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
    title: "📦 同プロジェクト内のカラムへ移動できるようになりました",
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
    body: "期限が明日のタスク・小タスクに黄色の「明日まで」バッジが表示されるようになりました。",
  },
  {
    id: "2026-06-10-complete-btn",
    date: "2026/06/10",
    title: "✅ タスク詳細モーダルに完了ボタンを追加しました",
    body: "タスク詳細画面の右上に「✓ 完了」ボタンが追加されました。完了済みは「↩ 戻す」で元に戻せます。",
  },
  {
    id: "2026-06-09-overdue-red",
    date: "2026/06/09",
    title: "🔴 期限超過の小タスクのテキストが赤くなりました",
    body: "小タスクの期限が過ぎると、テキスト自体が赤色で表示されるようになりました。",
  },
];

const STORAGE_KEY = "taskboard_read_announcements_v2";

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

  // ポップアップを開いたとき既読にする（閉じるときではなく開いた後に遅延で既読）
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const allIds = ANNOUNCEMENTS.map((a) => a.id);
      setReadIds(allIds);
      saveReadIds(allIds);
    }, 1500); // 1.5秒後に既読
    return () => clearTimeout(timer);
  }, [open]);

  const markAllRead = () => {
    const allIds = ANNOUNCEMENTS.map((a) => a.id);
    setReadIds(allIds);
    saveReadIds(allIds);
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      {/* ベルボタン - 未読時は目立つデザイン */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="新機能のお知らせ"
        style={{
          position: "relative",
          background: unreadCount > 0
            ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
            : open ? "#ede9fe" : "#f8f7ff",
          color: unreadCount > 0 ? "#fff" : "#6366f1",
          border: unreadCount > 0 ? "none" : "1.5px solid #e0e7ff",
          borderRadius: 10,
          padding: "7px 13px",
          fontSize: 15,
          cursor: "pointer",
          transition: "all .2s",
          boxShadow: unreadCount > 0 ? "0 4px 14px rgba(99,102,241,.45)" : "none",
          fontWeight: unreadCount > 0 ? 700 : 400,
          animation: unreadCount > 0 ? "bellShake 1.2s ease infinite" : "none",
        }}
        onMouseEnter={(e) => {
          if (unreadCount === 0) e.currentTarget.style.background = "#ede9fe";
        }}
        onMouseLeave={(e) => {
          if (unreadCount === 0) e.currentTarget.style.background = open ? "#ede9fe" : "#f8f7ff";
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute",
            top: -5,
            right: -5,
            background: "#ef4444",
            color: "#fff",
            fontSize: 9,
            fontWeight: 800,
            borderRadius: "50%",
            minWidth: 17,
            height: 17,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #fff",
            lineHeight: 1,
            fontFamily: "'Noto Sans JP',sans-serif",
            padding: "0 2px",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* ポップアップ */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 10px)",
          right: 0,
          width: 340,
          maxHeight: 440,
          overflowY: "auto",
          background: "#fff",
          border: "1.5px solid #e0e7ff",
          borderRadius: 16,
          boxShadow: "0 16px 48px rgba(99,102,241,.22)",
          zIndex: 3000,
          fontFamily: "'Noto Sans JP',sans-serif",
        }}>
          {/* ヘッダー */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px 12px",
            borderBottom: "1.5px solid #f0f0ff",
            position: "sticky",
            top: 0,
            background: "#fff",
            zIndex: 1,
            borderRadius: "16px 16px 0 0",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#1e1b4b" }}>🔔 新機能のお知らせ</span>
              {unreadCount > 0 && (
                <span style={{
                  background: "#6366f1",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 20,
                  padding: "1px 7px",
                }}>
                  {unreadCount}件未読
                </span>
              )}
            </div>
            <button
              onClick={markAllRead}
              style={{ fontSize: 10, color: "#6366f1", background: "#f0f0ff", border: "none", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
            >すべて既読</button>
          </div>

          {/* お知らせ一覧 */}
          <div>
            {ANNOUNCEMENTS.map((a, idx) => {
              const isRead = readIds.includes(a.id);
              return (
                <div key={a.id} style={{
                  padding: "12px 16px",
                  borderBottom: idx < ANNOUNCEMENTS.length - 1 ? "1px solid #f0f0ff" : "none",
                  background: isRead ? "#fff" : "#f5f3ff",
                  transition: "background .3s",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    {!isRead && (
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#6366f1",
                        flexShrink: 0,
                        marginTop: 5,
                      }} />
                    )}
                    {isRead && <span style={{ width: 8, flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b", lineHeight: 1.5, marginBottom: 5 }}>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
                        {a.body}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>{a.date}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ベルアニメーション用CSS */}
      <style>{`
        @keyframes bellShake {
          0%, 100% { transform: rotate(0deg); }
          10% { transform: rotate(-12deg); }
          20% { transform: rotate(12deg); }
          30% { transform: rotate(-8deg); }
          40% { transform: rotate(8deg); }
          50% { transform: rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
