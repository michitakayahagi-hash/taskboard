import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";

// Cookie name for project-level auth sessions
const PROJECT_SESSION_COOKIE = "tb_proj_session";

// In-memory project session store: token -> { projectId, memberId, role, name, exp }
const projectSessions = new Map<string, { projectId: string; memberId: number; role: "viewer" | "editor"; name: string; exp: number }>();

function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function getProjectSession(req: { cookies?: Record<string, string> }, projectId: string) {
  const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
  if (!raw) return null;
  const session = projectSessions.get(raw);
  if (!session) return null;
  if (session.projectId !== projectId) return null;
  if (Date.now() > session.exp) { projectSessions.delete(raw); return null; }
  return session;
}

const COL_COLORS = ["#6366f1", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444", "#06b6d4", "#f97316", "#84cc16"];
const uid = () => "id" + Date.now() + Math.random().toString(36).slice(2, 8);

/** Parse CSV text into rows of string arrays, handling quoted fields with commas/newlines */
function parseCSVLines(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
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
      } else if (ch === ',') {
        current.push(field);
        field = "";
      } else if (ch === '\r') {
        // skip
      } else if (ch === '\n') {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  // Remove empty trailing rows
  while (rows.length > 0 && rows[rows.length - 1].every(c => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Projects ───────────────────────────────────────────────────────────
  project: router({
    list: publicProcedure.query(async () => {
      return db.getAllProjects();
    }),
    create: publicProcedure
      .input(z.object({ id: z.string(), name: z.string(), color: z.string() }))
      .mutation(async ({ input }) => {
        await db.createProject(input);
        return input;
      }),
    update: publicProcedure
      .input(z.object({ id: z.string(), name: z.string().optional(), color: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateProject(id, data);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteProject(input.id);
        return { success: true };
      }),
  }),

  // ─── Columns ────────────────────────────────────────────────────────────
  column: router({
    list: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        return db.getColumnsByProject(input.projectId);
      }),
    create: publicProcedure
      .input(z.object({ id: z.string(), projectId: z.string(), title: z.string(), color: z.string(), sortOrder: z.number() }))
      .mutation(async ({ input }) => {
        await db.createColumn(input);
        return input;
      }),
    update: publicProcedure
      .input(z.object({ id: z.string(), title: z.string().optional(), color: z.string().optional(), sortOrder: z.number().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateColumn(id, data);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteColumn(input.id);
        return { success: true };
      }),
  }),

  // ─── Tasks ──────────────────────────────────────────────────────────────
  task: router({
    list: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        return db.getTasksByProject(input.projectId);
      }),
    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return db.getTaskById(input.id);
      }),
    create: publicProcedure
      .input(z.object({
        id: z.string(),
        projectId: z.string(),
        colId: z.string(),
        title: z.string(),
        assignee: z.string().default(""),
        priority: z.string().default("medium"),
        due: z.string().nullable().optional(),
        tags: z.array(z.string()).default([]),
        subtasks: z.array(z.object({ id: z.number(), text: z.string(), done: z.boolean() })).default([]),
        description: z.string().nullable().optional(),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        await db.createTask(input);
        return input;
      }),
    update: publicProcedure
      .input(z.object({
        id: z.string(),
        colId: z.string().optional(),
        title: z.string().optional(),
        assignee: z.string().optional(),
        priority: z.string().optional(),
        due: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        subtasks: z.array(z.object({ id: z.number(), text: z.string(), done: z.boolean() })).optional(),
        description: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
        prevCol: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateTask(id, data);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteTask(input.id);
        return { success: true };
      }),
  }),

  // ─── Comments ───────────────────────────────────────────────────────────
  comment: router({
    list: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input }) => {
        return db.getCommentsByTask(input.taskId);
      }),
    create: publicProcedure
      .input(z.object({
        taskId: z.string(),
        author: z.string(),
        text: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.createComment(input);
        return { success: true };
      }),
  }),

  // ─── Import (Jooto CSV) ─────────────────────────────────────────────────
  import: router({
    jootoCSV: publicProcedure
      .input(z.object({
        projectName: z.string(),
        csvContent: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { projectName, csvContent } = input;

        // Parse CSV (handle BOM)
        const raw = csvContent.replace(/^\uFEFF/, "");
        const lines = parseCSVLines(raw);
        if (lines.length < 2) throw new Error("CSVにデータがありません");

        const headers = lines[0];
        const listIdx = headers.indexOf("リスト名*");
        const taskIdx = headers.indexOf("タスク名*");
        const descIdx = headers.indexOf("説明");
        const statusIdx = headers.indexOf("ステータス*");
        const labelIdx = headers.indexOf("ラベル");
        const assigneeIdx = headers.indexOf("タスク担当者");
        const startDateIdx = headers.indexOf("タスク開始日");
        const dueDateIdx = headers.indexOf("タスク締切日");
        const checklistNameIdx = headers.indexOf("チェックリスト名");
        const checklistItemIdx = headers.indexOf("アイテム名");
        const checklistDoneIdx = headers.indexOf("アイテム完了フラグ");

        if (listIdx === -1 || taskIdx === -1) {
          throw new Error("必須カラム（リスト名*, タスク名*）が見つかりません");
        }

        // Create project
        const projectId = "p" + Date.now();
        const projectColor = COL_COLORS[Math.floor(Math.random() * COL_COLORS.length)];
        await db.createProject({ id: projectId, name: projectName, color: projectColor });

        // Collect unique list names (preserve order)
        const listNames: string[] = [];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          const listName = (row[listIdx] || "").trim();
          if (listName && !listNames.includes(listName)) {
            listNames.push(listName);
          }
        }

        // Create columns
        const colMap: Record<string, string> = {};
        for (let i = 0; i < listNames.length; i++) {
          const colId = "col_" + projectId + "_" + i;
          await db.createColumn({
            id: colId,
            projectId,
            title: listNames[i],
            color: COL_COLORS[i % COL_COLORS.length],
            sortOrder: i,
          });
          colMap[listNames[i]] = colId;
        }

        // Collect unique assignees from CSV (split by Japanese comma)
        const allAssignees: string[] = [];
        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          const rawAssignee = assigneeIdx >= 0 ? (row[assigneeIdx] || "").replace(/^"|"$/g, "").trim() : "";
          if (rawAssignee) {
            // Split by Japanese comma "\u3001" or regular comma
            const names = rawAssignee.split(/[\u3001,]/).map((n: string) => n.trim()).filter(Boolean);
            for (const name of names) {
              if (!allAssignees.includes(name)) {
                allAssignees.push(name);
              }
            }
          }
        }

        // Merge with existing members setting
        const existingMembersRaw = await db.getSetting("members");
        let existingMembers: string[] = [];
        try { existingMembers = JSON.parse(existingMembersRaw || "null") || []; } catch { existingMembers = []; }
        const mergedMembers = [...existingMembers];
        for (const name of allAssignees) {
          if (!mergedMembers.includes(name)) {
            mergedMembers.push(name);
          }
        }
        // Save merged members
        if (mergedMembers.length > 0) {
          await db.setSetting("members", JSON.stringify(mergedMembers));
        }

        // Build tasks in memory first, then batch insert
        let taskCount = 0;
        const taskSortOrders: Record<string, number> = {};
        interface TaskEntry {
          id: string; projectId: string; colId: string; title: string;
          assignee: string; priority: string; due: string | null;
          tags: string[]; subtasks: { id: number; text: string; done: boolean }[];
          description: string | null; sortOrder: number;
        }
        const taskEntries: TaskEntry[] = [];
        let currentTask: TaskEntry | null = null;

        for (let i = 1; i < lines.length; i++) {
          const row = lines[i];
          const listName = (row[listIdx] || "").trim();
          const taskName = (row[taskIdx] || "").trim();
          const colId = colMap[listName];

          if (!colId) continue;

          if (taskName) {
            // Finalize previous task
            if (currentTask) taskEntries.push(currentTask);

            const description = descIdx >= 0 ? (row[descIdx] || "").trim() : "";
            const labels = labelIdx >= 0 ? (row[labelIdx] || "").replace(/^"|"$/g, "").trim() : "";
            const rawAssignee = assigneeIdx >= 0 ? (row[assigneeIdx] || "").replace(/^"|"$/g, "").trim() : "";
            const assigneeNames = rawAssignee ? rawAssignee.split(/[\u3001,]/).map((n: string) => n.trim()).filter(Boolean) : [];
            const assignee = assigneeNames[0] || "";
            const dueDate = dueDateIdx >= 0 ? (row[dueDateIdx] || "").trim() : "";
            const tags = labels ? labels.split(",").map((l: string) => l.trim()).filter(Boolean) : [];

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
              sortOrder,
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
        // Finalize last task
        if (currentTask) taskEntries.push(currentTask);

        // Batch insert all tasks (subtasks stored as JSON in the column)
        await db.createTasksBatch(taskEntries.map(t => ({
          id: t.id,
          projectId: t.projectId,
          colId: t.colId,
          title: t.title,
          assignee: t.assignee,
          priority: t.priority,
          due: t.due,
          tags: t.tags,
          subtasks: t.subtasks,
          description: t.description,
          sortOrder: t.sortOrder,
        })));

        return {
          projectId,
          projectName,
          columnCount: listNames.length,
          taskCount,
          columns: listNames,
          members: allAssignees,
        };
      }),
  }),

  // ─── Settings ─────────────────────────────────────────────────
  setting: router({
    get: publicProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        const value = await db.getSetting(input.key);
        return { key: input.key, value };
      }),
    set: publicProcedure
      .input(z.object({ key: z.string(), value: z.string() }))
      .mutation(async ({ input }) => {
        await db.setSetting(input.key, input.value);
        return { success: true };
      }),
  }),

  // ─── Project Access Control ──────────────────────────────────────────
  projectAccess: router({
    // Check if a project has any members (i.e., access control is enabled)
    hasRestriction: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        const restricted = await db.hasAnyMember(input.projectId);
        return { restricted };
      }),

    // Get current session info for a project
    getSession: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input, ctx }) => {
        const session = getProjectSession(ctx.req as unknown as { cookies?: Record<string, string> }, input.projectId);
        if (!session) return null;
        return { name: session.name, role: session.role };
      }),

    // Login to a restricted project
    login: publicProcedure
      .input(z.object({ projectId: z.string(), name: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const member = await db.getMemberByNameAndProject(input.projectId, input.name);
        if (!member) throw new TRPCError({ code: "UNAUTHORIZED", message: "名前またはパスワードが正しくありません" });
        const ok = await bcrypt.compare(input.password, member.passwordHash);
        if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "名前またはパスワードが正しくありません" });
        const token = genToken();
        const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
        projectSessions.set(token, { projectId: input.projectId, memberId: member.id, role: member.role, name: member.name, exp });
        const res = ctx.res as unknown as { cookie: (name: string, value: string, opts: object) => void };
        res.cookie(PROJECT_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
        return { success: true, name: member.name, role: member.role };
      }),

    // Logout from a project
    logout: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .mutation(async ({ ctx }) => {
        const req = ctx.req as unknown as { cookies?: Record<string, string> };
        const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
        if (raw) projectSessions.delete(raw);
        const res = ctx.res as unknown as { clearCookie: (name: string, opts: object) => void };
        res.clearCookie(PROJECT_SESSION_COOKIE, { httpOnly: true, sameSite: "lax" });
        return { success: true };
      }),

    // List members for a project (for settings screen)
    listMembers: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        const members = await db.getMembersByProject(input.projectId);
        return members.map(m => ({ id: m.id, name: m.name, role: m.role }));
      }),

    // Add a member to a project
    addMember: publicProcedure
      .input(z.object({ projectId: z.string(), name: z.string(), password: z.string(), role: z.enum(["viewer", "editor"]) }))
      .mutation(async ({ input }) => {
        const existing = await db.getMemberByNameAndProject(input.projectId, input.name);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "同じ名前のメンバーがすでに存在します" });
        const passwordHash = await bcrypt.hash(input.password, 10);
        await db.createProjectMember({ projectId: input.projectId, name: input.name, passwordHash, role: input.role });
        return { success: true };
      }),

    // Update a member's role or password
    updateMember: publicProcedure
      .input(z.object({ id: z.number(), role: z.enum(["viewer", "editor"]).optional(), password: z.string().optional() }))
      .mutation(async ({ input }) => {
        const update: { role?: "viewer" | "editor"; passwordHash?: string } = {};
        if (input.role) update.role = input.role;
        if (input.password) update.passwordHash = await bcrypt.hash(input.password, 10);
        await db.updateProjectMember(input.id, update);
        return { success: true };
      }),

    // Remove a member from a project
    removeMember: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteProjectMember(input.id);
        return { success: true };
      }),
  }),
});;

export type AppRouter = typeof appRouter;
