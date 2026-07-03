/**
 * AnnouncementBell - 新機能お知らせベルアイコン
 * ・各お知らせをクリックすると既読になる（開いただけでは既読にならない）
 * ・ReactDOM.createPortal で document.body 直下に描画
 */
import { useState, useRef } from "react";
import { createPortal } from "react-dom";

// ─── お知らせデータ（新機能追加時にここに追記する） ───────────────────────
export const ANNOUNCEMENTS: { id: string; date: string; title: string; body: string }[] = [
  {
    id: "2026-06-22-creator-required",
    date: "2026/06/22",
    title: "👤 作成者が必須入力になりました",
    body: "タスク作成画面の「作成者」欄が必須になりました。初期値は空白（未選択）で、選択せずに「作成」ボタンを押すと赤いエラーメッセージが表示され、タスクを作成できません。必ずメンバー一覧から作成者を選んでから作成してください。",
  },
  {
    id: "2026-06-22-assignee-dashboard-sort",
    date: "2026/06/22",
    title: "🚨 担当者ダッシュボードの表示順が改善されました",
    body: "「期限順」で並べたとき、最も緊急度の高いタスクが上に来るよう順序を変更しました。\n①期限超過（赤い背景・🚨アイコン）→ ②今日が期限 → ③近い順 → ④通常 → ⑤期限なし\nの順で表示されます。期限を過ぎたタスクはカード全体が赤く強調されるので、見落としを防げます。",
  },
  {
    id: "2026-06-22-assignee-dashboard-link",
    date: "2026/06/22",
    title: "🔗 担当者ダッシュボードからタスクに直接移動できるようになりました",
    body: "担当者ダッシュボードに表示されているタスクカードをクリックすると、そのタスクが属するプロジェクトのボードに自動で切り替わり、タスク詳細モーダルが開きます。ダッシュボードから直接タスクの内容を確認・編集できます。",
  },
  {
    id: "2026-06-12-card-move",
    date: "2026/06/12",
    title: "↙ タスクカードから同プロジェクト内の別カラムに移動できるようになりました",
    body: "各タスクカードの右下に「↙」ボタンが追加されました。クリックすると同じプロジェクト内のカラム一覧がドロップダウンで表示され、選択したカラムにタスクを即座に移動できます。ドラッグ操作なしで素早く整理できます。",
  },
  {
    id: "2026-06-12-move-col",
    date: "2026/06/12",
    title: "📦 タスク詳細から別プロジェクトへ移動できるようになりました",
    body: "タスク詳細モーダルの右上にある📦ボタンをクリックすると、別プロジェクトの任意のカラムにタスクを移動できます。プロジェクトをまたいでタスクを整理したいときに便利です。",
  },
  {
    id: "2026-06-12-member-sort",
    date: "2026/06/12",
    title: "👥 メンバーの並び順を変更できるようになりました",
    body: "設定画面の「メンバー管理」で、各メンバー行の左側に ▲▼ ボタンが追加されました。▲で上に、▼で下に移動できます。担当者の選択ドロップダウンにもこの順番が反映されます。「保存」ボタンで確定してください。",
  },
  {
    id: "2026-06-11-tomorrow-badge",
    date: "2026/06/11",
    title: "🟡 期限が「明日まで」のタスクに黄色バッジが表示されるようになりました",
    body: "期限日が明日のタスク・小タスクに黄色の「明日まで」バッジが表示されるようになりました。これまでの「今日まで（オレンジ）」「期限超過（赤）」に加え、1日前から事前に気づけるようになります。",
  },
  {
    id: "2026-06-10-complete-btn",
    date: "2026/06/10",
    title: "✅ タスク詳細モーダルに完了ボタンが追加されました",
    body: "タスクをクリックして開く詳細モーダルの右上に「✓ 完了」ボタンが追加されました。クリックするとタスクが完了済みカラムに移動します。完了後は「↩ 戻す」ボタンが表示され、元のカラムに戻すことができます。",
  },
  {
    id: "2026-06-09-overdue-red",
    date: "2026/06/09",
    title: "🔴 期限超過の小タスクのテキストが赤く表示されるようになりました",
    body: "タスク詳細モーダル内の小タスク（チェックリスト）で、期限が過ぎた未完了の項目はテキスト自体が赤色で表示されるようになりました。「期限超過」バッジも引き続き表示されます。",
  },
];

const STORAGE_KEY = "taskboard_read_announcements_v6";

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
  const [popupPos, setPopupPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const unreadCount = ANNOUNCEMENTS.filter((a) => !readIds.includes(a.id)).length;

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  };

  // 各お知らせをクリックして既読にする
  const markRead = (id: string) => {
    if (readIds.includes(id)) return;
    const next = [...readIds, id];
    setReadIds(next);
    saveReadIds(next);
  };

  const markAllRead = () => {
    const allIds = ANNOUNCEMENTS.map((a) => a.id);
    setReadIds(allIds);
    saveReadIds(allIds);
    setOpen(false);
  };

  // 外側クリックで閉じる（useEffectの代わりにonMouseDownをdocumentに登録）
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setOpen(false);
  };

  const popup = open ? (
    <>
      {/* 透明オーバーレイ（外クリックで閉じる） */}
      <div
        onMouseDown={handleOverlayClick}
        style={{ position: "fixed", inset: 0, zIndex: 2147483646 }}
      />
      <div
        id="announcement-popup"
        style={{
          position: "fixed",
          top: popupPos.top,
          right: popupPos.right,
          width: 360,
          maxHeight: 520,
          overflowY: "auto",
          background: "#fff",
          border: "1.5px solid #e0e7ff",
          borderRadius: 16,
          boxShadow: "0 16px 48px rgba(99,102,241,.30)",
          zIndex: 2147483647,
          fontFamily: "'Noto Sans JP',sans-serif",
        }}
      >
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
              <span style={{ background: "#6366f1", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 20, padding: "1px 7px" }}>
                {unreadCount}件未読
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>クリックで既読</span>
            <button
              onClick={markAllRead}
              style={{ fontSize: 10, color: "#6366f1", background: "#f0f0ff", border: "none", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", fontWeight: 700, borderRadius: 6, padding: "3px 8px" }}
            >すべて既読</button>
          </div>
        </div>

        {/* お知らせ一覧 */}
        <div>
          {ANNOUNCEMENTS.map((a, idx) => {
            const isRead = readIds.includes(a.id);
            return (
              <div
                key={a.id}
                onClick={() => markRead(a.id)}
                style={{
                  padding: "13px 16px",
                  borderBottom: idx < ANNOUNCEMENTS.length - 1 ? "1px solid #f0f0ff" : "none",
                  background: isRead ? "#fff" : "#f5f3ff",
                  transition: "background .3s",
                  cursor: isRead ? "default" : "pointer",
                }}
                onMouseEnter={(e) => { if (!isRead) (e.currentTarget as HTMLDivElement).style.background = "#ede9fe"; }}
                onMouseLeave={(e) => { if (!isRead) (e.currentTarget as HTMLDivElement).style.background = "#f5f3ff"; }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  {/* 未読ドット */}
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: isRead ? "transparent" : "#6366f1",
                    flexShrink: 0, marginTop: 5,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isRead ? "#64748b" : "#1e1b4b", lineHeight: 1.5, marginBottom: 6 }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.8, whiteSpace: "pre-line" }}>
                      {a.body}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{a.date}</span>
                      {!isRead && (
                        <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>クリックして既読 →</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      {/* ベルボタン */}
      <button
        ref={btnRef}
        onClick={handleOpen}
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
          flexShrink: 0,
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: -5, right: -5,
            background: "#ef4444", color: "#fff",
            fontSize: 9, fontWeight: 800, borderRadius: "50%",
            minWidth: 17, height: 17,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "2px solid #fff", lineHeight: 1,
            fontFamily: "'Noto Sans JP',sans-serif", padding: "0 2px",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {createPortal(popup, document.body)}

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
    </>
  );
}
