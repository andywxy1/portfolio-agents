import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { OnboardingGuide } from './components/OnboardingGuide';
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from './components/LoadingSpinner';
import { useConfigStatus } from './api/hooks';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Holdings = lazy(() => import('./pages/Holdings'));
const Analysis = lazy(() => import('./pages/Analysis'));
const AnalysisLive = lazy(() => import('./pages/AnalysisLive'));
const Recommendations = lazy(() => import('./pages/Recommendations'));
const History = lazy(() => import('./pages/History'));
const Setup = lazy(() => import('./pages/Setup'));
const NotFound = lazy(() => import('./pages/NotFound'));

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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoadingSpinner size="lg" label="Loading configuration..." />
      </div>
    );
  }

  // If we can't reach the backend, show the main app anyway (graceful degradation)
  const needsSetup = !isError && configStatus && !configStatus.configured;

  return (
    <>
    {/* Only show onboarding when configured (not during setup wizard) */}
    <OnboardingGuide configured={configStatus?.configured === true} />
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
            path="analysis/progress/:jobId"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <AnalysisLive />
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
          <Route
            path="*"
            element={
              <Suspense fallback={<LoadingSpinner />}>
                <NotFound />
              </Suspense>
            }
          />
        </Route>
      )}
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ErrorBoundary>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  );
}
