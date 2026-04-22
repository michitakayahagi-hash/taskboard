import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const conn = await mysql.createConnection(url);

try {
  // isPublicカラムが存在するか確認
  const [rows] = await conn.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'isPublic'
  `);
  
  if (rows.length === 0) {
    await conn.execute(`ALTER TABLE projects ADD COLUMN isPublic BOOLEAN NOT NULL DEFAULT FALSE`);
    console.log("✓ isPublic column added to projects table");
  } else {
    console.log("✓ isPublic column already exists");
  }
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await conn.end();
}
