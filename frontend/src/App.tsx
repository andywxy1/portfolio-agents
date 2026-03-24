import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from './components/LoadingSpinner';
import { useConfigStatus } from './api/hooks';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Holdings = lazy(() => import('./pages/Holdings'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Recommendations = lazy(() => import('./pages/Recommendations'));
const History = lazy(() => import('./pages/History'));
const Setup = lazy(() => import('./pages/Setup'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  const { data: configStatus, isLoading, isError } = useConfigStatus();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <LoadingSpinner size="lg" label="Loading configuration..." />
      </div>
    );
  }

  // If we can't reach the backend, show the main app anyway (graceful degradation)
  const needsSetup = !isError && configStatus && !configStatus.configured;

  return (
    <Routes>
      {/* Setup route is always accessible (for reconfiguration) */}
      <Route
        path="setup"
        element={
          <Suspense fallback={<LoadingSpinner />}>
            <Setup />
          </Suspense>
        }
      />

      {needsSetup ? (
        // Redirect everything to /setup when not configured
        <Route path="*" element={<Navigate to="/setup" replace />} />
      ) : (
        // Normal app with sidebar layout
        <Route element={<Layout />}>
          <Route
            index
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="holdings"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Holdings />
              </Suspense>
            }
          />
          <Route
            path="analysis"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Analysis />
              </Suspense>
            }
          />
          <Route
            path="recommendations"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <Recommendations />
              </Suspense>
            }
          />
          <Route
            path="history"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <History />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
