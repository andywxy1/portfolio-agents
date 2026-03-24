import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { clearActiveAnalysisJob } from '../../hooks/useActiveAnalysis';
import { useToast } from '../../components/Toast';
import { useAnalysisJob, useCancelAnalysis } from '../../api/hooks';
import {
  useAnalysisStream,
  AGENT_PIPELINE,
} from '../../hooks/useAnalysisStream';
import type {
  AgentStatus,
  StreamEvent,
  DecisionInfo,
} from '../../hooks/useAnalysisStream';

// =============================================================================
// Utilities
// =============================================================================

/** Simple markdown renderer - handles ##, **, -, ```, `inline` */
function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.slice(3, -3).replace(/^\w*\n/, '');
    return `<pre class="bg-gray-800 rounded p-3 my-2 overflow-x-auto text-sm text-gray-300 font-mono">${code}</pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1.5 py-0.5 rounded text-sm text-emerald-400 font-mono">$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-gray-100 mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-gray-100 mt-5 mb-2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-gray-100 mt-6 mb-3">$1</h1>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-100 font-semibold">$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-gray-300">$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-2 space-y-1">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-300">$1</li>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p class="text-gray-300 my-2">');
  html = `<p class="text-gray-300 my-2">${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  return html;
}

/** Format timestamp for message log */
function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Detect sentiment from text content */
function detectSentiment(content: string): 'bullish' | 'bearish' | 'neutral' | 'data' {
  if (!content) return 'neutral';
  const lower = content.toLowerCase();
  const bullishWords = ['bullish', 'buy', 'upside', 'growth', 'positive', 'strong', 'opportunity', 'outperform', 'overweight'];
  const bearishWords = ['bearish', 'sell', 'downside', 'decline', 'negative', 'weak', 'risk', 'underperform', 'underweight'];
  let bullScore = 0;
  let bearScore = 0;
  for (const w of bullishWords) { if (lower.includes(w)) bullScore++; }
  for (const w of bearishWords) { if (lower.includes(w)) bearScore++; }
  if (bullScore > bearScore && bullScore >= 2) return 'bullish';
  if (bearScore > bullScore && bearScore >= 2) return 'bearish';
  return 'neutral';
}

/** Sentiment border color */
function sentimentBorderClass(type: StreamEvent['type'], content: string): string {
  if (type === 'tool_call' || type === 'tool_result') return 'border-l-blue-500';
  if (type === 'error') return 'border-l-red-500';
  if (type !== 'agent_message') return 'border-l-gray-700';
  const s = detectSentiment(content);
  if (s === 'bullish') return 'border-l-emerald-500';
  if (s === 'bearish') return 'border-l-red-500';
  return 'border-l-amber-500';
}

/** Type badge config */
function typeBadge(type: StreamEvent['type']): { label: string; cls: string } {
  switch (type) {
    case 'agent_message': return { label: 'Agent', cls: 'bg-purple-900/60 text-purple-300' };
    case 'tool_call': return { label: 'Tool', cls: 'bg-blue-900/60 text-blue-300' };
    case 'tool_result': return { label: 'Data', cls: 'bg-gray-700/60 text-gray-300' };
    case 'stage_start': return { label: 'System', cls: 'bg-emerald-900/60 text-emerald-300' };
    case 'stage_complete': return { label: 'System', cls: 'bg-emerald-900/60 text-emerald-300' };
    case 'report': return { label: 'Report', cls: 'bg-cyan-900/60 text-cyan-300' };
    case 'decision': return { label: 'Decision', cls: 'bg-amber-900/60 text-amber-300' };
    case 'error': return { label: 'Error', cls: 'bg-red-900/60 text-red-300' };
    default: return { label: 'Info', cls: 'bg-gray-700/60 text-gray-400' };
  }
}

/** Agent avatar color from agent name */
function agentColor(agent: string): string {
  const colors = [
    'bg-purple-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600',
    'bg-cyan-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-violet-600',
  ];
  let hash = 0;
  for (let i = 0; i < agent.length; i++) {
    hash = ((hash << 5) - hash) + agent.charCodeAt(i);
    hash |= 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

// Simple ding sound as data URI (short sine wave)
const DING_DATA_URI = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVYGAACAgICAgICAgICAgICAgICAgICAgICBgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/v///////v79/Pv6+fj39vX08/Lx8O/u7ezr6uno5+bl5OPi4eDf3t3c29rZ2NfW1dTT0tHQz87NzMvKycjHxsXEw8LBwL++vby7urm4t7a1tLOysbCvrq2sq6qpqKempaSjoqGgn56dnJuamZiXlpWUk5KRkI+OjYyLiomIh4aFhIOCgYCAgICAgICAgICAgICAgICAgICAgIB/f35+fX18e3p5eHd2dXRzcnFwb25tbGtqaWhnZmVkY2JhYF9eXVxbWllYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQkFAPz49PDs6OTg3NjU0MzIxMC8uLSwrKikoJyYlJCMiISAfHh0cGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIBAQEBAQEBAQEBAQEBAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUJDREVGRkhJSktMTU5PUFFSU1RVVldYWVpbXF1eX2BhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ent8fX5+f3+AgA==';

/** Play a ding sound */
function playDing() {
  try {
    const audio = new Audio(DING_DATA_URI);
    audio.volume = 0.3;
    audio.play().catch(() => { /* browser may block autoplay */ });
  } catch {
    // Ignore audio errors
  }
}

/** Copy text to clipboard */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Report type labels
const REPORT_TYPE_LABELS: Record<string, string> = {
  market: 'Market',
  sentiment: 'Sentiment',
  news: 'News',
  fundamentals: 'Fundamentals',
  debate: 'Debate',
  risk: 'Risk',
  decision: 'Decision',
  investment_debate: 'Debate',
  risk_debate: 'Risk',
  investment_plan: 'Plan',
};

const REPORT_TAB_ORDER = ['market', 'sentiment', 'news', 'fundamentals', 'debate', 'investment_debate', 'risk', 'risk_debate', 'investment_plan', 'decision'];

// =============================================================================
// Sub-components
// =============================================================================

/** Status icon for agent progress */
function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case 'completed':
      return <span className="text-emerald-400 text-sm" aria-label="completed">{'\u2713'}</span>;
    case 'in_progress':
      return (
        <span className="inline-flex items-center" aria-label="in progress">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
          </span>
        </span>
      );
    case 'failed':
      return <span className="text-red-400 text-sm" aria-label="failed">{'\u2717'}</span>;
    case 'pending':
    default:
      return <span className="text-gray-600 text-xs" aria-label="pending">{'\u00B7'}</span>;
  }
}

/** Mini sparkline SVG chart */
function Sparkline({ data, width = 150, height = 50 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data
    .map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 4) - 2}`)
    .join(' ');

  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#34d399' : '#f87171';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block" aria-label="Price sparkline">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

/** Progress panel (left side) */
function ProgressPanel({
  stages,
  currentTicker,
}: {
  stages: Map<string, AgentStatus>;
  currentTicker: string;
}) {
  // Group pipeline by team
  const teams = useMemo(() => {
    const grouped: { team: string; agents: { agent: string; icon: string }[] }[] = [];
    let current: typeof grouped[0] | null = null;
    for (const def of AGENT_PIPELINE) {
      if (!current || current.team !== def.team) {
        current = { team: def.team, agents: [] };
        grouped.push(current);
      }
      current.agents.push({ agent: def.agent, icon: def.icon });
    }
    return grouped;
  }, []);

  return (
    <div className="space-y-4" role="tree" aria-label={`Analysis progress for ${currentTicker}`}>
      {teams.map(({ team, agents }) => (
        <div key={team}>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5" role="treeitem">
            {team}
          </div>
          <div className="space-y-0.5 ml-1">
            {agents.map(({ agent, icon }, idx) => {
              const status = stages.get(agent) ?? 'pending';
              const isLast = idx === agents.length - 1;
              const connector = isLast ? '\u2514' : '\u251C';
              return (
                <div
                  key={agent}
                  className={`flex items-center gap-2 py-0.5 px-1.5 rounded text-sm ${
                    status === 'in_progress' ? 'bg-blue-950/40' : ''
                  }`}
                  role="treeitem"
                  aria-label={`${agent}: ${status}`}
                >
                  <span className="text-gray-700 font-mono text-xs select-none">{connector}\u2500</span>
                  <span className="text-sm" aria-hidden="true">{icon}</span>
                  <span className={`flex-1 truncate ${
                    status === 'in_progress' ? 'text-blue-300 font-medium' :
                    status === 'completed' ? 'text-gray-300' :
                    status === 'failed' ? 'text-red-400' :
                    'text-gray-500'
                  }`}>
                    {agent}
                  </span>
                  <StatusIcon status={status} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Single message row in the feed */
function MessageRow({ event, expanded, onToggle }: { event: StreamEvent; expanded: boolean; onToggle: () => void }) {
  const badge = typeBadge(event.type);
  const content = event.content ?? '';
  const isLong = content.length > 200;
  const displayContent = (!expanded && isLong) ? content.slice(0, 200) + '...' : content;
  const borderClass = sentimentBorderClass(event.type, content);

  return (
    <div
      className={`border-l-2 ${borderClass} pl-3 py-2 hover:bg-gray-800/50 transition-colors cursor-pointer`}
      onClick={onToggle}
      role="row"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <div className="flex items-start gap-2">
        {/* Agent avatar */}
        {event.agent && (
          <div
            className={`flex-shrink-0 w-6 h-6 rounded-full ${agentColor(event.agent)} flex items-center justify-center text-xs font-bold text-white mt-0.5`}
            title={event.agent}
            aria-hidden="true"
          >
            {event.agent.charAt(0)}
          </div>
        )}
        {!event.agent && <div className="flex-shrink-0 w-6" />}

        <div className="flex-1 min-w-0">
          {/* Meta line */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-gray-500 font-mono tabular-nums">{formatTime(event.timestamp)}</span>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>
              {badge.label}
            </span>
            {event.agent && (
              <span className="text-xs text-gray-400 truncate">{event.agent}</span>
            )}
          </div>
          {/* Content */}
          <div className="text-sm text-gray-300 whitespace-pre-wrap break-words">
            {displayContent}
          </div>
          {isLong && (
            <button
              className="text-xs text-blue-400 hover:text-blue-300 mt-1"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Messages panel (right side) */
function MessagesPanel({ events }: { events: StreamEvent[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [userScrolled, setUserScrolled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Auto-scroll behavior
  useEffect(() => {
    if (!userScrolled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, userScrolled]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setUserScrolled(!atBottom);
  }, []);

  const jumpToLatest = useCallback(() => {
    setUserScrolled(false);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Filter out stage_start/stage_complete for cleaner feed, keep the rest
  const visibleEvents = useMemo(() =>
    events.filter(e => e.type !== 'stage_start' && e.type !== 'stage_complete' && e.type !== 'job_status'),
    [events]
  );

  return (
    <div className="relative h-full flex flex-col">
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-0.5 pr-1"
        onScroll={handleScroll}
        role="log"
        aria-label="Analysis messages"
        aria-live="polite"
      >
        {visibleEvents.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            Waiting for events...
          </div>
        )}
        {visibleEvents.map(event => (
          <MessageRow
            key={event.id}
            event={event}
            expanded={expandedIds.has(event.id)}
            onToggle={() => toggleExpand(event.id)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      {userScrolled && visibleEvents.length > 0 && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-2 right-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg transition-colors"
          aria-label="Jump to latest message"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

/** Report tabs panel (bottom) */
function ReportsPanel({
  reports,
  decision,
}: {
  reports: Map<string, string>;
  decision: DecisionInfo | undefined;
}) {
  const availableTabs = useMemo(() => {
    const tabs: { key: string; label: string; available: boolean }[] = [];
    for (const key of REPORT_TAB_ORDER) {
      const available = reports.has(key);
      if (available || tabs.length < 7) { // always show core tabs even if not yet available
        tabs.push({
          key,
          label: REPORT_TYPE_LABELS[key] ?? key,
          available,
        });
      }
    }
    // Dedupe labels - only keep one of debate/investment_debate, risk/risk_debate
    const seen = new Set<string>();
    return tabs.filter(t => {
      if (seen.has(t.label)) return false;
      seen.add(t.label);
      return true;
    });
  }, [reports]);

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Auto-select first available tab
  useEffect(() => {
    if (activeTab && reports.has(activeTab)) return;
    const first = availableTabs.find(t => t.available);
    if (first) setActiveTab(first.key);
  }, [availableTabs, activeTab, reports]);

  const currentContent = activeTab ? reports.get(activeTab) : undefined;

  const handleCopy = useCallback(async () => {
    if (!currentContent) return;
    const ok = await copyToClipboard(currentContent);
    if (ok) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  }, [currentContent]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-800 pb-2 mb-3 flex-wrap">
        {availableTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => tab.available && setActiveTab(tab.key)}
            disabled={!tab.available}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-600 text-white'
                : tab.available
                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                : 'bg-gray-900 text-gray-600 cursor-not-allowed'
            }`}
            aria-selected={activeTab === tab.key}
            role="tab"
          >
            {tab.label}
          </button>
        ))}

        {/* Copy button */}
        {currentContent && (
          <button
            onClick={handleCopy}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            title="Copy as Markdown"
          >
            {copyFeedback ? (
              <span className="text-emerald-400">Copied!</span>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" role="tabpanel">
        {activeTab === 'decision' && decision ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className={`text-2xl font-bold ${
                decision.signal === 'BUY' || decision.signal === 'OVERWEIGHT' ? 'text-emerald-400' :
                decision.signal === 'SELL' || decision.signal === 'UNDERWEIGHT' ? 'text-red-400' :
                'text-amber-400'
              }`}>
                {decision.signal}
              </span>
              <span className="text-gray-400 text-sm">
                Confidence: {Math.round(decision.confidence * 100)}%
              </span>
            </div>
            <div
              className="prose prose-invert max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(decision.summary) }}
            />
          </div>
        ) : currentContent ? (
          <div
            className="prose prose-invert max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(currentContent) }}
          />
        ) : (
          <div className="text-gray-600 text-sm text-center py-8">
            {availableTabs.some(t => t.available)
              ? 'Select a report tab to view its content.'
              : 'Reports will appear here as agents complete their analysis.'}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main page component
// =============================================================================

export default function AnalysisLive() {
  usePageTitle('Live Analysis');
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const cancelMutation = useCancelAnalysis();

  // SSE stream
  const {
    eventsByTicker,
    stagesByTicker,
    reportsByTicker,
    decisions,
    isConnected,
    isComplete,
    connectionError,
    jobProgress,
    tickers: streamTickers,
  } = useAnalysisStream(jobId);

  // Fallback polling for job status
  const { data: job, isLoading: jobLoading, isError: jobError } = useAnalysisJob(jobId);

  // Merge tickers from job + stream
  const allTickers = useMemo(() => {
    const set = new Set<string>();
    if (job?.tickers) job.tickers.forEach(t => set.add(t));
    streamTickers.forEach(t => { if (t !== '_all') set.add(t); });
    return [...set];
  }, [job?.tickers, streamTickers]);

  // Active ticker tab
  const [activeTicker, setActiveTicker] = useState<string>('');

  // Auto-select first ticker
  useEffect(() => {
    if (!activeTicker && allTickers.length > 0) {
      setActiveTicker(allTickers[0]);
    }
  }, [activeTicker, allTickers]);

  // Sound toggle
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Play ding on completion & clear active job tracker
  const prevComplete = useRef(isComplete);
  useEffect(() => {
    if (isComplete && !prevComplete.current) {
      if (soundEnabled) playDing();
      clearActiveAnalysisJob();
    }
    prevComplete.current = isComplete;
  }, [isComplete, soundEnabled]);

  // Report panel collapsed state
  const [reportsCollapsed, setReportsCollapsed] = useState(false);

  // Copy all reports
  const [copyAllFeedback, setCopyAllFeedback] = useState(false);
  const handleCopyAll = useCallback(async () => {
    const reports = reportsByTicker.get(activeTicker);
    if (!reports || reports.size === 0) return;
    const parts: string[] = [];
    for (const [type, content] of reports) {
      parts.push(`# ${REPORT_TYPE_LABELS[type] ?? type} Report\n\n${content}`);
    }
    const decision = decisions.get(activeTicker);
    if (decision) {
      parts.push(`# Decision: ${decision.signal} (${Math.round(decision.confidence * 100)}%)\n\n${decision.summary}`);
    }
    const ok = await copyToClipboard(parts.join('\n\n---\n\n'));
    if (ok) {
      setCopyAllFeedback(true);
      setTimeout(() => setCopyAllFeedback(false), 2000);
    }
  }, [reportsByTicker, decisions, activeTicker]);

  // Sparkline mock data (since we don't have real price history in SSE)
  const sparklineData = useMemo(() => {
    // Generate deterministic pseudo-random data from ticker name
    if (!activeTicker) return [];
    let seed = 0;
    for (let i = 0; i < activeTicker.length; i++) seed += activeTicker.charCodeAt(i);
    const data: number[] = [];
    let price = 50 + (seed % 200);
    for (let i = 0; i < 30; i++) {
      seed = (seed * 16807 + 7) % 2147483647;
      price += ((seed % 100) - 50) / 10;
      if (price < 5) price = 5;
      data.push(price);
    }
    return data;
  }, [activeTicker]);

  // Derived data for active ticker
  const activeEvents = eventsByTicker.get(activeTicker) ?? eventsByTicker.get('_all') ?? [];
  const activeStages = stagesByTicker.get(activeTicker) ?? stagesByTicker.get('_all') ?? new Map();
  const activeReports = reportsByTicker.get(activeTicker) ?? reportsByTicker.get('_all') ?? new Map();
  const activeDecision = decisions.get(activeTicker);

  // Is the analysis still active (not finished)?
  const jobStatus = job?.status;
  const isRunning = !isComplete && jobStatus !== 'failed' && jobStatus !== 'cancelled';

  const handleStopAnalysis = useCallback(() => {
    if (!jobId) return;
    cancelMutation.mutate(jobId, {
      onSuccess: () => {
        clearActiveAnalysisJob();
        toast.success('Analysis cancellation requested');
      },
      onError: (err) => {
        toast.error(`Failed to cancel: ${err.message}`);
      },
    });
  }, [jobId, cancelMutation, toast]);

  // Progress computation
  const totalTickers = jobProgress.tickersTotal || job?.total_tickers || allTickers.length || 0;
  const completedTickers = jobProgress.tickersCompleted || job?.completed_tickers || 0;
  const progressPct = totalTickers > 0 ? Math.round((completedTickers / totalTickers) * 100) : 0;

  // Ticker status for tabs
  const getTickerStatus = useCallback((ticker: string): AgentStatus => {
    const d = decisions.get(ticker);
    if (d) return 'completed';
    const stages = stagesByTicker.get(ticker);
    if (!stages) {
      // Check job data
      const pa = job?.position_analyses?.find(p => p.ticker === ticker);
      if (pa?.status === 'completed') return 'completed';
      if (pa?.status === 'running') return 'in_progress';
      if (pa?.status === 'failed') return 'failed';
      return 'pending';
    }
    const statuses = [...stages.values()];
    if (statuses.some(s => s === 'in_progress')) return 'in_progress';
    if (statuses.some(s => s === 'failed')) return 'failed';
    if (statuses.length > 0 && statuses.every(s => s === 'completed')) return 'completed';
    return 'pending';
  }, [decisions, stagesByTicker, job?.position_analyses]);

  // Loading state
  if (jobLoading && !isConnected) {
    return (
      <div className="-m-4 sm:-m-6 bg-gray-950 flex items-center justify-center h-[calc(100vh-3.25rem)] lg:h-screen">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-700 border-t-blue-500" />
          <p className="text-sm text-gray-400">Connecting to analysis stream...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (jobError && !isConnected && !isComplete) {
    return (
      <div className="-m-4 sm:-m-6 bg-gray-950 flex items-center justify-center p-4 h-[calc(100vh-3.25rem)] lg:h-screen">
        <div className="rounded-xl border border-red-900 bg-red-950/50 p-6 text-center max-w-md">
          <p className="text-sm font-medium text-red-400">Could not load analysis job.</p>
          <button
            onClick={() => navigate('/holdings')}
            className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors"
          >
            Back to Holdings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-4 sm:-m-6 bg-gray-950 text-gray-100 flex flex-col h-[calc(100vh-3.25rem)] lg:h-screen">
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <header className="flex-shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Back button */}
          <button
            onClick={() => navigate('/analysis')}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Back to analysis"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>

          {/* Title + progress */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-200 whitespace-nowrap">Live Analysis</h1>
            {totalTickers > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>Analyzing {completedTickers}/{totalTickers} positions</span>
                <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isComplete ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.max(progressPct, isComplete ? 100 : 3)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sparkline */}
          {sparklineData.length > 0 && (
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="text-xs text-gray-500 font-mono">{activeTicker}</span>
              <Sparkline data={sparklineData} width={120} height={32} />
            </div>
          )}

          {/* Connection indicator */}
          <div className="flex items-center gap-1.5" title={isConnected ? 'Connected' : isComplete ? 'Complete' : 'Disconnected'}>
            <span className={`inline-block w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-500' : isComplete ? 'bg-blue-500' : 'bg-red-500'
            }`} />
            <span className="text-xs text-gray-500 hidden sm:inline">
              {isConnected ? 'Live' : isComplete ? 'Done' : 'Offline'}
            </span>
          </div>

          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(prev => !prev)}
            className={`p-1.5 rounded transition-colors text-sm ${
              soundEnabled ? 'bg-blue-900/50 text-blue-300' : 'text-gray-600 hover:text-gray-400'
            }`}
            title={soundEnabled ? 'Sound on' : 'Sound off'}
            aria-label={soundEnabled ? 'Disable sound notifications' : 'Enable sound notifications'}
          >
            {soundEnabled ? '\uD83D\uDD14' : '\uD83D\uDD15'}
          </button>

          {/* Stop Analysis button - only shown when analysis is active */}
          {isRunning && (
            <button
              onClick={handleStopAnalysis}
              disabled={cancelMutation.isPending}
              className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
              aria-label="Stop analysis"
            >
              {cancelMutation.isPending ? 'Stopping...' : 'Stop Analysis'}
            </button>
          )}

          {/* Copy all reports */}
          <button
            onClick={handleCopyAll}
            className="p-1.5 rounded text-gray-600 hover:text-gray-400 transition-colors text-sm"
            title="Copy full report"
            aria-label="Copy full report as markdown"
          >
            {copyAllFeedback ? (
              <span className="text-emerald-400 text-xs">Copied!</span>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>

          {/* View Results when done */}
          {isComplete && (
            <button
              onClick={() => navigate('/analysis')}
              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs font-semibold text-white transition-colors"
            >
              View Results
            </button>
          )}
        </div>

        {/* Ticker tabs */}
        {allTickers.length > 1 && (
          <div className="flex items-center gap-1 mt-2 overflow-x-auto pb-1" role="tablist" aria-label="Ticker selector">
            {allTickers.map(ticker => {
              const status = getTickerStatus(ticker);
              return (
                <button
                  key={ticker}
                  onClick={() => setActiveTicker(ticker)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    activeTicker === ticker
                      ? 'bg-gray-800 text-gray-100 ring-1 ring-gray-700'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
                  }`}
                  role="tab"
                  aria-selected={activeTicker === ticker}
                >
                  <span>{ticker}</span>
                  <StatusIcon status={status} />
                </button>
              );
            })}
          </div>
        )}

        {/* Connection error banner */}
        {connectionError && (
          <div className="mt-2 text-xs text-amber-400 bg-amber-950/30 rounded px-2 py-1">
            {connectionError}
          </div>
        )}
      </header>

      {/* ================================================================== */}
      {/* MAIN CONTENT: Progress (left) + Messages (right) */}
      {/* ================================================================== */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Progress panel */}
        <aside className="w-64 flex-shrink-0 border-r border-gray-800 overflow-y-auto p-3 hidden md:block">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</h2>
          <ProgressPanel stages={activeStages} currentTicker={activeTicker} />
        </aside>

        {/* Right: Messages + Reports */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Messages area */}
          <div className={`flex-1 min-h-0 p-3 ${reportsCollapsed ? '' : 'max-h-[55vh]'}`}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Messages &amp; Tools</h2>
              <span className="text-xs text-gray-600">{activeEvents.length} events</span>
            </div>
            <div className="h-[calc(100%-1.5rem)]">
              <MessagesPanel events={activeEvents} />
            </div>
          </div>

          {/* Reports area (bottom, collapsible) */}
          <div className={`flex-shrink-0 border-t border-gray-800 ${reportsCollapsed ? '' : 'h-[40vh]'}`}>
            <button
              onClick={() => setReportsCollapsed(prev => !prev)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-900/50 transition-colors"
              aria-expanded={!reportsCollapsed}
            >
              <span>Reports</span>
              <svg
                className={`w-4 h-4 transition-transform ${reportsCollapsed ? '' : 'rotate-180'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {!reportsCollapsed && (
              <div className="h-[calc(100%-2rem)] px-3 pb-3">
                <ReportsPanel
                  reports={activeReports}
                  decision={activeDecision}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Mobile: Progress as a collapsible drawer */}
      <MobileProgressDrawer stages={activeStages} currentTicker={activeTicker} />
    </div>
  );
}

/** Mobile progress drawer shown only on small screens */
function MobileProgressDrawer({ stages, currentTicker }: { stages: Map<string, AgentStatus>; currentTicker: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="fixed bottom-4 left-4 bg-gray-800 border border-gray-700 text-gray-300 px-3 py-2 rounded-full shadow-lg text-xs font-medium z-50"
        aria-label="Toggle progress panel"
      >
        {open ? 'Hide Progress' : 'Show Progress'}
      </button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 bg-gray-950 border-t border-gray-800 p-4 z-40 max-h-[60vh] overflow-y-auto">
          <ProgressPanel stages={stages} currentTicker={currentTicker} />
        </div>
      )}
    </div>
  );
}
