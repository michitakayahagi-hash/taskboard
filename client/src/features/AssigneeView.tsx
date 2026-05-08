/**
 * AssigneeView - 全プロジェクト横断の担当者別タスク一覧
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";

const PRI: Record<string, { label: string; color: string }> = {
  high: { label: "高", color: "#ef4444" },
  medium: { label: "中", color: "#f59e0b" },
  low: { label: "低", color: "#6b7280" },
};

function getDueStatus(due: string | null): "overdue" | "today" | "soon" | "normal" | "none" {
  if (!due) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(due + "T00:00:00");
  const diff = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "soon";
  return "normal";
}

function DueLabel({ due }: { due: string | null }) {
  if (!due) return null;
  const status = getDueStatus(due);
  const colors: Record<string, { bg: string; text: string }> = {
    overdue: { bg: "#fee2e2", text: "#dc2626" },
    today: { bg: "#fef3c7", text: "#d97706" },
    soon: { bg: "#fef9c3", text: "#ca8a04" },
    normal: { bg: "#f0fdf4", text: "#16a34a" },
  };
  const c = colors[status] || colors.normal;
  const label = status === "overdue" ? `⚠️ ${due}` : status === "today" ? `🔔 今日 ${due}` : `📅 ${due}`;
  return (
    <span style={{ fontSize: 11, background: c.bg, color: c.text, borderRadius: 6, padding: "2px 7px", fontWeight: 700, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

interface TaskWithMeta {
  id: string;
  title: string;
  assignee: string;
  priority: string;
  due: string | null;
  colTitle: string;
  colColor: string;
  projectName: string;
  projectId: string;
  tags: string[];
}

export default function AssigneeView({ onBack }: { onBack: () => void }) {
  const allTasksQuery = trpc.task.listAll.useQuery();
  const allTasks: TaskWithMeta[] = (allTasksQuery.data || []).map((t: any) => ({
    ...t,
    tags: t.tags || [],
  }));

  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active"); // active | all
  const [sortKey, setSortKey] = useState<"due" | "priority" | "project">("due");

  // 完了カラムのタスクを除外（colTitleが「完了」のもの）
  const activeTasks = useMemo(() =>
    filterStatus === "active"
      ? allTasks.filter((t) => t.colTitle !== "完了")
      : allTasks,
    [allTasks, filterStatus]
  );

  // 担当者一覧（カンマ区切りを展開）
  const assignees = useMemo(() => {
    const set = new Set<string>();
    activeTasks.forEach((t) => {
      if (t.assignee) {
        t.assignee.split(",").map((a) => a.trim()).filter(Boolean).forEach((a) => set.add(a));
      }
    });
    return Array.from(set).sort();
  }, [activeTasks]);

  // プロジェクト一覧
  const projectNames = useMemo(() => {
    const set = new Set<string>();
    activeTasks.forEach((t) => set.add(t.projectName));
    return Array.from(set).sort();
  }, [activeTasks]);

  // 担当者ごとのタスク数（バッジ用）
  const assigneeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    activeTasks.forEach((t) => {
      if (t.assignee) {
        t.assignee.split(",").map((a) => a.trim()).filter(Boolean).forEach((a) => {
          counts[a] = (counts[a] || 0) + 1;
        });
      }
    });
    return counts;
  }, [activeTasks]);

  // 選択担当者のタスク一覧
  const filteredTasks = useMemo(() => {
    let tasks = selectedAssignee
      ? activeTasks.filter((t) => t.assignee && t.assignee.split(",").map((a) => a.trim()).includes(selectedAssignee))
      : activeTasks;
    if (filterProject !== "all") tasks = tasks.filter((t) => t.projectName === filterProject);
    // ソート
    return [...tasks].sort((a, b) => {
      if (sortKey === "due") {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      }
      if (sortKey === "priority") {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.priority as keyof typeof order] ?? 1) - (order[b.priority as keyof typeof order] ?? 1);
      }
      if (sortKey === "project") {
        return a.projectName.localeCompare(b.projectName);
      }
      return 0;
    });
  }, [activeTasks, selectedAssignee, filterProject, sortKey]);

  // 期限超過タスク数
  const overdueCount = useMemo(() =>
    filteredTasks.filter((t) => getDueStatus(t.due) === "overdue").length,
    [filteredTasks]
  );

  if (allTasksQuery.isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans JP',sans-serif", color: "#6366f1" }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8f7ff", fontFamily: "'Noto Sans JP',sans-serif" }}>
      {/* ヘッダー */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e0e7ff", padding: "0 16px", height: 54, display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 100 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 20, padding: "4px 8px", borderRadius: 8, display: "flex", alignItems: "center" }}>←</button>
        <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>👥</div>
        <span style={{ fontWeight: 800, fontSize: 15, color: "#1e1b4b" }}>担当者ダッシュボード</span>
        {overdueCount > 0 && (
          <span style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
            ⚠️ 期限超過 {overdueCount}件
          </span>
        )}
        <div style={{ flex: 1 }} />
        {/* 完了含むトグル */}
        <button
          onClick={() => setFilterStatus(filterStatus === "active" ? "all" : "active")}
          style={{ fontSize: 12, background: filterStatus === "all" ? "#ede9fe" : "#f1f5f9", color: filterStatus === "all" ? "#6366f1" : "#94a3b8", border: "1.5px solid " + (filterStatus === "all" ? "#6366f1" : "#e0e7ff"), borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>
          {filterStatus === "all" ? "✅ 完了含む" : "完了を除く"}
        </button>
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 54px)", overflow: "hidden" }}>
        {/* 担当者サイドバー */}
        <div style={{ width: 140, flexShrink: 0, background: "#fff", borderRight: "1px solid #e0e7ff", overflowY: "auto", padding: "12px 0" }}>
          <div
            onClick={() => setSelectedAssignee(null)}
            style={{ padding: "10px 14px", cursor: "pointer", background: selectedAssignee === null ? "#ede9fe" : "transparent", borderLeft: selectedAssignee === null ? "3px solid #6366f1" : "3px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: selectedAssignee === null ? 800 : 500, color: selectedAssignee === null ? "#6366f1" : "#374151" }}>全員</span>
            <span style={{ fontSize: 11, background: "#e0e7ff", color: "#6366f1", borderRadius: 10, padding: "1px 7px", fontWeight: 700 }}>{activeTasks.length}</span>
          </div>
          {assignees.map((a) => (
            <div key={a}
              onClick={() => setSelectedAssignee(a)}
              style={{ padding: "10px 14px", cursor: "pointer", background: selectedAssignee === a ? "#ede9fe" : "transparent", borderLeft: selectedAssignee === a ? "3px solid #6366f1" : "3px solid transparent", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: selectedAssignee === a ? 800 : 500, color: selectedAssignee === a ? "#6366f1" : "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{a}</span>
              <span style={{ fontSize: 11, background: "#e0e7ff", color: "#6366f1", borderRadius: 10, padding: "1px 7px", fontWeight: 700, flexShrink: 0 }}>{assigneeCounts[a] || 0}</span>
            </div>
          ))}
          {assignees.length === 0 && (
            <div style={{ padding: "16px 14px", fontSize: 12, color: "#94a3b8" }}>担当者なし</div>
          )}
        </div>

        {/* メインコンテンツ */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* フィルター・ソートバー */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              style={{ border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#374151", background: "#fff" }}>
              <option value="all">全プロジェクト</option>
              {projectNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              {(["due", "priority", "project"] as const).map((k) => (
                <button key={k} onClick={() => setSortKey(k)}
                  style={{ fontSize: 12, background: sortKey === k ? "#6366f1" : "#f1f5f9", color: sortKey === k ? "#fff" : "#64748b", border: "none", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontWeight: 700 }}>
                  {k === "due" ? "📅 期限順" : k === "priority" ? "⚡ 優先度" : "📂 プロジェクト"}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>{filteredTasks.length}件</span>
          </div>

          {/* タスクカード一覧 */}
          {filteredTasks.length === 0 ? (
            <div style={{ textAlign: "center", color: "#c7d2fe", fontSize: 14, marginTop: 60 }}>
              {selectedAssignee ? `${selectedAssignee} さんのタスクはありません` : "タスクがありません"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredTasks.map((task) => {
                const pri = PRI[task.priority] || PRI.medium;
                const dueStatus = getDueStatus(task.due);
                const cardBorder = dueStatus === "overdue" ? "1.5px solid #fca5a5" : "1.5px solid #e0e7ff";
                const cardBg = dueStatus === "overdue" ? "#fff5f5" : "#fff";
                return (
                  <div key={task.id} style={{ background: cardBg, border: cardBorder, borderRadius: 12, padding: "12px 14px", boxShadow: "0 1px 6px rgba(99,102,241,.06)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, background: pri.color + "22", color: pri.color, borderRadius: 6, padding: "2px 7px", fontWeight: 700, flexShrink: 0 }}>{pri.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1e1b4b", flex: 1, lineHeight: 1.4 }}>{task.title}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {/* プロジェクト */}
                      <span style={{ fontSize: 11, background: "#ede9fe", color: "#6d28d9", borderRadius: 6, padding: "2px 7px", fontWeight: 600 }}>📂 {task.projectName}</span>
                      {/* カラム */}
                      <span style={{ fontSize: 11, background: task.colColor + "22", color: task.colColor, borderRadius: 6, padding: "2px 7px", fontWeight: 600 }}>{task.colTitle}</span>
                      {/* 期限 */}
                      <DueLabel due={task.due} />
                      {/* 担当者（全員表示時のみ） */}
                      {!selectedAssignee && task.assignee && (
                        <span style={{ fontSize: 11, background: "#f0fdf4", color: "#16a34a", borderRadius: 6, padding: "2px 7px", fontWeight: 600 }}>
                          👤 {task.assignee.split(",").map((a) => a.trim()).join(" / ")}
                        </span>
                      )}
                      {/* タグ */}
                      {task.tags && task.tags.slice(0, 2).map((tag: string) => (
                        <span key={tag} style={{ fontSize: 10, background: "#f1f5f9", color: "#64748b", borderRadius: 6, padding: "2px 7px" }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
