import { db } from "./db.js";
import { sql } from "drizzle-orm";

export async function runMigrations() {
  try {
    // isPublicカラムをprojectsテーブルに追加（存在しない場合のみ）
    await db.execute(sql`
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS isPublic BOOLEAN NOT NULL DEFAULT FALSE
    `);
    console.log("✓ Migration: isPublic column ensured");
  } catch (err: any) {
    // カラムが既に存在する場合はエラーを無視
    if (err.message && err.message.includes("Duplicate column")) {
      console.log("✓ Migration: isPublic column already exists");
    } else {
      console.error("Migration error:", err.message);
    }
  }
}
