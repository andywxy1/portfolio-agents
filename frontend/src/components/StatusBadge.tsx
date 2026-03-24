import type { Signal, AnalysisJobStatus, RecommendationStatus, SuggestionStatus } from '../types';

type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple';

const variantClasses: Record<BadgeVariant, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  yellow: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  gray: 'bg-gray-50 text-gray-600 ring-gray-500/20',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/20',
};

function getSignalVariant(signal: Signal): BadgeVariant {
  switch (signal) {
    case 'BUY':
    case 'OVERWEIGHT':
      return 'green';
    case 'SELL':
    case 'UNDERWEIGHT':
      return 'red';
    case 'HOLD':
      return 'yellow';
  }
}

function getJobStatusVariant(status: AnalysisJobStatus): BadgeVariant {
  switch (status) {
    case 'completed':
      return 'green';
    case 'running':
      return 'blue';
    case 'pending':
      return 'yellow';
    case 'failed':
      return 'red';
    case 'cancelled':
      return 'gray';
  }
}

function getRecommendationStatusVariant(status: RecommendationStatus | SuggestionStatus): BadgeVariant {
  switch (status) {
    case 'accepted':
    case 'executed':
    case 'added':
      return 'green';
    case 'pending':
      return 'yellow';
    case 'dismissed':
      return 'gray';
    case 'expired':
      return 'red';
    default:
      return 'gray';
  }
}

interface SignalBadgeProps {
  signal: Signal;
}

export function SignalBadge({ signal }: SignalBadgeProps) {
  const variant = getSignalVariant(signal);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${variantClasses[variant]}`}
    >
      {signal}
    </span>
  );
}

interface JobStatusBadgeProps {
  status: AnalysisJobStatus;
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const variant = getJobStatusVariant(status);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${variantClasses[variant]}`}
    >
      {status}
    </span>
  );
}

interface RecommendationStatusBadgeProps {
  status: RecommendationStatus | SuggestionStatus;
}

export function RecommendationStatusBadge({ status }: RecommendationStatusBadgeProps) {
  const variant = getRecommendationStatusVariant(status);
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset capitalize ${variantClasses[variant]}`}
    >
      {status}
    </span>
  );
}

interface SideBadgeProps {
  side: 'buy' | 'sell';
}

export function SideBadge({ side }: SideBadgeProps) {
  const variant = side === 'buy' ? 'green' : 'red';
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset uppercase ${variantClasses[variant]}`}
    >
      {side}
    </span>
  );
}
