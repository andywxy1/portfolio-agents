import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAnalysisHistory, usePnlHistory } from '../../api/hooks';
import { Skeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { JobStatusBadge, SignalBadge } from '../../components/StatusBadge';
import { usePageTitle } from '../../hooks/usePageTitle';
import { formatDate, formatDateTime, formatRelativeTime, formatCurrency, formatPnl } from '../../utils/format';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts';
import type { AnalysisJob } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOBS_PER_PAGE = 10;

type DateFilter = '7d' | '30d' | 'all';
type ChartMode = 'value' | 'pnl';

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function History() {
  usePageTitle('History');
  const navigate = useNavigate();
  const { data: jobs, isLoading: jobsLoading, error: jobsError } = useAnalysisHistory();
  const { data: pnlHistory, isLoading: pnlLoading, error: pnlError } = usePnlHistory();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Fix #15: Pagination and date filter state
  const [currentPage, setCurrentPage] = useState(0);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  // Fix #16: Combined chart toggle
  const [chartMode, setChartMode] = useState<ChartMode>('value');

  // Fix #13: Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<Set<string>>(new Set());

  // Defensive: ensure jobs is always an array
  const jobsList = Array.isArray(jobs) ? jobs : [];

  // Fix #15: Filter by date range
  const filteredJobs = useMemo(() => {
    if (dateFilter === 'all') return jobsList;
    const now = Date.now();
    const cutoff = dateFilter === '7d' ? now - 7 * 86400000 : now - 30 * 86400000;
    return jobsList.filter(j => new Date(j.created_at).getTime() >= cutoff);
  }, [jobsList, dateFilter]);

  // Fix #15: Paginate
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const paginatedJobs = filteredJobs.slice(
    currentPage * JOBS_PER_PAGE,
    (currentPage + 1) * JOBS_PER_PAGE
  );

  // Fix #13: Compare toggle handler
  const toggleCompare = (jobId: string) => {
    setCompareSelection(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else if (next.size < 2) {
        next.add(jobId);
      }
      return next;
    });
  };

  const compareIds = Array.from(compareSelection);
  const compareJobA = jobsList.find(j => j.id === compareIds[0]);
  const compareJobB = jobsList.find(j => j.id === compareIds[1]);

  // Fully empty state (Fix #17)
  if (!jobsLoading && !pnlLoading && jobsList.length === 0 && (!pnlHistory || pnlHistory.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">History</h1>
          <p className="mt-1 text-sm text-gray-500">Past analysis runs and portfolio performance over time</p>
        </div>
        <EmptyState
          title="Your analysis history will build up over time"
          description="Go to Holdings and click Run Analysis to start building your history."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">History</h1>
        <p className="mt-1 text-sm text-gray-500">Past analysis runs and portfolio performance over time</p>
      </div>

      {/* Fix #16: Combined chart with toggle */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">
            {chartMode === 'value' ? 'Portfolio Value Over Time' : 'P&L Over Time'}
          </h2>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setChartMode('value')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                chartMode === 'value'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Portfolio Value
            </button>
            <button
              onClick={() => setChartMode('pnl')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
                chartMode === 'pnl'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              P&L
            </button>
          </div>
        </div>
        {pnlLoading ? (
          <div className="h-72 flex items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        ) : pnlError ? (
          <div className="h-72 flex items-center justify-center">
            <p className="text-sm text-red-600">Failed to load chart data</p>
          </div>
        ) : !pnlHistory || pnlHistory.length === 0 ? (
          <div className="h-72 flex items-center justify-center">
            <p className="text-sm text-gray-400">No historical data yet</p>
          </div>
        ) : chartMode === 'value' ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pnlHistory} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  domain={[(dataMin: number) => dataMin - Math.max(1000, Math.abs(dataMin) * 0.1), (dataMax: number) => dataMax + Math.max(1000, Math.abs(dataMax) * 0.1)]}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', fontSize: '13px', border: '1px solid #e5e7eb' }}
                  formatter={(value: unknown) => [formatCurrency(value as number), 'Value']}
                  labelFormatter={(label: unknown) => formatDate(String(label))}
                />
                <Area
                  type="monotone"
                  dataKey="total_value"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlHistory} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: string) => {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', fontSize: '13px', border: '1px solid #e5e7eb' }}
                  formatter={(value: unknown) => [formatPnl(value as number), 'P&L']}
                  labelFormatter={(label: unknown) => formatDate(String(label))}
                />
                <Line type="monotone" dataKey="pnl" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Analysis Job History */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Analysis Runs</h2>
          <div className="flex items-center gap-2">
            {/* Fix #15: Date range filter */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {([['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => { setDateFilter(val); setCurrentPage(0); setExpandedJob(null); }}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    dateFilter === val
                      ? 'bg-slate-900 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  } ${val !== '7d' ? 'border-l border-gray-200' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Fix #13: Compare toggle */}
            <button
              onClick={() => {
                setCompareMode(!compareMode);
                setCompareSelection(new Set());
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                compareMode
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {compareMode ? 'Exit Compare' : 'Compare'}
            </button>
          </div>
        </div>

        {/* Fix #13: Compare hint */}
        {compareMode && (
          <p className="text-xs text-gray-500 mb-3">
            Select 2 analysis runs to compare. {compareSelection.size}/2 selected.
          </p>
        )}

        {/* Fix #13: Comparison panel */}
        {compareMode && compareJobA && compareJobB && (
          <ComparePanel jobA={compareJobA} jobB={compareJobB} />
        )}

        {jobsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-6 w-20 rounded-md" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : jobsError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm text-red-700">Failed to load analysis history</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <EmptyState title="No analysis history" description="No runs match the selected date range." />
        ) : (
          <>
            <div className="space-y-3">
              {paginatedJobs.map(job => (
                <JobCard
                  key={job.id}
                  job={job}
                  isExpanded={expandedJob === job.id}
                  onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                  compareMode={compareMode}
                  isSelected={compareSelection.has(job.id)}
                  onCompareToggle={() => toggleCompare(job.id)}
                />
              ))}
            </div>

            {/* Fix #15: Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-xs text-gray-500">
                  Showing {currentPage * JOBS_PER_PAGE + 1}-{Math.min((currentPage + 1) * JOBS_PER_PAGE, filteredJobs.length)} of {filteredJobs.length} runs
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                    disabled={currentPage === 0}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={currentPage >= totalPages - 1}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job card (Fix #14: link to full analysis)
// ---------------------------------------------------------------------------

function JobCard({
  job,
  isExpanded,
  onToggle,
  compareMode,
  isSelected,
  onCompareToggle,
}: {
  job: AnalysisJob;
  isExpanded: boolean;
  onToggle: () => void;
  compareMode: boolean;
  isSelected: boolean;
  onCompareToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border bg-white overflow-hidden transition-colors ${
      isSelected ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200'
    }`}>
      <div className="flex w-full items-center">
        {/* Fix #13: Compare checkbox */}
        {compareMode && (
          <div className="flex items-center pl-4">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onCompareToggle}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              aria-label={`Select run from ${formatDateTime(job.created_at)} for comparison`}
            />
          </div>
        )}

        <button
          onClick={onToggle}
          className="flex flex-1 items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-4">
            <JobStatusBadge status={job.status} />
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {job.total_tickers} position{job.total_tickers !== 1 ? 's' : ''} analyzed
              </p>
              <p className="text-xs text-gray-500">
                {formatDateTime(job.created_at)} ({formatRelativeTime(job.created_at)})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {(job.tickers ?? []).slice(0, 5).map(t => (
                <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                  {t}
                </span>
              ))}
              {(job.tickers ?? []).length > 5 && (
                <span className="text-xs text-gray-400">+{(job.tickers ?? []).length - 5}</span>
              )}
            </div>
            <svg
              className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </div>
        </button>
      </div>

      {isExpanded && Array.isArray(job.position_analyses) && job.position_analyses.length > 0 && (
        <div className="border-t border-gray-100 px-6 py-4">
          <div className="space-y-2">
            {job.position_analyses.map(pa => (
              <div key={pa.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900 w-16">{pa.ticker}</span>
                  {pa.signal && <SignalBadge signal={pa.signal} />}
                  <span className="text-xs text-gray-500 capitalize">{pa.analysis_depth}</span>
                </div>
                <div className="flex items-center gap-3">
                  {pa.current_price && (
                    <span className="text-sm text-gray-600 tabular-nums">{formatCurrency(pa.current_price)}</span>
                  )}
                  <JobStatusBadge status={pa.status} />
                </div>
              </div>
            ))}
          </div>
          {/* Fix #14: Link to full analysis */}
          <div className="mt-3 pt-3 border-t border-gray-100">
            <Link
              to="/analysis"
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              View Full Analysis
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {isExpanded && job.error_message && (
        <div className="border-t border-red-100 bg-red-50 px-6 py-3">
          <p className="text-sm text-red-700">{job.error_message}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare panel (Fix #13)
// ---------------------------------------------------------------------------

function ComparePanel({ jobA, jobB }: { jobA: AnalysisJob; jobB: AnalysisJob }) {
  const analysesA = jobA.position_analyses ?? [];
  const analysesB = jobB.position_analyses ?? [];

  // Gather all unique tickers
  const allTickers = Array.from(new Set([
    ...analysesA.map(a => a.ticker),
    ...analysesB.map(a => a.ticker),
  ])).sort();

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-5 mb-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Run Comparison</h3>

      {/* Header row */}
      <div className="grid grid-cols-3 gap-4 text-xs text-gray-500 font-medium border-b border-gray-200 pb-2">
        <div>Ticker</div>
        <div>
          Run A: {formatDate(jobA.created_at)}
          <span className="ml-1 text-gray-400">({jobA.total_tickers} positions)</span>
        </div>
        <div>
          Run B: {formatDate(jobB.created_at)}
          <span className="ml-1 text-gray-400">({jobB.total_tickers} positions)</span>
        </div>
      </div>

      {/* Comparison rows */}
      {allTickers.map(ticker => {
        const a = analysesA.find(p => p.ticker === ticker);
        const b = analysesB.find(p => p.ticker === ticker);
        const signalChanged = a?.signal !== b?.signal;
        const depthChanged = a?.analysis_depth !== b?.analysis_depth;

        return (
          <div
            key={ticker}
            className={`grid grid-cols-3 gap-4 py-2 text-sm ${
              signalChanged ? 'bg-amber-50 -mx-2 px-2 rounded-lg' : ''
            }`}
          >
            <div className="font-semibold text-gray-900">{ticker}</div>
            <div className="flex items-center gap-2">
              {a ? (
                <>
                  {a.signal ? <SignalBadge signal={a.signal} /> : <span className="text-gray-400">--</span>}
                  <span className="text-xs text-gray-400 capitalize">{a.analysis_depth}</span>
                  {a.current_price != null && (
                    <span className="text-xs text-gray-500 tabular-nums">{formatCurrency(a.current_price)}</span>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-400">Not included</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {b ? (
                <>
                  {b.signal ? <SignalBadge signal={b.signal} /> : <span className="text-gray-400">--</span>}
                  <span className="text-xs text-gray-400 capitalize">{b.analysis_depth}</span>
                  {b.current_price != null && (
                    <span className="text-xs text-gray-500 tabular-nums">{formatCurrency(b.current_price)}</span>
                  )}
                  {signalChanged && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      Changed
                    </span>
                  )}
                  {depthChanged && !signalChanged && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                      Depth changed
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-400">Not included</span>
              )}
            </div>
          </div>
        );
      })}

      {allTickers.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No position data available for comparison.</p>
      )}
    </div>
  );
}
