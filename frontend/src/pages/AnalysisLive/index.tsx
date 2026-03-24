import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePageTitle } from '../../hooks/usePageTitle';
import { clearActiveAnalysisJob } from '../../hooks/useActiveAnalysis';
import { useToast } from '../../components/Toast';
import { apiClient } from '../../api/client';
import { useAnalysisJob, useCancelAnalysis } from '../../api/hooks';
import type { LatestAnalysisResponse } from '../../types';
import {
  useAnalysisStream,
  AGENT_PIPELINE,
} from '../../hooks/useAnalysisStream';
import type {
  AgentStatus,
  StreamEvent,
  DecisionInfo,
  TickerDepthInfo,
} from '../../hooks/useAnalysisStream';
import { depthBadgeClass } from '../../components/DepthSelector';

// =============================================================================
// Utilities
// =============================================================================

/** Comprehensive markdown renderer for dark-themed report display */
function renderMarkdown(text: string): string {
  if (!text) return '';

  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks - extract before other transforms
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="bg-gray-800 rounded p-3 my-3 overflow-x-auto text-sm text-gray-300 font-mono border border-gray-700">${code.replace(/\n$/, '')}</pre>`);
    return `\x00CB${idx}\x00`;
  });
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="bg-gray-800 rounded p-3 my-3 overflow-x-auto text-sm text-gray-300 font-mono border border-gray-700">${code.replace(/^\n/, '').replace(/\n$/, '')}</pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Tables
  html = html.replace(
    /((?:^|\n)\|[^\n]+\|\n\|[\s:|-]+\|\n(?:\|[^\n]+\|\n?)*)/g,
    (tableBlock) => {
      const lines = tableBlock.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return tableBlock;
      const parseRow = (line: string): string[] =>
        line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headers = parseRow(lines[0]);
      const dataRows = lines.slice(2).map(parseRow);
      let table = '<div class="overflow-x-auto my-3"><table class="w-full text-sm border-collapse border border-gray-700 rounded">';
      table += '<thead><tr class="bg-gray-800">';
      for (const h of headers) {
        table += `<th class="px-3 py-2 text-left text-gray-200 font-semibold border border-gray-700">${h}</th>`;
      }
      table += '</tr></thead><tbody>';
      dataRows.forEach((row, rowIdx) => {
        const bgClass = rowIdx % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/50';
        table += `<tr class="${bgClass} hover:bg-gray-800/70 transition-colors">`;
        for (let i = 0; i < headers.length; i++) {
          table += `<td class="px-3 py-2 text-gray-300 border border-gray-700">${row[i] ?? ''}</td>`;
        }
        table += '</tr>';
      });
      table += '</tbody></table></div>';
      return table;
    }
  );

  // Blockquotes
  html = html.replace(
    /((?:^|\n)&gt; [^\n]+(?:\n&gt; [^\n]+)*)/g,
    (block) => {
      const inner = block.replace(/(?:^|\n)&gt; /g, '\n').trim();
      return `<blockquote class="border-l-4 border-gray-600 pl-4 my-3 text-gray-400 italic">${inner}</blockquote>`;
    }
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-base font-semibold text-gray-100 mt-3 mb-1.5">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-gray-100 mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-gray-100 mt-5 mb-2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-gray-100 mt-6 mb-3">$1</h1>');

  // Horizontal rules
  html = html.replace(/^(\*{3,}|-{3,}|_{3,})$/gm, '<hr class="border-gray-700 my-4" />');

  // Bold+Italic combined
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong class="text-gray-100 font-semibold"><em>$1</em></strong>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-100 font-semibold">$1</strong>');
  // Italic
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em class="text-gray-300">$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1.5 py-0.5 rounded text-sm text-emerald-400 font-mono">$1</code>');

  // Numbered lists
  html = html.replace(
    /((?:^\d+\. .+$\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(line => {
        const m = line.match(/^\d+\.\s+(.+)$/);
        return m ? `<li class="ml-4 list-decimal text-gray-300">${m[1]}</li>` : '';
      }).join('\n');
      return `<ol class="my-2 space-y-1 pl-2">${items}</ol>`;
    }
  );

  // Unordered lists
  html = html.replace(
    /((?:^[ \t]*[-*] .+$\n?)+)/gm,
    (block) => {
      const items = block.trim().split('\n').map(line => {
        const m = line.match(/^([ \t]*)[-*]\s+(.+)$/);
        if (!m) return '';
        const indent = m[1].length;
        const mlClass = indent >= 4 ? 'ml-8' : indent >= 2 ? 'ml-6' : 'ml-4';
        return `<li class="${mlClass} list-disc text-gray-300">${m[2]}</li>`;
      }).join('\n');
      return `<ul class="my-2 space-y-1">${items}</ul>`;
    }
  );

  // Paragraphs
  const sections = html.split(/\n\n+/);
  html = sections
    .map(section => {
      const trimmed = section.trim();
      if (!trimmed) return '';
      if (/^(<h[1-4]|<ul|<ol|<pre|<table|<div|<blockquote|<hr|\x00CB)/.test(trimmed)) {
        return trimmed;
      }
      return `<p class="text-gray-300 my-2">${trimmed.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');

  // Restore code blocks
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)] ?? '');

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');

  return html;
}

/** Extract text from a report field that may be JSON or a plain string */
function extractReportText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        return extractReportText(parsed);
      }
      return String(parsed);
    } catch {
      return value;
    }
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    // Common wrapper: { text: "..." }
    if (typeof obj.text === 'string') return obj.text;
    // Investment debate structure
    if (obj.bull_case || obj.bear_case || obj.judge_decision) {
      const parts: string[] = [];
      if (obj.bull_case) parts.push(`## Bull Case\n\n${obj.bull_case}`);
      if (obj.bear_case) parts.push(`## Bear Case\n\n${obj.bear_case}`);
      if (obj.debate_history) parts.push(`## Debate History\n\n${obj.debate_history}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }
    // Risk debate structure
    if (obj.aggressive_view || obj.conservative_view || obj.neutral_view) {
      const parts: string[] = [];
      if (obj.aggressive_view) parts.push(`## Aggressive View\n\n${obj.aggressive_view}`);
      if (obj.conservative_view) parts.push(`## Conservative View\n\n${obj.conservative_view}`);
      if (obj.neutral_view) parts.push(`## Neutral View\n\n${obj.neutral_view}`);
      if (obj.debate_history) parts.push(`## Debate History\n\n${obj.debate_history}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }
    // Alternate pipeline naming
    if (obj.bull_report || obj.bear_report) {
      const parts: string[] = [];
      if (obj.bull_report) parts.push(`## Bull Report\n\n${obj.bull_report}`);
      if (obj.bear_report) parts.push(`## Bear Report\n\n${obj.bear_report}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }
    if (obj.aggressive_report || obj.conservative_report || obj.neutral_report) {
      const parts: string[] = [];
      if (obj.aggressive_report) parts.push(`## Aggressive Report\n\n${obj.aggressive_report}`);
      if (obj.conservative_report) parts.push(`## Conservative Report\n\n${obj.conservative_report}`);
      if (obj.neutral_report) parts.push(`## Neutral Report\n\n${obj.neutral_report}`);
      if (obj.judge_decision) parts.push(`## Judge Decision\n\n${obj.judge_decision}`);
      return parts.join('\n\n---\n\n');
    }
    // Fallback: stringify
    return JSON.stringify(value, null, 2);
  }
  return String(value);
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

// Report type labels - canonical mapping for all report keys
const REPORT_TYPE_LABELS: Record<string, string> = {
  market: 'Market',
  sentiment: 'Sentiment',
  news: 'News',
  fundamentals: 'Fundamentals',
  debate: 'Debate',
  investment_debate: 'Debate',
  risk: 'Risk',
  risk_debate: 'Risk',
  plan: 'Plan',
  investment_plan: 'Plan',
  decision: 'Decision',
};

// Canonical tab order. SSE uses short keys (market, sentiment, etc.).
// DB reports use longer keys (investment_debate, risk_debate, investment_plan).
// We show both aliases but dedupe by label.
const REPORT_TAB_ORDER = ['market', 'sentiment', 'news', 'fundamentals', 'debate', 'investment_debate', 'risk', 'risk_debate', 'plan', 'investment_plan', 'decision'];

// DB field names to tab key mapping (used in completion fetch)
const DB_SIMPLE_REPORT_FIELDS: Array<[string, string]> = [
  ['market_report', 'market'],
  ['sentiment_report', 'sentiment'],
  ['news_report', 'news'],
  ['fundamentals_report', 'fundamentals'],
  ['investment_plan', 'plan'],
];

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
  tickerDepth,
  concurrentTickers,
}: {
  stages: Map<string, AgentStatus>;
  currentTicker: string;
  tickerDepth?: TickerDepthInfo;
  concurrentTickers?: Set<string>;
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

  const concurrentList = concurrentTickers ? [...concurrentTickers] : [];

  return (
    <div className="space-y-4" role="tree" aria-label={`Analysis progress for ${currentTicker}`}>
      {/* Ticker depth subtitle */}
      {tickerDepth && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-300">{currentTicker}</span>
          {(() => {
            const badge = depthBadgeClass(tickerDepth.depth);
            return (
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge.bg} ${badge.text}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                {tickerDepth.depth}
              </span>
            );
          })()}
        </div>
      )}

      {/* Parallel status */}
      {concurrentList.length > 1 && (
        <div className="rounded bg-blue-950/40 border border-blue-900/50 px-2.5 py-1.5 text-xs text-blue-300 mb-1">
          Analyzing: {concurrentList.join(', ')} ({concurrentList.length} concurrent)
        </div>
      )}

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

/** Format tool call as compact summary */
function formatToolCallSummary(content: string): string {
  const fnMatch = content.match(/(\w+)\s*\(/);
  if (fnMatch) {
    const argsMatch = content.match(/\(([^)]*)\)/);
    const args = argsMatch ? argsMatch[1].replace(/['"{}]/g, '').split(',').slice(0, 2).join(', ') : '';
    return args ? `${fnMatch[1]}(${args})` : fnMatch[1] + '()';
  }
  return content.slice(0, 60) + (content.length > 60 ? '...' : '');
}

/** Single message row in the feed */
function MessageRow({ event, expanded, onToggle, showTickerBadge }: { event: StreamEvent; expanded: boolean; onToggle: () => void; showTickerBadge?: boolean }) {
  const content = event.content ?? '';
  const isToolCall = event.type === 'tool_call' || event.type === 'tool_result';
  const isSystemOrData = event.type === 'stage_start' || event.type === 'stage_complete' || event.type === 'report' || event.type === 'decision';

  // Tool calls: compact collapsed line, expandable on click
  if (isToolCall) {
    const summary = formatToolCallSummary(content);
    return (
      <div
        className="pl-3 py-0.5 cursor-pointer hover:bg-gray-800/30 transition-colors"
        onClick={onToggle}
        role="row"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      >
        {!expanded ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="text-gray-600 font-mono tabular-nums">{formatTime(event.timestamp)}</span>
            {showTickerBadge && event.ticker && event.ticker !== '_all' && (
              <span className="text-[10px] text-gray-600 uppercase">{event.ticker}</span>
            )}
            <span>{event.type === 'tool_call' ? '\uD83D\uDD27' : '\uD83D\uDCE6'} {summary}</span>
          </div>
        ) : (
          <div className="border-l-2 border-l-blue-500/40 pl-2 py-1">
            <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
              <span className="font-mono tabular-nums">{formatTime(event.timestamp)}</span>
              <span className="text-blue-400">{event.type === 'tool_call' ? 'Tool Call' : 'Tool Result'}</span>
              {event.agent && <span className="text-gray-600">({event.agent})</span>}
            </div>
            <div className="text-xs text-gray-400 whitespace-pre-wrap break-words font-mono bg-gray-900/50 rounded p-2 max-h-40 overflow-y-auto">
              {content}
            </div>
            <button
              className="text-[10px] text-blue-400 hover:text-blue-300 mt-0.5"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
            >
              Collapse
            </button>
          </div>
        )}
      </div>
    );
  }

  // System/control and data messages: small gray text, no expansion
  if (isSystemOrData) {
    return (
      <div className="pl-3 py-0.5" role="row">
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="font-mono tabular-nums">{formatTime(event.timestamp)}</span>
          {showTickerBadge && event.ticker && event.ticker !== '_all' && (
            <span className="text-[10px] text-gray-600 uppercase">{event.ticker}</span>
          )}
          <span className="text-gray-700">{'\u2500'}</span>
          <span className="truncate">{content.slice(0, 80)}{content.length > 80 ? '...' : ''}</span>
        </div>
      </div>
    );
  }

  // Agent messages: full display with avatar and content
  const borderClass = sentimentBorderClass(event.type, content);
  const isLong = content.length > 300;
  const displayContent = (!expanded && isLong) ? content.slice(0, 300) + '...' : content;

  return (
    <div
      className={`border-l-2 ${borderClass} pl-3 py-2 hover:bg-gray-800/50 transition-colors ${isLong ? 'cursor-pointer' : ''}`}
      onClick={isLong ? onToggle : undefined}
      role="row"
      tabIndex={isLong ? 0 : undefined}
      onKeyDown={isLong ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
    >
      <div className="flex items-start gap-2">
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
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-gray-500 font-mono tabular-nums">{formatTime(event.timestamp)}</span>
            {showTickerBadge && event.ticker && event.ticker !== '_all' && (
              <span className="inline-flex items-center rounded bg-gray-700/80 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300 uppercase">
                {event.ticker}
              </span>
            )}
            {event.agent && (
              <span className="text-xs text-purple-400 font-medium truncate">{event.agent}</span>
            )}
          </div>
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

/** Messages panel */
function MessagesPanel({ events, showTickerBadge, showToolCalls }: { events: StreamEvent[]; showTickerBadge?: boolean; showToolCalls: boolean }) {
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

  // Filter events: always hide job_status, hide tool calls when toggle is off
  const visibleEvents = useMemo(() =>
    events.filter(e => {
      if (e.type === 'job_status') return false;
      if (!showToolCalls && (e.type === 'tool_call' || e.type === 'tool_result')) return false;
      return true;
    }),
    [events, showToolCalls]
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
            showTickerBadge={showTickerBadge}
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
    setReportsByTicker,
    decisions,
    setDecisions,
    isConnected,
    isComplete,
    connectionError,
    jobProgress,
    tickers: streamTickers,
    tickerDepths,
    activeTickers: concurrentTickers,
    overallDepth,
  } = useAnalysisStream(jobId);

  // Messages ticker filter
  const [messageTickerFilter, setMessageTickerFilter] = useState<string>('_all');

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

  // When analysis completes, fetch full reports from DB to replace truncated SSE data
  const fetchedFullReports = useRef(false);
  useEffect(() => {
    if (!isComplete || !jobId || fetchedFullReports.current) return;
    fetchedFullReports.current = true;

    apiClient.get<LatestAnalysisResponse>('/analysis/latest').then((data) => {
      if (!data?.position_analyses?.length) return;

      const fullReports = new Map<string, Map<string, string>>();
      const newDecisions = new Map(decisions);

      for (const pa of data.position_analyses) {
        const tickerReports = new Map<string, string>();

        // Simple report fields
        for (const [dbField, tabKey] of DB_SIMPLE_REPORT_FIELDS) {
          const val = (pa as unknown as Record<string, unknown>)[dbField];
          if (val) {
            tickerReports.set(tabKey, extractReportText(val));
          }
        }

        // Structured debate fields
        if (pa.investment_debate) {
          tickerReports.set('debate', extractReportText(pa.investment_debate));
        }
        if (pa.risk_debate) {
          tickerReports.set('risk', extractReportText(pa.risk_debate));
        }

        // Decision / trade_decision
        if (pa.raw_decision) {
          tickerReports.set('decision', pa.raw_decision);
          // Also update decision info
          if (pa.signal) {
            newDecisions.set(pa.ticker, {
              ticker: pa.ticker,
              signal: pa.signal,
              confidence: 0.5, // DB doesn't store confidence separately
              summary: pa.raw_decision,
            });
          }
        }

        if (tickerReports.size > 0) {
          fullReports.set(pa.ticker, tickerReports);
        }
      }

      if (fullReports.size > 0) {
        setReportsByTicker(fullReports);
        setDecisions(newDecisions);
      }
    }).catch((err) => {
      // Silently fail - streaming reports remain as fallback
      console.warn('Failed to fetch full reports from DB:', err);
    });
  }, [isComplete, jobId, decisions, setReportsByTicker, setDecisions]);

  // Report panel collapsed state
  const [reportsCollapsed, setReportsCollapsed] = useState(false);

  // Tool calls visibility toggle (off by default)
  const [showToolCalls, setShowToolCalls] = useState(false);

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
  const activeStages = stagesByTicker.get(activeTicker) ?? stagesByTicker.get('_all') ?? new Map();
  const activeReports = reportsByTicker.get(activeTicker) ?? reportsByTicker.get('_all') ?? new Map();
  const activeDecision = decisions.get(activeTicker);
  const activeTickerDepth = tickerDepths.get(activeTicker);

  // Messages: merge all tickers or filter to selected
  const activeEvents = useMemo(() => {
    if (messageTickerFilter === '_all') {
      // Merge all ticker events, sorted by timestamp
      const all: StreamEvent[] = [];
      for (const [, events] of eventsByTicker) {
        all.push(...events);
      }
      return all.sort((a, b) => a.timestamp - b.timestamp);
    }
    return eventsByTicker.get(messageTickerFilter) ?? eventsByTicker.get('_all') ?? [];
  }, [eventsByTicker, messageTickerFilter]);

  const showTickerBadgeInMessages = messageTickerFilter === '_all' && allTickers.length > 1;

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
            <h1 className="text-sm font-semibold text-gray-200 whitespace-nowrap">
              Live Analysis
              {overallDepth && (
                <span className="ml-1.5 text-xs font-normal text-gray-500">
                  {' '}&mdash; {overallDepth.charAt(0).toUpperCase() + overallDepth.slice(1)} Depth
                </span>
              )}
            </h1>
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
            {/* Concurrent indicator */}
            {concurrentTickers.size > 0 && !isComplete && (
              <span className="inline-flex items-center gap-1 rounded bg-blue-900/40 px-2 py-0.5 text-xs text-blue-300 font-medium">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                {concurrentTickers.size} concurrent
              </span>
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
                  {(() => {
                    const depthInfo = tickerDepths.get(ticker);
                    if (depthInfo) {
                      const badge = depthBadgeClass(depthInfo.depth);
                      return (
                        <span className={`inline-block h-2 w-2 rounded-full ${badge.dot}`} title={`${depthInfo.depth} depth`} />
                      );
                    }
                    return <span className="inline-block h-2 w-2 rounded-full bg-gray-600" title="Pending" />;
                  })()}
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
      {/* MAIN CONTENT: Progress (left) | Reports (center) | Messages (right/bottom) */}
      {/* ================================================================== */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Progress panel */}
        <aside className="w-56 flex-shrink-0 border-r border-gray-800 overflow-y-auto p-3 hidden md:block">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Progress</h2>
          <ProgressPanel stages={activeStages} currentTicker={activeTicker} tickerDepth={activeTickerDepth} concurrentTickers={concurrentTickers} />
        </aside>

        {/* Center: Reports (main content - largest panel) */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Reports</h2>
            </div>
            <div className="h-[calc(100%-1.5rem)]">
              <ReportsPanel
                reports={activeReports}
                decision={activeDecision}
              />
            </div>
          </div>

          {/* Bottom: Messages (collapsed, max 300px) */}
          <div className={`flex-shrink-0 border-t border-gray-800 ${reportsCollapsed ? '' : 'h-[300px]'}`}>
            <button
              onClick={() => setReportsCollapsed(prev => !prev)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-900/50 transition-colors"
              aria-expanded={!reportsCollapsed}
            >
              <div className="flex items-center gap-2">
                <span>Messages</span>
                <span className="text-[10px] text-gray-600 normal-case font-normal">{activeEvents.length} events</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Tool calls toggle */}
                <label
                  className="flex items-center gap-1.5 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] text-gray-500 normal-case font-normal">Show tool calls</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowToolCalls(prev => !prev); }}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                      showToolCalls ? 'bg-blue-600' : 'bg-gray-700'
                    }`}
                    role="switch"
                    aria-checked={showToolCalls}
                    aria-label="Show tool calls"
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                      showToolCalls ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </label>
                {allTickers.length > 1 && (
                  <select
                    value={messageTickerFilter}
                    onChange={(e) => { e.stopPropagation(); setMessageTickerFilter(e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded bg-gray-800 border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    aria-label="Filter messages by ticker"
                  >
                    <option value="_all">All tickers</option>
                    {allTickers.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
                <svg
                  className={`w-4 h-4 transition-transform ${reportsCollapsed ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>
            {!reportsCollapsed && (
              <div className="h-[calc(100%-1.75rem)] px-3 pb-2">
                <MessagesPanel events={activeEvents} showTickerBadge={showTickerBadgeInMessages} showToolCalls={showToolCalls} />
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Mobile: Progress as a collapsible drawer */}
      <MobileProgressDrawer stages={activeStages} currentTicker={activeTicker} tickerDepth={activeTickerDepth} concurrentTickers={concurrentTickers} />
    </div>
  );
}

/** Mobile progress drawer shown only on small screens */
function MobileProgressDrawer({ stages, currentTicker, tickerDepth, concurrentTickers }: { stages: Map<string, AgentStatus>; currentTicker: string; tickerDepth?: TickerDepthInfo; concurrentTickers?: Set<string> }) {
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
          <ProgressPanel stages={stages} currentTicker={currentTicker} tickerDepth={tickerDepth} concurrentTickers={concurrentTickers} />
        </div>
      )}
    </div>
  );
}
