import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePositionAnalyses, useStartAnalysis } from '../../api/hooks';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonReportPanel, Skeleton } from '../../components/Skeleton';
import { SignalBadge, JobStatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import { formatCurrency, formatPnlPercent, pnlColor, formatRelativeTime } from '../../utils/format';
import type { PositionAnalysis } from '../../types';

export default function Analysis() {
  usePageTitle('Analysis');
  const navigate = useNavigate();
  const toast = useToast();
  const { data: analyses, isLoading, error } = usePositionAnalyses();
  const analysisMutation = useStartAnalysis();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const handleReanalyze = useCallback((ticker: string) => {
    analysisMutation.mutate(
      { mode: 'single', ticker },
      {
        onSuccess: (result) => {
          toast.info(`Re-analysis started for ${ticker}`);
          navigate(`/analysis/progress/${result.job_id}`);
        },
        onError: (err) => {
          toast.error(`Analysis failed: ${err.message}`);
        },
      }
    );
  }, [analysisMutation, navigate, toast]);

  // Loading skeleton (Item 8)
  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] gap-6">
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

  // Error state (Item 9)
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

  // Empty state (Item 14)
  if (analysesList.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analysis</h1>
          <p className="mt-1 text-sm text-gray-500">AI-powered position analysis results</p>
        </div>
        <EmptyState
          title="No analysis has been run yet"
          description="Go to Holdings and click Run Analysis to get AI-powered insights on your positions."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      </div>
    );
  }

  const selected = analysesList.find(a => a.ticker === selectedTicker) ?? analysesList[0];

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-6">
      {/* Left sidebar - position list */}
      <div className="w-64 flex-shrink-0 space-y-1 overflow-y-auto">
        <h2 className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Positions</h2>
        {analysesList.map(a => (
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
        ))}
      </div>

      {/* Right panel - detail */}
      <div className="flex-1 overflow-y-auto space-y-6">
        <AnalysisDetail
          analysis={selected}
          onReanalyze={handleReanalyze}
          isReanalyzing={analysisMutation.isPending}
        />
      </div>
    </div>
  );
}

function AnalysisDetail({
  analysis,
  onReanalyze,
  isReanalyzing,
}: {
  analysis: PositionAnalysis;
  onReanalyze: (ticker: string) => void;
  isReanalyzing: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{analysis.ticker}</h1>
        {analysis.signal && <SignalBadge signal={analysis.signal} />}
        <JobStatusBadge status={analysis.status} />
        <span className="text-sm text-gray-500 capitalize">
          {analysis.analysis_depth} analysis
        </span>
        <button
          onClick={() => onReanalyze(analysis.ticker)}
          disabled={isReanalyzing}
          className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {isReanalyzing ? 'Starting...' : 'Re-analyze'}
        </button>
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

      {/* Raw Decision */}
      {analysis.raw_decision && (
        <CollapsibleSection title="Final Decision" defaultOpen>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{analysis.raw_decision}</p>
        </CollapsibleSection>
      )}

      {/* Investment Debate */}
      {analysis.investment_debate && (
        <CollapsibleSection title="Investment Debate" defaultOpen>
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Bull Case</h4>
              <p className="text-sm text-gray-700">{analysis.investment_debate.bull_case}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Bear Case</h4>
              <p className="text-sm text-gray-700">{analysis.investment_debate.bear_case}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Judge Decision</h4>
              <p className="text-sm text-gray-700">{analysis.investment_debate.judge_decision}</p>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Risk Assessment */}
      {analysis.risk_debate && (
        <CollapsibleSection title="Risk Assessment">
          <div className="space-y-4">
            <div>
              <h4 className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">Aggressive View</h4>
              <p className="text-sm text-gray-700">{analysis.risk_debate.aggressive_view}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Conservative View</h4>
              <p className="text-sm text-gray-700">{analysis.risk_debate.conservative_view}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Neutral View</h4>
              <p className="text-sm text-gray-700">{analysis.risk_debate.neutral_view}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-1">Judge Decision</h4>
              <p className="text-sm text-gray-700">{analysis.risk_debate.judge_decision}</p>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Market Report */}
      {analysis.market_report && (
        <CollapsibleSection title="Market Report">
          <ReportContent data={analysis.market_report} />
        </CollapsibleSection>
      )}

      {/* Sentiment Report */}
      {analysis.sentiment_report && (
        <CollapsibleSection title="Sentiment Report">
          <ReportContent data={analysis.sentiment_report} />
        </CollapsibleSection>
      )}

      {/* News Report */}
      {analysis.news_report && (
        <CollapsibleSection title="News Report">
          <ReportContent data={analysis.news_report} />
        </CollapsibleSection>
      )}

      {/* Fundamentals Report */}
      {analysis.fundamentals_report && (
        <CollapsibleSection title="Fundamentals Report">
          <ReportContent data={analysis.fundamentals_report} />
        </CollapsibleSection>
      )}

      {/* Investment Plan */}
      {analysis.investment_plan && (
        <CollapsibleSection title="Investment Plan">
          <ReportContent data={analysis.investment_plan} />
        </CollapsibleSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && <div className="border-t border-gray-100 px-6 py-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report Content renderer (for generic JSON report data)
// ---------------------------------------------------------------------------

function ReportContent({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <p className="text-xs font-medium text-gray-500 capitalize">{key.replace(/_/g, ' ')}</p>
          <div className="mt-0.5 text-sm text-gray-700">
            {typeof value === 'string' ? (
              <p className="whitespace-pre-wrap">{value}</p>
            ) : Array.isArray(value) ? (
              <ul className="list-disc list-inside space-y-0.5">
                {value.map((item, i) => (
                  <li key={i}>{String(item)}</li>
                ))}
              </ul>
            ) : (
              <p className="font-mono text-xs">{JSON.stringify(value, null, 2)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
