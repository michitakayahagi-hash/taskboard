/**
 * InvitePage - 招待リンクからメンバー登録するページ
 * /invite/:token でアクセスされる
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const S = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #ede9fe 0%, #e0e7ff 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    fontFamily: "'Noto Sans JP',sans-serif",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "36px 28px",
    width: "100%",
    maxWidth: 420,
    boxShadow: "0 20px 60px rgba(99,102,241,.22)",
  },
  label: { display: "block" as const, fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 },
  input: {
    width: "100%",
    border: "2px solid #e0e7ff",
    borderRadius: 10,
    padding: "9px 11px",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
    marginBottom: 14,
    fontFamily: "'Noto Sans JP',sans-serif",
    color: "#1e1b4b",
  },
  btn: {
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 24px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 13,
    fontFamily: "'Noto Sans JP',sans-serif",
    boxShadow: "0 4px 12px rgba(99,102,241,.35)",
    width: "100%",
  },
};

export function InvitePage({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [projectId, setProjectId] = useState("");

  const inviteQuery = trpc.projectAccess.getInvite.useQuery(
    { token },
    {
      retry: false,
      onError: (e) => setError(e.message),
    }
  );

  const acceptMut = trpc.projectAccess.acceptInvite.useMutation({
    onSuccess: (data) => {
      setProjectId(data.projectId);
      setDone(true);
    },
    onError: (e) => setError(e.message),
  });

  const handleSubmit = () => {
    setError("");
    if (!name.trim()) { setError("名前を入力してください"); return; }
    if (password.length < 6) { setError("パスワードは6文字以上で入力してください"); return; }
    if (password !== password2) { setError("パスワードが一致しません"); return; }
    acceptMut.mutate({ token, name: name.trim(), password });
  };

  if (done) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <h2 style={{ color: "#6366f1", fontSize: 20, margin: "0 0 8px" }}>参加完了！</h2>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 24px" }}>
              プロジェクトへの参加が完了しました。
            </p>
            <button
              style={S.btn}
              onClick={() => { window.location.href = `/project/${projectId}`; }}
            >
              プロジェクトを開く →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (inviteQuery.isLoading) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <p style={{ textAlign: "center", color: "#94a3b8" }}>招待情報を確認中...</p>
        </div>
      </div>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <h2 style={{ color: "#ef4444", fontSize: 18, margin: "0 0 12px" }}>❌ 無効な招待リンク</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>
            {error || "この招待リンクは無効か期限切れです。管理者に再度招待を依頼してください。"}
          </p>
        </div>
      </div>
    );
  }

  const inv = inviteQuery.data;

  return (
    <div style={S.page}>
      <div style={S.card}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#1e1b4b" }}>
          📋 プロジェクトへの招待
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8" }}>
          <strong style={{ color: "#6366f1" }}>「{inv.projectName}」</strong> に招待されています。
          名前とパスワードを設定して参加してください。
        </p>

        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "10px 14px", marginBottom: 20, fontSize: 12 }}>
          <span style={{ color: "#6366f1", fontWeight: 700 }}>招待メール：</span>
          <span style={{ color: "#1e1b4b" }}>{inv.email}</span>
          <span style={{ marginLeft: 12, background: inv.isAdmin ? "#fef3c7" : "#e0e7ff", color: inv.isAdmin ? "#d97706" : "#6366f1", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>
            {inv.isAdmin ? "管理者" : inv.role === "editor" ? "編集可" : "閲覧のみ"}
          </span>
        </div>

        <label style={S.label}>表示名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="あなたの名前"
          style={S.input}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
          onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
        />

        <label style={S.label}>パスワード（6文字以上）</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワードを設定"
          style={S.input}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
          onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
        />

        <label style={S.label}>パスワード（確認）</label>
        <input
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder="もう一度入力"
          style={S.input}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
          onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
        />

        {error && (
          <p style={{ color: "#ef4444", fontSize: 12, margin: "-8px 0 12px" }}>{error}</p>
        )}

        <button
          style={{ ...S.btn, opacity: acceptMut.isPending ? 0.7 : 1 }}
          onClick={handleSubmit}
          disabled={acceptMut.isPending}
        >
          {acceptMut.isPending ? "登録中..." : "参加する"}
        </button>
      </div>
    </div>
  );
}
