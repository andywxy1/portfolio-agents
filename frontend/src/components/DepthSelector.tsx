import type { AnalysisRequestDepth } from '../types';

export interface DepthOption {
  value: AnalysisRequestDepth;
  label: string;
  description: string;
  timeEstimate: string;
  colorClass: string;
  dotClass: string;
}

export const DEPTH_OPTIONS: DepthOption[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Tiered by position weight: large positions get deep, small get light',
    timeEstimate: 'Varies',
    colorClass: 'border-gray-300 bg-gray-50',
    dotClass: 'bg-gray-400',
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Quick scan: fundamentals only',
    timeEstimate: '~30s per ticker',
    colorClass: 'border-emerald-300 bg-emerald-50',
    dotClass: 'bg-emerald-500',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Standard: market + fundamentals analysis',
    timeEstimate: '~1-2 min per ticker',
    colorClass: 'border-amber-300 bg-amber-50',
    dotClass: 'bg-amber-500',
  },
  {
    value: 'deep',
    label: 'Deep',
    description: 'Full analysis: all analysts + debate',
    timeEstimate: '~3-5 min per ticker',
    colorClass: 'border-red-300 bg-red-50',
    dotClass: 'bg-red-500',
  },
];

interface DepthSelectorProps {
  value: AnalysisRequestDepth;
  onChange: (depth: AnalysisRequestDepth) => void;
  compact?: boolean;
}

export function DepthSelector({ value, onChange, compact = false }: DepthSelectorProps) {
  if (compact) {
    return (
      <div className="flex flex-col gap-1">
        {DEPTH_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              value === opt.value
                ? 'bg-slate-100 ring-1 ring-slate-400'
                : 'hover:bg-gray-50'
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${opt.dotClass}`} />
            <div className="min-w-0">
              <span className="font-medium text-gray-900">{opt.label}</span>
              <span className="ml-1.5 text-xs text-gray-500">{opt.timeEstimate}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {DEPTH_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
            value === opt.value
              ? `${opt.colorClass} ring-2 ring-offset-1 ring-slate-400`
              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className={`mt-1 inline-block h-3 w-3 rounded-full flex-shrink-0 ${opt.dotClass}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
              <span className="text-xs text-gray-500">{opt.timeEstimate}</span>
            </div>
            <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{opt.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Estimate total time given ticker count and depth */
export function estimateTime(tickerCount: number, depth: AnalysisRequestDepth, concurrency: number = 5): string {
  const timePerTicker: Record<AnalysisRequestDepth, number> = {
    light: 30,
    medium: 90,
    deep: 240,
    auto: 90, // average estimate
  };
  const seconds = Math.ceil(tickerCount / concurrency) * timePerTicker[depth];
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes} min`;
}

/** Estimate auto depth breakdown */
export function estimateAutoBreakdown(tickerCount: number): { deep: number; medium: number; light: number } {
  // Rough heuristic: top 30% deep, middle 40% medium, bottom 30% light
  const deep = Math.max(1, Math.round(tickerCount * 0.3));
  const light = Math.max(1, Math.round(tickerCount * 0.3));
  const medium = Math.max(0, tickerCount - deep - light);
  return { deep, medium, light };
}

/** Get depth badge classes for live dashboard display */
export function depthBadgeClass(depth: string): { bg: string; text: string; dot: string } {
  switch (depth) {
    case 'deep':
      return { bg: 'bg-red-900/60', text: 'text-red-300', dot: 'bg-red-400' };
    case 'medium':
      return { bg: 'bg-amber-900/60', text: 'text-amber-300', dot: 'bg-amber-400' };
    case 'light':
      return { bg: 'bg-emerald-900/60', text: 'text-emerald-300', dot: 'bg-emerald-400' };
    case 'auto':
    default:
      return { bg: 'bg-gray-700/60', text: 'text-gray-300', dot: 'bg-gray-400' };
  }
}
