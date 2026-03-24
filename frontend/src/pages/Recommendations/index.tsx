import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  // Confirm dialog for dismiss (Item 7)
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);

  const recommendations: Recommendation[] = Array.isArray(recsData?.data) ? recsData.data : [];

  // Defensive: ensure suggestions is always an array
  const suggestionsList = Array.isArray(suggestions) ? suggestions : [];

  // Empty state check (Item 14)
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
          title="Run an analysis to get AI-powered recommendations"
          description="Recommendations are generated when you run an analysis on your holdings."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      ) : (
        <>
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
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
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
                      <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
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
                          {rec.status === 'pending' && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  updateMutation.mutate(
                                    { id: rec.id, data: { status: 'accepted' } },
                                    {
                                      onSuccess: () => toast.success(`${rec.ticker} recommendation accepted`),
                                      onError: () => toast.error('Failed to update recommendation'),
                                    }
                                  );
                                }}
                                disabled={updateMutation.isPending}
                                className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => setDismissConfirm(rec.id)}
                                disabled={updateMutation.isPending}
                                className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {/* Rationale expandable rows */}
                <div className="divide-y divide-gray-100 border-t border-gray-200">
                  {recommendations.map(rec => (
                    <details key={`rationale-${rec.id}`} className="group">
                      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50">
                        <svg className="h-3 w-3 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                        </svg>
                        {rec.ticker} rationale
                        {rec.tags && rec.tags.length > 0 && (
                          <span className="flex gap-1 ml-2">
                            {rec.tags.map(tag => (
                              <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{tag}</span>
                            ))}
                          </span>
                        )}
                      </summary>
                      <p className="px-4 pb-3 pt-1 text-sm text-gray-600">{rec.rationale}</p>
                    </details>
                  ))}
                </div>
              </div>
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

      {/* Dismiss confirmation (Item 7) */}
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
