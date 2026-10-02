/**
 * ProjectAccessModal - Google Workspaceログイン後のプロジェクト権限管理
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
  input: {
    width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 8,
    padding: "7px 8px", fontSize: 12, outline: "none", boxSizing: "border-box" as const,
    fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#fff",
  },
};

/** Googleログイン済みでも、当該プロジェクトのメンバーに未登録の場合に表示する。 */
export function ProjectLoginModal({
  projectName, onCancel,
}: {
  projectId: string; projectName: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={S.overlay}>
      <div style={S.card}>
        <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 800, color: "#1e1b4b" }}>アクセス権限が必要です</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>
          「{projectName}」を閲覧するには、Google Workspaceのメールアドレスをこのプロジェクトのメンバーとして登録する必要があります。
        </p>
        <p style={{ margin: "0 0 20px", fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>
          プロジェクト管理者に、あなたの <strong>@b-bloom.jp または @b-noix.jp</strong> メールアドレスの追加を依頼してください。
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "9px 18px", cursor: "pointer", fontWeight: 800, fontSize: 13, fontFamily: "'Noto Sans JP',sans-serif" }}>戻る</button>
        </div>
      </div>
    </div>
  );
}

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
      setNewName("");
      setNewEmail("");
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
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "editor">("editor");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [addError, setAddError] = useState("");
  const members = membersQuery.data || [];

  const handleAdd = () => {
    const email = newEmail.trim().toLowerCase();
    if (!newName.trim() || !email) {
      setAddError("名前とGoogle Workspaceメールアドレスを入力してください");
      return;
    }
    if (!email.endsWith("@b-bloom.jp") && !email.endsWith("@b-noix.jp")) {
      setAddError("@b-bloom.jp または @b-noix.jp のメールアドレスを入力してください");
      return;
    }
    setAddError("");
    addMember.mutate({ projectId, name: newName.trim(), email, role: newRole, isAdmin: newIsAdmin });
  };

  const roleBadge = (isAdmin: boolean, role: "viewer" | "editor") => {
    if (isAdmin) return { label: "管理者", bg: "#fef3c7", color: "#d97706" };
    if (role === "editor") return { label: "編集可", bg: "#e0e7ff", color: "#6366f1" };
    return { label: "閲覧のみ", bg: "#f1f5f9", color: "#64748b" };
  };

  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 6 }}>
        Google Workspace メンバー
      </label>
      <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 12px", lineHeight: 1.6 }}>
        このプロジェクトのアクセス権は、登録した <strong>@b-bloom.jp または @b-noix.jp</strong> のメールアドレスで判定されます。
      </p>

      {membersQuery.isError && (
        <p style={{ margin: "0 0 10px", fontSize: 11, color: "#ef4444" }}>メンバー情報を読み込めませんでした。</p>
      )}
      {members.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {members.map((m) => {
            const badge = roleBadge(m.isAdmin, m.role);
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, background: "#f8f7ff", borderRadius: 8, padding: "7px 10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#1e1b4b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email || "メールアドレス未登録"}</div>
                </div>
                <span style={{ background: badge.bg, color: badge.color, borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{badge.label}</span>
                {currentUserIsAdmin && (
                  <>
                    <select
                      value={m.role}
                      onChange={(e) => updateMember.mutate({ projectId, id: m.id, role: e.target.value as "viewer" | "editor" })}
                      style={{ border: "1.5px solid #e0e7ff", borderRadius: 6, padding: "3px 5px", fontSize: 10, color: "#6366f1", background: "#fff", cursor: "pointer" }}
                    >
                      <option value="editor">編集可</option>
                      <option value="viewer">閲覧のみ</option>
                    </select>
                    <button
                      onClick={() => updateMember.mutate({ projectId, id: m.id, isAdmin: !m.isAdmin })}
                      title={m.isAdmin ? "管理者を解除" : "管理者に昇格"}
                      style={{ background: m.isAdmin ? "#fef3c7" : "#f1f5f9", color: m.isAdmin ? "#d97706" : "#94a3b8", border: "none", borderRadius: 6, padding: "3px 6px", fontSize: 10, cursor: "pointer", fontWeight: 700 }}
                    >{m.isAdmin ? "管理者" : "一般"}</button>
                    <button
                      onClick={() => { if (confirm(`「${m.name}」を削除しますか？`)) removeMember.mutate({ projectId, id: m.id }); }}
                      title="削除"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: "0 2px" }}
                    >×</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {currentUserIsAdmin && (
        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: 12, border: "1.5px dashed #c7d2fe" }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#6366f1" }}>メンバーを追加</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 6, marginBottom: 6 }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="表示名" style={S.input} />
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@b-bloom.jp または name@b-noix.jp" style={S.input} />
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as "viewer" | "editor")}
              style={{ border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, color: "#6366f1", fontWeight: 700, background: "#fff", cursor: "pointer" }}>
              <option value="editor">編集可</option>
              <option value="viewer">閲覧のみ</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#d97706", cursor: "pointer" }}>
              <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} /> 管理者
            </label>
            <button onClick={handleAdd} disabled={addMember.isPending}
              style={{ marginLeft: "auto", background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>
              {addMember.isPending ? "追加中..." : "追加"}
            </button>
          </div>
          {addError && <p style={{ color: "#ef4444", fontSize: 11, margin: "8px 0 0" }}>{addError}</p>}
          {members.length === 0 && <p style={{ margin: "8px 0 0", fontSize: 10, color: "#94a3b8" }}>最初の管理者には、現在ログインしているGoogle Workspaceメールアドレスを登録してください。</p>}
        </div>
      )}
    </div>
  );
}
