/**
 * TaskBoard - カンバンボードアプリ (DB対応版)
 * Design: クリーン・ライト (インディゴ/バイオレット系)
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import ImportModal from "./ImportModal";
import { ProjectLoginModal, ProjectMemberSettings } from "./ProjectAccessModal";
import { SubtaskTemplatePanel } from "@/features/SubtaskTemplatePanel";
import HelpModal from "./HelpModal";
import AssigneeView from "@/features/AssigneeView";

// ─── 定数 ────────────────────────────────────────────────────────────────────
const PRI: Record<string, { label: string; color: string }> = {
  high: { label: "高", color: "#ef4444" },
  medium: { label: "中", color: "#f59e0b" },
  low: { label: "低", color: "#6b7280" },
};
const DEFAULT_MEMBERS = ["田中", "鈴木", "佐藤", "山田", "伊藤"];
const INIT_COLS = [
  { id: "todo", title: "未着手", color: "#6366f1", sortOrder: 0 },
  { id: "inprogress", title: "進行中", color: "#f59e0b", sortOrder: 1 },
  { id: "review", title: "レビュー中", color: "#8b5cf6", sortOrder: 2 },
  { id: "done", title: "完了", color: "#10b981", sortOrder: 3 },
];
const COL_COLORS = ["#6366f1", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444", "#06b6d4", "#f97316", "#84cc16"];
const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16", "#ec4899"];
const uid = () => "id" + Date.now() + Math.random().toString(36).slice(2, 8);

// コメントテキストのURL自動リンク化 + Markdown記法 [text](url) 対応
function renderCommentText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // [テキスト](URL) と 生URL の両方にマッチ
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    if (match[1] && match[2]) {
      // Markdown記法 [テキスト](URL)
      parts.push(<a key={key++} href={match[2]} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "underline", wordBreak: "break-all" }}>{match[1]}</a>);
    } else if (match[3]) {
      // 生URL
      parts.push(<a key={key++} href={match[3]} target="_blank" rel="noopener noreferrer" style={{ color: "#6366f1", textDecoration: "underline", wordBreak: "break-all" }}>{match[3]}</a>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────
interface Col { id: string; title: string; color: string; sortOrder: number; }
interface Subtask { id: number; text: string; done: boolean; assignee?: string; url?: string; due?: string; }
interface CommentType { id?: number; author: string; text: string; createdAt?: Date | string; }
interface TaskType {
  id: string; colId: string; sortOrder: number; title: string; assignee: string;
  priority: string; due: string | null; tags: string[]; subtasks: Subtask[];
  description: string | null; prevCol?: string | null; projectId: string;
  createdBy?: string | null;
}
interface ProjectType { id: string; name: string; color: string; }

// ─── helpers ─────────────────────────────────────────────────────────────────
function reorder(tasks: TaskType[], dragId: string, targetCol: string, targetIndex: number): TaskType[] {
  const dragged = tasks.find((t) => t.id === dragId)!;
  const colTasks = tasks.filter((t) => t.colId === targetCol && t.id !== dragId).sort((a, b) => a.sortOrder - b.sortOrder);
  colTasks.splice(targetIndex, 0, dragged);
  const reassigned = colTasks.map((t, i) => ({ ...t, colId: targetCol, sortOrder: i }));
  const rest = tasks.filter((t) => t.colId !== targetCol && t.id !== dragId);
  return [...rest, ...reassigned];
}

// ─── CustomDatePicker ────────────────────────────────────────────────────────
function CustomDatePicker({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [calPos, setCalPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [viewYear, setViewYear] = useState(() => {
    const d = value ? new Date(value.replace(/\//g, "-")) : new Date();
    return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value.replace(/\//g, "-")) : new Date();
    return isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      // カレンダーポップアップ自体はdocument直下のportalなのでrefで判定できない
      // data属性で判定
      if ((target as HTMLElement).closest?.('[data-datepicker-popup]')) return;
      if (ref.current && !ref.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const parsed = value ? new Date(value.replace(/\//g, "-")) : null;
  const selYear = parsed && !isNaN(parsed.getTime()) ? parsed.getFullYear() : null;
  const selMonth = parsed && !isNaN(parsed.getTime()) ? parsed.getMonth() : null;
  const selDay = parsed && !isNaN(parsed.getTime()) ? parsed.getDate() : null;

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const today = new Date();
  const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();

  const select = (day: number) => {
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const displayVal = value ? value.replace(/-/g, "/") : "";
  const DOW = ["日", "月", "火", "水", "木", "金", "土"];
  const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0, ...style }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            const vw = Math.min(document.documentElement.clientWidth, window.innerWidth);
            const vh = Math.min(document.documentElement.clientHeight, window.innerHeight);
            // スマホ対応: 画面幅が小さい場合は画面左端に固定
            const calW = Math.min(280, vw - 16);
            let left = rect.left;
            if (left + calW > vw - 8) left = vw - calW - 8;
            if (left < 8) left = 8;
            const spaceBelow = vh - rect.bottom;
            const top = spaceBelow >= 300 ? rect.bottom + 4 : Math.max(8, rect.top - 304);
            setCalPos({ top, left });
          }
          setOpen(o => !o);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 7, padding: "3px 6px", fontSize: 11, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: value ? "#1e1b4b" : "#94a3b8", background: "#f8f7ff", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 4, overflow: "hidden", minWidth: 0 }}>
        <span style={{ flexShrink: 0 }}>📅</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{displayVal || "年/月/日"}</span>
      </button>
      {open && (
        <div data-datepicker-popup onPointerDown={(e) => e.stopPropagation()} style={{ position: "fixed", zIndex: 99999, top: calPos.top, left: calPos.left, right: Math.max(8, window.innerWidth - calPos.left - Math.min(280, window.innerWidth - 16)), background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(99,102,241,.28)", border: "1.5px solid #e0e7ff", padding: "10px 12px", minWidth: 0, width: Math.min(280, (Math.min(document.documentElement.clientWidth, window.innerWidth)) - 16) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button type="button" onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#6366f1", padding: "0 4px" }}>‹</button>
            <span style={{ fontWeight: 700, fontSize: 13, color: "#1e1b4b", fontFamily: "'Noto Sans JP',sans-serif" }}>{viewYear}年 {MONTHS[viewMonth]}</span>
            <button type="button" onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#6366f1", padding: "0 4px" }}>›</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {DOW.map((d, i) => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: i === 0 ? "#ef4444" : i === 6 ? "#3b82f6" : "#64748b", padding: "2px 0" }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {Array.from({ length: firstDow }).map((_, i) => <div key={"e" + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isSelected = selYear === viewYear && selMonth === viewMonth && selDay === day;
              const isToday = todayY === viewYear && todayM === viewMonth && todayD === day;
              const dow = (firstDow + i) % 7;
              return (
                <button key={day} type="button" onClick={() => select(day)}
                  style={{ textAlign: "center", fontSize: 11, padding: "4px 0", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: isSelected || isToday ? 700 : 400, background: isSelected ? "#6366f1" : isToday ? "#ede9fe" : "transparent", color: isSelected ? "#fff" : dow === 0 ? "#ef4444" : dow === 6 ? "#3b82f6" : "#1e1b4b", fontFamily: "'Noto Sans JP',sans-serif" }}>
                  {day}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, borderTop: "1px solid #e0e7ff", paddingTop: 6 }}>
            <button type="button" onClick={() => { onChange(""); setOpen(false); }} style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>削除</button>
            <button type="button" onClick={() => { const t = new Date(); select(t.getDate()); setViewYear(t.getFullYear()); setViewMonth(t.getMonth()); }} style={{ fontSize: 11, color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", fontWeight: 700 }}>今日</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── tiny UI ─────────────────────────────────────────────────────────────────
function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const bg = ["#6366f1", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444"][name.charCodeAt(0) % 5];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, color: "#fff", flexShrink: 0, border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.15)" }}>
      {name[0]}
    </div>
  );
}

function Ghost({ task, x, y }: { task: TaskType; x: number; y: number }) {
  const p = PRI[task.priority];
  return (
    <div style={{ position: "fixed", left: x - 130, top: y - 38, width: 260, background: "#fff", borderRadius: 12, padding: "12px 14px", boxShadow: "0 16px 48px rgba(99,102,241,.38)", borderLeft: `3px solid ${p.color}`, opacity: 0.95, pointerEvents: "none", zIndex: 9999, transform: "rotate(1.8deg) scale(1.05)" }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1e1b4b", fontFamily: "'Noto Sans JP',sans-serif" }}>{task.title}</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <Avatar name={task.assignee || "?"} size={22} />
        <span style={{ background: p.color + "18", color: p.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{p.label}</span>
      </div>
    </div>
  );
}

function DropLine() {
  return <div style={{ height: 3, borderRadius: 3, background: "#6366f1", margin: "2px 0", boxShadow: "0 0 6px rgba(99,102,241,.5)" }} />;
}

function InlineTagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const submit = () => { if (val.trim()) { onAdd(val.trim()); setVal(""); setOpen(false); } };
  if (!open)
    return <span onClick={() => setOpen(true)} style={{ fontSize: 10, color: "#a5b4fc", cursor: "pointer", padding: "2px 6px", borderRadius: 20, border: "1px dashed #c7d2fe", fontFamily: "'Noto Sans JP',sans-serif" }}>＋</span>;
  return (
    <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setVal(""); setOpen(false); } }}
      onBlur={() => { submit(); setOpen(false); }}
      placeholder="タグ名"
      style={{ fontSize: 10, border: "1.5px solid #6366f1", borderRadius: 20, padding: "2px 8px", outline: "none", width: 60, fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
  );
}

function TagEditor({ tags, onUpdate }: { tags: string[]; onUpdate: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => { const t = input.trim(); if (t && !tags.includes(t)) { onUpdate([...tags, t]); } setInput(""); };
  return (
    <div style={{ padding: "10px 22px", borderBottom: "1.5px solid #f0f0ff", flexShrink: 0 }}>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>タグ</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
        {tags.map((t) => (
          <span key={t} style={{ background: "#ede9fe", color: "#6d28d9", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4, maxWidth: "100%", overflow: "hidden" }}>
            {/^https?:\/\//.test(t)
              ? <a href={t} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#6366f1", textDecoration: "underline", wordBreak: "break-all", fontSize: 11 }}>{t}</a>
              : <span style={{ wordBreak: "break-all" }}>{t}</span>}
            <span onClick={() => onUpdate(tags.filter((x) => x !== t))} style={{ cursor: "pointer", fontSize: 13, lineHeight: "1", color: "#a78bfa", flexShrink: 0 }}>×</span>
          </span>
        ))}
        {tags.length === 0 && <span style={{ fontSize: 12, color: "#c7d2fe" }}>タグなし</span>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="タグを入力してEnter"
          style={{ flex: 1, border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "5px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />
        <button onClick={add} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "0 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>追加</button>
      </div>
    </div>
  );
}

function DescriptionField({ task, onUpdateDescription }: { task: TaskType; onUpdateDescription: (id: string, desc: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.description || "");
  const save = () => { onUpdateDescription(task.id, text); setEditing(false); };
  if (editing)
    return (
      <div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder="概要を入力..." rows={3}
          style={{ width: "100%", border: "1.5px solid #6366f1", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
          <button onClick={() => { setText(task.description || ""); setEditing(false); }} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif" }}>キャンセル</button>
          <button onClick={save} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif" }}>保存</button>
        </div>
      </div>
    );
  return (
    <div onClick={() => setEditing(true)}
      style={{ cursor: "text", minHeight: 36, padding: "6px 8px", borderRadius: 8, border: "1.5px solid transparent", transition: "border .15s,background .15s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#f8f7ff"; (e.currentTarget as HTMLDivElement).style.borderColor = "#e0e7ff"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).style.borderColor = "transparent"; }}>
      {text
        ? <p style={{ margin: 0, fontSize: 13, color: "#1e1b4b", lineHeight: 1.6, fontFamily: "'Noto Sans JP',sans-serif", whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>{renderCommentText(text)}</p>
        : <p style={{ margin: 0, fontSize: 13, color: "#c7d2fe", fontFamily: "'Noto Sans JP',sans-serif" }}>+ 概要を追加...</p>}
    </div>
  );
}

// ─── TaskDetailModal ────────────────────────────────────────────────────────────
function TaskDetailModal({ task, cols, webhookUrl, members, projectId, onClose, onAddComment, onUpdateSubtasks, onUpdateDescription, onUpdateField, onDeleteTask }: {
  task: TaskType; cols: Col[]; webhookUrl: string; members: string[]; projectId: string;
  onClose: () => void;
  onAddComment: (taskId: string, comment: CommentType) => void;
  onUpdateSubtasks: (taskId: string, subtasks: Subtask[]) => void;
  onUpdateDescription: (taskId: string, desc: string) => void;
  onUpdateField: (id: string, field: string, value: unknown) => void;
  onDeleteTask?: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<"subtasks" | "comments" | "attachments">("subtasks");
  const [newSub, setNewSub] = useState("");
  const [editingSubId, setEditingSubId] = useState<number | null>(null);
  const [editingSubText, setEditingSubText] = useState("");
  const [commentText, setCommentText] = useState("");
  const [sender, setSender] = useState(members[0] || "");
  const [sending, setSending] = useState(false);
  const [chatMsg, setChatMsg] = useState("");
  const currentCol = cols.find((c) => c.id === task.colId);

  // Load comments from DB
  const commentsQuery = trpc.comment.list.useQuery({ taskId: task.id });
  const deleteComment = trpc.comment.delete.useMutation({ onSuccess: () => commentsQuery.refetch() });
  // Load attachments from DB
  const attachmentsQuery = trpc.attachment.list.useQuery({ taskId: task.id });
  const attachments = attachmentsQuery.data || [];
  const uploadAttachment = trpc.attachment.upload.useMutation({ onSuccess: () => attachmentsQuery.refetch() });
  const deleteAttachment = trpc.attachment.delete.useMutation({ onSuccess: () => attachmentsQuery.refetch() });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setChatMsg("✗ ファイルサイズは10MB以下にしてください"); setTimeout(() => setChatMsg(""), 3000); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = ev.target?.result as string;
        await uploadAttachment.mutateAsync({
          taskId: task.id,
          fileName: file.name,
          fileBase64: base64,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          uploadedBy: sender || members[0] || "unknown",
        });
        setChatMsg("✓ ファイルをアップロードしました");
        setTimeout(() => setChatMsg(""), 2000);
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch { setChatMsg("✗ アップロードに失敗しました"); setTimeout(() => setChatMsg(""), 3000); setUploading(false); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const dbComments = commentsQuery.data || [];

  const addComment = async (sendToChat: boolean) => {
    if (!commentText.trim()) return;
    const comment: CommentType = { author: sender, text: commentText.trim() };
    onAddComment(task.id, comment);
    if (sendToChat && webhookUrl) {
      setSending(true);
      try {
        const mention = "";
        const shareUrl = `${window.location.origin}?project=${projectId}&task=${task.id}`;
        const chatText = `${mention}📋 *${task.title}*\n💬 ${sender}: ${commentText.trim()}\n🔗 ${shareUrl}`;
        const resp = await fetch("/api/gchat-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ webhookUrl, text: chatText }),
        });
        if (resp.ok) { setChatMsg("✓ Google Chatに送信しました"); }
        else { setChatMsg("✗ 送信に失敗しました"); }
      } catch { setChatMsg("✗ 送信エラー"); }
      setSending(false);
      setTimeout(() => setChatMsg(""), 3000);
    }
    setCommentText("");
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}?project=${projectId}&task=${task.id}`;
    navigator.clipboard.writeText(url);
    setChatMsg("✓ リンクをコピーしました");
    setTimeout(() => setChatMsg(""), 2000);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 22px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: currentCol?.color || "#6366f1" }} />
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{currentCol?.title || ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={copyShareLink} title="共有リンクをコピー" style={{ background: "#ede9fe", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 14, color: "#6366f1" }}>🔗</button>
            {onDeleteTask && (
              <button
                onClick={() => {
                  if (window.confirm(`「${task.title}」を削除しますか？\nこの操作は元に戻せません。`)) {
                    onDeleteTask(task.id);
                    onClose();
                  }
                }}
                title="タスクを削除"
                style={{ background: "#fef2f2", border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 14, color: "#ef4444" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fee2e2")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fef2f2")}
              >🗑</button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#c7d2fe", lineHeight: "1" }}>×</button>
          </div>
        </div>
        {chatMsg && <div style={{ margin: "6px 22px 0", padding: "6px 10px", background: chatMsg.startsWith("✓") ? "#f0fdf4" : "#fef2f2", color: chatMsg.startsWith("✓") ? "#10b981" : "#ef4444", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{chatMsg}</div>}
        {/* Title */}
        <input
          defaultValue={task.title}
          onBlur={(e) => { if (e.target.value.trim() && e.target.value !== task.title) onUpdateField(task.id, "title", e.target.value.trim()); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          style={{ margin: "10px 22px 0", fontSize: 16, fontWeight: 800, color: "#1e1b4b", border: "none", borderBottom: "2px solid transparent", outline: "none", width: "calc(100% - 44px)", fontFamily: "'Noto Sans JP',sans-serif", background: "transparent", padding: "2px 0", borderRadius: 0 }}
          onFocus={(e) => (e.target.style.borderBottomColor = "#6366f1")}
          onBlurCapture={(e) => (e.target.style.borderBottomColor = "transparent")}
        />
        {/* Fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "14px 22px 0" }}>
          {([["優先度", "priority", Object.entries(PRI).map(([k, v]) => [k, v.label])], ["ステータス", "colId", cols.map((c) => [c.id, c.title])], ["期限日", "due", null]] as [string, string, [string, string][] | null][]).map(([label, key, opts]) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 3 }}>{label}</label>
              {opts
                ? <select value={(task as any)[key] || ""} onChange={(e) => onUpdateField(task.id, key, e.target.value)} style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#f8f7ff" }}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                : <CustomDatePicker value={(task as any)[key] || ""} onChange={(v) => onUpdateField(task.id, key, v)} style={{ flex: "none", width: "100%" }} />}
            </div>
          ))}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 3 }}>担当者</label>
            {(() => {
              const assignees = task.assignee ? task.assignee.split(",").map((a) => a.trim()).filter(Boolean) : [""];
              const a1 = assignees[0] || "";
              const a2 = assignees[1] || "";
              const setAssignees = (v1: string, v2: string) => {
                const combined = v2 ? `${v1},${v2}` : v1;
                onUpdateField(task.id, "assignee", combined);
              };
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <select value={a1} onChange={(e) => setAssignees(e.target.value, a2)} style={{ border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#f8f7ff" }}>
                    {members.map((m: string) => <option key={m}>{m}</option>)}
                  </select>
                  {a2
                    ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <select value={a2} onChange={(e) => setAssignees(a1, e.target.value)} style={{ border: "1.5px solid #c4b5fd", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#6d28d9", background: "#f5f3ff" }}>
                          {members.map((m: string) => <option key={m}>{m}</option>)}
                        </select>
                        <button onClick={() => setAssignees(a1, "")} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 16, padding: "0 2px", lineHeight: 1 }} title="2人目を削除">×</button>
                      </div>
                    : <button onClick={() => setAssignees(a1, members.find((m) => m !== a1) || members[0] || "")} style={{ fontSize: 11, color: "#6366f1", background: "#ede9fe", border: "none", borderRadius: 7, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>＋ 担当者追加</button>
                  }
                </div>
              );
            })()}
          </div>
        </div>
        <TagEditor tags={task.tags || []} onUpdate={(tags) => onUpdateField(task.id, "tags", tags)} />
        {task.createdBy && (
          <div style={{ padding: "4px 22px 0", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>👤 作成者:</span>
            <span style={{ fontSize: 11, color: "#6366f1", fontWeight: 700 }}>{task.createdBy}</span>
          </div>
        )}
        <DescriptionField task={task} onUpdateDescription={onUpdateDescription} />
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1.5px solid #f0f0ff", flexShrink: 0 }}>
          {(["subtasks", "comments", "attachments"] as const).map((t) => (
            <button key={t} onClick={(e) => { e.stopPropagation(); setTab(t); }} style={{ flex: 1, padding: "10px", fontSize: 12, fontWeight: 700, color: tab === t ? "#6366f1" : "#94a3b8", background: "none", border: "none", borderBottom: tab === t ? "2.5px solid #6366f1" : "2.5px solid transparent", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>
              {t === "subtasks" ? "✅ 小タスク" : t === "comments" ? "💬 コメント" : "📎 添付"}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 22px 18px" }}>
          {tab === "subtasks" ? (
            <>
              {(task.subtasks || []).map((s, i) => (
                <div key={s.id} style={{ background: "#f8f7ff", borderRadius: 8, padding: "6px 8px", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <button onClick={() => { if (i === 0) return; const ns = [...task.subtasks]; [ns[i-1], ns[i]] = [ns[i], ns[i-1]]; onUpdateSubtasks(task.id, ns); }}
                        style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#e0e7ff" : "#94a3b8", fontSize: 10, lineHeight: 1, padding: "1px 2px" }}>▲</button>
                      <button onClick={() => { if (i === task.subtasks.length - 1) return; const ns = [...task.subtasks]; [ns[i], ns[i+1]] = [ns[i+1], ns[i]]; onUpdateSubtasks(task.id, ns); }}
                        style={{ background: "none", border: "none", cursor: i === task.subtasks.length - 1 ? "default" : "pointer", color: i === task.subtasks.length - 1 ? "#e0e7ff" : "#94a3b8", fontSize: 10, lineHeight: 1, padding: "1px 2px" }}>▼</button>
                    </div>
                    <input type="checkbox" checked={s.done} onChange={() => { const ns = [...task.subtasks]; ns[i] = { ...s, done: !s.done }; onUpdateSubtasks(task.id, ns); }}
                      style={{ accentColor: "#6366f1", flexShrink: 0 }} />
                    {editingSubId === s.id ? (
                      <input autoFocus value={editingSubText} onChange={(e) => setEditingSubText(e.target.value)}
                        onBlur={() => { const ns = [...task.subtasks]; ns[i] = { ...s, text: editingSubText || s.text }; onUpdateSubtasks(task.id, ns); setEditingSubId(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { const ns = [...task.subtasks]; ns[i] = { ...s, text: editingSubText || s.text }; onUpdateSubtasks(task.id, ns); setEditingSubId(null); } }}
                        style={{ flex: 1, fontSize: 13, border: "1.5px solid #6366f1", borderRadius: 6, padding: "2px 6px", outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
                    ) : (
                      <span onClick={() => { setEditingSubId(s.id); setEditingSubText(s.text); }}
                        title="クリックで編集"
                        style={{ fontSize: 13, color: s.done ? "#94a3b8" : "#1e1b4b", textDecoration: s.done ? "line-through" : "none", flex: 1, cursor: "text", minWidth: 0, wordBreak: "break-all" }}>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: s.done ? "#94a3b8" : "#6366f1", textDecoration: "underline", wordBreak: "break-all" }}>{s.text}</a>
                        ) : s.text}
                      </span>
                    )}
                    <button onClick={() => onUpdateSubtasks(task.id, task.subtasks.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 14, flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}>×</button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: 32 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>担当:</span>
                    <select value={s.assignee || ""} onChange={(e) => { const ns = [...task.subtasks]; ns[i] = { ...s, assignee: e.target.value }; onUpdateSubtasks(task.id, ns); }}
                      style={{ fontSize: 11, border: "1px solid #e0e7ff", borderRadius: 6, padding: "2px 4px", color: "#1e1b4b", background: "#fff", fontFamily: "'Noto Sans JP',sans-serif" }}>
                      <option value="">未設定</option>
                      {members.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: 32 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>🔗</span>
                    <input
                      type="text"
                      defaultValue={s.url || ""}
                      key={s.id + "-url"}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.url || "")) { const ns = [...task.subtasks]; ns[i] = { ...s, url: v || undefined }; onUpdateSubtasks(task.id, ns); } }}
                      placeholder="URLを入力（任意）"
                      style={{ flex: 1, fontSize: 11, border: "1px solid #e0e7ff", borderRadius: 6, padding: "2px 6px", color: "#1e1b4b", background: "#fff", fontFamily: "'Noto Sans JP',sans-serif", outline: "none" }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: 32 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>📅 期日:</span>
                    <CustomDatePicker value={s.due || ""} onChange={(v) => { const ns = [...task.subtasks]; ns[i] = { ...s, due: v || undefined }; onUpdateSubtasks(task.id, ns); }} />
                    {s.due && (() => {
                      const today = new Date().toISOString().slice(0, 10);
                      const isOverdue = s.due < today && !s.done;
                      const isToday = s.due === today && !s.done;
                      return isOverdue ? <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 700 }}>期限超過</span>
                        : isToday ? <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 700 }}>今日まで</span> : null;
                    })()}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newSub.trim()) { onUpdateSubtasks(task.id, [...(task.subtasks || []), { id: Date.now(), text: newSub.trim(), done: false }]); setNewSub(""); } }}
                  placeholder="小タスクを追加..." style={{ flex: 1, border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
              </div>
              {/* テンプレートパネル（features/SubtaskTemplatePanel.tsx） */}
              <SubtaskTemplatePanel
                projectId={projectId}
                currentSubtasks={task.subtasks || []}
                onApply={(subtasks) => onUpdateSubtasks(task.id, subtasks)}
              />
            </>
          ) : tab === "attachments" ? (
            <>
              <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileUpload} />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                style={{ width: "100%", background: uploading ? "#e0e7ff" : "#ede9fe", border: "1.5px dashed #6366f1", borderRadius: 10, padding: "12px", cursor: uploading ? "not-allowed" : "pointer", fontSize: 13, color: "#6366f1", fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif", marginBottom: 12 }}>
                {uploading ? "アップロード中..." : "📎 ファイルを選択（最大10MB）"}
              </button>
              {attachments.length === 0 && !uploading && <p style={{ fontSize: 13, color: "#c7d2fe", textAlign: "center", marginTop: 8 }}>添付ファイルはまだありません</p>}
              {(attachments as any[]).map((a) => {
                const isImage = a.fileUrl && (a.fileName.match(/\.(png|jpg|jpeg|gif|webp)$/i) || a.fileUrl.startsWith("data:image"));
                const formatSize = (b: number) => b < 1024 ? b + "B" : b < 1024*1024 ? (b/1024).toFixed(1)+"KB" : (b/1024/1024).toFixed(1)+"MB";
                return (
                  <div key={a.id} style={{ background: "#f8f7ff", borderRadius: 10, padding: "10px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
                    {isImage ? <img src={a.fileUrl} alt={a.fileName} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} /> : <div style={{ width: 40, height: 40, background: "#e0e7ff", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📄</div>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <a href={a.fileUrl} download={a.fileName} style={{ fontSize: 13, fontWeight: 700, color: "#6366f1", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.fileName}</a>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{formatSize(a.fileSize)} ・ {a.uploadedBy} ・ {new Date(a.createdAt).toLocaleDateString("ja-JP")}</span>
                    </div>
                    <button onClick={() => deleteAttachment.mutate({ id: a.id })} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 16, flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}>×</button>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {dbComments.map((c: any, i: number) => (
                <div key={c.id || i} style={{ marginBottom: 10, background: "#f8f7ff", borderRadius: 10, padding: "10px 12px", position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: "#6366f1" }}>{c.author}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{c.createdAt ? new Date(c.createdAt).toLocaleString("ja-JP") : ""}</span>
                      {c.id != null && (
                        <button
                          onClick={() => {
                            if (window.confirm("このコメントを削除しますか？")) {
                              deleteComment.mutate({ id: c.id });
                            }
                          }}
                          title="削除"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13, padding: "0 2px", lineHeight: 1, display: "flex", alignItems: "center" }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                        >🗑</button>
                      )}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#1e1b4b", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>{renderCommentText(c.text)}</p>
                </div>
              ))}
              {dbComments.length === 0 && <p style={{ fontSize: 13, color: "#c7d2fe", textAlign: "center", marginTop: 16 }}>コメントはまだありません</p>}
              <div style={{ marginTop: 12, borderTop: "1.5px solid #f0f0ff", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <select value={sender} onChange={(e) => setSender(e.target.value)} style={{ border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#f8f7ff" }}>
                    {members.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="コメントを入力..." rows={2}
                  style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", marginBottom: 8 }}
                  onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => addComment(false)} disabled={!commentText.trim()} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "7px 14px", cursor: commentText.trim() ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>💾 保存</button>

                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TaskCard ────────────────────────────────────────────────────────────────
function TaskCard({ task, dragging, members, doneColIds, onPointerDown, onClick, onComplete, onRevert, onComment, onUpdateField }: {
  task: TaskType; dragging: boolean; members: string[]; doneColIds: string[];
  onPointerDown: (e: React.PointerEvent, task: TaskType) => void;
  onClick: (task: TaskType) => void;
  onComplete: (task: TaskType) => void;
  onRevert: (task: TaskType) => void;
  onComment: (task: TaskType) => void;
  onUpdateField: (id: string, field: string, value: unknown) => void;
}) {
  const p = PRI[task.priority] || PRI.medium;
  const isDone = doneColIds.includes(task.colId);
  const overdue = !isDone && task.due && new Date(task.due) < new Date(new Date().toDateString());
  return (
    <div onPointerDown={(e) => onPointerDown(e, task)} onClick={() => onClick(task)}
      style={{ background: dragging ? "#f0f0ff" : isDone ? "#f3f4f6" : overdue ? "#fff5f5" : "#fff", borderRadius: 12, padding: "12px 14px", marginBottom: 8, boxShadow: dragging ? "0 0 0 2px #6366f1, 0 8px 24px rgba(99,102,241,.2)" : isDone ? "none" : overdue ? "0 0 0 2px #ef4444, 0 2px 8px rgba(239,68,68,.18)" : "0 1px 4px rgba(99,102,241,.08)", borderLeft: isDone ? "3px solid #d1d5db" : overdue ? "4px solid #ef4444" : `3px solid ${p.color}`, cursor: dragging ? "grabbing" : "grab", opacity: isDone ? 0.6 : dragging ? 0.4 : 1, transition: "box-shadow .12s,opacity .12s,background .12s", touchAction: "pan-y" }}>
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, color: isDone ? "#9ca3af" : overdue ? "#b91c1c" : "#1e1b4b", fontFamily: "'Noto Sans JP',sans-serif", lineHeight: 1.4, textDecoration: isDone ? "line-through" : "none" }}>{overdue && <span style={{ marginRight: 4 }}>🚨</span>}{task.title}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: task.due ? 4 : 8 }}>
        <span style={{ background: p.color + "18", color: p.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>{p.label}</span>
        {(task.tags || []).map((t) => (
          <span key={t} style={{ background: "#ede9fe", color: "#6d28d9", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, maxWidth: "100%", overflow: "hidden", display: "inline-flex", alignItems: "center" }}>
            {/^https?:\/\//.test(t)
              ? <a href={t} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#6366f1", textDecoration: "underline", wordBreak: "break-all", fontSize: 10 }}>{t}</a>
              : t}
          </span>
        ))}
        <InlineTagInput onAdd={(tag) => { if (tag && !(task.tags || []).includes(tag)) onUpdateField(task.id, "tags", [...(task.tags || []), tag]); }} />
      </div>
      {task.due && (() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const dueStr = task.due.replace(/\//g, "-");
        const isToday = dueStr === todayStr && !isDone;
        return (
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              fontSize: 13, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              background: isDone ? "#f3f4f6" : overdue ? "#ef4444" : isToday ? "#f59e0b" : "#f1f5f9",
              color: isDone ? "#9ca3af" : overdue ? "#fff" : isToday ? "#fff" : "#475569",
              letterSpacing: 0.3,
            }}>📅 {task.due}</span>
            {overdue && !isDone && <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444" }}>期限超過</span>}
            {isToday && <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>今日まで</span>}
          </div>
        );
      })()}
      {(task.subtasks || []).length > 0 && (() => {
        const done = (task.subtasks || []).filter((s) => s.done).length;
        const total = (task.subtasks || []).length;
        return (
          <div style={{ marginBottom: 8, pointerEvents: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>
              <span>✅ {done}/{total}</span><span>{Math.round(done / total * 100)}%</span>
            </div>
            <div style={{ height: 3, background: "#e0e7ff", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${Math.round(done / total * 100)}%`, background: "#10b981", borderRadius: 3 }} />
            </div>
          </div>
        );
      })()}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, minWidth: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {(() => {
          const assignees = task.assignee ? task.assignee.split(",").map((a) => a.trim()).filter(Boolean) : [""];
          const a1 = assignees[0] || "";
          const a2 = assignees[1] || "";
          const setAssignees = (v1: string, v2: string) => {
            const combined = v2 ? `${v1},${v2}` : v1;
            onUpdateField(task.id, "assignee", combined);
          };
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "0 0 auto" }}>
              <select value={a1} onChange={(e) => setAssignees(e.target.value, a2)} style={{ border: "1.5px solid #e0e7ff", borderRadius: 7, padding: "3px 6px", fontSize: 11, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#f8f7ff", cursor: "pointer", maxWidth: 110, minWidth: 0 }}>
                {members.map((m: string) => <option key={m}>{m}</option>)}
              </select>
              {a2
                ? <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <select value={a2} onChange={(e) => setAssignees(a1, e.target.value)} style={{ border: "1.5px solid #c4b5fd", borderRadius: 7, padding: "3px 6px", fontSize: 11, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#6d28d9", background: "#f5f3ff", cursor: "pointer", maxWidth: 95, minWidth: 0 }}>
                      {members.map((m: string) => <option key={m}>{m}</option>)}
                    </select>
                    <button onClick={() => setAssignees(a1, "")} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 13, padding: "0 2px", lineHeight: 1 }} title="2人目を削除">×</button>
                  </div>
                : <button onClick={() => setAssignees(a1, members.find((m) => m !== a1) || members[0] || "")} style={{ fontSize: 10, color: "#6366f1", background: "#ede9fe", border: "none", borderRadius: 6, padding: "2px 6px", cursor: "pointer", fontWeight: 700, textAlign: "left" }}>＋ 担当者追加</button>
              }
            </div>
          );
        })()}
        <CustomDatePicker value={task.due || ""} onChange={(v) => onUpdateField(task.id, "due", v)} style={{ minWidth: 0, flex: "1 1 0", overflow: "hidden" }} />
      </div>
      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onComment(task); }} style={{ fontSize: 11, fontWeight: 700, color: "#1877F2", background: "#eff6ff", border: "1.5px solid #93c5fd", borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", flexShrink: 0 }}>💬 コメント</button>
        {isDone
          ? <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRevert(task); }} style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", background: "#f1f5f9", border: "none", borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>↩ 戻す</button>
          : <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onComplete(task); }} style={{ fontSize: 11, fontWeight: 700, color: "#10b981", background: "#f0fdf4", border: "1.5px solid #6ee7b7", borderRadius: 8, padding: "4px 9px", cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>✓ 完了</button>}
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────
function ColumnComp({ col, tasks, draggingId, dropTarget, members, doneColIds, onPointerDown, onCardClick, onComplete, onRevert, onComment, onUpdateField, onAddTask, onUpdateColTitle, onDeleteCol, colRef, cardRefs, onColDragStart, onColDragOver, onColDrop, colDraggingId }: {
  col: Col; tasks: TaskType[]; draggingId: string | null; dropTarget: { col: string; index: number } | null; members: string[]; doneColIds: string[];
  onPointerDown: (e: React.PointerEvent, task: TaskType) => void;
  onCardClick: (task: TaskType) => void;
  onComplete: (task: TaskType) => void;
  onRevert: (task: TaskType) => void;
  onComment: (task: TaskType) => void;
  onUpdateField: (id: string, field: string, value: unknown) => void;
  onAddTask: (colId: string) => void;
  onUpdateColTitle: (id: string, title: string) => void;
  onDeleteCol: (id: string) => void;
  colRef: (el: HTMLDivElement | null) => void;
  cardRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onColDragStart: (colId: string) => void;
  onColDragOver: (colId: string) => void;
  onColDrop: () => void;
  colDraggingId: string | null;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState(col.title);
  const [sortByDue, setSortByDue] = useState(true);
  const isOver = dropTarget?.col === col.id;
  const insertIdx = isOver ? dropTarget!.index : -1;
  const isColDragging = colDraggingId === col.id;
  const isDoneCol = doneColIds.includes(col.id);

  // 期限順ソート（表示のみ・DBは変更しない）
  const displayTasks = sortByDue && !isDoneCol ? [...tasks].sort((a, b) => {
    const todayMs = new Date(new Date().toDateString()).getTime();
    const aOver = a.due && new Date(a.due.replace(/\//g, "-")).getTime() < todayMs ? 0 : 1;
    const bOver = b.due && new Date(b.due.replace(/\//g, "-")).getTime() < todayMs ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    // 期限なしは最後
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.replace(/\//g, "-").localeCompare(b.due.replace(/\//g, "-"));
  }) : tasks;
  return (
    <div ref={colRef}
      onDragOver={(e) => { e.preventDefault(); onColDragOver(col.id); }}
      onDrop={(e) => { e.preventDefault(); onColDrop(); }}
      style={{ background: isOver ? "#ede9fe" : "#f5f3ff", borderRadius: 16, padding: "13px 11px", minWidth: "min(255px, 78vw)", maxWidth: 275, flex: "0 0 min(255px, 78vw)", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 108px)", boxShadow: isOver ? "0 0 0 2.5px #6366f1, 0 4px 20px rgba(99,102,241,.14)" : "0 2px 8px rgba(99,102,241,.06)", border: isColDragging ? "2px dashed #6366f1" : isOver ? "2px solid #6366f1" : "1.5px solid rgba(99,102,241,.1)", transition: "background .12s,box-shadow .12s,border-color .12s,opacity .12s", scrollSnapAlign: "start", opacity: isColDragging ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <div draggable onDragStart={(e) => { e.stopPropagation(); onColDragStart(col.id); }} title="ドラッグして並び替え" style={{ cursor: "grab", color: "#c7d2fe", fontSize: 14, flexShrink: 0, lineHeight: 1, userSelect: "none", padding: "0 2px" }}>⠿</div>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: col.color, flexShrink: 0, boxShadow: `0 0 0 3px ${col.color}28` }} />
        {editingTitle
          ? <input autoFocus value={titleVal} onChange={(e) => setTitleVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { onUpdateColTitle(col.id, titleVal || col.title); setEditingTitle(false); } }}
            onBlur={() => { onUpdateColTitle(col.id, titleVal || col.title); setEditingTitle(false); }}
            style={{ flex: 1, fontWeight: 800, fontSize: 13, color: "#1e1b4b", fontFamily: "'Noto Sans JP',sans-serif", border: "1.5px solid #6366f1", borderRadius: 6, padding: "1px 6px", outline: "none" }} />
          : <span onClick={() => setEditingTitle(true)} title="クリックで編集" style={{ fontWeight: 800, fontSize: 13, color: "#1e1b4b", flex: 1, fontFamily: "'Noto Sans JP',sans-serif", letterSpacing: 0.3, cursor: "text" }}>{col.title}</span>}
        <span style={{ background: col.color + "22", color: col.color, fontSize: 11, fontWeight: 700, borderRadius: 20, padding: "2px 9px" }}>{tasks.length}</span>
        {!isDoneCol && (
          <button
            onClick={() => setSortByDue((v) => !v)}
            title={sortByDue ? "期限順（クリックで手動順に切り替え）" : "手動順（クリックで期限順に戻す）"}
            style={{ background: sortByDue ? "#6366f1" : "none", border: sortByDue ? "none" : "none", cursor: "pointer", color: sortByDue ? "#fff" : "#c7d2fe", fontSize: 13, padding: sortByDue ? "2px 5px" : "0 2px", lineHeight: "1", borderRadius: 6, flexShrink: 0, fontWeight: 700, transition: "background .15s,color .15s" }}
            onMouseEnter={(e) => { if (!sortByDue) e.currentTarget.style.color = "#6366f1"; }}
            onMouseLeave={(e) => { if (!sortByDue) e.currentTarget.style.color = "#c7d2fe"; }}>
            📅
          </button>
        )}
        {col.title !== "完了" && (
          <button onClick={() => onDeleteCol(col.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 14, padding: 0, lineHeight: "1" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}>×</button>
        )}
      </div>
      {sortByDue && !isDoneCol && (
        <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 700, marginBottom: 6, textAlign: "center", background: "#ede9fe", borderRadius: 6, padding: "2px 0" }}>📅 期限日付順</div>
      )}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 2 }}>
        {insertIdx === 0 && <DropLine />}
        {displayTasks.map((task, i) => (
          <div key={task.id} ref={(el) => { cardRefs.current[task.id] = el; }}>
            <TaskCard task={task} dragging={draggingId === task.id} members={members} doneColIds={doneColIds} onPointerDown={onPointerDown} onClick={onCardClick} onComplete={onComplete} onRevert={onRevert} onComment={onComment} onUpdateField={onUpdateField} />
            {insertIdx === i + 1 && <DropLine />}
          </div>
        ))}
        {tasks.length === 0 && isOver && <div style={{ height: 52, border: "2px dashed #a5b4fc", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#818cf8", fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>ここにドロップ</div>}
      </div>
      <button onClick={() => onAddTask(col.id)} style={{ marginTop: 10, width: "100%", background: "transparent", border: "1.5px dashed rgba(99,102,241,.3)", borderRadius: 10, padding: "9px", fontSize: 12, color: "#6366f1", cursor: "pointer", fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif", transition: "background .15s,border-color .15s" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#ede9fe"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#6366f1"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(99,102,241,.3)"; }}>
        + タスクを追加
      </button>
    </div>
  );
}

// ─── AddTaskModal ─────────────────────────────────────────────────────────────
function AddTaskModal({ defaultCol, cols, members, currentUser, onClose, onSave }: { defaultCol: string; cols: Col[]; members: string[]; currentUser?: string; onClose: () => void; onSave: (form: { title: string; colId: string; assignee: string; priority: string; due: string; tags: string[]; createdBy?: string }) => void }) {
  const [form, setForm] = useState({ title: "", colId: defaultCol || cols[0]?.id || "", assignee: "", priority: "medium", due: "", tags: [] as string[] });
  const [assignee2, setAssignee2] = useState("");
  const [tagInput, setTagInput] = useState("");
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const addTag = () => { if (tagInput.trim() && !form.tags.includes(tagInput.trim())) { set("tags", [...form.tags, tagInput.trim()]); setTagInput(""); } };
  const combinedAssignee = assignee2 ? `${form.assignee},${assignee2}` : form.assignee;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "26px 22px", width: "100%", maxWidth: 450, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif" }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>新しいタスク</h2>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>タスク名 *</label>
        <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="タスク名を入力..."
          style={{ width: "100%", border: "2px solid #e0e7ff", borderRadius: 10, padding: "9px 11px", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 14, fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          {([["優先度", "priority", Object.entries(PRI).map(([k, v]) => [k, v.label])], ["ステータス", "colId", cols.map((c) => [c.id, c.title])], ["期限日", "due", null]] as [string, string, [string, string][] | null][]).map(([label, key, opts]) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>{label}</label>
              {opts
                ? <select value={(form as any)[key] || ""} onChange={(e) => set(key, e.target.value)} style={{ width: "100%", border: "2px solid #e0e7ff", borderRadius: 10, padding: "8px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#fff" }}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                : <CustomDatePicker value={(form as any)[key] || ""} onChange={(v) => set(key, v)} style={{ flex: "none", width: "100%" }} />}
            </div>
          ))}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>担当者</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <select value={form.assignee} onChange={(e) => set("assignee", e.target.value)} style={{ border: "2px solid #e0e7ff", borderRadius: 10, padding: "8px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", background: "#fff" }}>
                <option value="">担当なし</option>
                {members.map((m: string) => <option key={m}>{m}</option>)}
              </select>
              {assignee2
                ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <select value={assignee2} onChange={(e) => setAssignee2(e.target.value)} style={{ border: "2px solid #c4b5fd", borderRadius: 10, padding: "8px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#6d28d9", background: "#f5f3ff" }}>
                      {members.map((m: string) => <option key={m}>{m}</option>)}
                    </select>
                    <button onClick={() => setAssignee2("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#a78bfa", fontSize: 18, padding: "0 2px", lineHeight: 1 }} title="2人目を削除">×</button>
                  </div>
                : <button onClick={() => setAssignee2(members.find((m) => m !== form.assignee) || members[0] || "")} style={{ fontSize: 12, color: "#6366f1", background: "#ede9fe", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}>＋ 担当者追加</button>
              }
            </div>
          </div>
        </div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>タグ</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} placeholder="Enter で追加"
            style={{ flex: 1, border: "2px solid #e0e7ff", borderRadius: 10, padding: "7px 9px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
          <button onClick={addTag} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "0 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>追加</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
          {form.tags.map((t) => (
            <span key={t} style={{ background: "#ede9fe", color: "#6d28d9", fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 20, display: "flex", alignItems: "center", gap: 4, maxWidth: "100%", overflow: "hidden" }}>
              {/^https?:\/\//.test(t)
                ? <a href={t} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "#6366f1", textDecoration: "underline", wordBreak: "break-all", fontSize: 11 }}>{t}</a>
                : <span style={{ wordBreak: "break-all" }}>{t}</span>}
              <span onClick={() => set("tags", form.tags.filter((x) => x !== t))} style={{ cursor: "pointer", fontSize: 13, lineHeight: "1", color: "#a78bfa", flexShrink: 0 }}>×</span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>キャンセル</button>
          <button onClick={() => form.title.trim() && onSave({ ...form, assignee: combinedAssignee, createdBy: currentUser || undefined })} style={{ background: form.title.trim() ? "#6366f1" : "#c7d2fe", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", cursor: form.title.trim() ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif", boxShadow: form.title.trim() ? "0 4px 12px rgba(99,102,241,.35)" : "none" }}>作成</button>
        </div>
      </div>
    </div>
  );
}

// ─── AddProjectModal ──────────────────────────────────────────────────────────
function AddProjectModal({ onClose, onSave, existingCount }: { onClose: () => void; onSave: (name: string, color: string) => void; existingCount: number }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PROJECT_COLORS[existingCount % PROJECT_COLORS.length]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "26px 22px", width: "100%", maxWidth: 400, boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif" }}>
        <h2 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>新しいプロジェクト</h2>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>プロジェクト名 *</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="プロジェクト名を入力..."
          style={{ width: "100%", border: "2px solid #e0e7ff", borderRadius: 10, padding: "9px 11px", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 16, fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
          onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim(), color)} />
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 8 }}>カラー</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
          {PROJECT_COLORS.map((c) => (
            <div key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer", border: color === c ? "3px solid #1e1b4b" : "3px solid transparent", boxSizing: "border-box", transition: "border .15s" }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>キャンセル</button>
          <button onClick={() => name.trim() && onSave(name.trim(), color)} style={{ background: name.trim() ? "#6366f1" : "#c7d2fe", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", cursor: name.trim() ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif", boxShadow: name.trim() ? "0 4px 12px rgba(99,102,241,.35)" : "none" }}>作成</button>
        </div>
      </div>
    </div>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────
function SettingsModal({ webhookUrl, members, projectId, currentUserIsAdmin, isPublic, onSave, onClose }: {
  webhookUrl: string; members: string[]; projectId: string;
  currentUserIsAdmin?: boolean;
  isPublic?: boolean;
  onSave: (url: string, members: string[]) => void; onClose: () => void;
}) {
  const [url, setUrl] = useState(webhookUrl);
  const [localMembers, setLocalMembers] = useState<string[]>(members);
  const [newMember, setNewMember] = useState("");
  const [activeTab, setActiveTab] = useState<"general" | "access">("general");
  const [localIsPublic, setLocalIsPublic] = useState<boolean>(isPublic ?? false);
  const updateProject = trpc.project.update.useMutation();
  const [publicSaved, setPublicSaved] = useState(false);
  const addMember = () => { if (newMember.trim() && !localMembers.includes(newMember.trim())) { setLocalMembers([...localMembers, newMember.trim()]); setNewMember(""); } };
  const tabStyle = (active: boolean) => ({
    padding: "7px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer",
    borderRadius: 8, border: "none", fontFamily: "'Noto Sans JP',sans-serif",
    background: active ? "#6366f1" : "#f1f5f9",
    color: active ? "#fff" : "#64748b",
  });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "26px 22px", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>⚙ 設定</h2>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
          <button style={tabStyle(activeTab === "general")} onClick={() => setActiveTab("general")}>一般</button>
          <button style={tabStyle(activeTab === "access")} onClick={() => setActiveTab("access")}>🔒 アクセス権限</button>
        </div>

        {activeTab === "general" && (
          <>
            {/* Webhook URL */}
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 6 }}>Google Chat Webhook URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://chat.googleapis.com/v1/spaces/.../messages?key=..."
              style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 11, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b", boxSizing: "border-box", marginBottom: 16 }} />
            {/* Members */}
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 8 }}>メンバー管理</label>
            <div style={{ marginBottom: 4 }}>
              {localMembers.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                  <input value={m} onChange={(e) => { const nm = [...localMembers]; nm[i] = e.target.value; setLocalMembers(nm); }}
                    style={{ flex: 1, border: "1.5px solid #e0e7ff", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
                  <button onClick={() => { setLocalMembers(localMembers.filter((_, j) => j !== i)); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e7ff", fontSize: 16 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#e0e7ff")}>×</button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <input value={newMember} onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} placeholder="新しいメンバー名"
                  style={{ flex: 1, border: "1.5px dashed #c7d2fe", borderRadius: 8, padding: "6px 8px", fontSize: 12, outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
                <button onClick={addMember} style={{ background: "#ede9fe", color: "#6366f1", border: "none", borderRadius: 8, padding: "0 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>追加</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={onClose} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>キャンセル</button>
              <button onClick={() => onSave(url, localMembers)} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", cursor: "pointer", fontWeight: 800, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif", boxShadow: "0 4px 12px rgba(99,102,241,.35)" }}>保存</button>
            </div>
          </>
        )}

        {activeTab === "access" && (
          <>
            {/* 公開/非公開トグル */}
            <div style={{ background: localIsPublic ? "#f0fdf4" : "#fef2f2", border: `1.5px solid ${localIsPublic ? "#6ee7b7" : "#fca5a5"}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: localIsPublic ? "#10b981" : "#ef4444", marginBottom: 4 }}>
                    {localIsPublic ? "🔓 公開中" : "🔒 非公開"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {localIsPublic ? "ログイン不要で誰でも閲覧可能" : "アクセス制限あり（メンバーのみ）"}
                  </div>
                </div>
                <button
                  onClick={() => {
                    const newVal = !localIsPublic;
                    setLocalIsPublic(newVal);
                    updateProject.mutate({ id: projectId, isPublic: newVal }, {
                      onSuccess: () => { setPublicSaved(true); setTimeout(() => setPublicSaved(false), 2000); }
                    });
                  }}
                  style={{
                    width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer",
                    background: localIsPublic ? "#10b981" : "#e0e7ff",
                    position: "relative", transition: "background .2s", flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 4, left: localIsPublic ? 28 : 4,
                    width: 20, height: 20, borderRadius: "50%", background: "#fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,.2)", transition: "left .2s",
                  }} />
                </button>
              </div>
              {publicSaved && <div style={{ marginTop: 8, fontSize: 11, color: "#10b981", fontWeight: 700 }}>✓ 保存しました</div>}
            </div>
            <ProjectMemberSettings projectId={projectId} currentUserIsAdmin={currentUserIsAdmin} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={onClose} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>閉じる</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/// ─── ProjectList ────────────────────────────────────────────────────────────
function ProjectList({ projects, taskCounts, onSelect, onAdd, onImport, onDelete, onRename, onRefresh, onDuplicate, onShowAssigneeView }: {
  projects: ProjectType[]; taskCounts: Record<string, { total: number; done: number; dueToday: number }>;
  onSelect: (id: string) => void; onAdd: () => void; onImport: () => void; onDelete: (id: string) => void; onRename: (id: string, name: string) => void; onRefresh: () => void; onDuplicate: (id: string) => void; onShowAssigneeView: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameVal, setNameVal] = useState("");
  const [search, setSearch] = useState("");
  const filtered = projects.filter((p) => p.name.includes(search));
  return (
    <div style={{ minHeight: "100vh", background: "#f8f7ff", fontFamily: "'Noto Sans JP',sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e0e7ff", padding: "0 28px", height: 54, display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📋</div>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#1e1b4b" }}>TaskBoard</span>
        </div>
        <span style={{ fontSize: 13, color: "#94a3b8" }}>プロジェクト一覧</span>
        <div style={{ flex: 1 }} />
        <button onClick={onShowAssigneeView} title="担当者ダッシュボード" style={{ background: "#f8f7ff", color: "#6366f1", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 12px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif", transition: "background .15s", whiteSpace: "nowrap" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "#f8f7ff")}>👥 担当者</button>
        <button onClick={async (e) => {
            const btn = e.currentTarget;
            btn.style.transform = "rotate(360deg)";
            btn.style.transition = "transform 0.5s ease";
            setTimeout(() => { btn.style.transform = ""; btn.style.transition = "background .15s"; }, 600);
            await onRefresh();
          }} title="更新" style={{ background: "#f8f7ff", color: "#6366f1", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 12px", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif", transition: "background .15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "#f8f7ff")}>🔄</button>
      </div>
      <div style={{ padding: "32px 28px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, gap: 12 }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 400 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="プロジェクトを検索..."
              style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "9px 12px 9px 36px", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#fff", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
              onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={onImport} style={{ background: "#fff", color: "#6366f1", border: "1.5px solid #6366f1", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif", whiteSpace: "nowrap", transition: "background .15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}>Jootoインポート</button>
            <button onClick={onAdd} style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 13, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 14px rgba(99,102,241,.35)", fontFamily: "'Noto Sans JP',sans-serif", whiteSpace: "nowrap" }}>＋ 新規プロジェクト</button>
          </div>
        </div>
        {filtered.length === 0 && <div style={{ textAlign: "center", color: "#c7d2fe", fontSize: 14, marginTop: 60 }}>プロジェクトがありません</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
          {filtered.map((p) => {
            const counts = taskCounts[p.id] || { total: 0, done: 0, dueToday: 0 };
            return (
              <div key={p.id} onClick={() => onSelect(p.id)}
                style={{ background: "#fff", borderRadius: 16, padding: "20px", boxShadow: "0 2px 12px rgba(99,102,241,.08)", border: "1.5px solid #e0e7ff", cursor: "pointer", transition: "box-shadow .18s,transform .12s", position: "relative" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 28px rgba(99,102,241,.18)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 12px rgba(99,102,241,.08)"; (e.currentTarget as HTMLDivElement).style.transform = ""; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: p.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{p.name[0]}</div>
                  {editingId === p.id
                    ? <input autoFocus value={nameVal} onChange={(e) => setNameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { onRename(p.id, nameVal || p.name); setEditingId(null); } }}
                      onBlur={() => { onRename(p.id, nameVal || p.name); setEditingId(null); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flex: 1, fontWeight: 700, fontSize: 14, border: "1.5px solid #6366f1", borderRadius: 8, padding: "4px 8px", outline: "none", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }} />
                    : <span style={{ fontWeight: 700, fontSize: 14, color: "#1e1b4b", flex: 1, lineHeight: 1.3 }}>{p.name}</span>}
                </div>
                {counts.total > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}><span>進捗</span><span>{counts.done}/{counts.total}</span></div>
                    <div style={{ height: 4, background: "#e0e7ff", borderRadius: 4 }}>
                      <div style={{ height: "100%", width: `${counts.total > 0 ? Math.round(counts.done / counts.total * 100) : 0}%`, background: "#10b981", borderRadius: 4 }} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#94a3b8" }}>今日が期限のタスク {counts.dueToday}件</div>
                <div style={{ position: "absolute", top: 14, right: 14, display: "flex", gap: 4 }}>
                  <button onClick={(e) => { e.stopPropagation(); setEditingId(p.id); setNameVal(p.name); }} title="名前を変更" style={{ background: "none", border: "none", cursor: "pointer", color: "#c7d2fe", fontSize: 13, padding: "2px 4px", borderRadius: 6 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#6366f1")} onMouseLeave={(e) => (e.currentTarget.style.color = "#c7d2fe")}>✏️</button>
                  <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`「${p.name}」をまるごと複製しますか？\n\nカラム・タスクがすべてコピーされます。`)) onDuplicate(p.id); }} title="複製" style={{ background: "none", border: "none", cursor: "pointer", color: "#c7d2fe", fontSize: 13, padding: "2px 4px", borderRadius: 6 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#8b5cf6")} onMouseLeave={(e) => (e.currentTarget.style.color = "#c7d2fe")}>📋</button>
                  {<button onClick={(e) => { e.stopPropagation(); if (window.confirm(`「${p.name}」を削除しますか？\n\nタスク・カラム・メンバー情報もすべて削除されます。\nこの操作は元に戻せません。`)) onDelete(p.id); }} title="削除" style={{ background: "none", border: "none", cursor: "pointer", color: "#c7d2fe", fontSize: 13, padding: "2px 4px", borderRadius: 6 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#c7d2fe")}>🗑</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── BoardView (Access Control Wrapper) ────────────────────────────────────────────────────────────────────────────────────
function BoardView({ project, onBack }: { project: ProjectType; onBack: () => void }) {
  const utils = trpc.useUtils();
  const restrictionQuery = trpc.projectAccess.hasRestriction.useQuery({ projectId: project.id });
  const sessionQuery = trpc.projectAccess.getSession.useQuery({ projectId: project.id });
  const logoutProject = trpc.projectAccess.logout.useMutation({
    onSuccess: () => utils.projectAccess.getSession.invalidate({ projectId: project.id }),
  });

  const isRestricted = restrictionQuery.data?.restricted ?? false;
  const projectSession = sessionQuery.data;
  const canEdit = !isRestricted || projectSession?.role === "editor";

  if (restrictionQuery.isLoading || sessionQuery.isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans JP',sans-serif", color: "#6366f1" }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (isRestricted && !projectSession) {
    return (
      <ProjectLoginModal
        projectId={project.id}
        projectName={project.name}
        onSuccess={() => utils.projectAccess.getSession.invalidate({ projectId: project.id })}
        onCancel={onBack}
      />
    );
  }


  return (
    <BoardViewInner
      project={project}
      onBack={onBack}
      canEdit={canEdit}
      isRestricted={isRestricted}
      projectSession={projectSession ?? null}
      onLogout={() => logoutProject.mutate({ projectId: project.id })}
    />
  );
}

function BoardViewInner({ project, onBack, canEdit, isRestricted, projectSession, onLogout }: {
  project: ProjectType; onBack: () => void;
  canEdit: boolean; isRestricted: boolean;
  projectSession: { name: string; role: string; isAdmin?: boolean } | null;
  onLogout: () => void;
}) {
  const utils = trpc.useUtils();

  // DB queries
  const colsQuery = trpc.column.list.useQuery({ projectId: project.id });
  const tasksQuery = trpc.task.list.useQuery({ projectId: project.id });
  const webhookQuery = trpc.setting.get.useQuery({ key: `webhook_url_${project.id}` });
  const membersQuery = trpc.setting.get.useQuery({ key: `members_${project.id}` });

  const cols: Col[] = (colsQuery.data || []).map((c: any) => ({ id: c.id, title: c.title, color: c.color, sortOrder: c.sortOrder }));
  const tasks: TaskType[] = (tasksQuery.data || []).map((t: any) => ({ ...t, tags: t.tags || [], subtasks: t.subtasks || [] }));
  const webhookUrl = webhookQuery.data?.value || "";
  const members: string[] = useMemo(() => { try { return JSON.parse(membersQuery.data?.value || "null") || DEFAULT_MEMBERS; } catch { return DEFAULT_MEMBERS; } }, [membersQuery.data]);

  // Mutations
  const createCol = trpc.column.create.useMutation({ onSuccess: () => utils.column.list.invalidate({ projectId: project.id }) });
  const updateCol = trpc.column.update.useMutation({ onSuccess: () => utils.column.list.invalidate({ projectId: project.id }) });
  const deleteColMut = trpc.column.delete.useMutation({
    onSuccess: () => {
      utils.column.list.invalidate({ projectId: project.id });
      utils.task.list.invalidate({ projectId: project.id });
    },
    onError: (err) => alert("削除に失敗しました: " + err.message),
  });
  const createTask = trpc.task.create.useMutation({ onSuccess: () => utils.task.list.invalidate({ projectId: project.id }) });
  const updateTask = trpc.task.update.useMutation({
    onMutate: async (vars) => {
      await utils.task.list.cancel({ projectId: project.id });
      const prev = utils.task.list.getData({ projectId: project.id });
      utils.task.list.setData({ projectId: project.id }, (old) =>
        old ? old.map((t: any) => t.id === vars.id ? { ...t, ...vars } : t) : old
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.task.list.setData({ projectId: project.id }, ctx.prev);
    },
    onSettled: () => utils.task.list.invalidate({ projectId: project.id }),
  });
  const createComment = trpc.comment.create.useMutation({ onSuccess: (_d, vars) => utils.comment.list.invalidate({ taskId: vars.taskId }) });
  const deleteTask = trpc.task.delete.useMutation({ onSuccess: () => utils.task.list.invalidate({ projectId: project.id }) });
  const setSetting = trpc.setting.set.useMutation({ onSuccess: () => { utils.setting.get.invalidate(); } });

  const [modal, setModal] = useState<{ defaultCol: string } | null>(null);
  const [search, setSearch] = useState("");
  const [filterMember, setFM] = useState("all");
  const [ghost, setGhost] = useState<{ task: TaskType; x: number; y: number } | null>(null);
  const [dropTarget, setDT] = useState<{ col: string; index: number } | null>(null);
  const [draggingId, setDId] = useState<string | null>(null);
  // カラムのドラッグ＆ドロップ状態
  const [colDraggingId, setColDraggingId] = useState<string | null>(null);
  const [colDragOverId, setColDragOverId] = useState<string | null>(null);
  const onColDragStart = (colId: string) => { setColDraggingId(colId); };
  const onColDragOver = (colId: string) => { if (colId !== colDraggingId) setColDragOverId(colId); };
  const onColDrop = () => {
    if (!colDraggingId || !colDragOverId || colDraggingId === colDragOverId) {
      setColDraggingId(null); setColDragOverId(null); return;
    }
    const sorted = [...cols].sort((a, b) => a.sortOrder - b.sortOrder);
    const fromIdx = sorted.findIndex((c) => c.id === colDraggingId);
    const toIdx = sorted.findIndex((c) => c.id === colDragOverId);
    if (fromIdx === -1 || toIdx === -1) { setColDraggingId(null); setColDragOverId(null); return; }
    const newOrder = [...sorted];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    newOrder.forEach((c, i) => { updateCol.mutate({ id: c.id, sortOrder: i }); });
    setColDraggingId(null); setColDragOverId(null);
  };
  const [detailTask, setDetailTask] = useState<TaskType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // URLパラメータからタスクを自動オープン
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("task");
    if (taskId && tasks.length > 0) {
      const found = tasks.find((t) => t.id === taskId);
      if (found) setDetailTask(found);
    }
  }, [tasks.length]);

  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef({ active: false, taskId: "", moved: false, startX: 0, startY: 0 });
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const [activeColIndex, setActiveColIndex] = useState(0);

  // スクロールインジケーター更新
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const colWidth = el.scrollWidth / (cols.length || 1);
      const idx = Math.round(el.scrollLeft / colWidth);
      setActiveColIndex(Math.min(idx, cols.length - 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [cols.length]);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressReadyRef = useRef(false); // 長押し完了フラグ

  const filtered = tasks.filter((t) => (!search || t.title.includes(search)) && (filterMember === "all" || t.assignee === filterMember));
  const doneColIds = cols.filter((c) => c.title === "完了").map((c) => c.id);
  const colTasks = (colId: string) => {
    const list = filtered.filter((t) => t.colId === colId);
    // 完了カラムは新しい順（sortOrder降順）、それ以外は昇順
    if (doneColIds.includes(colId)) {
      return list.sort((a, b) => b.sortOrder - a.sortOrder);
    }
    // 完了以外：期限超過を最優先、その後sortOrder昇順
    const todayMs = new Date(new Date().toDateString()).getTime();
    const isOverdue = (t: TaskType) => {
      if (!t.due) return false;
      const d = new Date(t.due.replace(/\//g, "-"));
      return !isNaN(d.getTime()) && d.getTime() < todayMs;
    };
    return list.sort((a, b) => {
      const aOver = isOverdue(a) ? 0 : 1;
      const bOver = isOverdue(b) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return a.sortOrder - b.sortOrder;
    });
  };

  const addCol = () => {
    const id = "col" + Date.now();
    createCol.mutate({ id, projectId: project.id, title: "新しい列", color: COL_COLORS[cols.length % COL_COLORS.length], sortOrder: cols.length });
  };
  const updateColTitle = (id: string, title: string) => updateCol.mutate({ id, title });
  const deleteCol = (id: string) => {
    const colTitle = cols.find((c) => c.id === id)?.title || "この列";
    const taskCount = tasks.filter((t) => t.colId === id).length;
    const msg = taskCount > 0
      ? `「${colTitle}」を削除しますか？\n\n${taskCount}件のタスクも一緒に削除されます。\nこの操作は元に戻せません。`
      : `「${colTitle}」を削除しますか？`;
    if (!window.confirm(msg)) return;
    deleteColMut.mutate({ id });
  };

  const computeTarget = useCallback((x: number, y: number) => {
    let hovCol: string | null = null;
    for (const [id, el] of Object.entries(colRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hovCol = id; break; }
    }
    if (!hovCol) return null;
    const cTasks = tasks.filter((t) => t.colId === hovCol && t.id !== dragRef.current.taskId).sort((a, b) => a.sortOrder - b.sortOrder);
    let idx = cTasks.length;
    for (let i = 0; i < cTasks.length; i++) {
      const el = cardRefs.current[cTasks[i].id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) { idx = i; break; }
    }
    return { col: hovCol, index: idx };
  }, [tasks]);

  const onPointerDown = useCallback((e: React.PointerEvent, task: TaskType) => {
    if ((e as unknown as MouseEvent).button !== undefined && (e as unknown as MouseEvent).button !== 0) return;
    const isTouch = e.pointerType === "touch";
    dragRef.current = { active: false, taskId: task.id, moved: false, startX: e.clientX, startY: e.clientY };
    longPressReadyRef.current = false;

    const startDrag = (startX: number, startY: number) => {
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragRef.current.active && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          dragRef.current.active = true;
          dragRef.current.moved = true;
          setDId(task.id);
        }
        if (dragRef.current.active) {
          setGhost({ task, x: ev.clientX, y: ev.clientY });
          setDT(computeTarget(ev.clientX, ev.clientY));
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        if (dragRef.current.active) {
          const target = computeTarget(ev.clientX, ev.clientY);
          if (target) {
            const reordered = reorder(tasks, task.id, target.col, target.index);
            reordered.filter((t) => t.colId === target.col).forEach((t) => {
              updateTask.mutate({ id: t.id, colId: t.colId, sortOrder: t.sortOrder });
            });
          }
        }
        setGhost(null); setDT(null); setDId(null);
        dragRef.current.active = false;
        longPressReadyRef.current = false;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    };

    if (isTouch) {
      // タッチ: 長押し500msでドラッグ開始
      longPressTimerRef.current = setTimeout(() => {
        longPressReadyRef.current = true;
        dragRef.current.active = true;
        dragRef.current.moved = true;
        setDId(task.id);
        setGhost({ task, x: dragRef.current.startX, y: dragRef.current.startY });
        // バイブレーション（対応デバイスのみ）
        if (navigator.vibrate) navigator.vibrate(50);
        startDrag(dragRef.current.startX, dragRef.current.startY);
      }, 500);
      // 長押し前に指が動いたらキャンセル（スクロール優先）
      const cancelLongPress = (ev: PointerEvent) => {
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
          document.removeEventListener("pointermove", cancelLongPress);
          document.removeEventListener("pointerup", cancelOnUp);
        }
      };
      const cancelOnUp = () => {
        if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
        document.removeEventListener("pointermove", cancelLongPress);
        document.removeEventListener("pointerup", cancelOnUp);
      };
      document.addEventListener("pointermove", cancelLongPress);
      document.addEventListener("pointerup", cancelOnUp);
    } else {
      // マウス: 従来通り即座にドラッグ開始
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    }
  }, [computeTarget, tasks]);

  const onCardClick = useCallback((task: TaskType) => { if (!dragRef.current.moved) setDetailTask(task); dragRef.current.moved = false; }, []);

  const saveTask = (form: { title: string; colId: string; assignee: string; priority: string; due: string; tags: string[]; createdBy?: string }) => {
    // 新規タスクをsortOrder=0で作成し、既存タスクを全て+1ずらして先頭に表示
    const colList = tasks.filter((t) => t.colId === form.colId);
    colList.forEach((t) => { updateTask.mutate({ id: t.id, sortOrder: t.sortOrder + 1 }); });
    createTask.mutate({ id: uid(), projectId: project.id, colId: form.colId, title: form.title, assignee: form.assignee, priority: form.priority, due: form.due || null, tags: form.tags, sortOrder: 0, createdBy: form.createdBy || undefined });
    // Google Chat通知
    if (webhookUrl && form.assignee) {
      const colName = cols.find((c) => c.id === form.colId)?.title || "";
      const priorityLabel = form.priority === "high" ? "🔴 高" : form.priority === "medium" ? "🟡 中" : "🟢 低";
      const chatText = [
        `━━━━━━━━━━━━━━━━━━━━`,
        `👤 *担当者：${form.assignee}* へのタスク通知`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📋 *${form.title}*`,
        ``,
        `📂 カラム：${colName}`,
        `⚡ 優先度：${priorityLabel}`,
        form.due ? `📅 期限：${form.due}` : null,
        ``,
        `${form.assignee} タスクが割り当てられました`,
        `🔗 ${window.location.origin}?project=${project.id}`,
        `━━━━━━━━━━━━━━━━━━━━`,
      ].filter(Boolean).join("\n");
      fetch("/api/gchat-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, text: chatText }),
      }).catch(() => {});
    }
    setModal(null);
  };

  const onUpdateField = useCallback((taskId: string, field: string, value: unknown) => {
    updateTask.mutate({ id: taskId, [field]: value });
    setDetailTask((prev) => prev && prev.id === taskId ? { ...prev, [field]: value } : prev);
  }, []);

  const onUpdateSubtasks = useCallback((taskId: string, subtasks: Subtask[]) => {
    updateTask.mutate({ id: taskId, subtasks });
  }, []);

  const onUpdateDescription = useCallback((taskId: string, description: string) => {
    updateTask.mutate({ id: taskId, description });
  }, []);

  const onAddComment = useCallback((taskId: string, comment: CommentType) => {
    createComment.mutate({ taskId, author: comment.author, text: comment.text });
  }, []);

  const onComplete = useCallback((task: TaskType) => {
    // 「完了」タイトルのカラムIDを動的に取得
    const doneCol = cols.find((c) => c.title === "完了") || cols.find((c) => c.id === "done");
    if (!doneCol) {
      // 完了カラムがない場合は作成してから移動
      const newDoneColId = "col_done_" + Date.now();
      createCol.mutate(
        { id: newDoneColId, projectId: project.id, title: "完了", color: "#10b981", sortOrder: cols.length },
        { onSuccess: () => {
          // 完了カラムの既存タスクの最大sortOrderを取得して+1（一番上＝最大値）
          const doneTasks = utils.task.list.getData({ projectId: project.id })?.filter((t: any) => t.colId === newDoneColId) || [];
          const maxOrder = doneTasks.length > 0 ? Math.max(...doneTasks.map((t: any) => t.sortOrder)) : 0;
          // 楽観的にUIを即更新
          utils.task.list.setData({ projectId: project.id }, (old: any) =>
            old ? old.map((t: any) => t.id === task.id ? { ...t, colId: newDoneColId, prevCol: task.colId, sortOrder: maxOrder + 1 } : t) : old
          );
          updateTask.mutate({ id: task.id, colId: newDoneColId, prevCol: task.colId, sortOrder: maxOrder + 1 });
        }}
      );
      return;
    }
    // 完了カラムの既存タスクの最大sortOrderを取得して+1（一番上＝最大値）
    const doneTasks = utils.task.list.getData({ projectId: project.id })?.filter((t: any) => t.colId === doneCol.id) || [];
    const maxOrder = doneTasks.length > 0 ? Math.max(...doneTasks.map((t: any) => t.sortOrder)) : 0;
    const newSortOrder = maxOrder + 1;
    // 楽観的にUIを即更新（完了カラムに移動＋sortOrder更新）
    utils.task.list.setData({ projectId: project.id }, (old: any) =>
      old ? old.map((t: any) => t.id === task.id ? { ...t, colId: doneCol.id, prevCol: task.colId, sortOrder: newSortOrder } : t) : old
    );
    // サーバーに保存（バックグラウンド）
    updateTask.mutate({ id: task.id, colId: doneCol.id, prevCol: task.colId, sortOrder: newSortOrder });
  }, [cols, project, utils]);

  const onRevert = useCallback((task: TaskType) => {
    updateTask.mutate({ id: task.id, colId: task.prevCol || "todo", prevCol: null });
  }, []);

  const handleSaveSettings = (url: string, newMembers: string[]) => {
    setSetting.mutate({ key: `webhook_url_${project.id}`, value: url });
    setSetting.mutate({ key: `members_${project.id}`, value: JSON.stringify(newMembers) });
    setShowSettings(false);
  };

  if (colsQuery.isLoading || tasksQuery.isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans JP',sans-serif", color: "#6366f1" }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "linear-gradient(135deg,#f0f0ff 0%,#faf5ff 50%,#f0fdf4 100%)", fontFamily: "'Noto Sans JP',sans-serif", userSelect: draggingId ? "none" : "auto", overflow: "hidden" }}>
      {ghost && <Ghost task={ghost.task} x={ghost.x} y={ghost.y} />}
      <div style={{ background: "rgba(255,255,255,.9)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(99,102,241,.12)", padding: "0 12px", minHeight: 54, display: "flex", alignItems: "center", gap: 8, flexShrink: 0, zIndex: 500, overflowX: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties} className="hide-scrollbar">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontSize: 13, fontWeight: 700, fontFamily: "'Noto Sans JP',sans-serif", display: "flex", alignItems: "center", gap: 4, flexShrink: 0, padding: "4px 8px", borderRadius: 8, transition: "background .15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>← 一覧</button>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: project.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{project.name[0]}</div>
        <span style={{ fontWeight: 800, fontSize: 14, color: "#1e1b4b", flexShrink: 0 }}>{project.name}</span>
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8", pointerEvents: "none" }}>🔍</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="検索..."
            style={{ width: "100%", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 10px 7px 30px", fontSize: 13, outline: "none", boxSizing: "border-box", background: "#f8f7ff", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
            onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />
        </div>
        <select value={filterMember} onChange={(e) => setFM(e.target.value)} style={{ flexShrink: 0, border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 10px", fontSize: 12, outline: "none", background: "#f8f7ff", fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}>
          <option value="all">全員</option>
          {members.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {isRestricted && projectSession && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1.5px solid #6ee7b7", borderRadius: 10, padding: "5px 10px" }}>
            <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700 }}>
              {projectSession.role === "editor" ? "✏️" : "👁"} {projectSession.name}
            </span>
            <button onClick={onLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 11, padding: 0, fontFamily: "'Noto Sans JP',sans-serif" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")} onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}>発退</button>
          </div>
        )}
        <button onClick={async (e) => {
            const btn = e.currentTarget;
            btn.style.transform = "rotate(360deg)";
            btn.style.transition = "transform 0.5s ease";
            setTimeout(() => { btn.style.transform = ""; btn.style.transition = "background .15s"; }, 600);
            await utils.column.list.invalidate({ projectId: project.id });
            await utils.task.list.invalidate({ projectId: project.id });
          }} title="更新" style={{ flexShrink: 0, background: "#f8f7ff", color: "#6366f1", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 11px", fontSize: 15, cursor: "pointer", transition: "background .15s" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "#f8f7ff")}>🔄</button>
        <button onClick={() => setShowHelp(true)} title="使い方" style={{ flexShrink: 0, background: "#f8f7ff", color: "#6366f1", border: "1.5px solid #e0e7ff", borderRadius: 10, padding: "7px 11px", fontSize: 15, cursor: "pointer", fontWeight: 800 }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ede9fe")} onMouseLeave={(e) => (e.currentTarget.style.background = "#f8f7ff")}>?</button>
        <button onClick={() => setShowSettings(true)} style={{ flexShrink: 0, background: webhookUrl ? "#f0fdf4" : "#f8f7ff", color: webhookUrl ? "#10b981" : "#94a3b8", border: `1.5px solid ${webhookUrl ? "#6ee7b7" : "#e0e7ff"}`, borderRadius: 10, padding: "7px 11px", fontSize: 15, cursor: "pointer" }}>⚙️</button>
        {canEdit && <button onClick={addCol} style={{ flexShrink: 0, background: "#fff", color: "#6366f1", border: "1.5px solid #6366f1", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "'Noto Sans JP',sans-serif" }}>＋ 列</button>}
      </div>
      <div ref={boardScrollRef} style={{ padding: "18px 14px", display: "flex", gap: 14, overflowX: "auto", alignItems: "flex-start", WebkitOverflowScrolling: "touch", scrollSnapType: "x proximity", scrollBehavior: "smooth", flex: 1, minHeight: 0, paddingBottom: 32 } as React.CSSProperties} className="board-scrollbar">
        {cols.map((col) => (
          <ColumnComp key={col.id} col={col} tasks={colTasks(col.id)} draggingId={draggingId} dropTarget={dropTarget} members={members}
            doneColIds={doneColIds}
            onPointerDown={onPointerDown} onCardClick={onCardClick} onComplete={onComplete} onRevert={onRevert} onComment={setDetailTask}
            onUpdateField={onUpdateField} onAddTask={(colId) => setModal({ defaultCol: colId })} onUpdateColTitle={updateColTitle} onDeleteCol={deleteCol}
            colRef={(el) => { colRefs.current[col.id] = el; }} cardRefs={cardRefs}
            onColDragStart={onColDragStart} onColDragOver={onColDragOver} onColDrop={onColDrop} colDraggingId={colDraggingId} />
        ))}
      </div>
      {/* スクロールインジケーター（ドット）—スマホ向け */}
      {cols.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, padding: "6px 0 10px", flexShrink: 0 }}>
          {cols.map((_, i) => (
            <button
              key={i}
              onClick={() => {
                const el = boardScrollRef.current;
                if (!el) return;
                const colWidth = el.scrollWidth / cols.length;
                el.scrollTo({ left: colWidth * i, behavior: "smooth" });
              }}
              style={{
                width: i === activeColIndex ? 20 : 8,
                height: 8,
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                padding: 0,
                background: i === activeColIndex ? "#6366f1" : "#c7d2fe",
                transition: "width .25s, background .25s",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
      {modal && <AddTaskModal defaultCol={modal.defaultCol} cols={cols} members={members} currentUser={projectSession?.name || members[0] || ""} onClose={() => setModal(null)} onSave={saveTask} />}
      {detailTask && <TaskDetailModal task={tasks.find((t) => t.id === detailTask.id) || detailTask} cols={cols} webhookUrl={webhookUrl} members={members} projectId={project.id} onClose={() => setDetailTask(null)} onAddComment={onAddComment} onUpdateSubtasks={onUpdateSubtasks} onUpdateDescription={onUpdateDescription} onUpdateField={onUpdateField} onDeleteTask={canEdit ? (id) => deleteTask.mutate({ id }) : undefined} />}
      {showSettings && <SettingsModal webhookUrl={webhookUrl} members={members} projectId={project.id} currentUserIsAdmin={projectSession?.isAdmin ?? !isRestricted} isPublic={(project as any).isPublic ?? false} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function TaskBoardApp() {
  const utils = trpc.useUtils();
  const projectsQuery = trpc.project.list.useQuery();
  const projects: ProjectType[] = projectsQuery.data || [];

  const createProject = trpc.project.create.useMutation({ onSuccess: () => utils.project.list.invalidate() });
  const updateProject = trpc.project.update.useMutation({ onSuccess: () => utils.project.list.invalidate() });
  const deleteProject = trpc.project.delete.useMutation({ onSuccess: () => utils.project.list.invalidate() });
  const duplicateProject = trpc.project.duplicate.useMutation({ onSuccess: () => utils.project.list.invalidate() });

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAssigneeView, setShowAssigneeView] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  // URLパラメータからプロジェクトを自動選択
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    if (projectId) setCurrentProjectId(projectId);
  }, []);

  const createColumn = trpc.column.create.useMutation({ onSuccess: () => utils.column.list.invalidate() });

  const addProject = async (name: string, color: string) => {
    const id = "p" + Date.now();
    await createProject.mutateAsync({ id, name, color });
    // Create default columns
    for (const col of INIT_COLS) {
      await createColumn.mutateAsync({ id: col.id + "_" + id, projectId: id, title: col.title, color: col.color, sortOrder: col.sortOrder });
    }
    setCurrentProjectId(id);
    setShowAddProject(false);
  };

  const handleDelete = (id: string) => { deleteProject.mutate({ id }); };
  const handleRename = (id: string, name: string) => { updateProject.mutate({ id, name }); };
  const handleDuplicate = (id: string) => { duplicateProject.mutate({ id }); };

  // Task counts for project list
  const [taskCounts, setTaskCounts] = useState<Record<string, { total: number; done: number; dueToday: number }>>({});

  useEffect(() => {
    const fetchCounts = async () => {
      const counts: Record<string, { total: number; done: number; dueToday: number }> = {};
      const today = new Date().toISOString().slice(0, 10);
      for (const p of projects) {
        try {
          const taskList = await utils.task.list.fetch({ projectId: p.id });
          const colList = await utils.column.list.fetch({ projectId: p.id });
          const doneColIds = colList.filter((c: any) => c.title === "完了").map((c: any) => c.id);
          counts[p.id] = {
            total: taskList.length,
            done: taskList.filter((t: any) => doneColIds.includes(t.colId)).length,
            dueToday: taskList.filter((t: any) => t.due === today).length,
          };
        } catch { counts[p.id] = { total: 0, done: 0, dueToday: 0 }; }
      }
      setTaskCounts(counts);
    };
    if (projects.length > 0) fetchCounts();
  }, [projects]);

  if (projectsQuery.isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Noto Sans JP',sans-serif", color: "#6366f1" }}>
        <p>読み込み中...</p>
      </div>
    );
  }

  if (currentProject) {
    return <BoardView project={currentProject} onBack={() => setCurrentProjectId(null)} />;
  }

  if (showAssigneeView) {
    return <AssigneeView onBack={() => setShowAssigneeView(false)} />;
  }

  return (
    <>
      <ProjectList projects={projects} taskCounts={taskCounts} onSelect={setCurrentProjectId} onAdd={() => setShowAddProject(true)} onImport={() => setShowImport(true)} onDelete={handleDelete} onRename={handleRename} onRefresh={async () => { await utils.project.list.invalidate(); await utils.task.list.invalidate(); await utils.column.list.invalidate(); }} onDuplicate={handleDuplicate} onShowAssigneeView={() => setShowAssigneeView(true)} />
      {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} onSave={addProject} existingCount={projects.length} />}
      {showImport && <ImportModal onClose={() => { setShowImport(false); utils.project.list.invalidate(); }} onImported={(pid: string) => { setShowImport(false); utils.project.list.invalidate(); setCurrentProjectId(pid); }} />}
    </>
  );
}
