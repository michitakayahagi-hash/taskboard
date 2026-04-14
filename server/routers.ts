import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { sendInvitationEmail } from "./_core/mailer";
import { storagePut } from "./storage";

// Cookie name for project-level auth sessions
const PROJECT_SESSION_COOKIE = "tb_proj_session";

function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function getProjectSession(req: { cookies?: Record<string, string> }, projectId: string) {
  const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
  if (!raw) return null;
  const session = await db.getProjectSessionByToken(raw);
  if (!session) return null;
  if (session.projectId !== projectId) return null;
  if (Date.now() > session.exp) { await db.deleteProjectSession(raw); return null; }
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
        // 完了カラムに移動した場合、100件超過分を古い順に自動削除
        if (data.colId) {
          try {
            const colInfo = await db.getColumnById(data.colId);
            if (colInfo && colInfo.title === "完了") {
              const doneTasks = await db.getTasksByColId(data.colId);
              const MAX_DONE = 100;
              if (doneTasks.length > MAX_DONE) {
                const sorted = [...doneTasks].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
                const toDelete = sorted.slice(0, doneTasks.length - MAX_DONE);
                for (const t of toDelete) {
                  await db.deleteTask(t.id);
                }
              }
            }
          } catch (_) { /* エラーは無視 */ }
        }
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

        // Merge with existing members setting (per-project key)
        const membersKey = `members_${projectId}`;
        const existingMembersRaw = await db.getSetting(membersKey);
        let existingMembers: string[] = [];
        try { existingMembers = JSON.parse(existingMembersRaw || "null") || []; } catch { existingMembers = []; }
        const mergedMembers = [...existingMembers];
        for (const name of allAssignees) {
          if (!mergedMembers.includes(name)) {
            mergedMembers.push(name);
          }
        }
        // Save merged members (per-project key)
        if (mergedMembers.length > 0) {
          await db.setSetting(membersKey, JSON.stringify(mergedMembers));
        }
        // Create a "完了" column for completed tasks if status column exists
        let doneColId: string | null = null;
        if (statusIdx >= 0) {
          doneColId = "col_" + projectId + "_done";
          await db.createColumn({
            id: doneColId,
            projectId,
            title: "完了",
            color: "#10b981",
            sortOrder: listNames.length,
          });
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

            // Check if task is completed (ステータス = "完了" or "done")
            const statusVal = statusIdx >= 0 ? (row[statusIdx] || "").trim() : "";
            const isCompleted = statusVal === "完了" || statusVal.toLowerCase() === "done" || statusVal === "完了済み";
            const effectiveColId = isCompleted && doneColId ? doneColId : colId;
            const effectivePrevCol = isCompleted ? colId : undefined;
            currentTask = {
              id: uid(),
              projectId,
              colId: effectiveColId,
              title: taskName,
              assignee,
              priority: "medium",
              due: dueDate || null,
              tags,
              subtasks: [],
              description: description || null,
              sortOrder,
            };
            if (effectivePrevCol) (currentTask as any).prevCol = effectivePrevCol;

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
          prevCol: (t as any).prevCol || null,
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
        const session = await getProjectSession(ctx.req as unknown as { cookies?: Record<string, string> }, input.projectId);
        if (!session) return null;
        return { name: session.name, role: session.role, isAdmin: session.isAdmin };
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
        const exp = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000; // 10 years (permanent)
        await db.createProjectSession({ token, projectId: input.projectId, memberId: member.id, role: member.role, name: member.name, isAdmin: member.isAdmin, exp });
        const res = ctx.res as unknown as { cookie: (name: string, value: string, opts: object) => void };
        res.cookie(PROJECT_SESSION_COOKIE, token, { httpOnly: true, sameSite: "none", secure: true, maxAge: 10 * 365 * 24 * 60 * 60 * 1000 });
        return { success: true, name: member.name, role: member.role, isAdmin: member.isAdmin };
      }),

    // Logout from a project
    logout: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .mutation(async ({ ctx }) => {
        const req = ctx.req as unknown as { cookies?: Record<string, string> };
        const raw = req.cookies?.[PROJECT_SESSION_COOKIE];
        if (raw) await db.deleteProjectSession(raw);
        const res = ctx.res as unknown as { clearCookie: (name: string, opts: object) => void };
        res.clearCookie(PROJECT_SESSION_COOKIE, { httpOnly: true, sameSite: "none", secure: true });
        return { success: true };
      }),

    // List members for a project (for settings screen)
    listMembers: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        const members = await db.getMembersByProject(input.projectId);
        return members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, isAdmin: m.isAdmin }));
      }),

    // Add a member to a project
    addMember: publicProcedure
      .input(z.object({ projectId: z.string(), name: z.string(), password: z.string(), role: z.enum(["viewer", "editor"]), isAdmin: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const existing = await db.getMemberByNameAndProject(input.projectId, input.name);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "同じ名前のメンバーがすでに存在します" });
        const passwordHash = await bcrypt.hash(input.password, 10);
        await db.createProjectMember({ projectId: input.projectId, name: input.name, passwordHash, role: input.role, isAdmin: input.isAdmin ?? false });
        return { success: true };
      }),

    // Update a member's role or password
    updateMember: publicProcedure
      .input(z.object({ id: z.number(), role: z.enum(["viewer", "editor"]).optional(), password: z.string().optional(), isAdmin: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const update: { role?: "viewer" | "editor"; passwordHash?: string; isAdmin?: boolean } = {};
        if (input.role) update.role = input.role;
        if (input.password) update.passwordHash = await bcrypt.hash(input.password, 10);
        if (input.isAdmin !== undefined) update.isAdmin = input.isAdmin;
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

    // ─── Invitation endpoints ───────────────────────────────────────────

    // Send invitation email
    sendInvite: publicProcedure
      .input(z.object({
        projectId: z.string(),
        email: z.string().email(),
        role: z.enum(["viewer", "editor"]),
        isAdmin: z.boolean().optional(),
        inviterName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Check caller is admin
        const session = await getProjectSession(ctx.req as unknown as { cookies?: Record<string, string> }, input.projectId);
        const hasMembers = await db.hasAnyMember(input.projectId);
        if (hasMembers && (!session || !session.isAdmin)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "招待は管理者のみ実行できます" });
        }

        // Check if already a member
        const existingMember = await db.getMemberByEmailAndProject(input.projectId, input.email);
        if (existingMember) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスはすでにメンバーです" });

        // Get project name
        const projects = await db.getAllProjects();
        const project = projects.find(p => p.id === input.projectId);
        const projectName = project?.name ?? "プロジェクト";

        // Create invitation token (72h expiry)
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        await db.createInvitation({
          projectId: input.projectId,
          email: input.email,
          token,
          role: input.role,
          isAdmin: input.isAdmin ?? false,
          status: "pending",
          invitedBy: session?.memberId ?? null,
          expiresAt,
        });

        // Send email
        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3100}`;
        const inviteUrl = `${baseUrl}/invite/${token}`;
        const inviterName = input.inviterName || session?.name || "管理者";
        const sent = await sendInvitationEmail({ to: input.email, projectName, inviteUrl, inviterName });

        return { success: true, emailSent: sent, inviteUrl };
      }),

    // Get invitation info by token (for accept page)
    getInvite: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await db.getInvitationByToken(input.token);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "招待が見つかりません" });
        if (inv.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "この招待はすでに使用済みか期限切れです" });
        if (new Date() > inv.expiresAt) {
          await db.updateInvitation(inv.id, { status: "expired" });
          throw new TRPCError({ code: "BAD_REQUEST", message: "招待リンクの有効期限が切れています" });
        }
        const projects = await db.getAllProjects();
        const project = projects.find(p => p.id === inv.projectId);
        return {
          id: inv.id,
          projectId: inv.projectId,
          projectName: project?.name ?? "プロジェクト",
          email: inv.email,
          role: inv.role,
          isAdmin: inv.isAdmin,
        };
      }),

    // Accept invitation (register with name + password)
    acceptInvite: publicProcedure
      .input(z.object({
        token: z.string(),
        name: z.string().min(1),
        password: z.string().min(6),
      }))
      .mutation(async ({ input, ctx }) => {
        const inv = await db.getInvitationByToken(input.token);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "招待が見つかりません" });
        if (inv.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "この招待はすでに使用済みか期限切れです" });
        if (new Date() > inv.expiresAt) {
          await db.updateInvitation(inv.id, { status: "expired" });
          throw new TRPCError({ code: "BAD_REQUEST", message: "招待リンクの有効期限が切れています" });
        }

        // Check name uniqueness
        const existingName = await db.getMemberByNameAndProject(inv.projectId, input.name);
        if (existingName) throw new TRPCError({ code: "CONFLICT", message: "この名前はすでに使用されています" });

        // Create member
        const passwordHash = await bcrypt.hash(input.password, 10);
        await db.createProjectMember({
          projectId: inv.projectId,
          name: input.name,
          email: inv.email,
          passwordHash,
          role: inv.role,
          isAdmin: inv.isAdmin,
        });

        // Mark invitation as accepted
        await db.updateInvitation(inv.id, { status: "accepted" });

        // Auto-login
        const token = genToken();
        const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
        const members = await db.getMembersByProject(inv.projectId);
        const newMember = members.find(m => m.name === input.name);
        if (newMember) {
          projectSessions.set(token, { projectId: inv.projectId, memberId: newMember.id, role: newMember.role, name: newMember.name, isAdmin: newMember.isAdmin, exp });
          const res = ctx.res as unknown as { cookie: (name: string, value: string, opts: object) => void };
          res.cookie(PROJECT_SESSION_COOKIE, token, { httpOnly: true, sameSite: "none", secure: true, maxAge: 10 * 365 * 24 * 60 * 60 * 1000 });
        }

        return { success: true, projectId: inv.projectId, name: input.name, role: inv.role, isAdmin: inv.isAdmin };
      }),

    // List invitations for a project
    listInvitations: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input, ctx }) => {
        const session = await getProjectSession(ctx.req as unknown as { cookies?: Record<string, string> }, input.projectId);
        const hasMembers = await db.hasAnyMember(input.projectId);
        if (hasMembers && (!session || !session.isAdmin)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理者のみ閲覧できます" });
        }
        const invs = await db.getInvitationsByProject(input.projectId);
        return invs.map(i => ({ id: i.id, email: i.email, role: i.role, isAdmin: i.isAdmin, status: i.status, expiresAt: i.expiresAt }));
      }),

    // Revoke an invitation
    revokeInvite: publicProcedure
      .input(z.object({ id: z.number(), projectId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const session = await getProjectSession(ctx.req as unknown as { cookies?: Record<string, string> }, input.projectId);
        const hasMembers = await db.hasAnyMember(input.projectId);
        if (hasMembers && (!session || !session.isAdmin)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理者のみ実行できます" });
        }
        await db.deleteInvitation(input.id);
        return { success: true };
      }),
  }),

  // ─── Attachments ─────────────────────────────────────────────────────────────
  attachment: router({
    // 添付ファイル一覧取得
    list: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input }) => {
        return db.getAttachmentsByTask(input.taskId);
      }),
    // 添付ファイル登録（Base64エンコードで受け取り、サーバーサイドでストレージに保存）
    upload: publicProcedure
      .input(z.object({
        taskId: z.string(),
        fileName: z.string(),
        fileBase64: z.string(),
        fileSize: z.number(),
        mimeType: z.string(),
        uploadedBy: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { taskId, fileName, fileBase64, fileSize, mimeType, uploadedBy } = input;
        // Base64デコード
        const base64Data = fileBase64.replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        // ストレージに保存
        const key = `attachments/${taskId}/${Date.now()}_${fileName}`;
        let fileUrl: string;
        try {
          const result = await storagePut(key, buffer, mimeType);
          fileUrl = result.url;
        } catch (e) {
          // ストレージが利用不可な場合はフォールバック：Base64 URLを直接保存
          fileUrl = `data:${mimeType};base64,${base64Data}`;
        }
        await db.createAttachment({ taskId, fileName, fileUrl, fileSize, uploadedBy });
        return { success: true, fileUrl };
      }),
    // 添付ファイル削除
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteAttachment(input.id);
        return { success: true };
      }),
  }),

  // ─── Subtask Templates ──────────────────────────────────────────────────────
  subtaskTemplate: router({
    // テンプレート一覧取得
    list: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        return db.getSubtaskTemplates(input.projectId);
      }),
    // テンプレート作成
    create: publicProcedure
      .input(z.object({
        projectId: z.string(),
        name: z.string().min(1),
        items: z.array(z.string()),
      }))
      .mutation(async ({ input }) => {
        await db.createSubtaskTemplate(input);
        return { success: true };
      }),
    // テンプレート更新
    update: publicProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        items: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateSubtaskTemplate(id, data);
        return { success: true };
      }),
    // テンプレート削除
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteSubtaskTemplate(input.id);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

