import { usePortfolioSummary, useLatestAnalysis, useHoldings } from '../../api/hooks';
import { EmptyState } from '../../components/EmptyState';
import { SkeletonCard, SkeletonChart } from '../../components/Skeleton';
import { JobStatusBadge } from '../../components/StatusBadge';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  formatCurrency,
  formatPnl,
  formatPnlPercent,
  pnlColor,
  formatPercent,
  formatRelativeTime,
} from '../../utils/format';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

const COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

export default function Dashboard() {
  usePageTitle('Dashboard');
  const navigate = useNavigate();
  const { data: holdings, isLoading: holdingsLoading } = useHoldings();
  const { data: summary, isLoading: summaryLoading, error: summaryError } = usePortfolioSummary();
  const { data: latest, isLoading: analysisLoading, error: analysisError } = useLatestAnalysis();

  // Dashboard empty state (Item 14) - check holdings first
  if (!holdingsLoading && (!holdings || holdings.length === 0)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Portfolio overview and performance metrics</p>
        </div>
        <EmptyState
          title="Add holdings to see your portfolio overview"
          description="Start by adding your positions on the Holdings page."
          action={{ label: 'Go to Holdings', onClick: () => navigate('/holdings') }}
        />
      </div>
    );
  }

  const allocationData = summary?.allocation
    ?.filter(a => a.weight != null)
    .map(a => ({ name: a.ticker, value: Number((a.weight! * 100).toFixed(1)) }))
    .sort((a, b) => b.value - a.value) ?? [];

  const sectorData = summary?.sector_breakdown?.map(s => ({
    name: s.sector,
    weight: Number((s.weight * 100).toFixed(1)),
  })) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Portfolio overview and performance metrics</p>
      </div>

      {/* Summary Cards - per-component loading/error (Item 9) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : summaryError ? (
          <div className="col-span-full rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm text-red-700">Failed to load portfolio summary</p>
          </div>
        ) : summary ? (
          <>
            <SummaryCard
              label="Total Value"
              value={formatCurrency(summary.total_value)}
              subtext={`${summary.holdings_count} positions`}
            />
            <SummaryCard
              label="Total P&L"
              value={formatPnl(summary.total_pnl)}
              valueColor={pnlColor(summary.total_pnl)}
              subtext={formatPnlPercent(summary.total_pnl_pct)}
              subtextColor={pnlColor(summary.total_pnl_pct)}
            />
            <SummaryCard
              label="Cost Basis"
              value={formatCurrency(summary.total_cost_basis)}
              subtext="Total invested"
            />
            <SummaryCard
              label="Concentration"
              value={summary.concentration ? `HHI ${summary.concentration.hhi.toLocaleString()}` : '--'}
              subtext={summary.concentration ? `Top 5: ${formatPercent(summary.concentration.top5_weight)}` : ''}
            />
          </>
        ) : null}
      </div>

      {/* Charts Row - per-component loading/error (Item 9) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Allocation Pie Chart */}
        {summaryLoading ? (
          <SkeletonChart />
        ) : summaryError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-700">Failed to load allocation chart</p>
          </div>
        ) : allocationData.length > 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Position Allocation</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {allocationData.map((_entry, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: unknown) => [`${value}%`, 'Weight']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px', border: '1px solid #e5e7eb' }}
                  />
                  <Legend
                    formatter={(value: string) => <span className="text-xs text-gray-600">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Position Allocation</h2>
            <div className="mt-4 flex items-center justify-center h-72">
              <p className="text-sm text-gray-400">Allocation data will appear after prices are loaded</p>
            </div>
          </div>
        )}

        {/* Sector Breakdown */}
        {summaryLoading ? (
          <SkeletonChart />
        ) : summaryError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-sm text-red-700">Failed to load sector chart</p>
          </div>
        ) : sectorData.length > 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Sector Breakdown</h2>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectorData} layout="vertical" margin={{ left: 40 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={120} />
                  <Tooltip
                    formatter={(value: unknown) => [`${value}%`, 'Weight']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px', border: '1px solid #e5e7eb' }}
                  />
                  <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                    {sectorData.map((_entry, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-gray-900">Sector Breakdown</h2>
            <div className="mt-4 flex items-center justify-center h-72">
              <p className="text-sm text-gray-400">Sector data will appear after analysis is run</p>
            </div>
          </div>
        )}
      </div>

      {/* Concentration & Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Holdings */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">Top 5 Holdings</h2>
          {summaryLoading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-gray-200 animate-pulse" />
                    <div className="space-y-1">
                      <div className="h-3 w-12 rounded bg-gray-200 animate-pulse" />
                      <div className="h-3 w-16 rounded bg-gray-200 animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : allocationData.length === 0 ? (
            <p className="mt-4 text-sm text-gray-400">No allocation data yet</p>
          ) : (
            <div className="mt-4 space-y-3">
              {allocationData.slice(0, 5).map((item, i) => {
                const alloc = summary?.allocation.find(a => a.ticker === item.name);
                return (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: COLORS[i] }}>
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.name}</p>
                        <p className="text-xs text-gray-500">{formatCurrency(alloc?.market_value)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{item.value}%</p>
                      <p className={`text-xs ${pnlColor(alloc?.pnl_pct)}`}>
                        {formatPnlPercent(alloc?.pnl_pct)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
          <div className="mt-4 space-y-4">
            {analysisLoading ? (
              <div className="space-y-3">
                <div className="h-16 rounded-lg bg-gray-100 animate-pulse" />
                <div className="h-12 rounded-lg bg-gray-100 animate-pulse" />
              </div>
            ) : analysisError ? (
              <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-xs text-red-600">Failed to load recent activity</p>
              </div>
            ) : (
              <>
                {latest?.job && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">Latest Analysis</p>
                      <JobStatusBadge status={latest.job.status} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {latest.job.total_tickers} positions analyzed
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatRelativeTime(latest.job.completed_at ?? latest.job.created_at)}
                    </p>
                  </div>
                )}

                {Array.isArray(latest?.recommendations) && latest.recommendations.length > 0 && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm font-medium text-gray-900">Pending Recommendations</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {latest.recommendations.filter(r => r.status === 'pending').length} actions awaiting review
                    </p>
                  </div>
                )}

                {!latest?.job && !(Array.isArray(latest?.recommendations) && latest.recommendations.length > 0) && (
                  <p className="text-sm text-gray-400">No recent activity. Run an analysis to get started.</p>
                )}

                {summary?.any_prices_stale && (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-800">Stale Prices</p>
                    <p className="mt-1 text-xs text-amber-600">
                      Some prices may be outdated. Data will refresh automatically.
                    </p>
                  </div>
                )}

                {summary?.prices_as_of && (
                  <p className="text-xs text-gray-400">
                    Prices as of {formatRelativeTime(summary.prices_as_of)}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  valueColor = 'text-gray-900',
  subtext,
  subtextColor = 'text-gray-500',
}: {
  label: string;
  value: string;
  valueColor?: string;
  subtext?: string;
  subtextColor?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueColor}`}>{value}</p>
      {subtext && <p className={`mt-1 text-sm ${subtextColor}`}>{subtext}</p>}
    </div>
  );
}
