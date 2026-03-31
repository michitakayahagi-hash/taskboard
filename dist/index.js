// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq, and, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { boolean, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var projects = mysqlTable("projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var columns = mysqlTable("columns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var tasks = mysqlTable("tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  colId: varchar("colId", { length: 64 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  assignee: varchar("assignee", { length: 100 }).notNull().default(""),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  due: varchar("due", { length: 20 }),
  tags: json("tags").$type().notNull().default([]),
  subtasks: json("subtasks").$type().notNull().default([]),
  description: text("description"),
  sortOrder: int("sortOrder").notNull().default(0),
  prevCol: varchar("prevCol", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  author: varchar("author", { length: 100 }).notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("settingKey", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var projectMembers = mysqlTable("project_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["viewer", "editor"]).notNull().default("viewer"),
  isAdmin: boolean("isAdmin").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});
var invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  role: mysqlEnum("role", ["viewer", "editor"]).notNull().default("viewer"),
  isAdmin: boolean("isAdmin").notNull().default(false),
  status: mysqlEnum("status", ["pending", "accepted", "expired"]).notNull().default("pending"),
  invitedBy: int("invitedBy"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getAllProjects() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).orderBy(asc(projects.createdAt));
}
async function createProject(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(projects).values(data);
  return data;
}
async function updateProject(id, data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
}
async function deleteProject(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(comments).where(
    eq(comments.taskId, id)
    // We'll handle this via task deletion
  );
  const projectTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id));
  for (const t2 of projectTasks) {
    await db.delete(comments).where(eq(comments.taskId, t2.id));
  }
  await db.delete(tasks).where(eq(tasks.projectId, id));
  await db.delete(columns).where(eq(columns.projectId, id));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
  await db.delete(invitations).where(eq(invitations.projectId, id));
  await db.delete(projects).where(eq(projects.id, id));
}
async function getColumnsByProject(projectId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(columns).where(eq(columns.projectId, projectId)).orderBy(asc(columns.sortOrder));
}
async function createColumn(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(columns).values(data);
  return data;
}
async function updateColumn(id, data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(columns).set(data).where(eq(columns.id, id));
}
async function deleteColumn(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(columns).where(eq(columns.id, id));
}
async function getTasksByProject(projectId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder));
}
async function createTask(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(tasks).values(data);
  return data;
}
async function createTasksBatch(dataArr) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (dataArr.length === 0) return;
  const CHUNK = 50;
  for (let i = 0; i < dataArr.length; i += CHUNK) {
    const chunk = dataArr.slice(i, i + CHUNK);
    await db.insert(tasks).values(chunk);
  }
}
async function updateTask(id, data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}
async function deleteTask(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(comments).where(eq(comments.taskId, id));
  await db.delete(tasks).where(eq(tasks.id, id));
}
async function getTaskById(id) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function getCommentsByTask(taskId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(comments).where(eq(comments.taskId, taskId)).orderBy(asc(comments.createdAt));
}
async function createComment(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(comments).values(data);
}
async function getSetting(key) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return result.length > 0 ? result[0].value : null;
}
async function setSetting(key, value) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(settings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}
async function getMembersByProject(projectId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.createdAt));
}
async function getMemberByNameAndProject(projectId, name) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.name, name))).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function getMemberByEmailAndProject(projectId, email) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email))).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function createProjectMember(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(projectMembers).values(data);
}
async function updateProjectMember(id, data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projectMembers).set(data).where(eq(projectMembers.id, id));
}
async function deleteProjectMember(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(projectMembers).where(eq(projectMembers.id, id));
}
async function hasAnyMember(projectId) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: projectMembers.id }).from(projectMembers).where(eq(projectMembers.projectId, projectId)).limit(1);
  return result.length > 0;
}
async function createInvitation(data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(invitations).values(data);
}
async function getInvitationByToken(token) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function getInvitationsByProject(projectId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invitations).where(eq(invitations.projectId, projectId)).orderBy(asc(invitations.createdAt));
}
async function updateInvitation(id, data) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(invitations).set(data).where(eq(invitations.id, id));
}
async function deleteInvitation(id) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(invitations).where(eq(invitations.id, id));
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z2 } from "zod";
import bcrypt from "bcryptjs";
import { TRPCError as TRPCError3 } from "@trpc/server";
import { randomUUID } from "crypto";

// server/_core/mailer.ts
import nodemailer from "nodemailer";
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[Mailer] SMTP settings not configured. Emails will not be sent.");
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}
async function sendInvitationEmail({
  to,
  projectName,
  inviteUrl,
  inviterName
}) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[Mailer] Would send invite to ${to} but SMTP not configured.`);
    return false;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transporter.sendMail({
    from,
    to,
    subject: `\u3010TaskBoard\u3011${projectName} \u3078\u62DB\u5F85\u3055\u308C\u307E\u3057\u305F`,
    html: `
      <div style="font-family:'Noto Sans JP',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8f7ff;border-radius:16px;">
        <h2 style="color:#6366f1;font-size:20px;margin:0 0 12px;">\u{1F4CB} TaskBoard \u62DB\u5F85</h2>
        <p style="color:#1e1b4b;font-size:14px;line-height:1.7;margin:0 0 16px;">
          <strong>${inviterName}</strong> \u3055\u3093\u304B\u3089 <strong>\u300C${projectName}\u300D</strong> \u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u3078\u306E\u62DB\u5F85\u304C\u5C4A\u3044\u3066\u3044\u307E\u3059\u3002
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(99,102,241,.35);">
          \u62DB\u5F85\u3092\u627F\u8A8D\u3057\u3066\u53C2\u52A0\u3059\u308B
        </a>
        <p style="color:#94a3b8;font-size:11px;margin:20px 0 0;">
          \u3053\u306E\u30EA\u30F3\u30AF\u306F72\u6642\u9593\u6709\u52B9\u3067\u3059\u3002\u5FC3\u5F53\u305F\u308A\u304C\u306A\u3044\u5834\u5408\u306F\u7121\u8996\u3057\u3066\u304F\u3060\u3055\u3044\u3002
        </p>
      </div>
    `
  });
  return true;
}

// server/routers.ts
var PROJECT_SESSION_COOKIE = "tb_proj_session";
var projectSessions = /* @__PURE__ */ new Map();
function genToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function getProjectSession(req, projectId) {
  const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
  if (!raw) return null;
  const session = projectSessions.get(raw);
  if (!session) return null;
  if (session.projectId !== projectId) return null;
  if (Date.now() > session.exp) {
    projectSessions.delete(raw);
    return null;
  }
  return session;
}
var COL_COLORS = ["#6366f1", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444", "#06b6d4", "#f97316", "#84cc16"];
var uid = () => "id" + Date.now() + Math.random().toString(36).slice(2, 8);
function parseCSVLines(text2) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text2.length; i++) {
    const ch = text2[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text2.length && text2[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        current.push(field);
        field = "";
      } else if (ch === "\r") {
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  // ─── Projects ───────────────────────────────────────────────────────────
  project: router({
    list: publicProcedure.query(async () => {
      return getAllProjects();
    }),
    create: publicProcedure.input(z2.object({ id: z2.string(), name: z2.string(), color: z2.string() })).mutation(async ({ input }) => {
      await createProject(input);
      return input;
    }),
    update: publicProcedure.input(z2.object({ id: z2.string(), name: z2.string().optional(), color: z2.string().optional() })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateProject(id, data);
      return { success: true };
    }),
    delete: publicProcedure.input(z2.object({ id: z2.string() })).mutation(async ({ input }) => {
      await deleteProject(input.id);
      return { success: true };
    })
  }),
  // ─── Columns ────────────────────────────────────────────────────────────
  column: router({
    list: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input }) => {
      return getColumnsByProject(input.projectId);
    }),
    create: publicProcedure.input(z2.object({ id: z2.string(), projectId: z2.string(), title: z2.string(), color: z2.string(), sortOrder: z2.number() })).mutation(async ({ input }) => {
      await createColumn(input);
      return input;
    }),
    update: publicProcedure.input(z2.object({ id: z2.string(), title: z2.string().optional(), color: z2.string().optional(), sortOrder: z2.number().optional() })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateColumn(id, data);
      return { success: true };
    }),
    delete: publicProcedure.input(z2.object({ id: z2.string() })).mutation(async ({ input }) => {
      await deleteColumn(input.id);
      return { success: true };
    })
  }),
  // ─── Tasks ──────────────────────────────────────────────────────────────
  task: router({
    list: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input }) => {
      return getTasksByProject(input.projectId);
    }),
    get: publicProcedure.input(z2.object({ id: z2.string() })).query(async ({ input }) => {
      return getTaskById(input.id);
    }),
    create: publicProcedure.input(z2.object({
      id: z2.string(),
      projectId: z2.string(),
      colId: z2.string(),
      title: z2.string(),
      assignee: z2.string().default(""),
      priority: z2.string().default("medium"),
      due: z2.string().nullable().optional(),
      tags: z2.array(z2.string()).default([]),
      subtasks: z2.array(z2.object({ id: z2.number(), text: z2.string(), done: z2.boolean() })).default([]),
      description: z2.string().nullable().optional(),
      sortOrder: z2.number().default(0)
    })).mutation(async ({ input }) => {
      await createTask(input);
      return input;
    }),
    update: publicProcedure.input(z2.object({
      id: z2.string(),
      colId: z2.string().optional(),
      title: z2.string().optional(),
      assignee: z2.string().optional(),
      priority: z2.string().optional(),
      due: z2.string().nullable().optional(),
      tags: z2.array(z2.string()).optional(),
      subtasks: z2.array(z2.object({ id: z2.number(), text: z2.string(), done: z2.boolean() })).optional(),
      description: z2.string().nullable().optional(),
      sortOrder: z2.number().optional(),
      prevCol: z2.string().nullable().optional()
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;
      await updateTask(id, data);
      return { success: true };
    }),
    delete: publicProcedure.input(z2.object({ id: z2.string() })).mutation(async ({ input }) => {
      await deleteTask(input.id);
      return { success: true };
    })
  }),
  // ─── Comments ───────────────────────────────────────────────────────────
  comment: router({
    list: publicProcedure.input(z2.object({ taskId: z2.string() })).query(async ({ input }) => {
      return getCommentsByTask(input.taskId);
    }),
    create: publicProcedure.input(z2.object({
      taskId: z2.string(),
      author: z2.string(),
      text: z2.string()
    })).mutation(async ({ input }) => {
      await createComment(input);
      return { success: true };
    })
  }),
  // ─── Import (Jooto CSV) ─────────────────────────────────────────────────
  import: router({
    jootoCSV: publicProcedure.input(z2.object({
      projectName: z2.string(),
      csvContent: z2.string()
    })).mutation(async ({ input }) => {
      const { projectName, csvContent } = input;
      const raw = csvContent.replace(/^\uFEFF/, "");
      const lines = parseCSVLines(raw);
      if (lines.length < 2) throw new Error("CSV\u306B\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093");
      const headers = lines[0];
      const listIdx = headers.indexOf("\u30EA\u30B9\u30C8\u540D*");
      const taskIdx = headers.indexOf("\u30BF\u30B9\u30AF\u540D*");
      const descIdx = headers.indexOf("\u8AAC\u660E");
      const statusIdx = headers.indexOf("\u30B9\u30C6\u30FC\u30BF\u30B9*");
      const labelIdx = headers.indexOf("\u30E9\u30D9\u30EB");
      const assigneeIdx = headers.indexOf("\u30BF\u30B9\u30AF\u62C5\u5F53\u8005");
      const startDateIdx = headers.indexOf("\u30BF\u30B9\u30AF\u958B\u59CB\u65E5");
      const dueDateIdx = headers.indexOf("\u30BF\u30B9\u30AF\u7DE0\u5207\u65E5");
      const checklistNameIdx = headers.indexOf("\u30C1\u30A7\u30C3\u30AF\u30EA\u30B9\u30C8\u540D");
      const checklistItemIdx = headers.indexOf("\u30A2\u30A4\u30C6\u30E0\u540D");
      const checklistDoneIdx = headers.indexOf("\u30A2\u30A4\u30C6\u30E0\u5B8C\u4E86\u30D5\u30E9\u30B0");
      if (listIdx === -1 || taskIdx === -1) {
        throw new Error("\u5FC5\u9808\u30AB\u30E9\u30E0\uFF08\u30EA\u30B9\u30C8\u540D*, \u30BF\u30B9\u30AF\u540D*\uFF09\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
      }
      const projectId = "p" + Date.now();
      const projectColor = COL_COLORS[Math.floor(Math.random() * COL_COLORS.length)];
      await createProject({ id: projectId, name: projectName, color: projectColor });
      const listNames = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        const listName = (row[listIdx] || "").trim();
        if (listName && !listNames.includes(listName)) {
          listNames.push(listName);
        }
      }
      const colMap = {};
      for (let i = 0; i < listNames.length; i++) {
        const colId = "col_" + projectId + "_" + i;
        await createColumn({
          id: colId,
          projectId,
          title: listNames[i],
          color: COL_COLORS[i % COL_COLORS.length],
          sortOrder: i
        });
        colMap[listNames[i]] = colId;
      }
      const allAssignees = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        const rawAssignee = assigneeIdx >= 0 ? (row[assigneeIdx] || "").replace(/^"|"$/g, "").trim() : "";
        if (rawAssignee) {
          const names = rawAssignee.split(/[\u3001,]/).map((n) => n.trim()).filter(Boolean);
          for (const name of names) {
            if (!allAssignees.includes(name)) {
              allAssignees.push(name);
            }
          }
        }
      }
      const existingMembersRaw = await getSetting("members");
      let existingMembers = [];
      try {
        existingMembers = JSON.parse(existingMembersRaw || "null") || [];
      } catch {
        existingMembers = [];
      }
      const mergedMembers = [...existingMembers];
      for (const name of allAssignees) {
        if (!mergedMembers.includes(name)) {
          mergedMembers.push(name);
        }
      }
      if (mergedMembers.length > 0) {
        await setSetting("members", JSON.stringify(mergedMembers));
      }
      let taskCount = 0;
      const taskSortOrders = {};
      const taskEntries = [];
      let currentTask = null;
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i];
        const listName = (row[listIdx] || "").trim();
        const taskName = (row[taskIdx] || "").trim();
        const colId = colMap[listName];
        if (!colId) continue;
        if (taskName) {
          if (currentTask) taskEntries.push(currentTask);
          const description = descIdx >= 0 ? (row[descIdx] || "").trim() : "";
          const labels = labelIdx >= 0 ? (row[labelIdx] || "").replace(/^"|"$/g, "").trim() : "";
          const rawAssignee = assigneeIdx >= 0 ? (row[assigneeIdx] || "").replace(/^"|"$/g, "").trim() : "";
          const assigneeNames = rawAssignee ? rawAssignee.split(/[\u3001,]/).map((n) => n.trim()).filter(Boolean) : [];
          const assignee = assigneeNames[0] || "";
          const dueDate = dueDateIdx >= 0 ? (row[dueDateIdx] || "").trim() : "";
          const tags = labels ? labels.split(",").map((l) => l.trim()).filter(Boolean) : [];
          const sortOrder = taskSortOrders[colId] || 0;
          taskSortOrders[colId] = sortOrder + 1;
          currentTask = {
            id: uid(),
            projectId,
            colId,
            title: taskName,
            assignee,
            priority: "medium",
            due: dueDate || null,
            tags,
            subtasks: [],
            description: description || null,
            sortOrder
          };
          const checkItem = checklistItemIdx >= 0 ? (row[checklistItemIdx] || "").trim() : "";
          if (checkItem) {
            const done = checklistDoneIdx >= 0 && (row[checklistDoneIdx] || "").trim() === "1";
            currentTask.subtasks.push({ id: currentTask.subtasks.length + 1, text: checkItem, done });
          }
          taskCount++;
        } else if (currentTask) {
          const checkItem = checklistItemIdx >= 0 ? (row[checklistItemIdx] || "").trim() : "";
          if (checkItem) {
            const done = checklistDoneIdx >= 0 && (row[checklistDoneIdx] || "").trim() === "1";
            currentTask.subtasks.push({ id: currentTask.subtasks.length + 1, text: checkItem, done });
          }
        }
      }
      if (currentTask) taskEntries.push(currentTask);
      await createTasksBatch(taskEntries.map((t2) => ({
        id: t2.id,
        projectId: t2.projectId,
        colId: t2.colId,
        title: t2.title,
        assignee: t2.assignee,
        priority: t2.priority,
        due: t2.due,
        tags: t2.tags,
        subtasks: t2.subtasks,
        description: t2.description,
        sortOrder: t2.sortOrder
      })));
      return {
        projectId,
        projectName,
        columnCount: listNames.length,
        taskCount,
        columns: listNames,
        members: allAssignees
      };
    })
  }),
  // ─── Settings ─────────────────────────────────────────────────
  setting: router({
    get: publicProcedure.input(z2.object({ key: z2.string() })).query(async ({ input }) => {
      const value = await getSetting(input.key);
      return { key: input.key, value };
    }),
    set: publicProcedure.input(z2.object({ key: z2.string(), value: z2.string() })).mutation(async ({ input }) => {
      await setSetting(input.key, input.value);
      return { success: true };
    })
  }),
  // ─── Project Access Control ──────────────────────────────────────────
  projectAccess: router({
    // Check if a project has any members (i.e., access control is enabled)
    hasRestriction: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input }) => {
      const restricted = await hasAnyMember(input.projectId);
      return { restricted };
    }),
    // Get current session info for a project
    getSession: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input, ctx }) => {
      const session = getProjectSession(ctx.req, input.projectId);
      if (!session) return null;
      return { name: session.name, role: session.role, isAdmin: session.isAdmin };
    }),
    // Login to a restricted project
    login: publicProcedure.input(z2.object({ projectId: z2.string(), name: z2.string(), password: z2.string() })).mutation(async ({ input, ctx }) => {
      const member = await getMemberByNameAndProject(input.projectId, input.name);
      if (!member) throw new TRPCError3({ code: "UNAUTHORIZED", message: "\u540D\u524D\u307E\u305F\u306F\u30D1\u30B9\u30EF\u30FC\u30C9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093" });
      const ok = await bcrypt.compare(input.password, member.passwordHash);
      if (!ok) throw new TRPCError3({ code: "UNAUTHORIZED", message: "\u540D\u524D\u307E\u305F\u306F\u30D1\u30B9\u30EF\u30FC\u30C9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093" });
      const token = genToken();
      const exp = Date.now() + 7 * 24 * 60 * 60 * 1e3;
      projectSessions.set(token, { projectId: input.projectId, memberId: member.id, role: member.role, name: member.name, isAdmin: member.isAdmin, exp });
      const res = ctx.res;
      res.cookie(PROJECT_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1e3 });
      return { success: true, name: member.name, role: member.role, isAdmin: member.isAdmin };
    }),
    // Logout from a project
    logout: publicProcedure.input(z2.object({ projectId: z2.string() })).mutation(async ({ ctx }) => {
      const req = ctx.req;
      const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
      if (raw) projectSessions.delete(raw);
      const res = ctx.res;
      res.clearCookie(PROJECT_SESSION_COOKIE, { httpOnly: true, sameSite: "lax" });
      return { success: true };
    }),
    // List members for a project (for settings screen)
    listMembers: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input }) => {
      const members = await getMembersByProject(input.projectId);
      return members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, isAdmin: m.isAdmin }));
    }),
    // Add a member to a project
    addMember: publicProcedure.input(z2.object({ projectId: z2.string(), name: z2.string(), password: z2.string(), role: z2.enum(["viewer", "editor"]), isAdmin: z2.boolean().optional() })).mutation(async ({ input }) => {
      const existing = await getMemberByNameAndProject(input.projectId, input.name);
      if (existing) throw new TRPCError3({ code: "CONFLICT", message: "\u540C\u3058\u540D\u524D\u306E\u30E1\u30F3\u30D0\u30FC\u304C\u3059\u3067\u306B\u5B58\u5728\u3057\u307E\u3059" });
      const passwordHash = await bcrypt.hash(input.password, 10);
      await createProjectMember({ projectId: input.projectId, name: input.name, passwordHash, role: input.role, isAdmin: input.isAdmin ?? false });
      return { success: true };
    }),
    // Update a member's role or password
    updateMember: publicProcedure.input(z2.object({ id: z2.number(), role: z2.enum(["viewer", "editor"]).optional(), password: z2.string().optional(), isAdmin: z2.boolean().optional() })).mutation(async ({ input }) => {
      const update = {};
      if (input.role) update.role = input.role;
      if (input.password) update.passwordHash = await bcrypt.hash(input.password, 10);
      if (input.isAdmin !== void 0) update.isAdmin = input.isAdmin;
      await updateProjectMember(input.id, update);
      return { success: true };
    }),
    // Remove a member from a project
    removeMember: publicProcedure.input(z2.object({ id: z2.number() })).mutation(async ({ input }) => {
      await deleteProjectMember(input.id);
      return { success: true };
    }),
    // ─── Invitation endpoints ───────────────────────────────────────────
    // Send invitation email
    sendInvite: publicProcedure.input(z2.object({
      projectId: z2.string(),
      email: z2.string().email(),
      role: z2.enum(["viewer", "editor"]),
      isAdmin: z2.boolean().optional(),
      inviterName: z2.string().optional()
    })).mutation(async ({ input, ctx }) => {
      const session = getProjectSession(ctx.req, input.projectId);
      const hasMembers = await hasAnyMember(input.projectId);
      if (hasMembers && (!session || !session.isAdmin)) {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u62DB\u5F85\u306F\u7BA1\u7406\u8005\u306E\u307F\u5B9F\u884C\u3067\u304D\u307E\u3059" });
      }
      const existingMember = await getMemberByEmailAndProject(input.projectId, input.email);
      if (existingMember) throw new TRPCError3({ code: "CONFLICT", message: "\u3053\u306E\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306F\u3059\u3067\u306B\u30E1\u30F3\u30D0\u30FC\u3067\u3059" });
      const projects2 = await getAllProjects();
      const project = projects2.find((p) => p.id === input.projectId);
      const projectName = project?.name ?? "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8";
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1e3);
      await createInvitation({
        projectId: input.projectId,
        email: input.email,
        token,
        role: input.role,
        isAdmin: input.isAdmin ?? false,
        status: "pending",
        invitedBy: session?.memberId ?? null,
        expiresAt
      });
      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3100}`;
      const inviteUrl = `${baseUrl}/invite/${token}`;
      const inviterName = input.inviterName || session?.name || "\u7BA1\u7406\u8005";
      const sent = await sendInvitationEmail({ to: input.email, projectName, inviteUrl, inviterName });
      return { success: true, emailSent: sent, inviteUrl };
    }),
    // Get invitation info by token (for accept page)
    getInvite: publicProcedure.input(z2.object({ token: z2.string() })).query(async ({ input }) => {
      const inv = await getInvitationByToken(input.token);
      if (!inv) throw new TRPCError3({ code: "NOT_FOUND", message: "\u62DB\u5F85\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      if (inv.status !== "pending") throw new TRPCError3({ code: "BAD_REQUEST", message: "\u3053\u306E\u62DB\u5F85\u306F\u3059\u3067\u306B\u4F7F\u7528\u6E08\u307F\u304B\u671F\u9650\u5207\u308C\u3067\u3059" });
      if (/* @__PURE__ */ new Date() > inv.expiresAt) {
        await updateInvitation(inv.id, { status: "expired" });
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u62DB\u5F85\u30EA\u30F3\u30AF\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059" });
      }
      const projects2 = await getAllProjects();
      const project = projects2.find((p) => p.id === inv.projectId);
      return {
        id: inv.id,
        projectId: inv.projectId,
        projectName: project?.name ?? "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8",
        email: inv.email,
        role: inv.role,
        isAdmin: inv.isAdmin
      };
    }),
    // Accept invitation (register with name + password)
    acceptInvite: publicProcedure.input(z2.object({
      token: z2.string(),
      name: z2.string().min(1),
      password: z2.string().min(6)
    })).mutation(async ({ input, ctx }) => {
      const inv = await getInvitationByToken(input.token);
      if (!inv) throw new TRPCError3({ code: "NOT_FOUND", message: "\u62DB\u5F85\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" });
      if (inv.status !== "pending") throw new TRPCError3({ code: "BAD_REQUEST", message: "\u3053\u306E\u62DB\u5F85\u306F\u3059\u3067\u306B\u4F7F\u7528\u6E08\u307F\u304B\u671F\u9650\u5207\u308C\u3067\u3059" });
      if (/* @__PURE__ */ new Date() > inv.expiresAt) {
        await updateInvitation(inv.id, { status: "expired" });
        throw new TRPCError3({ code: "BAD_REQUEST", message: "\u62DB\u5F85\u30EA\u30F3\u30AF\u306E\u6709\u52B9\u671F\u9650\u304C\u5207\u308C\u3066\u3044\u307E\u3059" });
      }
      const existingName = await getMemberByNameAndProject(inv.projectId, input.name);
      if (existingName) throw new TRPCError3({ code: "CONFLICT", message: "\u3053\u306E\u540D\u524D\u306F\u3059\u3067\u306B\u4F7F\u7528\u3055\u308C\u3066\u3044\u307E\u3059" });
      const passwordHash = await bcrypt.hash(input.password, 10);
      await createProjectMember({
        projectId: inv.projectId,
        name: input.name,
        email: inv.email,
        passwordHash,
        role: inv.role,
        isAdmin: inv.isAdmin
      });
      await updateInvitation(inv.id, { status: "accepted" });
      const token = genToken();
      const exp = Date.now() + 7 * 24 * 60 * 60 * 1e3;
      const members = await getMembersByProject(inv.projectId);
      const newMember = members.find((m) => m.name === input.name);
      if (newMember) {
        projectSessions.set(token, { projectId: inv.projectId, memberId: newMember.id, role: newMember.role, name: newMember.name, isAdmin: newMember.isAdmin, exp });
        const res = ctx.res;
        res.cookie(PROJECT_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1e3 });
      }
      return { success: true, projectId: inv.projectId, name: input.name, role: inv.role, isAdmin: inv.isAdmin };
    }),
    // List invitations for a project
    listInvitations: publicProcedure.input(z2.object({ projectId: z2.string() })).query(async ({ input, ctx }) => {
      const session = getProjectSession(ctx.req, input.projectId);
      const hasMembers = await hasAnyMember(input.projectId);
      if (hasMembers && (!session || !session.isAdmin)) {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u7BA1\u7406\u8005\u306E\u307F\u95B2\u89A7\u3067\u304D\u307E\u3059" });
      }
      const invs = await getInvitationsByProject(input.projectId);
      return invs.map((i) => ({ id: i.id, email: i.email, role: i.role, isAdmin: i.isAdmin, status: i.status, expiresAt: i.expiresAt }));
    }),
    // Revoke an invitation
    revokeInvite: publicProcedure.input(z2.object({ id: z2.number(), projectId: z2.string() })).mutation(async ({ input, ctx }) => {
      const session = getProjectSession(ctx.req, input.projectId);
      const hasMembers = await hasAnyMember(input.projectId);
      if (hasMembers && (!session || !session.isAdmin)) {
        throw new TRPCError3({ code: "FORBIDDEN", message: "\u7BA1\u7406\u8005\u306E\u307F\u5B9F\u884C\u3067\u304D\u307E\u3059" });
      }
      await deleteInvitation(input.id);
      return { success: true };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.post("/api/gchat-send", async (req, res) => {
    const { webhookUrl, text: text2 } = req.body;
    if (!webhookUrl || !text2) {
      res.status(400).json({ error: "webhookUrl and text are required" });
      return;
    }
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text2 })
      });
      if (!response.ok) {
        const body = await response.text();
        res.status(response.status).json({ error: body });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
