/**
 * RoadmapView - ガントチャート形式のロードマップページ
 * ・全プロジェクトのタスクを横軸（日付）×縦軸（プロジェクト > カラム）で表示
 * ・期限開始日〜期限日をバーで表示
 * ・小タスクにも開始日・終了日があればガントバーを表示
 * ・今日の位置に赤い縦線
 * ・期限超過タスクは赤く強調
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";

type SubtaskType = {
  id: number;
  text: string;
  done: boolean;
  dueStart?: string;
  due?: string;
  assignee?: string;
};

type TaskType = {
  id: string;
  title: string;
  colId: string;
  projectId: string;
  due: string | null;
  dueStart: string | null;
  priority: string;
  assignee: string;
  taskStatus?: string | null;
  subtasks?: SubtaskType[];
};

type ProjectType = { id: string; name: string; color: string };

// 日付文字列をDateに変換
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 日付を YYYY/MM/DD 形式に
function fmt(d: Date) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// 2日付の差（日数）
function diffDays(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

const CELL_W = 28;
const ROW_H = 34;
const SUB_ROW_H = 26;
const LABEL_W = 200;

export default function RoadmapView({
  onBack,
  onNavigateToTask,
}: {
  onBack: () => void;
  onNavigateToTask?: (projectId: string, taskId: string) => void;
}) {
  const projectsQuery = trpc.project.list.useQuery();
  const projects: ProjectType[] = projectsQuery.data || [];

  const [showDone, setShowDone] = useState(false);
  // 折りたたみ状態: projectId -> boolean(collapsed)
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  // カラム折りたたみ: `${projectId}__${colId}` -> boolean
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>({});

  // 各プロジェクトのタスク・カラムを並列取得
  const allTasksQueries = projects.map((p) => ({
    id: p.id,
    tasks: trpc.task.list.useQuery({ projectId: p.id }),
    cols: trpc.column.list.useQuery({ projectId: p.id }),
  }));

  // プロジェクト > カラム > タスク の構造を構築
  const projectGroups = useMemo(() => {
    return projects
      .map((proj) => {
        const q = allTasksQueries.find((x) => x.id === proj.id);
        const tasks = (q?.tasks.data || []) as TaskType[];
        const cols = q?.cols.data || [];

        // カラムごとにタスクをグループ化
        const colGroups = cols.map((col) => {
          let colTasks = tasks.filter((t) => t.colId === col.id);
          if (!showDone) {
            colTasks = colTasks.filter(
              (t) => t.taskStatus !== "done" && !col.title.toLowerCase().includes("done") && !col.title.includes("完了")
            );
          }
          // 期限があるタスク、または期限付き小タスクがあるタスクのみ
          colTasks = colTasks.filter((t) => {
            if (t.due || t.dueStart) return true;
            return (t.subtasks || []).some((s) => s.dueStart || s.due);
          });
          return { col, tasks: colTasks };
        }).filter((cg) => cg.tasks.length > 0);

        return { proj, colGroups };
      })
      .filter((pg) => pg.colGroups.length > 0);
  }, [projects, allTasksQueries, showDone]);

  // 表示期間を計算（全タスク・小タスクから）
  const { startDate, endDate, totalDays } = useMemo(() => {
    const dates: Date[] = [];
    for (const pg of projectGroups) {
      for (const cg of pg.colGroups) {
        for (const t of cg.tasks) {
          const s = parseDate(t.dueStart);
          const e = parseDate(t.due);
          if (s) dates.push(s);
          if (e) dates.push(e);
          // 小タスクの日付も考慮
          for (const sub of (t.subtasks || [])) {
            const ss = parseDate(sub.dueStart);
            const se = parseDate(sub.due);
            if (ss) dates.push(ss);
            if (se) dates.push(se);
          }
        }
      }
    }
    if (dates.length === 0) {
      const today = new Date();
      const s = new Date(today); s.setDate(s.getDate() - 7);
      const e = new Date(today); e.setDate(e.getDate() + 30);
      return { startDate: s, endDate: e, totalDays: 37 };
    }
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    minDate.setDate(minDate.getDate() - 3);
    maxDate.setDate(maxDate.getDate() + 7);
    return { startDate: minDate, endDate: maxDate, totalDays: diffDays(minDate, maxDate) + 1 };
  }, [projectGroups]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOffset = diffDays(startDate, today);

  // ヘッダー（月・日）
  const headerMonths: { label: string; span: number }[] = [];
  const headerDays: { label: string; isWeekend: boolean }[] = [];
  let cur = new Date(startDate);
  let curMonth = "";
  let monthSpan = 0;
  for (let i = 0; i < totalDays; i++) {
    const m = `${cur.getFullYear()}年${cur.getMonth() + 1}月`;
    if (m !== curMonth) {
      if (curMonth) headerMonths.push({ label: curMonth, span: monthSpan });
      curMonth = m;
      monthSpan = 0;
    }
    monthSpan++;
    const day = cur.getDay();
    headerDays.push({ label: String(cur.getDate()), isWeekend: day === 0 || day === 6 });
    cur.setDate(cur.getDate() + 1);
  }
  if (curMonth) headerMonths.push({ label: curMonth, span: monthSpan });

  const totalWidth = LABEL_W + totalDays * CELL_W;
  const isLoading = allTasksQueries.some((q) => q.tasks.isLoading || q.cols.isLoading);

  const toggleProject = (pid: string) =>
    setCollapsedProjects((prev) => ({ ...prev, [pid]: !prev[pid] }));
  const toggleCol = (pid: string, cid: string) =>
    setCollapsedCols((prev) => ({ ...prev, [`${pid}__${cid}`]: !prev[`${pid}__${cid}`] }));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f8f7ff", fontFamily: "'Noto Sans JP', sans-serif" }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", background: "#fff", borderBottom: "1.5px solid #e0e7ff", flexShrink: 0, flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ background: "#f0f0ff", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", color: "#6366f1", fontWeight: 700, fontSize: 13 }}
        >← 戻る</button>
        <span style={{ fontWeight: 800, fontSize: 16, color: "#1e1b4b" }}>📅 ロードマップ</span>

        {/* 完了タスク表示切り替え */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          完了タスクも表示
        </label>

        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
          プロジェクト › カラム別表示
        </span>
      </div>

      {/* ガントチャート本体 */}
      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
          読み込み中...
        </div>
      ) : projectGroups.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14 }}>
          期限が設定されたタスクがありません
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
          <div style={{ minWidth: totalWidth, position: "relative" }}>

            {/* 月ヘッダー */}
            <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 20, background: "#fff" }}>
              <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1.5px solid #e0e7ff", borderBottom: "1px solid #e0e7ff", background: "#f8f7ff" }} />
              {headerMonths.map((m, i) => (
                <div key={i} style={{ width: m.span * CELL_W, flexShrink: 0, borderRight: "1px solid #e0e7ff", borderBottom: "1px solid #e0e7ff", padding: "4px 6px", fontSize: 11, fontWeight: 700, color: "#1e1b4b", background: "#f8f7ff", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* 日付ヘッダー */}
            <div style={{ display: "flex", position: "sticky", top: 24, zIndex: 20, background: "#fff" }}>
              <div style={{ width: LABEL_W, flexShrink: 0, borderRight: "1.5px solid #e0e7ff", borderBottom: "1.5px solid #e0e7ff", background: "#f8f7ff" }} />
              {headerDays.map((d, i) => (
                <div key={i} style={{
                  width: CELL_W, flexShrink: 0,
                  borderRight: "1px solid #f0f0ff",
                  borderBottom: "1.5px solid #e0e7ff",
                  textAlign: "center",
                  fontSize: 10,
                  color: i === todayOffset ? "#6366f1" : d.isWeekend ? "#94a3b8" : "#64748b",
                  fontWeight: i === todayOffset ? 800 : 400,
                  background: i === todayOffset ? "#ede9fe" : d.isWeekend ? "#fafafa" : "#fff",
                  padding: "3px 0",
                }}>
                  {d.label}
                </div>
              ))}
            </div>

            {/* プロジェクト > カラム > タスク（+ 小タスク） */}
            {projectGroups.map(({ proj, colGroups }) => {
              const isProjectCollapsed = !!collapsedProjects[proj.id];
              return (
                <div key={proj.id}>
                  {/* プロジェクトヘッダー行 */}
                  <div
                    style={{ display: "flex", background: "#ede9fe", borderBottom: "1.5px solid #c7d2fe", cursor: "pointer" }}
                    onClick={() => toggleProject(proj.id)}
                  >
                    <div style={{
                      width: LABEL_W, flexShrink: 0,
                      padding: "7px 12px",
                      fontWeight: 800, fontSize: 13, color: "#1e1b4b",
                      borderRight: "1.5px solid #c7d2fe",
                      display: "flex", alignItems: "center", gap: 6,
                      position: "sticky", left: 0, background: "#ede9fe", zIndex: 8,
                    }}>
                      <span style={{ fontSize: 11, color: "#6366f1", width: 14, textAlign: "center" }}>
                        {isProjectCollapsed ? "▶" : "▼"}
                      </span>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: proj.color || "#6366f1", flexShrink: 0, display: "inline-block" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.name}</span>
                    </div>
                    <div style={{ flex: 1, position: "relative", height: 32 }}>
                      {todayOffset >= 0 && todayOffset < totalDays && (
                        <div style={{ position: "absolute", left: todayOffset * CELL_W + CELL_W / 2, top: 0, bottom: 0, width: 2, background: "#ef4444", opacity: 0.4, zIndex: 1 }} />
                      )}
                    </div>
                  </div>

                  {/* カラムグループ（折りたたみ対応） */}
                  {!isProjectCollapsed && colGroups.map(({ col, tasks }) => {
                    const colKey = `${proj.id}__${col.id}`;
                    const isColCollapsed = !!collapsedCols[colKey];
                    return (
                      <div key={col.id}>
                        {/* カラムヘッダー行 */}
                        <div
                          style={{ display: "flex", background: "#f5f3ff", borderBottom: "1px solid #e0e7ff", cursor: "pointer" }}
                          onClick={() => toggleCol(proj.id, col.id)}
                        >
                          <div style={{
                            width: LABEL_W, flexShrink: 0,
                            padding: "5px 12px 5px 28px",
                            fontWeight: 700, fontSize: 12, color: "#4338ca",
                            borderRight: "1.5px solid #e0e7ff",
                            display: "flex", alignItems: "center", gap: 5,
                            position: "sticky", left: 0, background: "#f5f3ff", zIndex: 7,
                          }}>
                            <span style={{ fontSize: 10, color: "#6366f1", width: 12, textAlign: "center" }}>
                              {isColCollapsed ? "▶" : "▼"}
                            </span>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {col.title}
                            </span>
                            <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8", fontWeight: 400, flexShrink: 0 }}>
                              {tasks.length}件
                            </span>
                          </div>
                          <div style={{ flex: 1, position: "relative", height: 28 }}>
                            {todayOffset >= 0 && todayOffset < totalDays && (
                              <div style={{ position: "absolute", left: todayOffset * CELL_W + CELL_W / 2, top: 0, bottom: 0, width: 2, background: "#ef4444", opacity: 0.2, zIndex: 1 }} />
                            )}
                          </div>
                        </div>

                        {/* タスク行 + 小タスク行 */}
                        {!isColCollapsed && tasks.map((task, ti) => {
                          const dueDate = parseDate(task.due);
                          const startD = parseDate(task.dueStart) || dueDate;
                          const endD = dueDate || startD;

                          const isOverdue = dueDate ? dueDate < today && task.taskStatus !== "done" : false;
                          const isDone = task.taskStatus === "done";
                          const isTodayDue = dueDate &&
                            dueDate.getFullYear() === today.getFullYear() &&
                            dueDate.getMonth() === today.getMonth() &&
                            dueDate.getDate() === today.getDate();

                          const barColor = isDone
                            ? "#94a3b8"
                            : isOverdue
                            ? "#ef4444"
                            : isTodayDue
                            ? "#f97316"
                            : proj.color || "#6366f1";

                          // 期限付き小タスク
                          const subtasksWithDates = (task.subtasks || []).filter(
                            (s) => s.dueStart || s.due
                          );

                          return (
                            <div key={task.id}>
                              {/* タスク行（期限がある場合のみバーを表示） */}
                              <div style={{ display: "flex", borderBottom: subtasksWithDates.length > 0 ? "none" : "1px solid #f0f0ff", height: ROW_H }}>
                                {/* タスク名ラベル */}
                                <div style={{
                                  width: LABEL_W, flexShrink: 0,
                                  padding: "0 8px 0 40px",
                                  display: "flex", alignItems: "center",
                                  borderRight: "1.5px solid #e0e7ff",
                                  position: "sticky", left: 0, background: "#fff", zIndex: 4,
                                  gap: 4,
                                }}>
                                  {isOverdue && <span style={{ fontSize: 9, color: "#ef4444", flexShrink: 0 }}>🚨</span>}
                                  {isTodayDue && !isOverdue && <span style={{ fontSize: 9, flexShrink: 0 }}>🔔</span>}
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: isOverdue ? "#ef4444" : isDone ? "#94a3b8" : "#1e1b4b",
                                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                      textDecoration: isDone ? "line-through" : "none",
                                      fontWeight: isOverdue ? 700 : 400,
                                      cursor: onNavigateToTask ? "pointer" : "default",
                                    }}
                                    title={task.title}
                                    onClick={() => onNavigateToTask?.(task.projectId, task.id)}
                                  >
                                    {task.title}
                                  </span>
                                </div>

                                {/* ガントバー（タスクに期限がある場合のみ） */}
                                <div style={{ flex: 1, position: "relative", background: ti % 2 === 0 ? "#fff" : "#fafbff" }}>
                                  {headerDays.map((d, di) => d.isWeekend ? (
                                    <div key={di} style={{ position: "absolute", left: di * CELL_W, top: 0, width: CELL_W, height: "100%", background: "rgba(0,0,0,0.02)" }} />
                                  ) : null)}
                                  {todayOffset >= 0 && todayOffset < totalDays && (
                                    <div style={{ position: "absolute", left: todayOffset * CELL_W + CELL_W / 2, top: 0, bottom: 0, width: 2, background: "#ef4444", opacity: 0.15, zIndex: 1 }} />
                                  )}
                                  {startD && endD && (
                                    <div
                                      title={`${task.title}\n${task.assignee ? `担当: ${task.assignee}` : ""}\n${fmt(startD)}〜${fmt(endD)}\nクリックで詳細を開く`}
                                      onClick={() => onNavigateToTask?.(task.projectId, task.id)}
                                      style={{
                                        position: "absolute",
                                        left: Math.max(0, diffDays(startDate, startD)) * CELL_W + 2,
                                        top: 5,
                                        width: Math.max(1, diffDays(startD, endD) + 1) * CELL_W - 4,
                                        height: ROW_H - 10,
                                        background: barColor,
                                        borderRadius: 4,
                                        opacity: isDone ? 0.5 : 1,
                                        display: "flex",
                                        alignItems: "center",
                                        paddingLeft: 6,
                                        overflow: "hidden",
                                        cursor: onNavigateToTask ? "pointer" : "default",
                                        zIndex: 2,
                                        boxShadow: isOverdue ? "0 2px 8px rgba(239,68,68,.3)" : "0 1px 4px rgba(0,0,0,.1)",
                                        transition: "filter .15s, transform .15s",
                                      }}
                                      onMouseEnter={(e) => { if (onNavigateToTask) { e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.transform = "scaleY(1.08)"; } }}
                                      onMouseLeave={(e) => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}
                                    >
                                      <span style={{ fontSize: 10, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {Math.max(1, diffDays(startD, endD) + 1) * CELL_W > 40 ? task.title : ""}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 小タスク行 */}
                              {subtasksWithDates.map((s, si) => {
                                const sStart = parseDate(s.dueStart || null) || parseDate(s.due || null);
                                const sEnd = parseDate(s.due || null) || sStart;
                                if (!sStart || !sEnd) return null;
                                const sLeft = Math.max(0, diffDays(startDate, sStart));
                                const sWidth = Math.max(1, diffDays(sStart, sEnd) + 1);
                                const sIsOverdue = sEnd < today && !s.done;
                                const sBarColor = s.done ? "#94a3b8" : sIsOverdue ? "#ef4444" : "#a78bfa";
                                const isLastSub = si === subtasksWithDates.length - 1;
                                return (
                                  <div key={s.id} style={{ display: "flex", borderBottom: isLastSub ? "1px solid #f0f0ff" : "none", height: SUB_ROW_H }}>
                                    {/* 小タスク名ラベル */}
                                    <div style={{
                                      width: LABEL_W, flexShrink: 0,
                                      padding: "0 8px 0 52px",
                                      display: "flex", alignItems: "center",
                                      borderRight: "1.5px solid #e0e7ff",
                                      position: "sticky", left: 0, background: "#faf8ff", zIndex: 3,
                                      gap: 3,
                                    }}>
                                      <span style={{ fontSize: 9, color: "#a78bfa", flexShrink: 0 }}>└</span>
                                      <span style={{
                                        fontSize: 10,
                                        color: s.done ? "#94a3b8" : sIsOverdue ? "#ef4444" : "#4338ca",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        textDecoration: s.done ? "line-through" : "none",
                                      }} title={s.text}>{s.text}</span>
                                    </div>
                                    {/* 小タスクガントバー */}
                                    <div style={{ flex: 1, position: "relative", background: "#faf8ff" }}>
                                      {todayOffset >= 0 && todayOffset < totalDays && (
                                        <div style={{ position: "absolute", left: todayOffset * CELL_W + CELL_W / 2, top: 0, bottom: 0, width: 2, background: "#ef4444", opacity: 0.1, zIndex: 1 }} />
                                      )}
                                      <div
                                        title={`小タスク: ${s.text}\n${s.assignee ? `担当: ${s.assignee}` : ""}\n${fmt(sStart)}〜${fmt(sEnd)}`}
                                        style={{
                                          position: "absolute",
                                          left: sLeft * CELL_W + 2,
                                          top: 4,
                                          width: sWidth * CELL_W - 4,
                                          height: SUB_ROW_H - 8,
                                          background: sBarColor,
                                          borderRadius: 3,
                                          opacity: s.done ? 0.5 : 0.85,
                                          display: "flex",
                                          alignItems: "center",
                                          paddingLeft: 4,
                                          overflow: "hidden",
                                          zIndex: 2,
                                          boxShadow: "0 1px 3px rgba(0,0,0,.1)",
                                        }}
                                      >
                                        <span style={{ fontSize: 9, color: "#fff", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {sWidth * CELL_W > 36 ? s.text : ""}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 今日の縦線（全体） */}
            {todayOffset >= 0 && todayOffset < totalDays && (
              <div style={{
                position: "absolute",
                left: LABEL_W + todayOffset * CELL_W + CELL_W / 2,
                top: 0, bottom: 0, width: 2,
                background: "#ef4444",
                opacity: 0.6,
                zIndex: 3,
                pointerEvents: "none",
              }} />
            )}
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div style={{ display: "flex", gap: 16, padding: "8px 20px", background: "#fff", borderTop: "1.5px solid #e0e7ff", flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>凡例：</span>
        {[
          { color: "#ef4444", label: "期限超過" },
          { color: "#f97316", label: "本日が期限" },
          { color: "#6366f1", label: "進行中" },
          { color: "#a78bfa", label: "小タスク" },
          { color: "#94a3b8", label: "完了" },
        ].map((l) => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 20, height: 10, background: l.color, borderRadius: 3 }} />
            <span style={{ fontSize: 11, color: "#64748b" }}>{l.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 2, height: 14, background: "#ef4444" }} />
          <span style={{ fontSize: 11, color: "#64748b" }}>今日</span>
        </div>
        <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>▼/▶ でプロジェクト・カラムを折りたたみ</span>
      </div>
    </div>
  );
}
