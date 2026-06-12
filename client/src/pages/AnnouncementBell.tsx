/**
 * AnnouncementBell - 新機能お知らせベルアイコン
 * 未読があるとバッジ表示、クリックでポップアップ
 */
import { useState, useEffect, useRef } from "react";

// ─── お知らせデータ（新機能追加時にここに追記する） ───────────────────────
export const ANNOUNCEMENTS: { id: string; date: string; title: string; body: string }[] = [
  {
    id: "2026-06-12-move-col",
    date: "2026/06/12",
    title: "📦 タスク詳細から同プロジェクト内のカラムへ移動できるようになりました",
    body: "タスク詳細モーダルの📦ボタンから、同じプロジェクト内の別カラムにタスクを移動できます。別プロジェクトへの移動も引き続き利用できます。",
  },
  {
    id: "2026-06-12-member-sort",
    date: "2026/06/12",
    title: "👥 メンバーの並び順を変更できるようになりました",
    body: "設定画面のメンバー管理で、各メンバー行の左側にある ▲▼ ボタンで順番を並び替えられます。",
  },
  {
    id: "2026-06-11-tomorrow-badge",
    date: "2026/06/11",
    title: "🟡 「明日まで」の期限バッジを追加しました",
    body: "期限が明日のタスク・小タスクに黄色の「明日まで」バッジが表示されるようになりました。今日まで（オレンジ）・期限超過（赤）と合わせてご活用ください。",
  },
  {
    id: "2026-06-10-complete-btn",
    date: "2026/06/10",
    title: "✅ タスク詳細モーダルに完了ボタンを追加しました",
    body: "タスク詳細画面の右上に「✓ 完了」ボタンが追加されました。完了済みのタスクは「↩ 戻す」ボタンで元のカラムに戻せます。",
  },
  {
    id: "2026-06-09-overdue-red",
    date: "2026/06/09",
    title: "🔴 期限超過の小タスクのテキストが赤くなりました",
    body: "小タスクの期限が過ぎると、テキスト自体が赤色で表示されるようになりました。",
  },
];

const STORAGE_KEY = "taskboard_read_announcements";

function getReadIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveReadIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export default function AnnouncementBell() {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<string[]>(getReadIds);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = ANNOUNCEMENTS.filter((a) => !readIds.includes(a.id)).length;

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const markAllRead = () => {
    const allIds = ANNOUNCEMENTS.map((a) => a.id);
    setReadIds(allIds);
    saveReadIds(allIds);
  };

  const handleOpen = () => {
    setOpen((v) => !v);
    // 開いたら全既読にする
    if (!open) {
      const allIds = ANNOUNCEMENTS.map((a) => a.id);
      setReadIds(allIds);
      saveReadIds(allIds);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      {/* ベルボタン */}
      <button
        onClick={handleOpen}
        title="新機能のお知らせ"
        style={{
          position: "relative",
          background: open ? "#ede9fe" : "#f8f7ff",
          color: "#6366f1",
          border: "1.5px solid #e0e7ff",
          borderRadius: 10,
          padding: "7px 11px",
          fontSize: 15,
          cursor: "pointer",
          transition: "background .15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")}
        onMouseLeave={(e) => (e.currentTarget.style.background = open ? "#ede9fe" : "#f8f7ff")}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: -4,
            right: -4,
            background: "#ef4444",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            borderRadius: "50%",
            width: 16,
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #fff",
            lineHeight: 1,
            fontFamily: "'Noto Sans JP',sans-serif",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ポップアップ */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 320,
          maxHeight: 420,
          overflowY: "auto",
          background: "#fff",
          border: "1.5px solid #e0e7ff",
          borderRadius: 14,
          boxShadow: "0 12px 36px rgba(99,102,241,.18)",
          zIndex: 2000,
          fontFamily: "'Noto Sans JP',sans-serif",
        }}>
          {/* ヘッダー */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px 10px",
            borderBottom: "1px solid #f0f0ff",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#1e1b4b" }}>🔔 新機能のお知らせ</span>
            <button
              onClick={markAllRead}
              style={{ fontSize: 10, color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", fontWeight: 700 }}
            >すべて既読</button>
          </div>

          {/* お知らせ一覧 */}
          <div style={{ padding: "8px 0" }}>
            {ANNOUNCEMENTS.map((a) => {
              const isRead = readIds.includes(a.id);
              return (
                <div key={a.id} style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid #f8f7ff",
                  background: isRead ? "#fff" : "#f5f3ff",
                  transition: "background .2s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    {!isRead && (
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "#6366f1",
                        flexShrink: 0,
                        marginTop: 4,
                      }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b", lineHeight: 1.5, marginBottom: 4 }}>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
                        {a.body}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{a.date}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
