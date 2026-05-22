const BASE = "https://proactive-caring-production-1be5.up.railway.app";

async function trpc(path, input) {
  const url = `${BASE}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": input }))}`;
  const res = await fetch(url);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json[0]?.result?.data;
  } catch(e) {
    console.error("Parse error for", path, text.slice(0, 200));
    return null;
  }
}

// 全プロジェクト取得
const projects = await trpc("project.list", {});
console.log("=== プロジェクト一覧 ===");
for (const p of (projects || [])) {
  console.log(`  [${p.id}] ${p.name}`);
}

// 社内プロジェクトのカラム取得
const shanaProj = (projects || []).find(p => p.name.includes("社内"));
if (shanaProj) {
  console.log(`\n=== 社内プロジェクト: ${shanaProj.name} (${shanaProj.id}) ===`);
  const cols = await trpc("column.list", { projectId: shanaProj.id });
  for (const c of (cols || [])) {
    console.log(`  カラム [${c.id}] ${c.title}`);
  }
}

// 各種依頼事項プロジェクトのカラム取得
const irai = (projects || []).find(p => p.name.includes("依頼") || p.name.includes("各種"));
if (irai) {
  console.log(`\n=== 依頼プロジェクト: ${irai.name} (${irai.id}) ===`);
  const cols = await trpc("column.list", { projectId: irai.id });
  for (const c of (cols || [])) {
    console.log(`  カラム [${c.id}] ${c.title}`);
  }
}
