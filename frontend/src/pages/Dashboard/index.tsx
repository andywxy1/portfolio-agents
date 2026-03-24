import { usePortfolioSummary, useLatestAnalysis } from '../../api/hooks';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { JobStatusBadge } from '../../components/StatusBadge';
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

const COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
];

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = usePortfolioSummary();
  const { data: latest, isLoading: analysisLoading } = useLatestAnalysis();

  if (summaryLoading || analysisLoading) {
    return <LoadingSpinner label="Loading dashboard..." />;
  }

  if (!summary) {
    return <EmptyState title="No portfolio data" description="Add holdings to see your dashboard." />;
  }

  const allocationData = summary.allocation
    .filter(a => a.weight != null)
    .map(a => ({ name: a.ticker, value: Number((a.weight! * 100).toFixed(1)) }))
    .sort((a, b) => b.value - a.value);

  const sectorData = summary.sector_breakdown.map(s => ({
    name: s.sector,
    weight: Number((s.weight * 100).toFixed(1)),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Portfolio overview and performance metrics</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Allocation Pie Chart */}
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

        {/* Sector Breakdown */}
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
      </div>

      {/* Concentration & Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Holdings */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">Top 5 Holdings</h2>
          <div className="mt-4 space-y-3">
            {allocationData.slice(0, 5).map((item, i) => {
              const alloc = summary.allocation.find(a => a.ticker === item.name);
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
        </div>

        {/* Recent Activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
          <div className="mt-4 space-y-4">
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

            {latest?.recommendations && latest.recommendations.length > 0 && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-medium text-gray-900">Pending Recommendations</p>
                <p className="mt-1 text-xs text-gray-500">
                  {latest.recommendations.filter(r => r.status === 'pending').length} actions awaiting review
                </p>
              </div>
            )}

            {summary.any_prices_stale && (
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800">Stale Prices</p>
                <p className="mt-1 text-xs text-amber-600">
                  Some prices may be outdated. Data will refresh automatically.
                </p>
              </div>
            )}

            {summary.prices_as_of && (
              <p className="text-xs text-gray-400">
                Prices as of {formatRelativeTime(summary.prices_as_of)}
              </p>
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
