import { eq, and, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  projects, InsertProject,
  columns, InsertColumn,
  tasks, InsertTask,
  comments, InsertComment,
  settings,
  projectMembers, InsertProjectMember,
  invitations, InsertInvitation,
  projectSessions, InsertProjectSession,
  attachments, InsertAttachment,
  subtaskTemplates, InsertSubtaskTemplate,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

// ─── User helpers ───────────────────────────────────────────────────────────
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) { values.lastSignedIn = new Date(); }
    if (Object.keys(updateSet).length === 0) { updateSet.lastSignedIn = new Date(); }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Project helpers ────────────────────────────────────────────────────────
export async function getProjectById(id: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
export async function getAllProjects() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).orderBy(asc(projects.createdAt));
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(projects).values(data);
  return data;
}

export async function updateProject(id: string, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projects).set(data).where(eq(projects.id, id));
}

export async function deleteProject(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(comments).where(
    eq(comments.taskId, id) // We'll handle this via task deletion
  );
  // Delete all tasks' comments and attachments first
  const projectTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id));
  for (const t of projectTasks) {
    await db.delete(comments).where(eq(comments.taskId, t.id));
    try { await db.delete(attachments).where(eq(attachments.taskId, t.id)); } catch (_) { /* テーブル未作成の場合は無視 */ }
  }
  await db.delete(tasks).where(eq(tasks.projectId, id));
  await db.delete(columns).where(eq(columns.projectId, id));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
  await db.delete(invitations).where(eq(invitations.projectId, id));
  try { await db.delete(subtaskTemplates).where(eq(subtaskTemplates.projectId, id)); } catch (_) { /* テーブル未作成の場合は無視 */ }
  await db.delete(projects).where(eq(projects.id, id));
}

// ─── Column helpers ─────────────────────────────────────────────────────────
export async function getColumnsByProject(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(columns).where(eq(columns.projectId, projectId)).orderBy(asc(columns.sortOrder));
}
export async function getColumnById(id: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(columns).where(eq(columns.id, id));
  return rows[0] || null;
}
export async function getTasksByColId(colId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.colId, colId)).orderBy(asc(tasks.sortOrder));
}

export async function createColumn(data: InsertColumn) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(columns).values(data);
  return data;
}

export async function updateColumn(id: string, data: Partial<InsertColumn>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(columns).set(data).where(eq(columns.id, id));
}

export async function deleteColumn(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  // カラム内のタスクを取得してコメント・添付ファイルを先に削除
  const colTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.colId, id));
  for (const t of colTasks) {
    await db.delete(comments).where(eq(comments.taskId, t.id));
    try { await db.delete(attachments).where(eq(attachments.taskId, t.id)); } catch (_) { /* テーブル未作成の場合は無視 */ }
  }
  await db.delete(tasks).where(eq(tasks.colId, id));
  await db.delete(columns).where(eq(columns.id, id));
}

// ─── Task helpers ───────────────────────────────────────────────────────────
export async function getTasksByProject(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder));
}

export async function getAllTasksWithMeta() {
  const db = await getDb();
  if (!db) return [];
  const allTasks = await db.select().from(tasks).orderBy(asc(tasks.sortOrder));
  const allProjects = await db.select().from(projects);
  const allColumns = await db.select().from(columns);
  const projectMap: Record<string, string> = {};
  allProjects.forEach((p: any) => { projectMap[p.id] = p.name; });
  const columnMap: Record<string, { title: string; color: string }> = {};
  allColumns.forEach((c: any) => { columnMap[c.id] = { title: c.title, color: c.color }; });
  return allTasks.map((t: any) => ({
    ...t,
    projectName: projectMap[t.projectId] || t.projectId,
    colTitle: columnMap[t.colId]?.title || t.colId,
    colColor: columnMap[t.colId]?.color || "#6366f1",
  }));
}

export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(tasks).values(data);
  return data;
}

export async function createTasksBatch(dataArr: InsertTask[]) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  if (dataArr.length === 0) return;
  // Insert in chunks of 50 to avoid MySQL packet size limits
  const CHUNK = 50;
  for (let i = 0; i < dataArr.length; i += CHUNK) {
    const chunk = dataArr.slice(i, i + CHUNK);
    await db.insert(tasks).values(chunk);
  }
}

export async function updateTask(id: string, data: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

export async function deleteTask(id: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(comments).where(eq(comments.taskId, id));
  await db.delete(tasks).where(eq(tasks.id, id));
}

export async function getTaskById(id: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ─── Comment helpers ────────────────────────────────────────────────────────
export async function getCommentsByTask(taskId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(comments).where(eq(comments.taskId, taskId)).orderBy(asc(comments.createdAt));
}

export async function createComment(data: InsertComment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(comments).values(data);
}

export async function deleteComment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(comments).where(eq(comments.id, id));
}

// ─── Settings helpers ───────────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return result.length > 0 ? result[0].value : null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(settings).values({ key, value }).onDuplicateKeyUpdate({ set: { value } });
}

// ─── Project Member helpers ─────────────────────────────────────────────────
export async function getMembersByProject(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.createdAt));
}

export async function getMemberByNameAndProject(projectId: string, name: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.name, name)))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getMemberByEmailAndProject(projectId: string, email: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.email, email)))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createProjectMember(data: InsertProjectMember) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(projectMembers).values(data);
}

export async function updateProjectMember(id: number, data: Partial<InsertProjectMember>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(projectMembers).set(data).where(eq(projectMembers.id, id));
}

export async function deleteProjectMember(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(projectMembers).where(eq(projectMembers.id, id));
}

export async function hasAnyMember(projectId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(eq(projectMembers.projectId, projectId)).limit(1);
  return result.length > 0;
}

// ─── Invitation helpers ─────────────────────────────────────────────────────
export async function createInvitation(data: InsertInvitation) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(invitations).values(data);
}

export async function getInvitationByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getInvitationsByProject(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(invitations).where(eq(invitations.projectId, projectId)).orderBy(asc(invitations.createdAt));
}

export async function updateInvitation(id: number, data: Partial<InsertInvitation>) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(invitations).set(data).where(eq(invitations.id, id));
}

export async function deleteInvitation(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(invitations).where(eq(invitations.id, id));
}

// ─── Project Sessions (DB-persisted) ─────────────────────────────────────────
export async function createProjectSession(data: InsertProjectSession) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(projectSessions).values(data);
}
export async function getProjectSessionByToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(projectSessions).where(eq(projectSessions.token, token)).limit(1);
  return result.length > 0 ? result[0] : null;
}
export async function deleteProjectSession(token: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectSessions).where(eq(projectSessions.token, token));
}

// ─── Attachments ─────────────────────────────────────────────────────────────
export async function createAttachment(data: InsertAttachment) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(attachments).values(data);
}
export async function getAttachmentsByTask(taskId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(attachments).where(eq(attachments.taskId, taskId)).orderBy(asc(attachments.createdAt));
}
export async function deleteAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(attachments).where(eq(attachments.id, id));
}

// ─── Subtask Templates ────────────────────────────────────────────────────────
export async function getSubtaskTemplates(projectId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subtaskTemplates).where(eq(subtaskTemplates.projectId, projectId)).orderBy(asc(subtaskTemplates.createdAt));
}
export async function createSubtaskTemplate(data: InsertSubtaskTemplate) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.insert(subtaskTemplates).values(data);
}
export async function updateSubtaskTemplate(id: number, data: { name?: string; items?: string[] }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.update(subtaskTemplates).set(data).where(eq(subtaskTemplates.id, id));
}
export async function deleteSubtaskTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(subtaskTemplates).where(eq(subtaskTemplates.id, id));
}
