import { useParams, useNavigate } from 'react-router-dom';
import { useAnalysisJob } from '../../api/hooks';
import { usePageTitle } from '../../hooks/usePageTitle';
import { JobStatusBadge, SignalBadge } from '../../components/StatusBadge';
import { formatRelativeTime } from '../../utils/format';
import { useEffect, useRef } from 'react';
import { useToast } from '../../components/Toast';

export default function AnalysisProgress() {
  usePageTitle('Analysis Progress');
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: job, isLoading, isError, error } = useAnalysisJob(jobId);

  // Track which statuses we've already shown a toast for (Fix 8)
  const toastedStatusRef = useRef<string | null>(null);

  // Notify on completion - only fire once per terminal status
  useEffect(() => {
    if (!job) return;
    const status = job.status;
    if (toastedStatusRef.current === status) return;
    if (status === 'completed') {
      toastedStatusRef.current = status;
      toast.success(`Analysis completed - ${job.completed_tickers} positions analyzed`);
    } else if (status === 'failed') {
      toastedStatusRef.current = status;
      toast.error(`Analysis failed: ${job.error_message ?? 'Unknown error'}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Analysis Progress</h1>
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-emerald-500" />
            <p className="text-sm text-gray-500">Loading job status...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Analysis Progress</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800">
            {error?.message ?? 'Could not load analysis job.'}
          </p>
          <button
            onClick={() => navigate('/holdings')}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
          >
            Back to Holdings
          </button>
        </div>
      </div>
    );
  }

  const progress = job.total_tickers > 0
    ? Math.round((job.completed_tickers / job.total_tickers) * 100)
    : 0;

  const isRunning = job.status === 'pending' || job.status === 'running';
  const isComplete = job.status === 'completed';
  const isFailed = job.status === 'failed';

  const modeLabel = job.mode === 'all_individual'
    ? 'Full Analysis (All Positions)'
    : job.mode === 'single'
    ? `Single Ticker: ${job.tickers[0] ?? ''}`
    : 'Portfolio Analysis';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analysis Progress</h1>
        <p className="mt-1 text-sm text-gray-500">
          {modeLabel} -- {job.total_tickers} position{job.total_tickers !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Status card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        {/* Status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <JobStatusBadge status={job.status} />
            <span className="text-sm text-gray-600">
              {isRunning && 'In progress...'}
              {isComplete && 'All positions analyzed'}
              {isFailed && 'Analysis failed'}
            </span>
          </div>
          {job.created_at && (
            <span className="text-xs text-gray-400">Started {formatRelativeTime(job.created_at)}</span>
          )}
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {job.completed_tickers} of {job.total_tickers} complete
            </span>
            <span className="text-sm font-semibold text-gray-900">{progress}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isFailed
                  ? 'bg-red-500'
                  : isComplete
                  ? 'bg-emerald-500'
                  : 'bg-blue-500 animate-progress-pulse'
              }`}
              style={{ width: `${Math.max(progress, isRunning ? 3 : 0)}%` }}
            />
          </div>
        </div>

        {/* Per-ticker status */}
        {job.tickers.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ticker Progress</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {job.tickers.map(ticker => {
                const pa = job.position_analyses?.find(p => p.ticker === ticker);
                const tickerDone = pa?.status === 'completed';
                const tickerFailed = pa?.status === 'failed';
                const tickerRunning = pa?.status === 'running';
                return (
                  <div
                    key={ticker}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      tickerDone
                        ? 'border-emerald-200 bg-emerald-50'
                        : tickerFailed
                        ? 'border-red-200 bg-red-50'
                        : tickerRunning
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <span className="font-semibold text-gray-900">{ticker}</span>
                    <span>
                      {tickerDone && pa?.signal ? (
                        <SignalBadge signal={pa.signal} />
                      ) : tickerDone ? (
                        <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : tickerFailed ? (
                        <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      ) : tickerRunning ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                      ) : (
                        <span className="text-xs text-gray-400">Pending</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error message */}
        {isFailed && job.error_message && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{job.error_message}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-center gap-3">
        {isComplete && (
          <button
            onClick={() => navigate('/analysis')}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
          >
            View Results
          </button>
        )}
        {isFailed && (
          <button
            onClick={() => navigate('/holdings')}
            className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
          >
            Retry from Holdings
          </button>
        )}
        {!isRunning && (
          <button
            onClick={() => navigate('/holdings')}
            className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Back to Holdings
          </button>
        )}
        {isRunning && (
          <p className="text-sm text-gray-400">Analysis is running. This page updates automatically.</p>
        )}
      </div>
    </div>
  );
}
