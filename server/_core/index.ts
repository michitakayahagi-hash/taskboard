import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
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
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Google Chat Webhook プロキシ
  app.post("/api/gchat-send", async (req, res) => {
    const { webhookUrl, text } = req.body as { webhookUrl: string; text: string };
    if (!webhookUrl || !text) {
      res.status(400).json({ error: "webhookUrl and text are required" });
      return;
    }
    // 土日（0=日曜、6=土曜）は通知をスキップ（JST基準）
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(Date.now() + jstOffset);
    const dayOfWeek = jstNow.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      res.json({ success: true, skipped: true, reason: "weekend" });
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
  // 土日（0=日曜、6=土曜）は通知をスキップ（JST基準）
  const jstOffset = 9 * 60 * 60 * 1000;
  const jstNow = new Date(Date.now() + jstOffset);
  const dow = jstNow.getUTCDay();
  if (dow === 0 || dow === 6) {
    console.log("[Overdue] 土日のため通知をスキップ");
    return;
  }
  try {
    const mysql2 = await import("mysql2/promise");
    const conn = await (mysql2 as any).createConnection(process.env.DATABASE_URL);

    // 完了カラムのIDを取得
    const [doneCols] = await conn.execute("SELECT id FROM `columns` WHERE title = '\u5b8c\u4e86'") as any[];
    const doneColIds: string[] = doneCols.map((c: any) => c.id);

    // 今日の日付（YYYY-MM-DD）→ JST基準
    const jstToday = new Date(Date.now() + jstOffset).toISOString().slice(0, 10);

    const doneExclude = doneColIds.length > 0
      ? ` AND t.colId NOT IN (${doneColIds.map(() => '?').join(',')})`
      : "";

    // 期限超過タスクを取得（完了カラム以外、期日が今日より前）
    const overdueQuery = `SELECT t.id, t.title, t.assignee, t.due, t.colId, t.projectId, c.title as colTitle, p.name as projectName FROM tasks t LEFT JOIN \`columns\` c ON t.colId = c.id LEFT JOIN projects p ON t.projectId = p.id WHERE t.due IS NOT NULL AND t.due != '' AND t.due < ?${doneExclude}`;
    const overdueParams: any[] = [jstToday, ...doneColIds];
    const [overdueTasks] = await conn.execute(overdueQuery, overdueParams) as any[];

    // 期限未設定タスクを取得（完了カラム以外、dueがNULLまたは空文字）
    const noDueQuery = `SELECT t.id, t.title, t.assignee, t.due, t.colId, t.projectId, c.title as colTitle, p.name as projectName FROM tasks t LEFT JOIN \`columns\` c ON t.colId = c.id LEFT JOIN projects p ON t.projectId = p.id WHERE (t.due IS NULL OR t.due = '')${doneExclude}`;
    const noDueParams: any[] = [...doneColIds];
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
          lines.push(`  🗂 ${t.colTitle || "不明"} ｜ 👤 ${t.assignee || "担当未設定"} ｜ 📅 ${t.due}`);
        }
        lines.push("");
      }

      if (ptasksNoDue.length > 0) {
        lines.push(`🗓 *期限未設定: ${ptasksNoDue.length}件*`);
        for (const t of ptasksNoDue) {
          lines.push(`📋 ${t.title}`);
          lines.push(`  🗂 ${t.colTitle || "不明"} ｜ 👤 ${t.assignee || "担当未設定"}`);
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
}).catch(console.error);
