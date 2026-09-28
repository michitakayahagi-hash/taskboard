import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { clearGoogleSession } from "./_core/googleAuth";
import { disableGeminiSync, getGeminiSyncStatus, triggerGeminiSync } from "./_core/geminiSync";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, unprotectedProcedure } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { sendInvitationEmail } from "./_core/mailer";
import { storagePut } from "./storage";
import { deadlineValuesChanged, isDueChangeApprover, normalizeDueDate } from "./_core/dueChangeApproval";

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

function getTaskBoardSuperAdminEmails() {
  return (process.env.TASKBOARD_SUPERADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isTaskBoardSuperAdmin(email?: string | null) {
  return !!email && getTaskBoardSuperAdminEmails().includes(email.trim().toLowerCase());
}

const TASKBOARD_PUBLIC_URL = process.env.APP_URL || "https://proactive-caring-production-1be5.up.railway.app";

function formatDeadline(value?: string | null) {
  return value ? value.replace(/-/g, "/") : "なし";
}

async function notifyDeadlineApproval(
  task: { id: string; projectId: string; title: string },
  request: { prevDue?: string | null; prevDueStart?: string | null; requestedDue?: string | null; requestedDueStart?: string | null; requesterName: string },
  event: "requested" | "applied" | "approved" | "rejected",
  approverName?: string
) {
  try {
    const webhookUrl = await db.getSetting(`webhook_url_${task.projectId}`);
    if (!webhookUrl) return;
    const taskUrl = `${TASKBOARD_PUBLIC_URL}/?project=${task.projectId}&task=${task.id}`;
    const heading = event === "requested"
      ? "🕒 *期日変更の承認依頼*"
      : event === "applied"
      ? "📅 *期日が変更されました*"
      : event === "approved"
      ? "✅ *期日変更が承認されました*"
      : "↩️ *期日変更が却下されました*";
    const lines = [
      heading,
      `タスク: <${taskUrl}|${task.title}>`,
      `現在: ${formatDeadline(request.prevDueStart)} ～ ${formatDeadline(request.prevDue)}`,
      `変更案: ${formatDeadline(request.requestedDueStart)} ～ ${formatDeadline(request.requestedDue)}`,
      `申請者: ${request.requesterName}`,
      event === "requested" ? "矢作充隆さんの承認待ちです。" : event === "applied" ? "初回変更のため即時反映しました。" : `承認者: ${approverName || "矢作充隆"}`,
    ];
    void fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    }).catch(() => undefined);
  } catch {
    // 通知不能でも、承認フロー本体は失敗させない。
  }
}

async function getGoogleProjectMember(user: { email?: string | null; name?: string | null } | null, projectId: string) {
  if (!user?.email) return null;
  const email = user.email.toLowerCase();
  const existingMember = await db.getMemberByEmailAndProject(projectId, email);
  if (existingMember) return existingMember;

  // 旧パスワード設定済みプロジェクトではメール未登録の既存メンバーがいる。
  // TASKBOARD_SUPERADMIN_EMAILSに明示登録された管理者だけを、管理者として自動移行する。
  // これにより、同じ@b-bloom.jpドメインの登録外ユーザーは絶対に許可されない。
  if (!isTaskBoardSuperAdmin(email)) return null;
  const project = await db.getProjectById(projectId);
  if (!project) return null;

  await db.createProjectMember({
    projectId,
    name: user.name?.trim() || email.split("@")[0],
    email,
    passwordHash: "google-workspace-superadmin",
    role: "editor",
    isAdmin: true,
  });
  return db.getMemberByEmailAndProject(projectId, email);
}

async function assertGoogleProjectAdmin(user: { email?: string | null } | null, projectId: string) {
  const hasMembers = await db.hasAnyMember(projectId);
  // メンバー未設定プロジェクトは、最初の管理者登録を許可する。
  if (!hasMembers) return null;
  const member = await getGoogleProjectMember(user, projectId);
  if (!member?.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "この操作はプロジェクト管理者のみ実行できます" });
  }
  return member;
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
    // 未認証状態でもログイン画面の表示判定に使えるよう公開する。
    me: unprotectedProcedure.query(opts => opts.ctx.user),
    logout: unprotectedProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      clearGoogleSession(ctx.req, ctx.res);
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
      .input(z.object({ id: z.string(), name: z.string().optional(), color: z.string().optional(), isPublic: z.boolean().optional(), webhookUrl: z.string().optional().nullable() }))
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
    duplicate: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        // 元プロジェクトを取得
        const allProjects = await db.getAllProjects();
        const src = allProjects.find((p: any) => p.id === input.id);
        if (!src) throw new TRPCError({ code: "NOT_FOUND", message: "プロジェクトが見つかりません" });

        const now = Date.now();
        const newProjectId = "p" + now;

        // プロジェクト複製
        await db.createProject({
          id: newProjectId,
          name: src.name + "のコピー",
          color: src.color,
          webhookUrl: src.webhookUrl ?? null,
        });

        // カラム複製
        const srcCols = await db.getColumnsByProject(input.id);
        const colIdMap: Record<string, string> = {};
        for (const col of srcCols) {
          const newColId = "col_" + newProjectId + "_" + now + "_" + col.id;
          colIdMap[col.id] = newColId;
          await db.createColumn({
            id: newColId,
            projectId: newProjectId,
            title: col.title,
            color: col.color,
            sortOrder: col.sortOrder,
          });
        }

        // タスク複製
        const srcTasks = await db.getTasksByProject(input.id);
        if (srcTasks.length > 0) {
          const newTasks = srcTasks.map((t: any, i: number) => ({
            id: "t" + now + "_" + i,
            projectId: newProjectId,
            colId: colIdMap[t.colId] ?? t.colId,
            title: t.title,
            assignee: t.assignee ?? "",
            priority: t.priority ?? "medium",
            due: t.due ?? null,
            tags: t.tags ?? [],
            subtasks: t.subtasks ?? [],
            description: t.description ?? null,
            sortOrder: t.sortOrder ?? 0,
            prevCol: t.prevCol ? (colIdMap[t.prevCol] ?? t.prevCol) : null,
            createdBy: t.createdBy ?? null,
          }));
          await db.createTasksBatch(newTasks);
        }

        return { success: true, newProjectId, name: src.name + "のコピー" };
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
    listAll: publicProcedure
      .query(async () => {
        return db.getAllTasksWithMeta();
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
        dueStart: z.string().nullable().optional(),
        tags: z.array(z.string()).default([]),
        subtasks: z.array(z.object({ id: z.number(), text: z.string(), done: z.boolean() })).default([]),
        description: z.string().nullable().optional(),
        sortOrder: z.number().default(0),
        createdBy: z.string().optional(),
        taskStatus: z.string().nullable().optional(),
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
        dueStart: z.string().nullable().optional(),
        tags: z.array(z.string()).optional(),
        subtasks: z.array(z.object({ id: z.number(), text: z.string(), done: z.boolean(), assignee: z.string().optional(), url: z.string().optional(), due: z.string().optional(), dueStart: z.string().optional() })).optional(),
        description: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
        prevCol: z.string().nullable().optional(),
        createdBy: z.string().nullable().optional(),
        taskStatus: z.string().nullable().optional(),
        changedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, changedBy: _changedBy, ...data } = input;
        if (data.due !== undefined || data.dueStart !== undefined) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "期日の変更は承認フローを通して申請してください",
          });
        }
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
    move: publicProcedure
      .input(z.object({
        id: z.string(),
        targetProjectId: z.string(),
        targetColId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        let colId: string;
        if (input.targetColId) {
          colId = input.targetColId;
        } else {
          // 移動先プロジェクトの最初のカラムを取得
          const targetCols = await db.getColumnsByProject(input.targetProjectId);
          if (!targetCols || targetCols.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "移動先プロジェクトにカラムが存在しません" });
          }
          colId = targetCols[0].id;
        }
        await db.updateTask(input.id, {
          projectId: input.targetProjectId,
          colId,
        });
        return { success: true, newColId: colId };
      }),
  }),

  // ─── Column Move (with column itself) ─────────────────────────────────────────────────────────────────────────────────────
  col: router({
    // カラム自体（タイトル・色・タスク）を別プロジェクトに移動する（元カラムは削除）
    moveAllTasks: publicProcedure
      .input(z.object({
        colId: z.string(),
        targetProjectId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.moveColumnToProject(input.colId, input.targetProjectId);
        return { success: true, movedCount: result.movedCount, newColId: result.newColId };
      }),
  }),

  // ─── Due History ──────────────────────────────────────────────────────────────────────────────────────
  dueHistory: router({
    list: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input }) => {
        return db.getDueHistory(input.taskId);
      }),
  }),

  // ─── Deadline change approval ─────────────────────────────────────────────
  dueChange: router({
    request: publicProcedure
      .input(z.object({
        taskId: z.string(),
        due: z.string().nullable().optional(),
        dueStart: z.string().nullable().optional(),
      }).refine((value) => value.due !== undefined || value.dueStart !== undefined, {
        message: "変更する期日を指定してください",
      }))
      .mutation(async ({ input, ctx }) => {
        const requesterEmail = ctx.user?.email?.trim().toLowerCase();
        if (!requesterEmail) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Workspaceでログインしてください" });
        const requesterName = ctx.user?.name?.trim() || requesterEmail;
        const task = await db.getTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "タスクが見つかりません" });

        const requestedDue = input.due !== undefined ? normalizeDueDate(input.due) : normalizeDueDate(task.due);
        const requestedDueStart = input.dueStart !== undefined ? normalizeDueDate(input.dueStart) : normalizeDueDate(task.dueStart);
        if (!deadlineValuesChanged(task, { due: requestedDue, dueStart: requestedDueStart })) {
          return { status: "unchanged" as const };
        }

        const history = await db.getDueHistory(input.taskId);
        // 期限の最初の変更は即時反映する。
        if (history.length === 0) {
          await db.updateTask(input.taskId, { due: requestedDue, dueStart: requestedDueStart });
          await db.addDueHistory({
            taskId: input.taskId,
            prevDue: normalizeDueDate(task.due),
            newDue: requestedDue,
            prevDueStart: normalizeDueDate(task.dueStart),
            newDueStart: requestedDueStart,
            changedBy: requesterName,
          });
          await notifyDeadlineApproval(task, {
            prevDue: normalizeDueDate(task.due),
            prevDueStart: normalizeDueDate(task.dueStart),
            requestedDue,
            requestedDueStart,
            requesterName,
          }, "applied");
          return { status: "applied" as const };
        }

        const pending = await db.getPendingDueChangeRequest(input.taskId);
        if (pending) {
          return { status: "already_pending" as const, requestId: pending.id };
        }
        await db.createDueChangeRequest({
          taskId: input.taskId,
          prevDue: normalizeDueDate(task.due),
          prevDueStart: normalizeDueDate(task.dueStart),
          requestedDue,
          requestedDueStart,
          requesterEmail,
          requesterName,
          status: "pending",
        });
        const created = await db.getPendingDueChangeRequest(input.taskId);
        if (created) await notifyDeadlineApproval(task, created, "requested");
        return { status: "pending" as const, requestId: created?.id ?? null };
      }),
    getPending: publicProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input, ctx }) => ({
        request: await db.getPendingDueChangeRequest(input.taskId),
        canApprove: isDueChangeApprover(ctx.user?.email),
      })),
    listPending: publicProcedure
      .query(async ({ ctx }) => {
        const canApprove = isDueChangeApprover(ctx.user?.email);
        if (!canApprove) return { canApprove, requests: [] };
        const pending = await db.listPendingDueChangeRequests();
        const requests = await Promise.all(pending.map(async (request) => {
          const task = await db.getTaskById(request.taskId);
          const project = task ? await db.getProjectById(task.projectId) : null;
          return {
            ...request,
            taskTitle: task?.title || "削除済みタスク",
            projectId: task?.projectId || null,
            projectName: project?.name || "削除済みプロジェクト",
          };
        }));
        return { canApprove, requests };
      }),
    approve: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const email = ctx.user?.email?.trim().toLowerCase();
        if (!isDueChangeApprover(email)) throw new TRPCError({ code: "FORBIDDEN", message: "矢作充隆さんのみ期日変更を承認できます" });
        const result = await db.approveDueChangeRequest(input.id, { email: email!, name: ctx.user?.name?.trim() || email! });
        const task = await db.getTaskById(result.request.taskId);
        if (task && result.applied) await notifyDeadlineApproval(task, result.request, "approved", ctx.user?.name?.trim() || email!);
        return { success: true, applied: result.applied, taskId: result.request.taskId };
      }),
    reject: publicProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const email = ctx.user?.email?.trim().toLowerCase();
        if (!isDueChangeApprover(email)) throw new TRPCError({ code: "FORBIDDEN", message: "矢作充隆さんのみ期日変更を却下できます" });
        const result = await db.rejectDueChangeRequest(input.id, { email: email!, name: ctx.user?.name?.trim() || email! });
        const task = await db.getTaskById(result.request.taskId);
        if (task && result.applied) await notifyDeadlineApproval(task, result.request, "rejected", ctx.user?.name?.trim() || email!);
        return { success: true, applied: result.applied, taskId: result.request.taskId };
      }),
  }),

  // ─── Comments ───────────────────────────────────────────────────────────────────────
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
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteComment(input.id);
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
        // Create a "完了" column for completed tasks (always required)
        const doneColId = "col_" + projectId + "_done";
        // Only create if not already in listNames
        if (!listNames.includes("完了")) {
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

  // ─── Gemini meeting notes sync ───────────────────────────────────────
  geminiSync: router({
    status: publicProcedure.query(async ({ ctx }) => {
      const email = ctx.user?.email?.toLowerCase();
      if (!email) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Workspaceでログインしてください" });
      return getGeminiSyncStatus(email);
    }),
    syncNow: publicProcedure.mutation(async ({ ctx }) => {
      const email = ctx.user?.email?.toLowerCase();
      if (!email) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Workspaceでログインしてください" });
      try {
        return await triggerGeminiSync(email);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Geminiメモの同期に失敗しました" });
      }
    }),
    disable: publicProcedure.mutation(async ({ ctx }) => {
      const email = ctx.user?.email?.toLowerCase();
      if (!email) throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Workspaceでログインしてください" });
      return disableGeminiSync(email);
    }),
  }),

  // ─── Project Access Control ──────────────────────────────────────────
  projectAccess: router({
    // Check if a project has any members (i.e., access control is enabled)
    // isPublic=true の場合はメンバーがいてもログイン不要
    hasRestriction: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        const project = await db.getProjectById(input.projectId);
        if (project?.isPublic) return { restricted: false };
        const restricted = await db.hasAnyMember(input.projectId);
        return { restricted };
      }),
    // Get isPublic status for a project
    getPublicStatus: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input }) => {
        const project = await db.getProjectById(input.projectId);
        return { isPublic: project?.isPublic ?? false };
      }),

    // Googleログイン中のメールアドレスを、プロジェクトメンバーのメールアドレスと照合する。
    getSession: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input, ctx }) => {
        const member = await getGoogleProjectMember(ctx.user, input.projectId);
        if (!member) return null;
        return { name: member.name, email: member.email, role: member.role, isAdmin: member.isAdmin };
      }),

    // 旧来の名前・パスワードログインは廃止する。
    login: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .mutation(async () => {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Google Workspaceでログインしてください" });
      }),

    // 互換性のため旧プロジェクトCookieを削除する。
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

    // List members for a project (Googleログイン済みのプロジェクト利用者のみ)
    listMembers: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input, ctx }) => {
        const hasMembers = await db.hasAnyMember(input.projectId);
        const currentMember = await getGoogleProjectMember(ctx.user, input.projectId);
        if (hasMembers && !currentMember) throw new TRPCError({ code: "FORBIDDEN", message: "このプロジェクトへの権限がありません" });
        const members = await db.getMembersByProject(input.projectId);
        return members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, isAdmin: m.isAdmin }));
      }),

    // Add a member to a project (メールアドレスをGoogle Workspaceアカウントと照合)
    addMember: publicProcedure
      .input(z.object({ projectId: z.string(), name: z.string().min(1), email: z.string().email(), role: z.enum(["viewer", "editor"]), isAdmin: z.boolean().optional() }))
      .mutation(async ({ input, ctx }) => {
        const normalizedEmail = input.email.toLowerCase();
        if (!normalizedEmail.endsWith("@b-bloom.jp")) throw new TRPCError({ code: "BAD_REQUEST", message: "@b-bloom.jp のメールアドレスを指定してください" });
        const hasMembers = await db.hasAnyMember(input.projectId);
        await assertGoogleProjectAdmin(ctx.user, input.projectId);
        if (!hasMembers && ctx.user?.email?.toLowerCase() !== normalizedEmail) {
          throw new TRPCError({ code: "FORBIDDEN", message: "最初の管理者には、ログイン中のGoogle Workspaceメールアドレスを登録してください" });
        }
        const existing = await db.getMemberByEmailAndProject(input.projectId, normalizedEmail);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスはすでにメンバーです" });
        await db.createProjectMember({
          projectId: input.projectId,
          name: input.name.trim(),
          email: normalizedEmail,
          // DB互換性のため保存するが、Googleログインでは使用しない。
          passwordHash: "google-workspace-auth",
          role: input.role,
          isAdmin: hasMembers ? (input.isAdmin ?? false) : true,
        });
        return { success: true };
      }),

    // Update a member's project role
    updateMember: publicProcedure
      .input(z.object({ projectId: z.string(), id: z.number(), role: z.enum(["viewer", "editor"]).optional(), isAdmin: z.boolean().optional() }))
      .mutation(async ({ input, ctx }) => {
        await assertGoogleProjectAdmin(ctx.user, input.projectId);
        const update: { role?: "viewer" | "editor"; isAdmin?: boolean } = {};
        if (input.role) update.role = input.role;
        if (input.isAdmin !== undefined) update.isAdmin = input.isAdmin;
        await db.updateProjectMember(input.id, update);
        return { success: true };
      }),

    // Remove a member from a project
    removeMember: publicProcedure
      .input(z.object({ projectId: z.string(), id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await assertGoogleProjectAdmin(ctx.user, input.projectId);
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
        const normalizedEmail = input.email.toLowerCase();
        if (!normalizedEmail.endsWith("@b-bloom.jp")) throw new TRPCError({ code: "BAD_REQUEST", message: "@b-bloom.jp のメールアドレスを指定してください" });
        const inviter = await assertGoogleProjectAdmin(ctx.user, input.projectId);
        const existingMember = await db.getMemberByEmailAndProject(input.projectId, normalizedEmail);
        if (existingMember) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスはすでにメンバーです" });

        const projects = await db.getAllProjects();
        const project = projects.find(p => p.id === input.projectId);
        const projectName = project?.name ?? "プロジェクト";
        const token = randomUUID();
        const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        await db.createInvitation({
          projectId: input.projectId,
          email: normalizedEmail,
          token,
          role: input.role,
          isAdmin: input.isAdmin ?? false,
          status: "pending",
          invitedBy: inviter?.id ?? null,
          expiresAt,
        });

        const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3100}`;
        const inviteUrl = `${baseUrl}/invite/${token}`;
        const inviterName = input.inviterName || inviter?.name || ctx.user?.name || "管理者";
        const sent = await sendInvitationEmail({ to: normalizedEmail, projectName, inviteUrl, inviterName });
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

    // Accept invitation after the recipient has authenticated with Google Workspace.
    acceptInvite: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const inv = await db.getInvitationByToken(input.token);
        if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "招待が見つかりません" });
        if (inv.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "この招待はすでに使用済みか期限切れです" });
        if (new Date() > inv.expiresAt) {
          await db.updateInvitation(inv.id, { status: "expired" });
          throw new TRPCError({ code: "BAD_REQUEST", message: "招待リンクの有効期限が切れています" });
        }
        const signedInEmail = ctx.user?.email?.toLowerCase();
        if (!signedInEmail || signedInEmail !== inv.email.toLowerCase()) {
          throw new TRPCError({ code: "FORBIDDEN", message: "招待先のGoogle Workspaceアカウントでログインしてください" });
        }
        const existing = await db.getMemberByEmailAndProject(inv.projectId, signedInEmail);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "このメールアドレスはすでにメンバーです" });
        await db.createProjectMember({
          projectId: inv.projectId,
          name: ctx.user?.name || signedInEmail.split("@")[0],
          email: signedInEmail,
          passwordHash: "google-workspace-auth",
          role: inv.role,
          isAdmin: inv.isAdmin,
        });
        await db.updateInvitation(inv.id, { status: "accepted" });
        return { success: true, projectId: inv.projectId, name: ctx.user?.name || signedInEmail, role: inv.role, isAdmin: inv.isAdmin };
      }),

    // List invitations for a project
    listInvitations: publicProcedure
      .input(z.object({ projectId: z.string() }))
      .query(async ({ input, ctx }) => {
        await assertGoogleProjectAdmin(ctx.user, input.projectId);
        const invs = await db.getInvitationsByProject(input.projectId);
        return invs.map(i => ({ id: i.id, email: i.email, role: i.role, isAdmin: i.isAdmin, status: i.status, expiresAt: i.expiresAt }));
      }),

    // Revoke an invitation
    revokeInvite: publicProcedure
      .input(z.object({ id: z.number(), projectId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        await assertGoogleProjectAdmin(ctx.user, input.projectId);
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
          console.log("[Storage] fallback to base64, reason:", (e as Error).message);
          fileUrl = `data:${mimeType};base64,${base64Data}`;
        }
        try {
          await db.createAttachment({ taskId, fileName, fileUrl, fileSize, uploadedBy });
        } catch (dbErr) {
          console.error("[Attachment] DB insert error:", (dbErr as Error).message);
          throw dbErr;
        }
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
