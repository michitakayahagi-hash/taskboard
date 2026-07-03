import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import TaskBoardApp from "./pages/TaskBoardApp";
import { InvitePage } from "./pages/InvitePage";
import RoadmapView from "./pages/RoadmapView";

function App() {
  // Simple client-side routing for invite page
  const [page, setPage] = useState<"board" | "roadmap">("board");
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
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
