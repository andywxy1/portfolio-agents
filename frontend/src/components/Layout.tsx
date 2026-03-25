import { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { useActiveAnalysisJob } from '../hooks/useActiveAnalysis';
import { apiClient } from '../api/client';

// Fix #8: Breadcrumb label mapping
const ROUTE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/holdings': 'Holdings',
  '/analysis': 'Analysis Results',
  '/recommendations': 'Recommendations',
  '/history': 'History',
  '/setup': 'Settings',
};

function getBreadcrumbLabel(pathname: string): string {
  // Exact match first
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  // Dynamic routes
  if (pathname.startsWith('/analysis/progress/')) return 'Live Analysis';
  // Fallback: capitalize last segment
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export function Layout() {
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const activeJobId = useActiveAnalysisJob();
  const location = useLocation();

  // Fix #9: Health check query - polls every 30s, shows banner on failure
  const healthQuery = useQuery<{ status: string }>({
    queryKey: ['health'],
    queryFn: () => apiClient.get<{ status: string }>('/health'),
    refetchInterval: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const backendDown = healthQuery.isError;

  // Close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Reset banner dismissed state when active job changes
  useEffect(() => {
    setBannerDismissed(false);
  }, [activeJobId]);

  // Show analysis banner when a job is active and we're not already on the live page
  const isOnLivePage = activeJobId ? location.pathname.includes(`/analysis/progress/${activeJobId}`) : false;
  const showAnalysisBanner = !!activeJobId && !bannerDismissed && !isOnLivePage;

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  // Fix #8: Breadcrumb data
  const currentLabel = getBreadcrumbLabel(location.pathname);
  const isHome = location.pathname === '/';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - responsive (Item 18) */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={closeSidebar} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header with hamburger */}
        <header className="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
          <button
            onClick={toggleSidebar}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-600 font-bold text-sm">
              P
            </div>
            <span className="text-sm font-semibold text-gray-900">Portfolio Agents</span>
          </div>
        </header>

        {/* Fix #9: Backend-down banner */}
        {backendDown && (
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
            <svg className="h-4 w-4 flex-shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm font-medium text-red-800">
              Cannot connect to server. Check that the backend is running.
            </p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['health'] })}
              className="ml-2 flex-shrink-0 rounded-md bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 transition-colors"
            >
              Retry now
            </button>
          </div>
        )}

        {/* Active analysis banner */}
        {showAnalysisBanner && (
          <div className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <p className="text-sm text-emerald-800 truncate">
                Analysis in progress
              </p>
              <Link
                to={`/analysis/progress/${activeJobId}`}
                className="flex-shrink-0 text-sm font-semibold text-emerald-700 underline underline-offset-2 hover:text-emerald-900 transition-colors"
              >
                View Live Dashboard
              </Link>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="flex-shrink-0 rounded p-0.5 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
              aria-label="Dismiss analysis notification"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Fix #8: Breadcrumb bar */}
        {!isHome && (
          <nav className="border-b border-gray-200 bg-white px-4 py-2 text-sm" aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-gray-500">
              <li>
                <Link to="/" className="hover:text-gray-700 transition-colors">Dashboard</Link>
              </li>
              <li aria-hidden="true">
                <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </li>
              <li>
                <span className="font-medium text-gray-900" aria-current="page">{currentLabel}</span>
              </li>
            </ol>
          </nav>
        )}

        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
