/**
 * SubtaskTemplatePanel
 * 小タスクのテンプレート管理UI
 * - テンプレートの作成・編集・削除
 * - テンプレートを小タスクに一括適用
 *
 * 既存コードへの影響ゼロ：このファイルは features/ に独立して配置
 * TaskDetailModal から import して使用する
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";

interface Subtask { id: number; text: string; done: boolean; }

interface Props {
  projectId: string;
  currentSubtasks: Subtask[];
  onApply: (subtasks: Subtask[]) => void; // テンプレート適用時のコールバック
}

const S = {
  btn: (color: string, bg: string) => ({
    background: bg,
    color,
    border: "none",
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "'Noto Sans JP',sans-serif",
    whiteSpace: "nowrap" as const,
  }),
  input: {
    border: "1.5px solid #e0e7ff",
    borderRadius: 8,
    padding: "6px 9px",
    fontSize: 12,
    outline: "none",
    fontFamily: "'Noto Sans JP',sans-serif",
    color: "#1e1b4b",
    width: "100%",
    boxSizing: "border-box" as const,
  },
};

export function SubtaskTemplatePanel({ projectId, currentSubtasks, onApply }: Props) {
  const utils = trpc.useUtils();

  // テンプレート一覧取得
  const templatesQuery = trpc.subtaskTemplate.list.useQuery({ projectId });
  const templates = templatesQuery.data || [];

  // テンプレート作成
  const createMut = trpc.subtaskTemplate.create.useMutation({
    onSuccess: () => {
      utils.subtaskTemplate.list.invalidate({ projectId });
      setNewName("");
      setNewItems([""]);
      setMode("list");
    },
  });

  // テンプレート更新
  const updateMut = trpc.subtaskTemplate.update.useMutation({
    onSuccess: () => {
      utils.subtaskTemplate.list.invalidate({ projectId });
      setEditId(null);
    },
  });

  // テンプレート削除
  const deleteMut = trpc.subtaskTemplate.delete.useMutation({
    onSuccess: () => utils.subtaskTemplate.list.invalidate({ projectId }),
  });

  // UI状態
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [newName, setNewName] = useState("");
  const [newItems, setNewItems] = useState<string[]>([""]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editItems, setEditItems] = useState<string[]>([""]);
  const [applyMode, setApplyMode] = useState<"replace" | "append">("append");
  const [confirmId, setConfirmId] = useState<number | null>(null);

  // テンプレート適用
  const handleApply = (templateId: number) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const newSubtasks: Subtask[] = tpl.items.map((text, i) => ({
      id: Date.now() + i,
      text,
      done: false,
    }));
    if (applyMode === "replace") {
      onApply(newSubtasks);
    } else {
      // append: 既存の小タスクに追加
      onApply([...currentSubtasks, ...newSubtasks]);
    }
    setConfirmId(null);
  };

  // 新規作成フォームのアイテム操作
  const addNewItem = () => setNewItems([...newItems, ""]);
  const updateNewItem = (i: number, val: string) => {
    const arr = [...newItems]; arr[i] = val; setNewItems(arr);
  };
  const removeNewItem = (i: number) => setNewItems(newItems.filter((_, j) => j !== i));

  // 編集フォームのアイテム操作
  const addEditItem = () => setEditItems([...editItems, ""]);
  const updateEditItem = (i: number, val: string) => {
    const arr = [...editItems]; arr[i] = val; setEditItems(arr);
  };
  const removeEditItem = (i: number) => setEditItems(editItems.filter((_, j) => j !== i));

  // 編集開始
  const startEdit = (id: number) => {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setEditId(id);
    setEditName(tpl.name);
    setEditItems([...tpl.items, ""]);
    setMode("edit");
  };

  return (
    <div style={{ marginTop: 12, borderTop: "1.5px dashed #e0e7ff", paddingTop: 12 }}>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#6366f1" }}>📋 テンプレート</span>
        {mode === "list" && (
          <button onClick={() => setMode("create")} style={S.btn("#6366f1", "#ede9fe")}>
            ＋ 新規作成
          </button>
        )}
        {mode !== "list" && (
          <button onClick={() => { setMode("list"); setEditId(null); }} style={S.btn("#64748b", "#f1f5f9")}>
            ← 戻る
          </button>
        )}
      </div>

      {/* テンプレート一覧 */}
      {mode === "list" && (
        <>
          {templates.length === 0 && (
            <p style={{ fontSize: 11, color: "#c7d2fe", textAlign: "center", margin: "8px 0" }}>
              テンプレートはまだありません
            </p>
          )}
          {templates.length > 0 && (
            <>
              {/* 適用モード選択 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>適用方法：</span>
                {(["append", "replace"] as const).map((m) => (
                  <label key={m} style={{ fontSize: 10, color: applyMode === m ? "#6366f1" : "#94a3b8", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                    <input
                      type="radio"
                      name="applyMode"
                      value={m}
                      checked={applyMode === m}
                      onChange={() => setApplyMode(m)}
                      style={{ accentColor: "#6366f1" }}
                    />
                    {m === "append" ? "追加" : "置き換え"}
                  </label>
                ))}
              </div>

              {templates.map((tpl) => (
                <div key={tpl.id} style={{ background: "#f8f7ff", borderRadius: 8, padding: "8px 10px", marginBottom: 6, border: "1.5px solid #e0e7ff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 800, color: "#1e1b4b" }}>{tpl.name}</span>
                    <button onClick={() => startEdit(tpl.id)} style={S.btn("#6366f1", "#ede9fe")}>編集</button>
                    <button
                      onClick={() => { if (confirm(`「${tpl.name}」を削除しますか？`)) deleteMut.mutate({ id: tpl.id }); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 14, padding: "0 2px" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}
                    >×</button>
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    {(tpl.items as string[]).slice(0, 3).map((item, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#64748b", paddingLeft: 8, lineHeight: 1.6 }}>・{item}</div>
                    ))}
                    {(tpl.items as string[]).length > 3 && (
                      <div style={{ fontSize: 10, color: "#94a3b8", paddingLeft: 8 }}>他 {(tpl.items as string[]).length - 3} 件...</div>
                    )}
                  </div>
                  {confirmId === tpl.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 700 }}>
                        {applyMode === "replace" ? "現在の小タスクを置き換えますか？" : "小タスクに追加しますか？"}
                      </span>
                      <button onClick={() => handleApply(tpl.id)} style={S.btn("#fff", "#6366f1")}>適用</button>
                      <button onClick={() => setConfirmId(null)} style={S.btn("#64748b", "#f1f5f9")}>キャンセル</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(tpl.id)}
                      style={{ ...S.btn("#fff", "#6366f1"), width: "100%", textAlign: "center" as const }}
                    >
                      ✅ このテンプレートを適用
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* 新規作成フォーム */}
      {mode === "create" && (
        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "12px", border: "1.5px dashed #c7d2fe" }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 800, color: "#6366f1" }}>テンプレート名</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例：月次報告タスク"
            style={{ ...S.input, marginBottom: 10 }}
          />
          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 800, color: "#6366f1" }}>小タスク一覧</p>
          {newItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input
                value={item}
                onChange={(e) => updateNewItem(i, e.target.value)}
                placeholder={`小タスク ${i + 1}`}
                style={{ ...S.input, flex: 1 }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewItem(); } }}
              />
              {newItems.length > 1 && (
                <button onClick={() => removeNewItem(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 14 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}
                >×</button>
              )}
            </div>
          ))}
          <button onClick={addNewItem} style={{ ...S.btn("#6366f1", "#ede9fe"), marginBottom: 10 }}>
            ＋ 項目を追加
          </button>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setMode("list"); setNewName(""); setNewItems([""]); }} style={S.btn("#64748b", "#f1f5f9")}>
              キャンセル
            </button>
            <button
              onClick={() => {
                const items = newItems.filter((s) => s.trim());
                if (!newName.trim() || items.length === 0) return;
                createMut.mutate({ projectId, name: newName.trim(), items });
              }}
              disabled={createMut.isPending}
              style={S.btn("#fff", "#6366f1")}
            >
              {createMut.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}

      {/* 編集フォーム */}
      {mode === "edit" && editId !== null && (
        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "12px", border: "1.5px dashed #c7d2fe" }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 800, color: "#6366f1" }}>テンプレート名</p>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            style={{ ...S.input, marginBottom: 10 }}
          />
          <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 800, color: "#6366f1" }}>小タスク一覧</p>
          {editItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <input
                value={item}
                onChange={(e) => updateEditItem(i, e.target.value)}
                placeholder={`小タスク ${i + 1}`}
                style={{ ...S.input, flex: 1 }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEditItem(); } }}
              />
              {editItems.length > 1 && (
                <button onClick={() => removeEditItem(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 14 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}
                >×</button>
              )}
            </div>
          ))}
          <button onClick={addEditItem} style={{ ...S.btn("#6366f1", "#ede9fe"), marginBottom: 10 }}>
            ＋ 項目を追加
          </button>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => { setMode("list"); setEditId(null); }} style={S.btn("#64748b", "#f1f5f9")}>
              キャンセル
            </button>
            <button
              onClick={() => {
                const items = editItems.filter((s) => s.trim());
                if (!editName.trim() || items.length === 0) return;
                updateMut.mutate({ id: editId, name: editName.trim(), items });
              }}
              disabled={updateMut.isPending}
              style={S.btn("#fff", "#6366f1")}
            >
              {updateMut.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
