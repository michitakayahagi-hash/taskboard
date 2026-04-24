import React from "react";

const sections = [
  {
    icon: "📌",
    title: "タスクの作成",
    items: [
      "各カラム下の「＋ タスクを追加」ボタンで新規作成",
      "タイトル・担当者・優先度・期限日・タグを設定可能",
      "タスクカードをクリックすると詳細画面が開く",
    ],
  },
  {
    icon: "🔄",
    title: "タスクの移動",
    items: [
      "タスクを長押ししてから別のカラムにドラッグ＆ドロップ",
      "「✓ 完了」ボタンで完了カラムに移動（完了一覧の一番上に表示）",
      "「↩ 戻す」ボタンで元のカラムに戻すことができる",
    ],
  },
  {
    icon: "📅",
    title: "期限・並び順",
    items: [
      "期限日はカード上に大きく表示（期限超過：赤背景・白文字）",
      "今日が期限のタスクはオレンジ色で強調表示",
      "カラムヘッダーの 📅 ボタンで期限日付順に並び替え（期限超過が最上位）",
      "もう一度タップすると元の並び順に戻る",
    ],
  },
  {
    icon: "📝",
    title: "タスク詳細",
    items: [
      "タスクカードをクリックすると詳細モーダルが開く",
      "説明文・小タスク（チェックリスト）・コメントを追加可能",
      "小タスクにも担当者・期限日を設定できる",
      "タスクの進捗はバーで視覚化（完了数/全体）",
    ],
  },
  {
    icon: "💬",
    title: "コメント・通知",
    items: [
      "「💬 コメント」ボタンでタスクにコメントを追加",
      "設定でGoogle Chat Webhook URLを登録するとタスク作成時に通知が届く",
    ],
  },
  {
    icon: "🗂",
    title: "カラム管理",
    items: [
      "「＋ 列」ボタンで新しいカラムを追加",
      "カラム名をクリックすると編集できる",
      "カラム左上の ⠿ アイコンでカラム自体を並び替え",
      "「完了」カラムは削除不可（消えないよう保護）",
    ],
  },
  {
    icon: "🔍",
    title: "検索・フィルター",
    items: [
      "ヘッダーの検索ボックスでタスク名をリアルタイム検索",
      "担当者ドロップダウンで担当者ごとに表示を絞り込み",
    ],
  },
  {
    icon: "⚙️",
    title: "設定",
    items: [
      "⚙️ ボタンからGoogle Chat通知・メンバー管理・アクセス権限を設定",
      "プロジェクトを公開設定にするとURLを知っている人が閲覧可能",
    ],
  },
];

export default function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(3px)", padding: 16,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: "#fff", borderRadius: 20, padding: "26px 22px",
        width: "100%", maxWidth: 540, maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1e1b4b" }}>📖 使い方ガイド</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {sections.map((sec) => (
            <div key={sec.title} style={{ background: "#f8f7ff", borderRadius: 12, padding: "14px 16px", border: "1.5px solid #e0e7ff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 18 }}>{sec.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#1e1b4b" }}>{sec.title}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                {sec.items.map((item, i) => (
                  <li key={i} style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{ marginTop: 20, width: "100%", background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}
        >閉じる</button>
      </div>
    </div>
  );
}
