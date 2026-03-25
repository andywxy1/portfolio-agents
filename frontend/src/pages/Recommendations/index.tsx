import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useRecommendations, useUpdateRecommendation, useSuggestions } from '../../api/hooks';
import { SkeletonTable, Skeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RecommendationStatusBadge, SideBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  formatCurrency,
  formatPercent,
  formatRelativeTime,
  formatCompactCurrency,
} from '../../utils/format';
import type { Recommendation, StockSuggestion } from '../../types';

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'pending' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Dismissed', value: 'dismissed' },
  { label: 'Expired', value: 'expired' },
];

export default function Recommendations() {
  usePageTitle('Recommendations');
  const navigate = useNavigate();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: recsData, isLoading: recsLoading, error: recsError } = useRecommendations(
    statusFilter ? { status: statusFilter } : undefined
  );
  const { data: suggestions, isLoading: sugLoading, error: sugError } = useSuggestions();
  const updateMutation = useUpdateRecommendation();

  // Confirm dialogs (Fix #7 dismiss + Fix #8 accept)
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);
  const [acceptConfirm, setAcceptConfirm] = useState<string | null>(null);

  // Expanded rationale rows (Fix #10)
  const [expandedRationale, setExpandedRationale] = useState<Set<string>>(new Set());

  const toggleRationale = (id: string) => {
    setExpandedRationale(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const recommendations: Recommendation[] = Array.isArray(recsData?.data) ? recsData.data : [];

  // Defensive: ensure suggestions is always an array
  const suggestionsList = Array.isArray(suggestions) ? suggestions : [];

  // Empty state check (Fix #17)
  const isAllEmpty = !recsLoading && !sugLoading && recommendations.length === 0 && suggestionsList.length === 0 && !statusFilter;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recommendations</h1>
        <p className="mt-1 text-sm text-gray-500">AI-generated order suggestions and new stock ideas</p>
      </div>

      {isAllEmpty ? (
        <EmptyState
          title="Agent recommendations will appear after running an analysis"
          description="Recommendations are generated when you run an analysis on your holdings."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      ) : (
        <>
          {/* Fix #9: Help text explaining Accept/Dismiss */}
          <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <p className="text-xs text-blue-700">
              Accepting marks a recommendation as an action you plan to take. It does not place any orders.
              Dismissing hides it from your pending list. You can review dismissed items later.
            </p>
          </div>

          {/* Active Recommendations */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Order Recommendations</h2>
              <div className="flex gap-1">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f.label}
                    onClick={() => setStatusFilter(f.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      statusFilter === f.value
                        ? 'bg-slate-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {recsLoading ? (
              <SkeletonTable rows={4} columns={9} />
            ) : recsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                <p className="text-sm text-red-700">Failed to load recommendations</p>
              </div>
            ) : recommendations.length === 0 ? (
              <EmptyState title="No recommendations" description="Run an analysis to generate recommendations." />
            ) : (
              <>
                {/* Desktop table (Fix #12: hidden on mobile) */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-8"></th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticker</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Side</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Confidence</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {recommendations.map(rec => (
                        <RecTableRow
                          key={rec.id}
                          rec={rec}
                          isExpanded={expandedRationale.has(rec.id)}
                          onToggle={() => toggleRationale(rec.id)}
                          onAccept={() => setAcceptConfirm(rec.id)}
                          onDismiss={() => setDismissConfirm(rec.id)}
                          isUpdating={updateMutation.isPending}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile card layout (Fix #12) */}
                <div className="md:hidden space-y-3">
                  {recommendations.map(rec => (
                    <RecMobileCard
                      key={rec.id}
                      rec={rec}
                      onAccept={() => setAcceptConfirm(rec.id)}
                      onDismiss={() => setDismissConfirm(rec.id)}
                      isUpdating={updateMutation.isPending}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* New Stock Suggestions */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Stock Suggestions</h2>
            {sugLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-8 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            ) : sugError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                <p className="text-sm text-red-700">Failed to load suggestions</p>
              </div>
            ) : suggestionsList.length === 0 ? (
              <EmptyState title="No suggestions" description="Suggestions are generated during analysis." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {suggestionsList.map(s => (
                  <SuggestionCard key={s.id} suggestion={s} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Accept confirmation (Fix #8) */}
      <ConfirmDialog
        open={acceptConfirm !== null}
        title="Accept Recommendation"
        message="Accept this recommendation? This marks it as an action to take. It does not place any orders."
        confirmLabel="Accept"
        onConfirm={() => {
          if (acceptConfirm) {
            const ticker = recommendations.find(r => r.id === acceptConfirm)?.ticker ?? '';
            updateMutation.mutate(
              { id: acceptConfirm, data: { status: 'accepted' } },
              {
                onSuccess: () => {
                  toast.success(`${ticker} recommendation accepted`);
                  setAcceptConfirm(null);
                },
                onError: () => {
                  toast.error('Failed to accept recommendation');
                  setAcceptConfirm(null);
                },
              }
            );
          }
        }}
        onCancel={() => setAcceptConfirm(null)}
      />

      {/* Dismiss confirmation */}
      <ConfirmDialog
        open={dismissConfirm !== null}
        title="Dismiss Recommendation"
        message="Are you sure you want to dismiss this recommendation? You can review dismissed items later."
        confirmLabel="Dismiss"
        destructive
        onConfirm={() => {
          if (dismissConfirm) {
            const ticker = recommendations.find(r => r.id === dismissConfirm)?.ticker ?? '';
            updateMutation.mutate(
              { id: dismissConfirm, data: { status: 'dismissed' } },
              {
                onSuccess: () => {
                  toast.success(`${ticker} recommendation dismissed`);
                  setDismissConfirm(null);
                },
                onError: () => {
                  toast.error('Failed to dismiss recommendation');
                  setDismissConfirm(null);
                },
              }
            );
          }
        }}
        onCancel={() => setDismissConfirm(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop table row with inline expandable rationale (Fix #10, #11)
// ---------------------------------------------------------------------------

function RecTableRow({
  rec,
  isExpanded,
  onToggle,
  onAccept,
  onDismiss,
  isUpdating,
}: {
  rec: Recommendation;
  isExpanded: boolean;
  onToggle: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  isUpdating: boolean;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        {/* Expand chevron */}
        <td className="px-4 py-3">
          <button
            onClick={onToggle}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={isExpanded ? 'Collapse rationale' : 'Expand rationale'}
          >
            <svg
              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          </button>
        </td>
        <td className="px-4 py-3 text-sm font-semibold text-gray-900">{rec.ticker}</td>
        <td className="px-4 py-3"><SideBadge side={rec.side} /></td>
        <td className="px-4 py-3 text-sm text-gray-600 capitalize">{rec.order_type.replace('_', ' ')}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">{rec.quantity}</td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {rec.limit_price ? formatCurrency(rec.limit_price) : rec.stop_price ? formatCurrency(rec.stop_price) : '--'}
        </td>
        <td className="px-4 py-3 text-sm text-right tabular-nums">
          {rec.confidence != null ? (
            <span className="inline-flex items-center gap-1.5">
              <div className="h-1.5 w-16 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${rec.confidence * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-500">{formatPercent(rec.confidence)}</span>
            </span>
          ) : '--'}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">{formatRelativeTime(rec.created_at)}</td>
        <td className="px-4 py-3"><RecommendationStatusBadge status={rec.status} /></td>
        <td className="px-4 py-3">
          <div className="flex gap-1">
            {rec.status === 'pending' && (
              <>
                <button
                  onClick={onAccept}
                  disabled={isUpdating}
                  className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={onDismiss}
                  disabled={isUpdating}
                  className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </>
            )}
            {/* Fix #11: Link to analysis */}
            <Link
              to={`/analysis?ticker=${rec.ticker}`}
              className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
            >
              View Analysis
            </Link>
          </div>
        </td>
      </tr>
      {/* Fix #10: Inline expandable rationale row */}
      {isExpanded && (
        <tr className="bg-gray-50/50">
          <td colSpan={10} className="px-6 py-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-xs font-medium text-gray-500 mb-1">Rationale</p>
                <p className="text-sm text-gray-600">{rec.rationale}</p>
              </div>
              {rec.tags && rec.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {rec.tags.map(tag => (
                    <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mobile card layout (Fix #12)
// ---------------------------------------------------------------------------

function RecMobileCard({
  rec,
  onAccept,
  onDismiss,
  isUpdating,
}: {
  rec: Recommendation;
  onAccept: () => void;
  onDismiss: () => void;
  isUpdating: boolean;
}) {
  const [showRationale, setShowRationale] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">{rec.ticker}</span>
          <SideBadge side={rec.side} />
          <RecommendationStatusBadge status={rec.status} />
        </div>
        <Link
          to={`/analysis?ticker=${rec.ticker}`}
          className="text-xs font-medium text-indigo-600"
        >
          Analysis
        </Link>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="capitalize">{rec.order_type.replace('_', ' ')}</span>
        <span>Qty: {rec.quantity}</span>
        <span>
          Price: {rec.limit_price ? formatCurrency(rec.limit_price) : rec.stop_price ? formatCurrency(rec.stop_price) : '--'}
        </span>
        <span>{formatRelativeTime(rec.created_at)}</span>
      </div>

      {/* Confidence bar */}
      {rec.confidence != null && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${rec.confidence * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">{formatPercent(rec.confidence)}</span>
        </div>
      )}

      {/* Rationale (truncated, expandable) */}
      <button
        onClick={() => setShowRationale(!showRationale)}
        className="text-left w-full"
      >
        <p className={`text-sm text-gray-600 ${showRationale ? '' : 'line-clamp-2'}`}>
          {rec.rationale}
        </p>
        {rec.rationale && rec.rationale.length > 100 && (
          <span className="text-xs text-indigo-600 font-medium">
            {showRationale ? 'Show less' : 'Show more'}
          </span>
        )}
      </button>

      {/* Tags */}
      {rec.tags && rec.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {rec.tags.map(tag => (
            <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{tag}</span>
          ))}
        </div>
      )}

      {/* Actions */}
      {rec.status === 'pending' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onAccept}
            disabled={isUpdating}
            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
          >
            Accept
          </button>
          <button
            onClick={onDismiss}
            disabled={isUpdating}
            className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem('watchlist') ?? '[]');
  } catch {
    return [];
  }
}

function toggleWatchlist(ticker: string): boolean {
  const list = getWatchlist();
  const idx = list.indexOf(ticker);
  if (idx >= 0) {
    list.splice(idx, 1);
    localStorage.setItem('watchlist', JSON.stringify(list));
    return false;
  }
  list.push(ticker);
  localStorage.setItem('watchlist', JSON.stringify(list));
  return true;
}

function SuggestionCard({ suggestion: s }: { suggestion: StockSuggestion }) {
  const [isWatched, setIsWatched] = useState(() => getWatchlist().includes(s.ticker));
  const toast = useToast();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{s.ticker}</h3>
          <p className="text-xs text-gray-500">{s.company_name}</p>
        </div>
        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 capitalize">
          {s.gap_type.replace('_', ' ')}
        </span>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span>{s.sector}</span>
        {s.current_price && <span>{formatCurrency(s.current_price)}</span>}
        {s.market_cap && <span>Mkt Cap {formatCompactCurrency(s.market_cap)}</span>}
      </div>

      <p className="text-sm text-gray-600 line-clamp-3">{s.rationale}</p>

      <div className="flex gap-4 text-xs text-gray-500">
        {s.pe_ratio && <span>P/E {s.pe_ratio.toFixed(1)}</span>}
        {s.dividend_yield != null && s.dividend_yield > 0 && <span>Div {formatPercent(s.dividend_yield)}</span>}
        {s.suggested_weight && <span>Suggested {formatPercent(s.suggested_weight)}</span>}
      </div>

      <button
        onClick={() => {
          const added = toggleWatchlist(s.ticker);
          setIsWatched(added);
          toast.info(added ? `${s.ticker} added to watchlist` : `${s.ticker} removed from watchlist`);
        }}
        className={`w-full rounded-lg border py-2 text-sm font-medium transition-colors ${
          isWatched
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {isWatched ? 'Watching' : 'Watch'}
      </button>
    </div>
  );
}
