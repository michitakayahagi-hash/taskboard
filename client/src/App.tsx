import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import TaskBoardApp from "./pages/TaskBoardApp";
import { InvitePage } from "./pages/InvitePage";

function App() {
  // Simple client-side routing for invite page
  const path = window.location.pathname;
  const inviteMatch = path.match(/^\/invite\/([^/]+)$/);

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          {inviteMatch ? (
            <InvitePage token={inviteMatch[1]} />
          ) : (
            <TaskBoardApp />
          )}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
