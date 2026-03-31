/**
 * ImportModal - Jooto CSVインポートモーダル
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";

export default function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (projectId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ projectId: string; taskCount: number; columnCount: number; columns: string[]; members: string[] } | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMut = trpc.import.jootoCSV.useMutation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError("");
      if (!projectName) {
        const name = f.name.replace(/\.csv$/i, "").replace(/jooto_\d+_\d+/, "").trim();
        setProjectName(name || "Jootoインポート");
      }
    }
  };

  const handleImport = async () => {
    if (!file || !projectName.trim()) return;
    setImporting(true);
    setError("");
    try {
      const text = await file.text();
      const res = await importMut.mutateAsync({ projectName: projectName.trim(), csvContent: text });
      setResult({ projectId: res.projectId, taskCount: res.taskCount, columnCount: res.columnCount, columns: res.columns, members: res.members });
    } catch (err: any) {
      setError(err.message || "インポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,10,40,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(3px)", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && !importing && onClose()}>
      <div style={{ background: "#fff", borderRadius: 20, padding: "26px 22px", width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(99,102,241,.22)", fontFamily: "'Noto Sans JP',sans-serif" }}>
        {!result ? (
          <>
            <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>Jooto CSV インポート</h2>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 18px", lineHeight: 1.5 }}>
              JootoからエクスポートしたCSVファイルを選択してください。<br/>
              リスト名がカラム、タスクがカードとしてインポートされます。
            </p>

            {/* File select */}
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} style={{ display: "none" }} />
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{ border: "2px dashed #c7d2fe", borderRadius: 12, padding: "20px", textAlign: "center", cursor: "pointer", marginBottom: 16, transition: "border-color .15s, background .15s", background: file ? "#f0fdf4" : "#f8f7ff" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#6366f1"; (e.currentTarget as HTMLDivElement).style.background = "#ede9fe"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#c7d2fe"; (e.currentTarget as HTMLDivElement).style.background = file ? "#f0fdf4" : "#f8f7ff"; }}>
              {file ? (
                <div>
                  <p style={{ margin: 0, fontSize: 24 }}>&#x1F4C4;</p>
                  <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 700, color: "#1e1b4b" }}>{file.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p style={{ margin: 0, fontSize: 28 }}>&#x1F4C1;</p>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "#94a3b8" }}>クリックしてCSVファイルを選択</p>
                </div>
              )}
            </div>

            {/* Project name */}
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6366f1", marginBottom: 4 }}>プロジェクト名 *</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="インポート先のプロジェクト名"
              style={{ width: "100%", border: "2px solid #e0e7ff", borderRadius: 10, padding: "9px 11px", fontSize: 13, outline: "none", boxSizing: "border-box", marginBottom: 16, fontFamily: "'Noto Sans JP',sans-serif", color: "#1e1b4b" }}
              onFocus={(e) => (e.target.style.borderColor = "#6366f1")} onBlur={(e) => (e.target.style.borderColor = "#e0e7ff")} />

            {error && <p style={{ fontSize: 12, color: "#ef4444", margin: "0 0 12px", padding: "8px 12px", background: "#fef2f2", borderRadius: 8 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} disabled={importing} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>キャンセル</button>
              <button onClick={handleImport} disabled={!file || !projectName.trim() || importing}
                style={{ background: (file && projectName.trim() && !importing) ? "#6366f1" : "#c7d2fe", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", cursor: (file && projectName.trim() && !importing) ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif", boxShadow: (file && projectName.trim() && !importing) ? "0 4px 12px rgba(99,102,241,.35)" : "none", display: "flex", alignItems: "center", gap: 6 }}>
                {importing ? (
                  <>
                    <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    インポート中...
                  </>
                ) : "インポート"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <p style={{ margin: 0, fontSize: 40 }}>&#x2705;</p>
              <h2 style={{ margin: "8px 0 6px", fontSize: 16, fontWeight: 800, color: "#1e1b4b" }}>インポート完了！</h2>
              <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>「{projectName}」を作成しました</p>
            </div>
            <div style={{ background: "#f8f7ff", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: "#94a3b8" }}>カラム数</span>
                <span style={{ fontWeight: 700, color: "#1e1b4b" }}>{result.columnCount}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: "#94a3b8" }}>タスク数</span>
                <span style={{ fontWeight: 700, color: "#1e1b4b" }}>{result.taskCount}</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: result.members.length > 0 ? 8 : 0 }}>
                <span style={{ fontWeight: 600 }}>カラム: </span>{result.columns.join(" → ")}
              </div>
              {result.members.length > 0 && (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  <span style={{ fontWeight: 600 }}>担当者: </span>{result.members.join("、")}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif" }}>閉じる</button>
              <button onClick={() => onImported(result.projectId)} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", cursor: "pointer", fontWeight: 800, fontSize: 12, fontFamily: "'Noto Sans JP',sans-serif", boxShadow: "0 4px 12px rgba(99,102,241,.35)" }}>プロジェクトを開く</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
