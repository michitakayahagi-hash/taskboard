import { bigint, boolean, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Projects table
 */
export const projects = mysqlTable("projects", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  isPublic: boolean("isPublic").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Columns (board columns) table
 */
export const columns = mysqlTable("columns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  color: varchar("color", { length: 32 }).notNull().default("#6366f1"),
  sortOrder: int("sortOrder").notNull().default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Column = typeof columns.$inferSelect;
export type InsertColumn = typeof columns.$inferInsert;

/**
 * Tasks table
 */
export const tasks = mysqlTable("tasks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  colId: varchar("colId", { length: 64 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  assignee: varchar("assignee", { length: 100 }).notNull().default(""),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  due: varchar("due", { length: 20 }),
  tags: json("tags").$type<string[]>().notNull().default([]),
  subtasks: json("subtasks").$type<{ id: number; text: string; done: boolean; assignee?: string; url?: string }[]>().notNull().default([]),
  description: text("description"),
  sortOrder: int("sortOrder").notNull().default(0),
  prevCol: varchar("prevCol", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Comments table
 */
export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  author: varchar("author", { length: 100 }).notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

/**
 * Settings table (key-value store for webhook URL, members, member IDs, etc.)
 */
export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("settingKey", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Setting = typeof settings.$inferSelect;
export type InsertSetting = typeof settings.$inferInsert;

/**
 * Project members table (per-project access control)
 * - isAdmin true: admin role (can invite members)
 * - isAdmin false: general member
 * Password is stored as bcrypt hash.
 */
export const projectMembers = mysqlTable("project_members", {
  id: int("id").autoincrement().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["viewer", "editor"]).notNull().default("viewer"),
  isAdmin: boolean("isAdmin").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;

/**
 * Invitations table
 * - token: unique invite token (UUID)
 * - status: pending / accepted / expired
 */
export const invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  role: mysqlEnum("role", ["viewer", "editor"]).notNull().default("viewer"),
  isAdmin: boolean("isAdmin").notNull().default(false),
  status: mysqlEnum("status", ["pending", "accepted", "expired"]).notNull().default("pending"),
  invitedBy: int("invitedBy"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

/**
 * Project Sessions table (DB-persisted, survives server restarts)
 */
export const projectSessions = mysqlTable("project_sessions", {
  token: varchar("token", { length: 128 }).notNull().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  memberId: int("memberId").notNull(),
  role: mysqlEnum("role", ["viewer", "editor"]).notNull().default("viewer"),
  name: varchar("name", { length: 100 }).notNull(),
  isAdmin: boolean("isAdmin").notNull().default(false),
  exp: bigint("exp", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectSession = typeof projectSessions.$inferSelect;
export type InsertProjectSession = typeof projectSessions.$inferInsert;

/**
 * Attachments table (files attached to tasks)
 */
export const attachments = mysqlTable("attachments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: int("fileSize").notNull(),
  uploadedBy: varchar("uploadedBy", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;

/**
 * Subtask Templates table
 * - プロジェクトごとに小タスクのテンプレートを保存
 * - items: 小タスク名の配列（JSON）
 */
export const subtaskTemplates = mysqlTable("subtask_templates", {
  id: int("id").autoincrement().primaryKey(),
  projectId: varchar("projectId", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  items: json("items").$type<string[]>().notNull().default([]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type SubtaskTemplate = typeof subtaskTemplates.$inferSelect;
export type InsertSubtaskTemplate = typeof subtaskTemplates.$inferInsert;
