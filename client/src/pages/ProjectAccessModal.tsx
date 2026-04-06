/**
 * ProjectAccessModal - プロジェクトアクセス制御
 * - 権限設定があるプロジェクトへのログイン画面
 * - 設定画面のメンバー管理タブ（管理者：メンバー管理）
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const S = {
  overlay: {
    position: "fixed" as const, inset: 0,
    background: "rgba(15,10,40,.45)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(3px)", padding: 16,
  },
  card: {
    background: "#fff", borderRadius: 20, padding: "28px 24px",
    width: "100%", maxWidth: 460,
    boxShadow: "0 20px 60px rgba(99,102,241,.22)",
    fontFamily: "'Noto Sans JP',sans-serif",
  },
  label: { display: "block" as const, fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 },
  input: {
    width: "100%", border: "2px solid #e0e7ff", borderRadius: 10,
    padding: "9px 11px", fontSize: 13, outline: "none",
    boxSizing: "border-box" as const, marginBottom: 14,
    fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b",
  },
  btn: (primary?: boolean) => ({
    background: primary ? "#6366f1" : "#f1f5f9",
    color: primary ? "#fff" : "#64748b",
    border: "none", borderRadius: 10,
    padding: "9px 20px", cursor: "pointer",
    fontWeight: 800, fontSize: 13,
    fontFamily: "'Noto Sans JP',sans-serif",
    boxShadow: primary ? "0 4px 12px rgba(99,102,241,.35)" : "none",
  }),
};

// ─── Login Modal ─────────────────────────────────────────────────────────────
export function ProjectLoginModal({
  projectId, projectName, onSuccess, onCancel,
}: {
  projectId: string; projectName: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const loginMut = trpc.projectAccess.login.useMutation({
    onSuccess: () => { onSuccess(); },
    onError: (e) => setError(e.message),
  });
  const submit = () => {
    if (!name.trim() || !password.trim()) { setError("名前とパスワードを入力してください"); return; }
    setError("");
    loginMut.mutate({ projectId, name: name.trim(), password });
  };
  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>🔒 アクセス制限</h2>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8" }}>「{projectName}」は閲覧・編集が制限されています。</p>
        <label style={S.label}>名前</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="メンバー名を入力"
          style={S.input}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
          onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
        />
        <label style={S.label}>パスワード</label>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワードを入力"
          style={S.input}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
          onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <p style={{ color: "#ef4444", fontSize: 12, margin: "-8px 0 12px" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={S.btn()}>キャンセル</button>
          <button onClick={submit} disabled={loginMut.isPending} style={S.btn(true)}>
            {loginMut.isPending ? "確認中..." : "ログイン"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Share Popup ──────────────────────────────────────────────────────────────
function SharePopup({
  name, password, onClose,
}: {
  name: string; password: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const appUrl = window.location.origin;
  const shareText = `【TaskBoardのログイン情報】\nURL: ${appUrl}\n名前: ${name}\nパスワード: ${password}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      position: "fixed" as const, inset: 0,
      background: "rgba(15,10,40,.55)", zIndex: 2000,
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(4px)", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "24px 22px",
        width: "100%", maxWidth: 400,
        boxShadow: "0 20px 60px rgba(99,102,241,.3)",
        fontFamily: "'Noto Sans JP',sans-serif",
      }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#1e1b4b" }}>
          ✅ メンバーを追加しました
        </h3>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94a3b8" }}>
          以下のログイン情報をメンバーに共有してください。
        </p>

        {/* 共有テキスト表示エリア */}
        <div style={{
          background: "#f8f7ff", border: "1.5px solid #c7d2fe",
          borderRadius: 10, padding: "12px 14px",
          marginBottom: 14, whiteSpace: "pre-wrap",
          fontSize: 13, color: "#1e1b4b", lineHeight: 1.8,
          fontFamily: "monospace",
        }}>
          {shareText}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "#f1f5f9", color: "#64748b",
              border: "none", borderRadius: 10,
              padding: "9px 20px", cursor: "pointer",
              fontWeight: 800, fontSize: 13,
              fontFamily: "'Noto Sans JP',sans-serif",
            }}
          >
            閉じる
          </button>
          <button
            onClick={handleCopy}
            style={{
              background: copied ? "#10b981" : "#6366f1",
              color: "#fff",
              border: "none", borderRadius: 10,
              padding: "9px 20px", cursor: "pointer",
              fontWeight: 800, fontSize: 13,
              fontFamily: "'Noto Sans JP',sans-serif",
              boxShadow: "0 4px 12px rgba(99,102,241,.35)",
              transition: "background 0.2s",
            }}
          >
            {copied ? "コピー済み ✓" : "📋 コピーする"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Member Management (in Settings Modal) ───────────────────────────────────
export function ProjectMemberSettings({
  projectId,
  currentUserIsAdmin,
}: {
  projectId: string;
  currentUserIsAdmin?: boolean;
}) {
  const utils = trpc.useUtils();
  const membersQuery = trpc.projectAccess.listMembers.useQuery({ projectId });
  const addMember = trpc.projectAccess.addMember.useMutation({
    onSuccess: () => {
      utils.projectAccess.listMembers.invalidate({ projectId });
      setAddError("");
    },
    onError: (e) => setAddError(e.message),
  });
  const updateMember = trpc.projectAccess.updateMember.useMutation({
    onSuccess: () => utils.projectAccess.listMembers.invalidate({ projectId }),
  });
  const removeMember = trpc.projectAccess.removeMember.useMutation({
    onSuccess: () => utils.projectAccess.listMembers.invalidate({ projectId }),
  });
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "editor">("editor");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [addError, setAddError] = useState("");
  const [editPassId, setEditPassId] = useState<number | null>(null);
  const [editPassVal, setEditPassVal] = useState("");

  // 追加直後の共有ポップアップ用
  const [sharePopup, setSharePopup] = useState<{ name: string; password: string } | null>(null);

  const members = membersQuery.data || [];

  const handleAdd = () => {
    if (!newName.trim() || !newPass.trim()) { setAddError("名前とパスワードを入力してください"); return; }
    const tempName = newName.trim();
    const tempPass = newPass;
    addMember.mutate({ projectId, name: tempName, password: tempPass, role: newRole, isAdmin: newIsAdmin }, {
      onSuccess: () => {
        setNewName(""); setNewPass("");
        // 追加成功後にポップアップを表示
        setSharePopup({ name: tempName, password: tempPass });
      }
    });
  };

  const roleBadge = (isAdmin: boolean, role: "viewer" | "editor") => {
    if (isAdmin) return { label: "管理者", bg: "#fef3c7", color: "#d97706" };
    if (role === "editor") return { label: "編集可", bg: "#e0e7ff", color: "#6366f1" };
    return { label: "閲覧のみ", bg: "#f1f5f9", color: "#64748b" };
  };

  return (
    <div>
      {/* 追加直後の共有ポップアップ */}
      {sharePopup && (
        <SharePopup
          name={sharePopup.name}
          password={sharePopup.password}
          onClose={() => setSharePopup(null)}
        />
      )}

      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 6 }}>
        🔒 アクセス権限メンバー
      </label>
      <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 12px" }}>
        メンバーを設定するとこのプロジェクトはログインが必要になります。
        メンバーなし = 誰でも閲覧・編集可能。
      </p>

      {/* Existing members */}
      {members.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {members.map((m) => {
            const badge = roleBadge(m.isAdmin, m.role);
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, background: "#f8f7ff", borderRadius: 8, padding: "6px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1e1b4b" }}>{m.name}</span>
                  {m.email && <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>{m.email}</span>}
                </div>
                <span style={{ background: badge.bg, color: badge.color, borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {badge.label}
                </span>
                {currentUserIsAdmin && (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => updateMember.mutate({ id: m.id, role: e.target.value as "viewer" | "editor" })}
                      style={{ border: "1.5px solid #e0e7ff", borderRadius: 6, padding: "3px 6px", fontSize: 11, color: "#6366f1", fontWeight: 700, background: "#fff", cursor: "pointer" }}
                    >
                      <option value="editor">編集可</option>
                      <option value="viewer">閲覧のみ</option>
                    </select>
                    <button
                      onClick={() => updateMember.mutate({ id: m.id, isAdmin: !m.isAdmin })}
                      title={m.isAdmin ? "管理者を解除" : "管理者に昇格"}
                      style={{ background: m.isAdmin ? "#fef3c7" : "#f1f5f9", color: m.isAdmin ? "#d97706" : "#94a3b8", border: "none", borderRadius: 6, padding: "3px 7px", fontSize: 10, cursor: "pointer", fontWeight: 700 }}
                    >
                      {m.isAdmin ? "管理者" : "一般"}
                    </button>
                    {editPassId === m.id ? (
                      <>
                        <input
                          type="password" value={editPassVal} onChange={(e) => setEditPassVal(e.target.value)}
                          placeholder="新PW"
                          style={{ width: 90, border: "1.5px solid #c7d2fe", borderRadius: 6, padding: "3px 6px", fontSize: 11, outline: "none" }}
                        />
                        <button
                          onClick={() => {
                            if (editPassVal.trim()) {
                              updateMember.mutate({ id: m.id, password: editPassVal });
                              setEditPassId(null); setEditPassVal("");
                            }
                          }}
                          style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>保存</button>
                        <button onClick={() => { setEditPassId(null); setEditPassVal(""); }}
                          style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}>×</button>
                      </>
                    ) : (
                      <button onClick={() => { setEditPassId(m.id); setEditPassVal(""); }}
                        style={{ background: "#ede9fe", color: "#6366f1", border: "none", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>PW変更</button>
                    )}
                    <button
                      onClick={() => { if (confirm(`「${m.name}」を削除しますか？`)) removeMember.mutate({ id: m.id }); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 16, padding: "0 2px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}
                    >×</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add new member directly (admin only) */}
      {currentUserIsAdmin && (
        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "12px", border: "1.5px dashed #c7d2fe" }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#6366f1" }}>直接追加（名前＋パスワード）</p>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="名前"
              style={{ flex: 1, minWidth: 80, border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
            />
            <input
              value={newPass} onChange={(e) => setNewPass(e.target.value)}
              placeholder="パスワード"
              style={{ flex: 1, minWidth: 80, border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
            />
            <select
              value={newRole} onChange={(e) => setNewRole(e.target.value as "viewer" | "editor")}
              style={{ border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, color: "#6366f1", fontWeight: 700, background: "#fff", cursor: "pointer" }}
            >
              <option value="editor">編集可</option>
              <option value="viewer">閲覧のみ</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#d97706", cursor: "pointer" }}>
              <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />
              管理者
            </label>
          </div>
          {addError && <p style={{ color: "#ef4444", fontSize: 11, margin: "0 0 6px" }}>{addError}</p>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleAdd}
              disabled={addMember.isPending}
              style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}
            >
              {addMember.isPending ? "追加中..." : "追加"}
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 10, color: "#94a3b8" }}>
            ※ 追加後にログイン情報の共有画面が表示されます
          </p>
        </div>
      )}
    </div>
  );
}
