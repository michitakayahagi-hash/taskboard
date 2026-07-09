import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import TaskBoardApp from "./pages/TaskBoardApp";
import { InvitePage } from "./pages/InvitePage";
import RoadmapView from "./pages/RoadmapView";

function App() {
  // URLパラメータから task / project を初期値として読み込む
  const _initParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState<"board" | "roadmap">("board");
  const [pendingProject, setPendingProject] = useState<string | null>(_initParams.get("project"));
  const [pendingTask, setPendingTask] = useState<string | null>(_initParams.get("task"));
  const path = window.location.pathname;
  const inviteMatch = path.match(/^\/invite\/([^/]+)$/);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          {inviteMatch ? (
            <InvitePage token={inviteMatch[1]} />
          ) : page === "roadmap" ? (
            <RoadmapView onBack={() => setPage("board")} onNavigateToTask={(projectId, taskId) => { setPendingProject(projectId); setPendingTask(taskId); setPage("board"); }} />
          ) : (
            <TaskBoardApp onOpenRoadmap={() => setPage("roadmap")} pendingProjectId={pendingProject} pendingTaskId={pendingTask} onPendingConsumed={() => { setPendingProject(null); setPendingTask(null); }} />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
