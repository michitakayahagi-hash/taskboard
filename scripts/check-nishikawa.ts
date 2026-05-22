import mysql from "mysql2/promise";

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL!);

  // 社内プロジェクトを探す
  const [projects] = await db.execute("SELECT id, name FROM projects WHERE name LIKE '%社内%'") as any;
  console.log("社内プロジェクト:", JSON.stringify(projects, null, 2));

  // 各種依頼事項プロジェクトを探す
  const [projects2] = await db.execute("SELECT id, name FROM projects WHERE name LIKE '%依頼%'") as any;
  console.log("依頼プロジェクト:", JSON.stringify(projects2, null, 2));

  // 西川進行中カラムを探す
  const [cols] = await db.execute("SELECT id, title, projectId FROM columns WHERE title LIKE '%西川%'") as any;
  console.log("西川カラム:", JSON.stringify(cols, null, 2));

  // 各種依頼事項のカラムを探す
  const [cols2] = await db.execute("SELECT id, title, projectId FROM columns WHERE title LIKE '%依頼%' OR title LIKE '%各種%'") as any;
  console.log("依頼カラム:", JSON.stringify(cols2, null, 2));

  // 最近更新されたタスクを確認（消えた可能性のあるもの）
  const [recentTasks] = await db.execute(
    "SELECT id, title, projectId, colId, updatedAt FROM tasks ORDER BY updatedAt DESC LIMIT 20"
  ) as any;
  console.log("最近更新タスク:", JSON.stringify(recentTasks, null, 2));

  await db.end();
}

main().catch(console.error);
