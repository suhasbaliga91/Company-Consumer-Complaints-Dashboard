import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { DashboardProvider } from '@/components/dashboard-context';
import { Dashboard } from '@/components/dashboard';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

/** Mounts the SSE auto-refresh listener inside the QueryClientProvider. */
function AutoRefreshController() {
  useAutoRefresh();
  return null;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AutoRefreshController />
      <TooltipProvider>
        <DashboardProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </DashboardProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
