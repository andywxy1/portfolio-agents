import { useState, useEffect, useRef, useCallback } from 'react';

// Type-safe SSE event handler
function onSSE(es: EventSource, event: string, handler: (data: string) => void) {
  es.addEventListener(event, ((e: MessageEvent) => {
    handler(e.data);
  }) as EventListener);
}

// ---------------------------------------------------------------------------
// Safe JSON parse helper (Fix #4)
// ---------------------------------------------------------------------------

function safeParse(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn('Failed to parse SSE event data:', raw);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface StageInfo {
  team: string;
  agent: string;
  status: AgentStatus;
}

export type StreamEventType =
  | 'agent_message'
  | 'tool_call'
  | 'tool_result'
  | 'report'
  | 'decision'
  | 'stage_start'
  | 'stage_complete'
  | 'error'
  | 'job_status'
  | 'done';

export interface StreamEvent {
  id: string;
  type: StreamEventType;
  timestamp: number;
  ticker: string;
  agent?: string;
  content?: string;
  tool?: string;
  params?: Record<string, unknown>;
  resultPreview?: string;
  reportType?: string;
  signal?: string;
  confidence?: number;
  summary?: string;
  message?: string;
  team?: string;
  status?: string;
  tickersCompleted?: number;
  tickersTotal?: number;
}

export interface DecisionInfo {
  ticker: string;
  signal: string;
  confidence: number;
  summary: string;
}

export interface JobProgress {
  tickersCompleted: number;
  tickersTotal: number;
}

export interface TickerDepthInfo {
  depth: string;
  position: number;
  total: number;
}

export interface TickerCompleteInfo {
  depth: string;
  signal: string;
  elapsedSeconds: number;
}

// ---------------------------------------------------------------------------
// Agent pipeline definition (the canonical order)
// ---------------------------------------------------------------------------

export interface AgentDef {
  team: string;
  agent: string;
  icon: string;
}

export const AGENT_PIPELINE: AgentDef[] = [
  { team: 'Analyst Team', agent: 'Market Analyst', icon: '\u{1F4CA}' },
  { team: 'Analyst Team', agent: 'Social Media Analyst', icon: '\u{1F4AC}' },
  { team: 'Analyst Team', agent: 'News Analyst', icon: '\u{1F4F0}' },
  { team: 'Analyst Team', agent: 'Fundamentals Analyst', icon: '\u{1F4CB}' },
  { team: 'Research Team', agent: 'Bull Researcher', icon: '\u{1F402}' },
  { team: 'Research Team', agent: 'Bear Researcher', icon: '\u{1F43B}' },
  { team: 'Research Team', agent: 'Research Manager', icon: '\u{1F4D1}' },
  { team: 'Trading Team', agent: 'Trader', icon: '\u{1F4B0}' },
  { team: 'Risk Management', agent: 'Aggressive Analyst', icon: '\u26A1' },
  { team: 'Risk Management', agent: 'Neutral Analyst', icon: '\u2696\uFE0F' },
  { team: 'Risk Management', agent: 'Conservative Analyst', icon: '\u{1F6E1}\uFE0F' },
  { team: 'Portfolio Management', agent: 'Portfolio Manager', icon: '\u{1F454}' },
];

// Quick lookup for icon by agent name
const AGENT_ICON_MAP = new Map(AGENT_PIPELINE.map(a => [a.agent, a.icon]));
export function getAgentIcon(agent: string): string {
  return AGENT_ICON_MAP.get(agent) ?? '\u{1F916}';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnalysisStream(jobId: string | undefined) {
  const [eventsByTicker, setEventsByTicker] = useState<Map<string, StreamEvent[]>>(new Map());
  const [stagesByTicker, setStagesByTicker] = useState<Map<string, Map<string, AgentStatus>>>(new Map());
  const [reportsByTicker, setReportsByTicker] = useState<Map<string, Map<string, string>>>(new Map());
  const [decisions, setDecisions] = useState<Map<string, DecisionInfo>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress>({ tickersCompleted: 0, tickersTotal: 0 });
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerDepths, setTickerDepths] = useState<Map<string, TickerDepthInfo>>(new Map());
  const [tickerCompleted, setTickerCompleted] = useState<Map<string, TickerCompleteInfo>>(new Map());
  const [activeTickers, setActiveTickers] = useState<Set<string>>(new Set());
  const [overallDepth, setOverallDepth] = useState<string>('auto');

  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const doneRef = useRef(false);
  // Fix #2: Move eventCounter from module-level mutable into a ref
  const eventCounterRef = useRef(0);
  const maxRetries = 3;

  // UX-56: Manual reconnect trigger
  const [reconnectCounter, setReconnectCounter] = useState(0);

  const reconnect = useCallback(() => {
    esRef.current?.close();
    retriesRef.current = 0;
    doneRef.current = false;
    setIsConnected(false);
    setIsComplete(false);
    setConnectionError(null);
    setReconnectCounter(c => c + 1);
  }, []);

  const addEvent = useCallback((ticker: string, event: StreamEvent) => {
    setEventsByTicker(prev => {
      const next = new Map(prev);
      const list = [...(next.get(ticker) ?? []), event];
      next.set(ticker, list);
      return next;
    });
    // Track discovered tickers
    setTickers(prev => {
      if (prev.includes(ticker)) return prev;
      return [...prev, ticker];
    });
  }, []);

  const nextEventId = useCallback(() => {
    eventCounterRef.current += 1;
    return `evt-${eventCounterRef.current}`;
  }, []);

  const setStage = useCallback((ticker: string, agent: string, status: AgentStatus) => {
    setStagesByTicker(prev => {
      const next = new Map(prev);
      const stages = new Map(next.get(ticker) ?? new Map());
      stages.set(agent, status);
      next.set(ticker, stages);
      return next;
    });
  }, []);

  const addReport = useCallback((ticker: string, reportType: string, content: string) => {
    setReportsByTicker(prev => {
      const next = new Map(prev);
      const reports = new Map(next.get(ticker) ?? new Map());
      reports.set(reportType, content);
      next.set(ticker, reports);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!jobId) return;

    // Reset done flag for new job connections
    doneRef.current = false;

    const connect = () => {
      const es = new EventSource(`/api/analysis/jobs/${jobId}/stream`);
      esRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        retriesRef.current = 0;
      };

      onSSE(es, 'ticker_start', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        setTickerDepths(prev => {
          const next = new Map(prev);
          next.set(ticker, { depth: (d.depth as string) ?? 'auto', position: (d.position as number) ?? 0, total: (d.total as number) ?? 0 });
          return next;
        });
        setActiveTickers(prev => {
          const next = new Set(prev);
          next.add(ticker);
          return next;
        });
        if (d.depth) {
          setOverallDepth(d.depth as string);
        }
        addEvent(ticker, {
          id: nextEventId(),
          type: 'stage_start',
          timestamp: Date.now(),
          ticker,
          content: `Ticker ${ticker} starting (${(d.depth as string) ?? 'auto'} depth)`,
        });
      });

      onSSE(es, 'ticker_complete', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        setTickerCompleted(prev => {
          const next = new Map(prev);
          next.set(ticker, { depth: (d.depth as string) ?? 'auto', signal: (d.signal as string) ?? '', elapsedSeconds: (d.elapsed_seconds as number) ?? 0 });
          return next;
        });
        setActiveTickers(prev => {
          const next = new Set(prev);
          next.delete(ticker);
          return next;
        });
        addEvent(ticker, {
          id: nextEventId(),
          type: 'stage_complete',
          timestamp: Date.now(),
          ticker,
          content: `Ticker ${ticker} complete: ${(d.signal as string) ?? 'N/A'} (${(d.elapsed_seconds as number) ?? 0}s)`,
        });
      });

      onSSE(es, 'stage_start', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        setStage(ticker, d.agent as string, 'in_progress');
        addEvent(ticker, {
          id: nextEventId(),
          type: 'stage_start',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          team: d.team as string,
          content: `${d.agent as string} starting...`,
        });
      });

      onSSE(es, 'stage_complete', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        const status: AgentStatus = d.status === 'failed' ? 'failed' : 'completed';
        setStage(ticker, d.agent as string, status);
        addEvent(ticker, {
          id: nextEventId(),
          type: 'stage_complete',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          team: d.team as string,
          content: `${d.agent as string} ${status}`,
          status: d.status as string,
        });
      });

      onSSE(es, 'agent_message', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        addEvent(ticker, {
          id: nextEventId(),
          type: 'agent_message',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          content: d.content as string,
        });
      });

      onSSE(es, 'tool_call', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        addEvent(ticker, {
          id: nextEventId(),
          type: 'tool_call',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          tool: d.tool as string,
          params: d.params as Record<string, unknown>,
          content: `${d.tool as string}(${JSON.stringify(d.params ?? {})})`,
        });
      });

      onSSE(es, 'tool_result', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        addEvent(ticker, {
          id: nextEventId(),
          type: 'tool_result',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          tool: d.tool as string,
          resultPreview: d.result_preview as string,
          content: d.result_preview as string,
        });
      });

      onSSE(es, 'report', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        addReport(ticker, d.report_type as string, d.content as string);
        addEvent(ticker, {
          id: nextEventId(),
          type: 'report',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          reportType: d.report_type as string,
          content: `Report ready: ${d.report_type as string}`,
        });
      });

      onSSE(es, 'decision', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        setDecisions(prev => {
          const next = new Map(prev);
          next.set(ticker, {
            ticker,
            signal: d.signal as string,
            confidence: d.confidence as number,
            summary: d.summary as string,
          });
          return next;
        });
        addReport(ticker, 'decision', d.summary as string);
        addEvent(ticker, {
          id: nextEventId(),
          type: 'decision',
          timestamp: Date.now(),
          ticker,
          signal: d.signal as string,
          confidence: d.confidence as number,
          summary: d.summary as string,
          content: `Decision: ${d.signal as string} (${Math.round((d.confidence as number) * 100)}% confidence)`,
        });
      });

      onSSE(es, 'job_status', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        setJobProgress({
          tickersCompleted: (d.tickers_completed as number) ?? 0,
          tickersTotal: (d.tickers_total as number) ?? 0,
        });
        // Detect terminal statuses so the UI updates immediately
        // (without waiting for the SSE 'done' event or polling)
        if (d.status === 'cancelled' || d.status === 'completed' || d.status === 'failed') {
          setIsComplete(true);
        }
      });

      onSSE(es, 'error', (raw) => {
        const d = safeParse(raw);
        if (!d) return;
        const ticker = (d.ticker as string) ?? '_all';
        if (d.agent) {
          setStage(ticker, d.agent as string, 'failed');
        }
        addEvent(ticker, {
          id: nextEventId(),
          type: 'error',
          timestamp: Date.now(),
          ticker,
          agent: d.agent as string,
          message: d.message as string,
          content: (d.message as string) ?? 'Unknown error',
        });
      });

      onSSE(es, 'done', () => {
        doneRef.current = true;
        setIsComplete(true);
        es.close();
      });

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Do NOT reconnect if the stream ended intentionally (done event
        // received).  We use a ref instead of the isComplete state because
        // React state updates are async and won't be visible here yet.
        if (doneRef.current) return;
        if (retriesRef.current < maxRetries) {
          retriesRef.current++;
          setTimeout(connect, 2000 * retriesRef.current);
        } else {
          setConnectionError('Connection lost. Stream may have ended.');
          setIsComplete(true);
        }
      };
    };

    connect();

    return () => {
      esRef.current?.close();
    };
  }, [jobId, addEvent, nextEventId, setStage, addReport, reconnectCounter]);

  return {
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
    tickers,
    tickerDepths,
    tickerCompleted,
    activeTickers,
    overallDepth,
    reconnect,
  };
}
