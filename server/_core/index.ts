import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerGoogleAuthRoutes } from "./googleAuth";
import { registerGeminiSyncRoutes, renewGeminiSyncWatches } from "./geminiSync";
import { getDueNotificationPlan, getJstDate, isJapaneseBusinessDay } from "./businessCalendar";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { drizzle } from "drizzle-orm/mysql2";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  if (!process.env.DATABASE_URL) return;
  try {
    const db = drizzle(process.env.DATABASE_URL);
    // dist/index.js -> dist/ -> project root -> drizzle/
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    await migrate(db, { migrationsFolder });
    console.log("[DB] Migrations applied successfully");
  } catch (err) {
    console.error("[DB] Migration error:", err);
  }
  // Ensure attachments table exists (created manually if migration didn't run)
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`CREATE TABLE IF NOT EXISTS attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id VARCHAR(255) NOT NULL,
      file_name VARCHAR(500) NOT NULL,
      file_url TEXT NOT NULL,
      file_size INT NOT NULL DEFAULT 0,
      mime_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
      uploaded_by VARCHAR(255) NOT NULL DEFAULT 'unknown',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_task_id (task_id)
    )`);
    console.log("[DB] attachments table ensured");
    // スネークケースカラムをキャメルケースにリネーム（Drizzleスキーマと一致させる）
    const renames = [
      ["task_id", "taskId", "VARCHAR(255) NOT NULL"],
      ["file_name", "fileName", "VARCHAR(500) NOT NULL"],
      ["file_url", "fileUrl", "MEDIUMTEXT NOT NULL"],
      ["file_size", "fileSize", "INT NOT NULL DEFAULT 0"],
      ["mime_type", "mimeType", "VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream'"],
      ["uploaded_by", "uploadedBy", "VARCHAR(255) NOT NULL DEFAULT 'unknown'"],
      ["created_at", "createdAt", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    ];
    for (const [oldName, newName, colDef] of renames) {
      try {
        await conn.execute(`ALTER TABLE attachments CHANGE COLUMN \`${oldName}\` \`${newName}\` ${colDef}`);
        console.log(`[DB] attachments: renamed ${oldName} -> ${newName}`);
      } catch (_) { /* already renamed or column not found */ }
    }
    // fileUrlカラムをMEDIUMTEXTに変更（既にキャメルケースの場合）
    try {
      await conn.execute(`ALTER TABLE attachments MODIFY COLUMN \`fileUrl\` MEDIUMTEXT NOT NULL`);
      console.log("[DB] attachments.fileUrl changed to MEDIUMTEXT");
    } catch (_) { /* ignore */ }
    await conn.end();
  } catch (err) {
    console.error("[DB] attachments table error:", err);
  }
  // Ensure isPublic column exists in projects table
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`ALTER TABLE projects ADD COLUMN isPublic BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log("[DB] projects.isPublic column added");
    await conn.end();
  } catch (err: any) {
    // errno 1060 = Duplicate column (already exists)
    if (err.errno === 1060 || err.message?.includes("Duplicate column")) {
      console.log("[DB] projects.isPublic column already exists");
    } else {
      console.error("[DB] isPublic column error:", err.message);
    }
  }
  // Ensure createdBy column exists in tasks table
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`ALTER TABLE tasks ADD COLUMN createdBy VARCHAR(100)`);
    console.log("[DB] tasks.createdBy column added");
    await conn.end();
  } catch (err: any) {
    if (err.errno === 1060 || err.message?.includes("Duplicate column")) {
      console.log("[DB] tasks.createdBy column already exists");
    } else {
      console.error("[DB] createdBy column error:", err.message);
    }
  }
  // Ensure webhookUrl column exists in projects table
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`ALTER TABLE projects ADD COLUMN webhookUrl TEXT`);
    console.log("[DB] projects.webhookUrl column added");
    await conn.end();
  } catch (err: any) {
    if (err.errno === 1060 || err.message?.includes("Duplicate column")) {
      console.log("[DB] projects.webhookUrl column already exists");
    } else {
      console.error("[DB] webhookUrl column error:", err.message);
    }
  }
  // Ensure subtask_templates table exists
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`CREATE TABLE IF NOT EXISTS subtask_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id VARCHAR(255) NOT NULL,
      name VARCHAR(500) NOT NULL,
      items JSON NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id)
    )`);
    console.log("[DB] subtask_templates table ensured");
    await conn.end();
  } catch (err) {
    console.error("[DB] subtask_templates table error:", err);
  }
  // Ensure due_history table exists
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`CREATE TABLE IF NOT EXISTS due_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      taskId VARCHAR(64) NOT NULL,
      prevDue VARCHAR(20),
      newDue VARCHAR(20),
      changedBy VARCHAR(100),
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_task_id (taskId)
    )`);
    console.log("[DB] due_history table ensured");
    await conn.end();
  } catch (err) {
    console.error("[DB] due_history table error:", err);
  }
  // Geminiメモ同期の接続情報・重複取込防止情報を保持する。
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    await conn.execute(`CREATE TABLE IF NOT EXISTS gemini_sync_connections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ownerEmail VARCHAR(320) NOT NULL UNIQUE,
      encryptedRefreshToken TEXT NOT NULL,
      pageToken TEXT NOT NULL,
      channelId VARCHAR(64),
      channelResourceId VARCHAR(255),
      channelToken VARCHAR(128),
      channelExpiresAt BIGINT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      lastSyncedAt DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY gemini_sync_channel_id (channelId)
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS gemini_imported_items (
      importKey CHAR(64) NOT NULL PRIMARY KEY,
      sourceFileId VARCHAR(128) NOT NULL,
      sourceDocTitle VARCHAR(500),
      sourceUrl TEXT,
      taskId VARCHAR(100) NOT NULL,
      sourceText TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX gemini_import_source_file (sourceFileId),
      INDEX gemini_import_task (taskId)
    )`);
    console.log("[DB] gemini sync tables ensured");
    await conn.end();
  } catch (err) {
    console.error("[DB] gemini sync tables error:", err);
  }
}

async function trimDoneTasksOnStartup() {
  if (!process.env.DATABASE_URL) return;
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    // 完了カラムを取得
    const [cols] = await conn.execute("SELECT id FROM `columns` WHERE title = '\u5b8c\u4e86'") as any[];
    for (const col of cols) {
      const [rows] = await conn.execute(
        "SELECT id FROM tasks WHERE colId = ? ORDER BY sortOrder ASC",
        [col.id]
      ) as any[];
      const MAX_DONE = 100;
      if (rows.length > MAX_DONE) {
        const toDelete = rows.slice(0, rows.length - MAX_DONE);
        for (const row of toDelete) {
          await conn.execute("DELETE FROM comments WHERE taskId = ?", [row.id]);
          await conn.execute("DELETE FROM tasks WHERE id = ?", [row.id]);
        }
        console.log(`[DB] 完了カラム(${col.id}): ${toDelete.length}件の古いタスクを削除しました`);
      }
    }
    await conn.end();
    console.log("[DB] trimDoneTasks completed");
  } catch (err) {
    console.error("[DB] trimDoneTasks error:", err);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Run DB migrations before starting the server
  await runMigrations();
  // 完了タスクを100件に削減（起動時に一度実行）
  await trimDoneTasksOnStartup();

  const app = express();
  const server = createServer(app);
  // Cookie parser (required for reading/writing cookies)
  app.use(cookieParser());
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Legacy OAuth callback and Google Workspace OAuth routes
  registerOAuthRoutes(app);
  registerGoogleAuthRoutes(app);
  registerGeminiSyncRoutes(app);
  // Google Chat Webhook プロキシ
  app.post("/api/gchat-send", async (req, res) => {
    const { webhookUrl, text } = req.body as { webhookUrl: string; text: string };
    if (!webhookUrl || !text) {
      res.status(400).json({ error: "webhookUrl and text are required" });
      return;
    }
    // 土日祝は通知を送らない（日本時間基準）。
    const jstToday = getJstDate();
    if (!isJapaneseBusinessDay(jstToday)) {
      res.json({ success: true, skipped: true, reason: "non_business_day" });
      return;
    }
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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

  // 外部監視用。認証・DBアクセス・静的アセット配信を伴わず、プロセスの応答性だけを確認する。
  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ok: true, service: "taskboard" });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
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

// ─── 毎朝9時：期限超過タスクをGoogle Chatに通知 ──────────────────────────────────────────────
async function sendOverdueNotifications() {
  if (!process.env.DATABASE_URL) return;
  const jstToday = getJstDate();
  if (!isJapaneseBusinessDay(jstToday)) {
    console.log("[Overdue] 土日祝のため通知をスキップ");
    return;
  }
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);

    // 完了・日々作業カラムのIDを取得（通知除外対象）
    const [doneCols] = await conn.execute("SELECT id FROM `columns` WHERE title = '\u5b8c\u4e86'") as any[];
    const doneColIds: string[] = doneCols.map((c: any) => c.id);
    const [dailyCols] = await conn.execute("SELECT id FROM `columns` WHERE title = '\u65e5\u3005\u4f5c\u696d'") as any[];
    const dailyColIds: string[] = dailyCols.map((c: any) => c.id);

    // 期限超過通知の除外カラム：完了のみ
    const doneExclude = doneColIds.length > 0
      ? ` AND t.colId NOT IN (${doneColIds.map(() => '?').join(',')})`
      : "";

    // 期限未設定通知の除外カラム：完了＋日々作業
    const allExcludeIds = [...doneColIds, ...dailyColIds];
    const allExclude = allExcludeIds.length > 0
      ? ` AND t.colId NOT IN (${allExcludeIds.map(() => '?').join(',')})`
      : "";

    // 期限超過タスクを取得（完了カラム以外、期日が今日より前）
    const overdueQuery = `SELECT t.id, t.title, t.assignee, t.due, t.colId, t.projectId, c.title as colTitle, p.name as projectName FROM tasks t LEFT JOIN \`columns\` c ON t.colId = c.id LEFT JOIN projects p ON t.projectId = p.id WHERE t.due IS NOT NULL AND t.due != '' AND t.due < ?${doneExclude}`;
    const overdueParams: any[] = [jstToday, ...doneColIds];
    const [overdueTasks] = await conn.execute(overdueQuery, overdueParams) as any[];

    // 期限未設定タスクを取得（完了・日々作業カラム以外、dueがNULLまたは空文字）
    const noDueQuery = `SELECT t.id, t.title, t.assignee, t.due, t.colId, t.projectId, c.title as colTitle, p.name as projectName FROM tasks t LEFT JOIN \`columns\` c ON t.colId = c.id LEFT JOIN projects p ON t.projectId = p.id WHERE (t.due IS NULL OR t.due = '')${allExclude}`;
    const noDueParams: any[] = [...allExcludeIds];
    const [noDueTasks] = await conn.execute(noDueQuery, noDueParams) as any[];

    if (overdueTasks.length === 0 && noDueTasks.length === 0) {
      await conn.end();
      return;
    }

    // プロジェクト別にWebhook URLを取得
    const allTasks = [...overdueTasks, ...noDueTasks];
    const projectIds = [...new Set(allTasks.map((t: any) => t.projectId))] as string[];
    const webhookMap: Record<string, string> = {};
    for (const pid of projectIds) {
      const [rows] = await conn.execute("SELECT value FROM settings WHERE `settingKey` = ?", [`webhook_url_${pid}`]) as any[];
      if (rows[0]?.value) webhookMap[pid] = rows[0].value;
    }

    // プロジェクト別にグループ化
    const overdueByProject: Record<string, any[]> = {};
    for (const t of overdueTasks) {
      if (!overdueByProject[t.projectId]) overdueByProject[t.projectId] = [];
      overdueByProject[t.projectId].push(t);
    }
    const noDueByProject: Record<string, any[]> = {};
    for (const t of noDueTasks) {
      if (!noDueByProject[t.projectId]) noDueByProject[t.projectId] = [];
      noDueByProject[t.projectId].push(t);
    }

    let totalSent = 0;
    for (const pid of projectIds) {
      const webhookUrl = webhookMap[pid];
      if (!webhookUrl) continue;
      const ptasksOverdue = overdueByProject[pid] || [];
      const ptasksNoDue = noDueByProject[pid] || [];
      const projectName = (ptasksOverdue[0] || ptasksNoDue[0])?.projectName || pid;

      const lines: string[] = [
        `🚨 *タスク確認通知* （${jstToday}時点）`,
        `📁 *${projectName}*`,
        "",
      ];

      if (ptasksOverdue.length > 0) {
        lines.push(`⚠️ *期限超過: ${ptasksOverdue.length}件*`);
        for (const t of ptasksOverdue) {
          lines.push(`📋 ${t.title}`);
          const assigneeDisplay = t.assignee ? t.assignee.split(",").map((a: string) => a.trim()).filter(Boolean).join(" & ") : "担当未設定";
          lines.push(`  🗂 ${t.colTitle || "不明"} ｜ 👤 ${assigneeDisplay} ｜ 📅 ${t.due}`);
        }
        lines.push("");
      }

      if (ptasksNoDue.length > 0) {
        lines.push(`🗓 *期限未設定: ${ptasksNoDue.length}件*`);
        for (const t of ptasksNoDue) {
          lines.push(`📋 ${t.title}`);
          const assigneeDisplay2 = t.assignee ? t.assignee.split(",").map((a: string) => a.trim()).filter(Boolean).join(" & ") : "担当未設定";
          lines.push(`  🗂 ${t.colTitle || "不明"} ｜ 👤 ${assigneeDisplay2}`);
        }
        lines.push("");
      }

      const text = lines.join("\n");
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      totalSent += ptasksOverdue.length + ptasksNoDue.length;
    }
    console.log(`[Overdue] 期限超過${overdueTasks.length}件・期限未設定${noDueTasks.length}件を通知しました`);
    await conn.end();
  } catch (err) {
    console.error("[Overdue] 通知エラー:", err);
  }
}

// ─── 期限前日・当日の未完了タスクをGoogle Chatに通知 ─────────────────────────
type DueNotificationKind = "tomorrow" | "today";

type DueNotificationItem = {
  id: string;
  title: string;
  assignee: string;
  projectId: string;
  projectName: string;
  colTitle: string;
  isSubtask: boolean;
  parentTitle?: string;
  targetDate: string;
};

const APP_BASE_URL = "https://proactive-caring-production-1be5.up.railway.app";

function formatAssignee(assignee?: string | null) {
  const names = (assignee || "").split(",").map((name) => name.trim()).filter(Boolean);
  return names.length > 0 ? names.join(" & ") : "担当未設定";
}

function parseSubtasks(value: unknown): Array<{ id?: number | string; text?: string; done?: boolean; assignee?: string; due?: string; dueStart?: string }> {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function sendDueNotifications(kind: DueNotificationKind) {
  if (!process.env.DATABASE_URL) return;
  const plan = getDueNotificationPlan(kind);
  if (!plan) {
    console.log(`[DueNotify] ${kind}：土日祝のため通知をスキップ`);
    return;
  }
  const targetDates = plan.targetDates;
  const targetDateSet = new Set(targetDates);
  const isBeforeNonBusinessDays = plan.kind === "beforeNonBusinessDays";
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);
    const [doneColumns] = await conn.execute("SELECT id FROM `columns` WHERE title = '完了'") as any[];
    const doneColIds: string[] = doneColumns.map((column: any) => column.id);
    const doneExclude = doneColIds.length > 0 ? ` AND t.colId NOT IN (${doneColIds.map(() => "?").join(",")})` : "";

    // 親タスクが完了カラムにあるものは、小タスクを含めてすべて通知対象外にする。
    const taskQuery = `SELECT t.id, t.title, t.assignee, t.due, t.subtasks, t.projectId, c.title AS colTitle, p.name AS projectName
      FROM tasks t
      LEFT JOIN \`columns\` c ON t.colId = c.id
      LEFT JOIN projects p ON t.projectId = p.id
      WHERE (t.due IN (${targetDates.map(() => "?").join(",")}) OR t.subtasks IS NOT NULL)${doneExclude}`;
    const [rows] = await conn.execute(taskQuery, [...targetDates, ...doneColIds]) as any[];

    const itemsByProject: Record<string, DueNotificationItem[]> = {};
    for (const task of rows) {
      const projectId = task.projectId;
      if (!projectId) continue;
      const add = (item: DueNotificationItem) => {
        if (!itemsByProject[projectId]) itemsByProject[projectId] = [];
        itemsByProject[projectId].push(item);
      };
      if (targetDateSet.has(task.due)) {
        add({
          id: task.id,
          title: task.title,
          assignee: task.assignee || "",
          projectId,
          projectName: task.projectName || projectId,
          colTitle: task.colTitle || "未分類",
          isSubtask: false,
          targetDate: task.due,
        });
      }
      // 小タスクはdone=falseかつ終了日（due）が対象日のものだけを通知する。
      for (const subtask of parseSubtasks(task.subtasks)) {
        if (subtask.done || !subtask.due || !targetDateSet.has(subtask.due) || !subtask.text?.trim()) continue;
        add({
          id: task.id,
          title: subtask.text.trim(),
          assignee: subtask.assignee || task.assignee || "",
          projectId,
          projectName: task.projectName || projectId,
          colTitle: task.colTitle || "未分類",
          isSubtask: true,
          parentTitle: task.title,
          targetDate: subtask.due,
        });
      }
    }

    const projectIds = Object.keys(itemsByProject);
    let totalSent = 0;
    for (const projectId of projectIds) {
      const [settingsRows] = await conn.execute(
        "SELECT value FROM settings WHERE `settingKey` = ?",
        [`webhook_url_${projectId}`],
      ) as any[];
      const webhookUrl = settingsRows[0]?.value;
      if (!webhookUrl) continue;

      const items = itemsByProject[projectId];
      const projectName = items[0]?.projectName || projectId;
      const mainTasks = items.filter((item) => !item.isSubtask);
      const subtasks = items.filter((item) => item.isSubtask);
      const dateLabel = targetDates.length === 1
        ? targetDates[0].replace(/-/g, "/")
        : `${targetDates[0].replace(/-/g, "/")}〜${targetDates[targetDates.length - 1].replace(/-/g, "/")}`;
      const lines = [
        isBeforeNonBusinessDays
          ? "📅 *土日祝・翌営業日分の期限タスク*"
          : kind === "tomorrow" ? "📅 *明日までのタスク*" : "⏰ *本日までのタスク*",
        `📁 *${projectName}*`,
        `期限：${dateLabel}`,
        "",
      ];
      if (isBeforeNonBusinessDays) {
        lines.push("次の通知対象日が土日祝のため、直前の営業日にまとめてお知らせしています。", "");
      }
      if (mainTasks.length > 0) {
        lines.push(`📋 *タスク（${mainTasks.length}件）*`);
        for (const item of mainTasks) {
          const taskUrl = `${APP_BASE_URL}/?project=${item.projectId}&task=${item.id}`;
          lines.push(`• <${taskUrl}|${item.title}> ｜ 📅 ${item.targetDate.replace(/-/g, "/")} ｜ 👤 ${formatAssignee(item.assignee)} ｜ 🗂 ${item.colTitle}`);
        }
        lines.push("");
      }
      if (subtasks.length > 0) {
        lines.push(`☑️ *小タスク（${subtasks.length}件）*`);
        for (const item of subtasks) {
          const taskUrl = `${APP_BASE_URL}/?project=${item.projectId}&task=${item.id}`;
          lines.push(`• <${taskUrl}|${item.title}>`);
          lines.push(`  親タスク：${item.parentTitle} ｜ 📅 ${item.targetDate.replace(/-/g, "/")} ｜ 👤 ${formatAssignee(item.assignee)} ｜ 🗂 ${item.colTitle}`);
        }
        lines.push("");
      }
      lines.push("完了した項目は、次回以降の通知から自動で除外されます。");

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: lines.join("\n") }),
      });
      if (response.ok) totalSent += items.length;
      else console.error(`[DueNotify] ${projectName} への通知に失敗しました:`, response.status);
    }
    console.log(`[DueNotify] ${kind}：${totalSent}件を通知しました（対象日 ${targetDates.join(", ")}）`);
    await conn.end();
  } catch (error) {
    console.error(`[DueNotify] ${kind} 通知エラー:`, error);
  }
}

function scheduleJstDaily(hour: number, minute: number, jobName: string, job: () => Promise<void>) {
  const scheduleNext = () => {
    const now = new Date();
    // JSTの予定時刻をUTC日時として作成する（JST = UTC+9）。
    const target = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    target.setUTCHours(hour, minute, 0, 0);
    let delay = target.getTime() - (now.getTime() + 9 * 60 * 60 * 1000);
    if (delay <= 0) delay += 24 * 60 * 60 * 1000;
    setTimeout(async () => {
      await job();
      scheduleNext();
    }, delay);
    console.log(`[DueNotify] ${jobName}：次回 ${new Date(now.getTime() + delay).toISOString()}（JST ${hour}:${String(minute).padStart(2, "0")}）`);
  };
  scheduleNext();
}

function scheduleDueNotifications() {
  // 前日は朝9時に1回、当日は10時・13時・15時に未完了項目を再抽出して送る。
  scheduleJstDaily(9, 0, "明日までのタスク通知", () => sendDueNotifications("tomorrow"));
  scheduleJstDaily(10, 0, "本日までのタスク通知", () => sendDueNotifications("today"));
  scheduleJstDaily(13, 0, "本日までのタスク通知", () => sendDueNotifications("today"));
  scheduleJstDaily(15, 0, "本日までのタスク通知", () => sendDueNotifications("today"));
}

function scheduleGeminiSyncWatchRenewal() {
  // Google Driveの変更通知は最大7日で失効するため、毎日安全に更新する。
  void renewGeminiSyncWatches();
  setInterval(() => { void renewGeminiSyncWatches(); }, 24 * 60 * 60 * 1000);
  console.log("[GeminiSync] Drive通知の更新スケジュールを開始しました");
}

function scheduleOverdueNotifications() {
  const now = new Date();
  // 日本時間9:00 = UTC 0:00
  const nextRun = new Date();
  nextRun.setUTCHours(0, 0, 0, 0);
  if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
  const delay = nextRun.getTime() - now.getTime();
  setTimeout(() => {
    sendOverdueNotifications();
    setInterval(sendOverdueNotifications, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`[Overdue] 次回通知: ${nextRun.toISOString()}（${Math.round(delay / 60000)}分後）`);
}

startServer().then(() => {
  scheduleOverdueNotifications();
  scheduleDueNotifications();
  scheduleGeminiSyncWatchRenewal();
}).catch(console.error);
