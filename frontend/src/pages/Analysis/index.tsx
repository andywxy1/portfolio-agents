import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { usePositionAnalyses, useStartAnalysis } from '../../api/hooks';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonReportPanel, Skeleton } from '../../components/Skeleton';
import { SignalBadge, JobStatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import { formatCurrency, formatPnlPercent, pnlColor, formatRelativeTime } from '../../utils/format';
import { renderMarkdown, parseReport } from '../../utils/markdown';
import type { PositionAnalysis } from '../../types';

// ---------------------------------------------------------------------------
// Tab definitions for report sections
// ---------------------------------------------------------------------------

interface ReportTab {
  key: string;
  label: string;
  icon: string;
}

const REPORT_TABS: ReportTab[] = [
  { key: 'trade_decision', label: 'Final Decision', icon: 'verdict' },
  { key: 'market_report', label: 'Market Analysis', icon: 'market' },
  { key: 'sentiment_report', label: 'Sentiment', icon: 'sentiment' },
  { key: 'news_report', label: 'News', icon: 'news' },
  { key: 'fundamentals_report', label: 'Fundamentals', icon: 'fundamentals' },
  { key: 'investment_debate', label: 'Investment Debate', icon: 'debate' },
  { key: 'risk_debate', label: 'Risk Assessment', icon: 'risk' },
  { key: 'investment_plan', label: 'Investment Plan', icon: 'plan' },
];

// ---------------------------------------------------------------------------
// Tab icon component
// ---------------------------------------------------------------------------

function TabIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'verdict':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'market':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      );
    case 'sentiment':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
        </svg>
      );
    case 'news':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
        </svg>
      );
    case 'fundamentals':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'debate':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
        </svg>
      );
    case 'risk':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
    case 'plan':
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Scroll-fade sidebar wrapper (Fix #3)
// ---------------------------------------------------------------------------

function ScrollFadeSidebar({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const hasMore = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
      setShowBottomFade(hasMore);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={ref} className="absolute inset-0 overflow-y-auto space-y-1 pr-1">
        {children}
      </div>
      {showBottomFade && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-50 to-transparent" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Render JSON objects as readable key-value pairs (Fix #7)
// ---------------------------------------------------------------------------

function renderJsonFallback(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? '');
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const label = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') {
      parts.push(`## ${label}\n\n${val}`);
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      parts.push(`**${label}:** ${String(val)}`);
    } else if (Array.isArray(val)) {
      const items = val.map(v => typeof v === 'string' ? `- ${v}` : `- ${JSON.stringify(v)}`).join('\n');
      parts.push(`## ${label}\n\n${items}`);
    } else if (typeof val === 'object') {
      // Nested object: render as sub-section key-value pairs
      const subParts: string[] = [];
      for (const [sk, sv] of Object.entries(val as Record<string, unknown>)) {
        const subLabel = sk.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (sv === null || sv === undefined) continue;
        if (typeof sv === 'string' || typeof sv === 'number' || typeof sv === 'boolean') {
          subParts.push(`**${subLabel}:** ${String(sv)}`);
        } else {
          subParts.push(`**${subLabel}:** ${JSON.stringify(sv)}`);
        }
      }
      parts.push(`## ${label}\n\n${subParts.join('\n\n')}`);
    }
  }
  return parts.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function Analysis() {
  usePageTitle('Analysis');
  const navigate = useNavigate();
  const toast = useToast();
  const { data: analyses, isLoading, error } = usePositionAnalyses();
  const analysisMutation = useStartAnalysis();
  const [searchParams] = useSearchParams();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(
    searchParams.get('ticker')
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [reanalyzingTicker, setReanalyzingTicker] = useState<string | null>(null);

  const handleReanalyze = useCallback((ticker: string) => {
    setReanalyzingTicker(ticker);
    analysisMutation.mutate(
      { mode: 'single', ticker },
      {
        onSuccess: (result) => {
          setReanalyzingTicker(null);
          toast.info(`Re-analysis started for ${ticker}`);
          navigate(`/analysis/progress/${result.job_id}`);
        },
        onError: (err) => {
          setReanalyzingTicker(null);
          toast.error(`Analysis failed: ${err.message}`);
        },
      }
    );
  }, [analysisMutation, navigate, toast]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
        <div className="w-64 flex-shrink-0 space-y-2">
          <Skeleton className="h-4 w-20 mb-3" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
        <div className="flex-1 space-y-6">
          <SkeletonReportPanel />
          <SkeletonReportPanel />
          <SkeletonReportPanel />
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Analysis</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800">Failed to load analysis: {error.message}</p>
        </div>
      </div>
    );
  }

  // Defensive: ensure analyses is always an array
  const analysesList = Array.isArray(analyses) ? analyses : [];

  // Empty state (Fix #17)
  if (analysesList.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">AI-powered position analysis results</p>
        </div>
        <EmptyState
          title="Run an analysis from the Holdings page to see results here"
          description="Go to Holdings and click Run Analysis to get AI-powered insights on your positions."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      </div>
    );
  }

  // Filter by search (Fix #6)
  const filteredAnalyses = searchQuery.trim()
    ? analysesList.filter(a => a.ticker.toLowerCase().includes(searchQuery.toLowerCase()))
    : analysesList;

  const selected = analysesList.find(a => a.ticker === selectedTicker) ?? analysesList[0];

  return (
    <>
      {/* Mobile position selector (Fix #2) */}
      <div className="md:hidden mb-4">
        <label htmlFor="mobile-position-select" className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Select position
        </label>
        <select
          id="mobile-position-select"
          value={selected.ticker}
          onChange={(e) => setSelectedTicker(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          {analysesList.map(a => (
            <option key={a.ticker} value={a.ticker}>
              {a.ticker} - {formatCurrency(a.current_price)} {a.signal ? `(${a.signal})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Fix #1: flex-1 min-h-0 overflow-hidden instead of h-[calc(100vh-3rem)] */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-6">
        {/* Left sidebar - position list (hidden on mobile, Fix #2) */}
        <div className="hidden md:flex w-64 flex-shrink-0 flex-col min-h-0">
          <h2 className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Positions</h2>

          {/* Search input (Fix #6) */}
          <div className="relative mb-2">
            <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Filter by ticker..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Scrollable list with fade indicator (Fix #3) */}
          <ScrollFadeSidebar>
            {filteredAnalyses.length === 0 ? (
              <p className="px-2 py-4 text-xs text-gray-400 text-center">No positions match "{searchQuery}"</p>
            ) : (
              filteredAnalyses.map(a => (
                <button
                  key={a.ticker}
                  onClick={() => setSelectedTicker(a.ticker)}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                    selected.ticker === a.ticker
                      ? 'bg-white shadow-sm ring-1 ring-gray-200'
                      : 'hover:bg-white/60'
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{a.ticker}</p>
                    <p className="text-xs text-gray-500">{formatCurrency(a.current_price)}</p>
                  </div>
                  {a.signal && <SignalBadge signal={a.signal} />}
                </button>
              ))
            )}
          </ScrollFadeSidebar>
        </div>

        {/* Right panel - detail */}
        <div className="flex-1 overflow-y-auto space-y-6">
          <AnalysisDetail
            analysis={selected}
            onReanalyze={handleReanalyze}
            isReanalyzing={reanalyzingTicker === selected.ticker}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Helper: get renderable markdown content for a report tab key (Fix #7)
// ---------------------------------------------------------------------------

function getReportContent(analysis: PositionAnalysis, key: string): string {
  let raw: unknown;
  switch (key) {
    case 'trade_decision':
      raw = analysis.raw_decision;
      break;
    case 'market_report':
      raw = analysis.market_report;
      break;
    case 'sentiment_report':
      raw = analysis.sentiment_report;
      break;
    case 'news_report':
      raw = analysis.news_report;
      break;
    case 'fundamentals_report':
      raw = analysis.fundamentals_report;
      break;
    case 'investment_debate':
      raw = analysis.investment_debate;
      break;
    case 'risk_debate':
      raw = analysis.risk_debate;
      break;
    case 'investment_plan':
      raw = analysis.investment_plan;
      break;
    default:
      return '';
  }

  const parsed = parseReport(raw);

  // Fix #7: If parseReport returned JSON.stringify output, render it better
  if (parsed.startsWith('{') || parsed.startsWith('[')) {
    try {
      const obj = JSON.parse(parsed);
      if (typeof obj === 'object' && obj !== null) {
        return renderJsonFallback(obj);
      }
    } catch {
      // not valid JSON, just return as-is
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Detail panel with tabbed reports
// ---------------------------------------------------------------------------

function AnalysisDetail({
  analysis,
  onReanalyze,
  isReanalyzing,
}: {
  analysis: PositionAnalysis;
  onReanalyze: (ticker: string) => void;
  isReanalyzing: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>('trade_decision');

  const availableTabs = REPORT_TABS.filter(tab => {
    const content = getReportContent(analysis, tab.key);
    return content.trim().length > 0;
  });

  // If current active tab has no content, fall back to first available
  const resolvedTab = availableTabs.find(t => t.key === activeTab)
    ? activeTab
    : (availableTabs[0]?.key ?? 'trade_decision');

  const currentContent = getReportContent(analysis, resolvedTab);

  return (
    <div className="space-y-6">
      {/* Header (Fix #4 & #5: links to Recommendations and History) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold text-gray-900">{analysis.ticker}</h1>
        {analysis.signal && <SignalBadge signal={analysis.signal} />}
        <JobStatusBadge status={analysis.status} />
        <span className="text-sm text-gray-500 capitalize">
          {analysis.analysis_depth} analysis
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/history"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            View History
          </Link>
          <button
            onClick={() => onReanalyze(analysis.ticker)}
            disabled={isReanalyzing}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {isReanalyzing ? 'Starting...' : 'Re-analyze'}
          </button>
        </div>
      </div>

      {/* Price info */}
      <div className="flex gap-6">
        <div>
          <p className="text-xs text-gray-500">Current Price</p>
          <p className="text-lg font-semibold tabular-nums">{formatCurrency(analysis.current_price)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Price Change</p>
          <p className={`text-lg font-semibold tabular-nums ${pnlColor(analysis.price_change_pct)}`}>
            {formatPnlPercent(analysis.price_change_pct)}
          </p>
        </div>
        {analysis.completed_at && (
          <div>
            <p className="text-xs text-gray-500">Analyzed</p>
            <p className="text-sm text-gray-600">{formatRelativeTime(analysis.completed_at)}</p>
          </div>
        )}
      </div>

      {/* Report tabs and content */}
      {availableTabs.length > 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {/* Tab bar */}
          <div className="border-b border-gray-200 bg-gray-50/50">
            <nav className="flex overflow-x-auto" aria-label="Report sections">
              {availableTabs.map(tab => {
                const isActive = tab.key === resolvedTab;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                      isActive
                        ? 'border-indigo-500 text-indigo-700 bg-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    aria-selected={isActive}
                    role="tab"
                  >
                    <TabIcon icon={tab.icon} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tab content */}
          <div className="px-6 py-5">
            {currentContent ? (
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(currentContent, 'light') }}
              />
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                No content available for this section.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No report data available yet. Reports will appear once the analysis completes.
          </p>
        </div>
      )}

      {/* Fix #4: Link to Recommendations */}
      <div className="flex justify-end">
        <Link
          to="/recommendations"
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          View Recommendations
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
