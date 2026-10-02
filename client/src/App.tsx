import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import TaskBoardApp from "./pages/TaskBoardApp";
import { InvitePage } from "./pages/InvitePage";
import RoadmapView from "./pages/RoadmapView";

function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const returnTo = params.get("next")?.startsWith("/") ? params.get("next")! : "/";
  const errorText = error === "domain"
    ? "@b-bloom.jp・@b-noix.jp、または許可済みの外部Googleアカウントでログインしてください。"
    : error === "configuration"
    ? "Googleログインの設定を確認してください。"
    : error === "state" || error === "authentication"
    ? "ログインを完了できませんでした。もう一度お試しください。"
    : "";

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <main style={{ width: "100%", maxWidth: 430, background: "#fff", borderRadius: 20, padding: "38px 32px", boxShadow: "0 20px 60px rgba(79, 70, 229, .18)", textAlign: "center" }}>
        <div style={{ width: 50, height: 50, borderRadius: 14, background: "#6366f1", color: "#fff", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800 }}>T</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 22, color: "#1e1b4b" }}>TaskBoard</h1>
        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#64748b", lineHeight: 1.8 }}>@b-bloom.jp・@b-noix.jp、または許可済みの外部Googleアカウントでログインしてください。</p>
        {errorText && <p style={{ margin: "0 0 16px", padding: "9px 12px", background: "#fff5f5", color: "#dc2626", borderRadius: 8, fontSize: 12, lineHeight: 1.6 }}>{errorText}</p>}
        <button
          type="button"
          onClick={() => { window.location.href = `/api/auth/google/login?next=${encodeURIComponent(returnTo)}`; }}
          style={{ width: "100%", border: "none", borderRadius: 10, padding: "12px 18px", cursor: "pointer", background: "#fff", color: "#1e1b4b", fontSize: 14, fontWeight: 800, boxShadow: "0 2px 10px rgba(30,27,75,.16)", outline: "1px solid #e2e8f0", fontFamily: "'Noto Sans JP', sans-serif" }}
        >Google Workspaceでログイン</button>
      </main>
    </div>
  );
}

function AccountMenu({ user }: { user: { name: string | null; email: string | null } }) {
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => { window.location.href = "/login"; },
  });
  return (
    <div style={{ position: "fixed", right: 16, top: 12, zIndex: 100, display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 10px", background: "rgba(255,255,255,.95)", border: "1px solid #e0e7ff", borderRadius: 10, boxShadow: "0 2px 10px rgba(79,70,229,.1)", fontFamily: "'Noto Sans JP', sans-serif" }}>
      <div style={{ minWidth: 0, textAlign: "right", lineHeight: 1.25 }}>
        <div style={{ maxWidth: 175, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 700, color: "#1e1b4b" }}>{user.name || "Google Workspace"}</div>
        <div style={{ maxWidth: 175, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "#64748b" }}>{user.email}</div>
      </div>
      <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} style={{ border: "none", background: "#f1f5f9", color: "#64748b", cursor: "pointer", borderRadius: 7, padding: "5px 8px", fontSize: 10, fontWeight: 700, fontFamily: "'Noto Sans JP', sans-serif" }}>{logout.isPending ? "..." : "ログアウト"}</button>
    </div>
  );
}

function AppContent() {
  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const path = window.location.pathname;
  const inviteMatch = path.match(/^\/invite\/([^/]+)$/);
  const initParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<"board" | "roadmap">("board");
  const [pendingProject, setPendingProject] = useState<string | null>(initParams.get("project"));
  const [pendingTask, setPendingTask] = useState<string | null>(initParams.get("task"));

  if (authQuery.isLoading) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "'Noto Sans JP', sans-serif", fontSize: 14 }}>認証状態を確認中...</div>;
  }
  if (!authQuery.data) return <LoginPage />;

  return (
    <>
      <AccountMenu user={authQuery.data} />
      {inviteMatch ? (
        <InvitePage token={inviteMatch[1]} />
      ) : page === "roadmap" ? (
        <RoadmapView onBack={() => setPage("board")} onNavigateToTask={(projectId, taskId) => { setPendingProject(projectId); setPendingTask(taskId); setPage("board"); }} />
      ) : (
        <TaskBoardApp onOpenRoadmap={() => setPage("roadmap")} pendingProjectId={pendingProject} pendingTaskId={pendingTask} onPendingConsumed={() => { setPendingProject(null); setPendingTask(null); }} />
      )}
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
