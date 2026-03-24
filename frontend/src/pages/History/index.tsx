import { useState } from 'react';
import { useAnalysisHistory, usePnlHistory } from '../../api/hooks';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { JobStatusBadge, SignalBadge } from '../../components/StatusBadge';
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

export default function History() {
  const { data: jobs, isLoading: jobsLoading } = useAnalysisHistory();
  const { data: pnlHistory, isLoading: pnlLoading } = usePnlHistory();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  if (jobsLoading || pnlLoading) return <LoadingSpinner label="Loading history..." />;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">History</h1>
        <p className="mt-1 text-sm text-gray-500">Past analysis runs and portfolio performance over time</p>
      </div>

      {/* P&L Timeline Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Portfolio Value Over Time</h2>
        {!pnlHistory || pnlHistory.length === 0 ? (
          <EmptyState title="No historical data" />
        ) : (
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
                  domain={['dataMin - 5000', 'dataMax + 5000']}
                />
                <Tooltip
                  contentStyle={{ borderRadius: '8px', fontSize: '13px', border: '1px solid #e5e7eb' }}
                  formatter={(value: unknown) => [formatCurrency(value as number), 'Value']}
                  labelFormatter={(label: unknown) => formatDate(String(label))}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#colorValue)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* P&L Timeline */}
      {pnlHistory && pnlHistory.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">P&L Over Time</h2>
          <div className="h-56">
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
        </div>
      )}

      {/* Analysis Job History */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Analysis Runs</h2>
        {!jobs || jobs.length === 0 ? (
          <EmptyState title="No analysis history" description="Run an analysis from the Holdings page." />
        ) : (
          <div className="space-y-3">
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                isExpanded={expandedJob === job.id}
                onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({
  job,
  isExpanded,
  onToggle,
}: {
  job: AnalysisJob;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
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
            {job.tickers.slice(0, 5).map(t => (
              <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                {t}
              </span>
            ))}
            {job.tickers.length > 5 && (
              <span className="text-xs text-gray-400">+{job.tickers.length - 5}</span>
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

      {isExpanded && job.position_analyses && (
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
