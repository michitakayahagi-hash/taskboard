/**
 * InvitePage - Google Workspaceログイン済みの招待先ユーザーが参加するページ
 * /invite/:token でアクセスされる
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const S = {
  page: {
    minHeight: "100vh", background: "linear-gradient(135deg, #ede9fe 0%, #e0e7ff 100%)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    fontFamily: "'Noto Sans JP',sans-serif",
  },
  card: {
    background: "#fff", borderRadius: 20, padding: "36px 28px", width: "100%", maxWidth: 420,
    boxShadow: "0 20px 60px rgba(99,102,241,.22)",
  },
  btn: {
    background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px",
    cursor: "pointer", fontWeight: 800, fontSize: 13, fontFamily: "'Noto Sans JP',sans-serif",
    boxShadow: "0 4px 12px rgba(99,102,241,.35)", width: "100%",
  },
};

export function InvitePage({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [projectId, setProjectId] = useState("");
  const meQuery = trpc.auth.me.useQuery();
  const inviteQuery = trpc.projectAccess.getInvite.useQuery(
    { token },
    { retry: false, onError: (e) => setError(e.message) }
  );
  const acceptMut = trpc.projectAccess.acceptInvite.useMutation({
    onSuccess: (data) => { setProjectId(data.projectId); setDone(true); },
    onError: (e) => setError(e.message),
  });

  if (done) {
    return (
      <div style={S.page}><div style={S.card}><div style={{ textAlign: "center" }}>
        <h2 style={{ color: "#6366f1", fontSize: 20, margin: "0 0 8px" }}>プロジェクトに参加しました</h2>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 24px" }}>Google Workspaceアカウントに権限を登録しました。</p>
        <button style={S.btn} onClick={() => { window.location.href = `/?project=${projectId}`; }}>プロジェクトを開く</button>
      </div></div></div>
    );
  }

  if (inviteQuery.isLoading || meQuery.isLoading) {
    return <div style={S.page}><div style={S.card}><p style={{ textAlign: "center", color: "#94a3b8" }}>招待情報を確認中...</p></div></div>;
  }
  if (inviteQuery.isError || !inviteQuery.data) {
    return <div style={S.page}><div style={S.card}>
      <h2 style={{ color: "#ef4444", fontSize: 18, margin: "0 0 12px" }}>無効な招待リンク</h2>
      <p style={{ color: "#64748b", fontSize: 13 }}>{error || "この招待リンクは無効か期限切れです。管理者に再度招待を依頼してください。"}</p>
    </div></div>;
  }

  const inv = inviteQuery.data;
  const signedInEmail = meQuery.data?.email?.toLowerCase() || "";
  const canAccept = signedInEmail === inv.email.toLowerCase();
  return (
    <div style={S.page}><div style={S.card}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>プロジェクトへの招待</h2>
      <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", lineHeight: 1.7 }}>
        <strong style={{ color: "#6366f1" }}>「{inv.projectName}」</strong> に招待されています。Google Workspaceアカウントで参加してください。
      </p>
      <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, lineHeight: 1.8 }}>
        <div><span style={{ color: "#6366f1", fontWeight: 700 }}>招待先：</span><span style={{ color: "#1e1b4b" }}>{inv.email}</span></div>
        <div><span style={{ color: "#6366f1", fontWeight: 700 }}>ログイン中：</span><span style={{ color: canAccept ? "#059669" : "#ef4444" }}>{signedInEmail || "未確認"}</span></div>
        <div style={{ marginTop: 4 }}><span style={{ background: inv.isAdmin ? "#fef3c7" : "#e0e7ff", color: inv.isAdmin ? "#d97706" : "#6366f1", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>{inv.isAdmin ? "管理者" : inv.role === "editor" ? "編集可" : "閲覧のみ"}</span></div>
      </div>
      {!canAccept && <p style={{ color: "#ef4444", fontSize: 12, lineHeight: 1.6 }}>招待先メールアドレスと同じGoogle Workspaceアカウントでログインしてください。</p>}
      {error && <p style={{ color: "#ef4444", fontSize: 12 }}>{error}</p>}
      <button style={{ ...S.btn, opacity: canAccept && !acceptMut.isPending ? 1 : 0.5 }} onClick={() => { setError(""); acceptMut.mutate({ token }); }} disabled={!canAccept || acceptMut.isPending}>
        {acceptMut.isPending ? "登録中..." : "Google Workspaceで参加する"}
      </button>
    </div></div>
  );
}
