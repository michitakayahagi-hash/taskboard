import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getGoogleUserFromRequest } from "./googleAuth";
import { getSessionCookieOptions } from "./cookies";

const SYNC_STATE_COOKIE = "tb_gemini_sync_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GEMINI_PROJECT_NAME = "Gemini確認待ち";
const GEMINI_COLUMN_TITLE = "要確認";
const APP_BASE_URL = "https://proactive-caring-production-1be5.up.railway.app";

interface SyncState {
  state: string;
  ownerEmail: string;
  returnTo: string;
}

interface SyncConnection {
  id: number;
  ownerEmail: string;
  encryptedRefreshToken: string;
  pageToken: string;
  channelId: string | null;
  channelResourceId: string | null;
  channelToken: string | null;
  channelExpiresAt: number | null;
  enabled: number | boolean;
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  trashed?: boolean;
  webViewLink?: string;
  modifiedTime?: string;
}

interface ParsedActionItem {
  original: string;
  assignee: string;
  title: string;
  due: string | null;
}

function requiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "JWT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
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
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted Google credential");
  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function safeReturnTo(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function readState(req: Request): SyncState | null {
  const raw = req.cookies?.[SYNC_STATE_COOKIE];
  if (!raw || typeof raw !== "string") return null;
  try {
    const state = JSON.parse(raw) as SyncState;
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
  const mysql2 = await import("mysql2/promise");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return mysql2.createConnection(process.env.DATABASE_URL);
}

async function fetchJson(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`Google Drive API error: ${response.status}`);
  return response.json() as Promise<any>;
}

async function refreshAccessToken(connection: SyncConnection) {
  const refreshToken = decryptSecret(connection.encryptedRefreshToken);
  const body = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`);
  const token = await response.json() as { access_token?: string; refresh_token?: string };
  if (!token.access_token) throw new Error("Google token refresh returned no access token");
  if (token.refresh_token) {
    const conn = await getConnection();
    try {
      await conn.execute("UPDATE gemini_sync_connections SET encryptedRefreshToken = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [encryptSecret(token.refresh_token), connection.id]);
    } finally {
      await conn.end();
    }
  }
  return token.access_token;
}

async function getConnectionByEmail(ownerEmail: string): Promise<SyncConnection | null> {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute("SELECT * FROM gemini_sync_connections WHERE ownerEmail = ? LIMIT 1", [ownerEmail.toLowerCase()]) as any[];
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

async function getConnectionByChannel(channelId: string): Promise<SyncConnection | null> {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute("SELECT * FROM gemini_sync_connections WHERE channelId = ? AND enabled = TRUE LIMIT 1", [channelId]) as any[];
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

async function saveWatch(connectionId: number, channel: { id?: string; resourceId?: string; expiration?: string }, channelToken: string) {
  const expiresAt = channel.expiration ? Number(channel.expiration) : Date.now() + 60 * 60 * 1000;
  const conn = await getConnection();
  try {
    await conn.execute(
      "UPDATE gemini_sync_connections SET channelId = ?, channelResourceId = ?, channelToken = ?, channelExpiresAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
      [channel.id || null, channel.resourceId || null, channelToken, expiresAt, connectionId]
    );
  } finally {
    await conn.end();
  }
}

function getWebhookUrl() {
  const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  try {
    if (redirect) return `${new URL(redirect).origin}/api/gemini-sync/drive-notification`;
  } catch {
    // Fall through to the Railway public URL.
  }
  return `${APP_BASE_URL}/api/gemini-sync/drive-notification`;
}

async function createOrRenewWatch(connection: SyncConnection) {
  const accessToken = await refreshAccessToken(connection);
  const channelToken = randomBytes(32).toString("base64url");
  const channelId = randomUUID();
  const endpoint = new URL("https://www.googleapis.com/drive/v3/changes/watch");
  endpoint.searchParams.set("pageToken", connection.pageToken);
  endpoint.searchParams.set("spaces", "drive");
  const channel = await fetchJson(endpoint.toString(), accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: getWebhookUrl(),
      token: channelToken,
      expiration: String(Date.now() + 6 * 24 * 60 * 60 * 1000),
    }),
  });
  await saveWatch(connection.id, channel, channelToken);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function parseExplicitDueDate(text: string, referenceDate: Date) {
  const yearMatch = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  const monthDayMatch = text.match(/(?:期限|締切|まで|日まで|on)?\s*(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*(?:日)?/);
  let year: number;
  let month: number;
  let day: number;
  if (yearMatch) {
    year = Number(yearMatch[1]); month = Number(yearMatch[2]); day = Number(yearMatch[3]);
  } else if (monthDayMatch) {
    year = referenceDate.getUTCFullYear(); month = Number(monthDayMatch[1]); day = Number(monthDayMatch[2]);
  } else {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  if (!yearMatch && candidate.getTime() < referenceDate.getTime() - 120 * 24 * 60 * 60 * 1000) candidate.setUTCFullYear(year + 1);
  return candidate.toISOString().slice(0, 10);
}

function parseActionItems(documentText: string, modifiedTime?: string): ParsedActionItem[] {
  const text = normalizeWhitespace(documentText);
  const heading = text.search(/(?:^|\n)\s*(?:次のステップ|アクション項目|次のアクション)\s*(?:\n|$)/m);
  if (heading < 0) return [];
  const section = text.slice(heading).split(/\n/).slice(1);
  const items: string[] = [];
  let current = "";
  const bullet = /^(?:[□☐☑✓✔・•●▪︎\-*]|\d+[.)、])\s*/;
  const nextHeading = /^(?:会議の概要|決定事項|議題|詳細|メモ|録画|参加者|次回)/;
  for (const rawLine of section) {
    const line = rawLine.trim();
    if (!line) continue;
    if (nextHeading.test(line) && current) break;
    const startsItem = bullet.test(line) || /^\[[^\]]+\]/.test(line);
    if (startsItem) {
      if (current) items.push(current);
      current = line.replace(bullet, "").trim();
    } else if (current) {
      current += ` ${line}`;
    }
  }
  if (current) items.push(current);

  const referenceDate = modifiedTime ? new Date(modifiedTime) : new Date();
  return items.map((original) => {
    const assigneeMatch = original.match(/^\[([^\]]+)\]\s*/);
    const assignee = assigneeMatch ? assigneeMatch[1].trim() : "";
    const content = (assigneeMatch ? original.slice(assigneeMatch[0].length) : original).trim();
    const firstSentence = content.split(/[。\n]/)[0].trim();
    const title = (firstSentence || content).slice(0, 180);
    return { original: content, assignee, title, due: parseExplicitDueDate(content, referenceDate) };
  }).filter(item => item.title.length > 0);
}

async function ensureGeminiProject(conn: any) {
  const [projects] = await conn.execute("SELECT id FROM projects WHERE name = ? LIMIT 1", [GEMINI_PROJECT_NAME]) as any[];
  let projectId = projects[0]?.id as string | undefined;
  if (!projectId) {
    projectId = `p_gemini_${Date.now()}`;
    await conn.execute("INSERT INTO projects (id, name, color, isPublic) VALUES (?, ?, ?, FALSE)", [projectId, GEMINI_PROJECT_NAME, "#7c3aed"]);
  }
  const [columns] = await conn.execute("SELECT id FROM `columns` WHERE projectId = ? AND title = ? LIMIT 1", [projectId, GEMINI_COLUMN_TITLE]) as any[];
  let columnId = columns[0]?.id as string | undefined;
  if (!columnId) {
    columnId = `col_gemini_${Date.now()}`;
    await conn.execute("INSERT INTO `columns` (id, projectId, title, color, sortOrder) VALUES (?, ?, ?, ?, 0)", [columnId, projectId, GEMINI_COLUMN_TITLE, "#a78bfa"]);
  }
  return { projectId, columnId };
}

async function importDocument(connection: SyncConnection, accessToken: string, file: DriveFile) {
  if (file.mimeType !== "application/vnd.google-apps.document" || file.trashed || !file.id) return 0;
  const contentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fplain`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!contentResponse.ok) return 0;
  const documentText = await contentResponse.text();
  const items = parseActionItems(documentText, file.modifiedTime);
  if (items.length === 0) return 0;

  const conn = await getConnection();
  let count = 0;
  try {
    const { projectId, columnId } = await ensureGeminiProject(conn);
    for (const item of items) {
      const importKey = createHash("sha256").update(`${file.id}\n${item.assignee}\n${normalizeWhitespace(item.original)}`).digest("hex");
      const taskId = `gemini_${randomUUID()}`;
      const sourceUrl = file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit`;
      const [reservation] = await conn.execute(
        "INSERT IGNORE INTO gemini_imported_items (importKey, sourceFileId, sourceDocTitle, sourceUrl, taskId, sourceText) VALUES (?, ?, ?, ?, ?, ?)",
        [importKey, file.id, file.name || "Geminiによるメモ", sourceUrl, taskId, item.original]
      ) as any[];
      if (!reservation.affectedRows) continue;
      const [sortResult] = await conn.execute("SELECT COALESCE(MAX(sortOrder), -1) + 1 AS nextOrder FROM tasks WHERE colId = ?", [columnId]) as any[];
      const assignee = item.assignee || "担当未設定";
      const detailLines = [
        "Geminiによるメモから自動取込（確認待ち）",
        `Gemini指定担当: ${item.assignee ? `[${item.assignee}]` : "未記載"}`,
        item.due ? `Gemini指定期限: ${item.due}` : "Gemini指定期限: 未記載",
        "",
        item.original,
        "",
        `元メモ: ${sourceUrl}`,
      ];
      await conn.execute(
        "INSERT INTO tasks (id, projectId, colId, title, assignee, priority, due, dueStart, tags, subtasks, description, sortOrder, createdBy, taskStatus) VALUES (?, ?, ?, ?, ?, 'medium', ?, NULL, ?, JSON_ARRAY(), ?, ?, 'Geminiメモ', '確認待ち')",
        [taskId, projectId, columnId, item.title, assignee, item.due, JSON.stringify(["Geminiメモ", "確認待ち"]), detailLines.join("\n"), Number(sortResult[0]?.nextOrder || 0)]
      );
      count++;
    }
  } finally {
    await conn.end();
  }
  return count;
}

async function syncConnection(connection: SyncConnection) {
  if (!connection.enabled) return { imported: 0 };
  const accessToken = await refreshAccessToken(connection);
  let pageToken = connection.pageToken;
  let imported = 0;
  for (let page = 0; page < 20; page++) {
    const endpoint = new URL("https://www.googleapis.com/drive/v3/changes");
    endpoint.searchParams.set("pageToken", pageToken);
    endpoint.searchParams.set("spaces", "drive");
    endpoint.searchParams.set("fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,trashed,webViewLink,modifiedTime))");
    const result = await fetchJson(endpoint.toString(), accessToken);
    for (const change of result.changes || []) {
      if (change.removed || !change.file) continue;
      try {
        imported += await importDocument(connection, accessToken, change.file as DriveFile);
      } catch (error) {
        console.error("[GeminiSync] Failed to import a Drive file", error);
      }
    }
    if (result.nextPageToken) {
      pageToken = result.nextPageToken;
      continue;
    }
    pageToken = result.newStartPageToken || pageToken;
    break;
  }
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE gemini_sync_connections SET pageToken = ?, lastSyncedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [pageToken, connection.id]);
  } finally {
    await conn.end();
  }
  return { imported };
}

export async function getGeminiSyncStatus(ownerEmail: string) {
  const connection = await getConnectionByEmail(ownerEmail);
  if (!connection) return { connected: false, enabled: false, lastSyncedAt: null, channelExpiresAt: null };
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute("SELECT lastSyncedAt FROM gemini_sync_connections WHERE id = ?", [connection.id]) as any[];
    return {
      connected: true,
      enabled: Boolean(connection.enabled),
      lastSyncedAt: rows[0]?.lastSyncedAt || null,
      channelExpiresAt: connection.channelExpiresAt || null,
    };
  } finally {
    await conn.end();
  }
}

export async function triggerGeminiSync(ownerEmail: string) {
  const connection = await getConnectionByEmail(ownerEmail);
  if (!connection || !connection.enabled) throw new Error("Geminiメモ連携が未設定です");
  return syncConnection(connection);
}

export async function disableGeminiSync(ownerEmail: string) {
  const connection = await getConnectionByEmail(ownerEmail);
  if (!connection) return { success: true };
  const conn = await getConnection();
  try {
    await conn.execute("UPDATE gemini_sync_connections SET enabled = FALSE, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [connection.id]);
  } finally {
    await conn.end();
  }
  return { success: true };
}

export async function renewGeminiSyncWatches() {
  const conn = await getConnection();
  let rows: SyncConnection[] = [];
  try {
    const [result] = await conn.execute("SELECT * FROM gemini_sync_connections WHERE enabled = TRUE AND (channelExpiresAt IS NULL OR channelExpiresAt < ?)", [Date.now() + 24 * 60 * 60 * 1000]) as any[];
    rows = result as SyncConnection[];
  } finally {
    await conn.end();
  }
  for (const connection of rows) {
    try {
      await createOrRenewWatch(connection);
      console.log(`[GeminiSync] Watch renewed for ${connection.ownerEmail}`);
    } catch (error) {
      console.error(`[GeminiSync] Watch renewal failed for ${connection.ownerEmail}`, error);
    }
  }
}

export function registerGeminiSyncRoutes(app: Express) {
  app.get("/api/gemini-sync/login", async (req: Request, res: Response) => {
    try {
      const user = await getGoogleUserFromRequest(req);
      if (!user?.email || !user.email.toLowerCase().endsWith("@b-bloom.jp")) {
        res.redirect(302, "/login?error=authentication");
        return;
      }
      const state = randomBytes(32).toString("base64url");
      const returnTo = safeReturnTo(req.query.next) ? req.query.next : "/?geminiSync=connected";
      res.cookie(SYNC_STATE_COOKIE, JSON.stringify({ state, ownerEmail: user.email.toLowerCase(), returnTo } satisfies SyncState), {
        ...getSessionCookieOptions(req), maxAge: STATE_TTL_MS,
      });
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", requiredEnv("GOOGLE_CLIENT_ID"));
      url.searchParams.set("redirect_uri", `${getWebhookUrl().replace("/drive-notification", "/callback")}`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", `openid email profile ${GOOGLE_DRIVE_SCOPE}`);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("hd", "b-bloom.jp");
      url.searchParams.set("state", state);
      res.redirect(302, url.toString());
    } catch (error) {
      console.error("[GeminiSync] OAuth start failed", error);
      res.redirect(302, "/?geminiSync=error");
    }
  });

  app.get("/api/gemini-sync/callback", async (req: Request, res: Response) => {
    const savedState = readState(req);
    const receivedState = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    res.clearCookie(SYNC_STATE_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
    if (!savedState || !code || !statesMatch(receivedState, savedState.state)) {
      res.redirect(302, "/?geminiSync=error");
      return;
    }
    try {
      const redirectUri = `${getWebhookUrl().replace("/drive-notification", "/callback")}`;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: requiredEnv("GOOGLE_CLIENT_ID"),
          client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
      const token = await response.json() as { access_token?: string; refresh_token?: string };
      if (!token.access_token || !token.refresh_token) throw new Error("Google Drive access was not granted");
      const profile = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", token.access_token);
      const email = typeof profile.email === "string" ? profile.email.toLowerCase() : "";
      if (email !== savedState.ownerEmail || !email.endsWith("@b-bloom.jp")) throw new Error("Google account does not match the signed-in account");

      const start = await fetchJson("https://www.googleapis.com/drive/v3/changes/startPageToken", token.access_token);
      if (!start.startPageToken) throw new Error("Could not initialize Google Drive change tracking");
      const conn = await getConnection();
      let connection: SyncConnection;
      try {
        await conn.execute(
          "INSERT INTO gemini_sync_connections (ownerEmail, encryptedRefreshToken, pageToken, enabled) VALUES (?, ?, ?, TRUE) ON DUPLICATE KEY UPDATE encryptedRefreshToken = VALUES(encryptedRefreshToken), pageToken = VALUES(pageToken), enabled = TRUE, updatedAt = CURRENT_TIMESTAMP",
          [email, encryptSecret(token.refresh_token), start.startPageToken]
        );
        const [rows] = await conn.execute("SELECT * FROM gemini_sync_connections WHERE ownerEmail = ? LIMIT 1", [email]) as any[];
        connection = rows[0] as SyncConnection;
      } finally {
        await conn.end();
      }
      await createOrRenewWatch(connection);
      res.redirect(302, savedState.returnTo);
    } catch (error) {
      console.error("[GeminiSync] OAuth callback failed", error);
      res.redirect(302, "/?geminiSync=error");
    }
  });

  app.post("/api/gemini-sync/drive-notification", async (req: Request, res: Response) => {
    const channelId = req.header("x-goog-channel-id") || "";
    const channelToken = req.header("x-goog-channel-token") || "";
    const resourceState = req.header("x-goog-resource-state") || "";
    if (!channelId || !channelToken) {
      res.status(401).end();
      return;
    }
    const connection = await getConnectionByChannel(channelId);
    if (!connection?.channelToken || !statesMatch(channelToken, connection.channelToken)) {
      res.status(401).end();
      return;
    }
    res.status(204).end();
    if (resourceState !== "sync") {
      void syncConnection(connection).then(result => console.log(`[GeminiSync] Imported ${result.imported} task(s)`)).catch(error => console.error("[GeminiSync] Webhook sync failed", error));
    }
  });
}
