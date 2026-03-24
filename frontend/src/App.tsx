import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from './components/LoadingSpinner';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Holdings = lazy(() => import('./pages/Holdings'));
const Analysis = lazy(() => import('./pages/Analysis'));
const Recommendations = lazy(() => import('./pages/Recommendations'));
const History = lazy(() => import('./pages/History'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
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
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
