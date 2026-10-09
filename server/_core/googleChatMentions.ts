import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getGoogleUserFromRequest } from "./googleAuth";
import { getSessionCookieOptions } from "./cookies";

const CHAT_OAUTH_STATE_COOKIE = "tb_google_chat_mentions_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_CHAT_MESSAGES_SCOPE = "https://www.googleapis.com/auth/chat.messages.create";
const APP_BASE_URL = "https://proactive-caring-production-1be5.up.railway.app";

type ChatMentionOAuthState = {
  state: string;
  ownerEmail: string;
  returnTo: string;
};

type ChatMentionConnection = {
  id: number;
  ownerEmail: string;
  encryptedRefreshToken: string;
  enabled: number | boolean;
};

export type GoogleChatMentionResolver = (assignee?: string | null) => string;

function requiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "JWT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getAppOrigin() {
  try {
    const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (redirect) return new URL(redirect).origin;
  } catch {
    // Fall through to the Railway app URL.
  }
  return APP_BASE_URL;
}

export function getGoogleChatMentionRedirectUri() {
  return `${getAppOrigin()}/api/google-chat-mentions/callback`;
}

function deriveEncryptionKey() {
  return createHash("sha256").update(requiredEnv("JWT_SECRET")).digest();
}

function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted Google Chat credential");
  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function safeReturnTo(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function splitAssignees(assignee?: string | null) {
  return (assignee || "")
    .split(/[、,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

export function formatAssigneeWithGoogleChatMentions(
  assignee: string | null | undefined,
  emailByName: ReadonlyMap<string, string>,
) {
  const names = splitAssignees(assignee);
  if (names.length === 0) return "担当未設定";
  return names.map((name) => {
    const email = emailByName.get(name);
    // The email form is supported for a user-authenticated Google Chat API message.
    return email ? `<users/${email}>` : name;
  }).join(" & ");
}

export function getGoogleChatSpaceName(webhookUrl: string) {
  try {
    const url = new URL(webhookUrl);
    if (url.hostname !== "chat.googleapis.com") return null;
    const match = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/messages$/);
    return match?.[1] ? `spaces/${decodeURIComponent(match[1])}` : null;
  } catch {
    return null;
  }
}

function isTaskBoardSuperAdmin(email?: string | null) {
  if (!email) return false;
  const superAdmins = (process.env.TASKBOARD_SUPERADMIN_EMAILS || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return superAdmins.includes(email.toLowerCase());
}

function readState(req: Request): ChatMentionOAuthState | null {
  const raw = req.cookies?.[CHAT_OAUTH_STATE_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  try {
    const state = JSON.parse(raw) as ChatMentionOAuthState;
    if (!state.state || !state.ownerEmail || !safeReturnTo(state.returnTo)) return null;
    return state;
  } catch {
    return null;
  }
}

function statesMatch(received: string, expected: string) {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function getConnection() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const mysql2 = await import("mysql2/promise");
  return mysql2.createConnection(process.env.DATABASE_URL);
}

async function getActiveConnection(): Promise<ChatMentionConnection | null> {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute(
      "SELECT id, ownerEmail, encryptedRefreshToken, enabled FROM google_chat_mention_connections WHERE enabled = TRUE ORDER BY updatedAt DESC LIMIT 1",
    ) as any[];
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

export async function isGoogleChatMentionConfigured() {
  return Boolean(await getActiveConnection());
}

async function refreshAccessToken(connection: ChatMentionConnection) {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Google Chat token refresh failed: ${response.status}`);
  const token = await response.json() as { access_token?: string; refresh_token?: string };
  if (!token.access_token) throw new Error("Google Chat token refresh returned no access token");
  if (token.refresh_token) {
    const conn = await getConnection();
    try {
      await conn.execute(
        "UPDATE google_chat_mention_connections SET encryptedRefreshToken = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
        [encryptSecret(token.refresh_token), connection.id],
      );
    } finally {
      await conn.end();
    }
  }
  return token.access_token;
}

/**
 * Resolves task-assignee display names to Google account emails without exposing
 * emails in the task notification text. Explicit project membership takes priority;
 * for organization-wide projects the registered TaskBoard user email is used.
 */
export async function createGoogleChatMentionResolver(
  projectId: string,
  assigneeValues: Array<string | null | undefined>,
): Promise<GoogleChatMentionResolver> {
  const names = Array.from(new Set(assigneeValues.flatMap(splitAssignees)));
  const emailByName = new Map<string, string>();
  if (names.length === 0 || !process.env.DATABASE_URL) {
    return (assignee) => formatAssigneeWithGoogleChatMentions(assignee, emailByName);
  }

  const placeholders = names.map(() => "?").join(",");
  const conn = await getConnection();
  try {
    const [settings] = await conn.execute(
      "SELECT value FROM settings WHERE settingKey = ? LIMIT 1",
      [`assignee_email_map_${projectId}`],
    ) as any[];
    try {
      const savedMap = JSON.parse(settings[0]?.value || "{}") as Record<string, unknown>;
      for (const name of names) {
        const email = typeof savedMap[name] === "string" ? savedMap[name].trim().toLowerCase() : "";
        if (email.includes("@")) emailByName.set(name, email);
      }
    } catch {
      // Invalid legacy settings are ignored and fall back to registered project members.
    }

    const [projectMembers] = await conn.execute(
      `SELECT name, email FROM project_members WHERE projectId = ? AND name IN (${placeholders}) AND email IS NOT NULL AND email <> ''`,
      [projectId, ...names],
    ) as any[];
    for (const member of projectMembers) {
      const name = typeof member.name === "string" ? member.name.trim() : "";
      const email = typeof member.email === "string" ? member.email.trim().toLowerCase() : "";
      if (name && email && !emailByName.has(name)) emailByName.set(name, email);
    }

    const unresolved = names.filter((name) => !emailByName.has(name));
    if (unresolved.length > 0) {
      const userPlaceholders = unresolved.map(() => "?").join(",");
      const [users] = await conn.execute(
        `SELECT name, email FROM users WHERE name IN (${userPlaceholders}) AND email IS NOT NULL AND email <> ''`,
        unresolved,
      ) as any[];
      for (const user of users) {
        const name = typeof user.name === "string" ? user.name.trim() : "";
        const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
        if (name && email && !emailByName.has(name)) emailByName.set(name, email);
      }
    }
  } finally {
    await conn.end();
  }

  return (assignee) => formatAssigneeWithGoogleChatMentions(assignee, emailByName);
}

async function postWebhookMessage(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return response.ok;
}

/**
 * Sends through the Google Chat API when the one-time administrator connection is
 * active. The legacy incoming webhook is retained as a safe fallback, so deadline
 * notifications continue even if Google Chat access is later revoked.
 */
export async function sendGoogleChatDeadlineMessage(webhookUrl: string, text: string, fallbackText = text) {
  const connection = await getActiveConnection().catch(() => null);
  const spaceName = getGoogleChatSpaceName(webhookUrl);
  if (connection && spaceName) {
    try {
      const accessToken = await refreshAccessToken(connection);
      const response = await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      if (response.ok) return { delivered: true, transport: "chat-api" as const };
      console.error(`[GoogleChatMention] Chat API delivery failed: ${response.status}`);
    } catch (error) {
      console.error("[GoogleChatMention] Chat API delivery error; using webhook fallback", error);
    }
  }

  try {
    const delivered = await postWebhookMessage(webhookUrl, fallbackText);
    return { delivered, transport: "webhook" as const };
  } catch (error) {
    console.error("[GoogleChatMention] Webhook fallback delivery error", error);
    return { delivered: false, transport: "webhook" as const };
  }
}

export function registerGoogleChatMentionRoutes(app: Express) {
  app.get("/api/google-chat-mentions/login", async (req: Request, res: Response) => {
    try {
      const user = await getGoogleUserFromRequest(req);
      if (!user?.email || !isTaskBoardSuperAdmin(user.email)) {
        res.redirect(302, "/?chatMentions=forbidden");
        return;
      }
      const state = randomBytes(32).toString("base64url");
      const returnTo = safeReturnTo(req.query.next) ? req.query.next : "/?chatMentions=connected";
      res.cookie(CHAT_OAUTH_STATE_COOKIE, JSON.stringify({
        state,
        ownerEmail: user.email.toLowerCase(),
        returnTo,
      } satisfies ChatMentionOAuthState), {
        ...getSessionCookieOptions(req),
        maxAge: STATE_TTL_MS,
      });

      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
      url.searchParams.set("redirect_uri", getGoogleChatMentionRedirectUri());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", `openid email profile ${GOOGLE_CHAT_MESSAGES_SCOPE}`);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      res.redirect(302, url.toString());
    } catch (error) {
      console.error("[GoogleChatMention] OAuth start failed", error);
      res.redirect(302, "/?chatMentions=error");
    }
  });

  app.get("/api/google-chat-mentions/callback", async (req: Request, res: Response) => {
    const savedState = readState(req);
    const receivedState = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    res.clearCookie(CHAT_OAUTH_STATE_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });

    if (!savedState || !code || !statesMatch(receivedState, savedState.state)) {
      res.redirect(302, "/?chatMentions=error");
      return;
    }

    try {
      const signedInUser = await getGoogleUserFromRequest(req);
      if (!signedInUser?.email || signedInUser.email.toLowerCase() !== savedState.ownerEmail || !isTaskBoardSuperAdmin(signedInUser.email)) {
        throw new Error("Signed-in administrator does not match the authorization request");
      }
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: requiredEnv("GOOGLE_CLIENT_ID"),
          client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
          redirect_uri: getGoogleChatMentionRedirectUri(),
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) throw new Error(`Google Chat token exchange failed: ${response.status}`);
      const token = await response.json() as { refresh_token?: string };
      if (!token.refresh_token) throw new Error("Google Chat access was not granted");

      const conn = await getConnection();
      try {
        await conn.execute(
          "INSERT INTO google_chat_mention_connections (ownerEmail, encryptedRefreshToken, enabled) VALUES (?, ?, TRUE) ON DUPLICATE KEY UPDATE encryptedRefreshToken = VALUES(encryptedRefreshToken), enabled = TRUE, updatedAt = CURRENT_TIMESTAMP",
          [savedState.ownerEmail, encryptSecret(token.refresh_token)],
        );
      } finally {
        await conn.end();
      }
      res.redirect(302, savedState.returnTo);
    } catch (error) {
      console.error("[GoogleChatMention] OAuth callback failed", error);
      res.redirect(302, "/?chatMentions=error");
    }
  });
}
