import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { getGoogleHostedDomainHint, isAllowedGoogleWorkspaceEmail } from "./googleDomainPolicy";

const GOOGLE_SESSION_COOKIE = "tb_google_session";
const GOOGLE_STATE_COOKIE = "tb_google_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

type OAuthState = {
  state: string;
  returnTo: string;
};

function getRequiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_OAUTH_REDIRECT_URI") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

function isSafeReturnTo(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function readOAuthState(req: Request): OAuthState | null {
  const raw = req.cookies?.[GOOGLE_STATE_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as OAuthState;
    if (!parsed.state || !isSafeReturnTo(parsed.returnTo)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStateCookie(req: Request, res: Response) {
  res.clearCookie(GOOGLE_STATE_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}

function stateMatches(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function clearGoogleSession(req: Request, res: Response) {
  res.clearCookie(GOOGLE_SESSION_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}

async function createGoogleSessionToken(user: User) {
  return new SignJWT({ email: user.email ?? "", name: user.name ?? "" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.openId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function getGoogleUserFromRequest(req: Request): Promise<User | null> {
  const token = req.cookies?.[GOOGLE_SESSION_COOKIE];
  if (!token || typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return (await db.getUserByOpenId(payload.sub)) ?? null;
  } catch {
    return null;
  }
}

export function registerGoogleAuthRoutes(app: Express) {
  app.get("/api/auth/google/login", (req: Request, res: Response) => {
    try {
      const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
      const redirectUri = getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI");
      const hostedDomainHint = getGoogleHostedDomainHint();
      const returnTo = isSafeReturnTo(req.query.next) ? req.query.next : "/";
      const state = randomBytes(32).toString("base64url");

      res.cookie(
        GOOGLE_STATE_COOKIE,
        JSON.stringify({ state, returnTo } satisfies OAuthState),
        { ...getSessionCookieOptions(req), maxAge: STATE_TTL_MS }
      );

      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", state);
      // Google OAuthのhdは単一ドメイン専用。複数許可時は省略し、コールバックで署名済みIDトークンのメールドメインを厳密に確認する。
      if (hostedDomainHint) url.searchParams.set("hd", hostedDomainHint);
      url.searchParams.set("prompt", "select_account");
      res.redirect(302, url.toString());
    } catch (error) {
      console.error("[GoogleAuth] Login start failed", error);
      res.redirect(302, "/login?error=configuration");
    }
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const savedState = readOAuthState(req);
    clearStateCookie(req, res);

    if (!code || !savedState || !stateMatches(state, savedState.state)) {
      res.redirect(302, "/login?error=state");
      return;
    }

    try {
      const clientId = getRequiredEnv("GOOGLE_CLIENT_ID");
      const clientSecret = getRequiredEnv("GOOGLE_CLIENT_SECRET");
      const redirectUri = getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${tokenResponse.status}`);

      const tokens = await tokenResponse.json() as { id_token?: string };
      if (!tokens.id_token) throw new Error("Google did not return an id_token");

      const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
        audience: clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });
      const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      const emailVerified = payload.email_verified === true || payload.email_verified === "true";
      if (!payload.sub || !emailVerified || !isAllowedGoogleWorkspaceEmail(email)) {
        res.redirect(302, "/login?error=domain");
        return;
      }

      const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : email.split("@")[0];
      const user = await db.findOrCreateGoogleUser({ openId: payload.sub, email, name });
      const sessionToken = await createGoogleSessionToken(user);
      res.cookie(GOOGLE_SESSION_COOKIE, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: SESSION_TTL_SECONDS * 1000,
      });
      res.redirect(302, savedState.returnTo);
    } catch (error) {
      console.error("[GoogleAuth] Callback failed", error);
      res.redirect(302, "/login?error=authentication");
    }
  });
}

export const googleSessionCookieName = GOOGLE_SESSION_COOKIE;
export const googleOAuthStateCookieName = GOOGLE_STATE_COOKIE;
