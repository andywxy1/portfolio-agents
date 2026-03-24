import { useState, useEffect, useRef, useCallback } from 'react';

// Type-safe SSE event handler
function onSSE(es: EventSource, event: string, handler: (data: string) => void) {
  es.addEventListener(event, ((e: MessageEvent) => {
    handler(e.data);
  }) as EventListener);
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

let eventCounter = 0;

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
  const maxRetries = 3;

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

    const connect = () => {
      const es = new EventSource(`/api/analysis/jobs/${jobId}/stream`);
      esRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setConnectionError(null);
        retriesRef.current = 0;
      };

      onSSE(es, 'ticker_start', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        setTickerDepths(prev => {
          const next = new Map(prev);
          next.set(ticker, { depth: d.depth ?? 'auto', position: d.position ?? 0, total: d.total ?? 0 });
          return next;
        });
        setActiveTickers(prev => {
          const next = new Set(prev);
          next.add(ticker);
          return next;
        });
        if (d.depth) {
          setOverallDepth(d.depth);
        }
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'stage_start',
          timestamp: Date.now(),
          ticker,
          content: `Ticker ${ticker} starting (${d.depth ?? 'auto'} depth)`,
        });
      });

      onSSE(es, 'ticker_complete', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        setTickerCompleted(prev => {
          const next = new Map(prev);
          next.set(ticker, { depth: d.depth ?? 'auto', signal: d.signal ?? '', elapsedSeconds: d.elapsed_seconds ?? 0 });
          return next;
        });
        setActiveTickers(prev => {
          const next = new Set(prev);
          next.delete(ticker);
          return next;
        });
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'stage_complete',
          timestamp: Date.now(),
          ticker,
          content: `Ticker ${ticker} complete: ${d.signal ?? 'N/A'} (${d.elapsed_seconds ?? 0}s)`,
        });
      });

      onSSE(es, 'stage_start', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        setStage(ticker, d.agent, 'in_progress');
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'stage_start',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          team: d.team,
          content: `${d.agent} starting...`,
        });
      });

      onSSE(es, 'stage_complete', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        const status: AgentStatus = d.status === 'failed' ? 'failed' : 'completed';
        setStage(ticker, d.agent, status);
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'stage_complete',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          team: d.team,
          content: `${d.agent} ${status}`,
          status: d.status,
        });
      });

      onSSE(es, 'agent_message', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'agent_message',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          content: d.content,
        });
      });

      onSSE(es, 'tool_call', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'tool_call',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          tool: d.tool,
          params: d.params,
          content: `${d.tool}(${JSON.stringify(d.params ?? {})})`,
        });
      });

      onSSE(es, 'tool_result', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'tool_result',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          tool: d.tool,
          resultPreview: d.result_preview,
          content: d.result_preview,
        });
      });

      onSSE(es, 'report', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        addReport(ticker, d.report_type, d.content);
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'report',
          timestamp: Date.now(),
          ticker,
          agent: d.agent,
          reportType: d.report_type,
          content: `Report ready: ${d.report_type}`,
        });
      });

      onSSE(es, 'decision', (raw) => {
        const d = JSON.parse(raw);
        const ticker = d.ticker ?? '_all';
        setDecisions(prev => {
          const next = new Map(prev);
          next.set(ticker, {
            ticker,
            signal: d.signal,
            confidence: d.confidence,
            summary: d.summary,
          });
          return next;
        });
        addReport(ticker, 'decision', d.summary);
        addEvent(ticker, {
          id: `evt-${++eventCounter}`,
          type: 'decision',
          timestamp: Date.now(),
          ticker,
          signal: d.signal,
          confidence: d.confidence,
          summary: d.summary,
          content: `Decision: ${d.signal} (${Math.round(d.confidence * 100)}% confidence)`,
        });
      });

      onSSE(es, 'job_status', (raw) => {
        const d = JSON.parse(raw);
        setJobProgress({
          tickersCompleted: d.tickers_completed ?? 0,
          tickersTotal: d.tickers_total ?? 0,
        });
        // Detect terminal statuses so the UI updates immediately
        // (without waiting for the SSE 'done' event or polling)
        if (d.status === 'cancelled' || d.status === 'completed' || d.status === 'failed') {
          setIsComplete(true);
        }
      });

      onSSE(es, 'error', (raw) => {
        try {
          const d = JSON.parse(raw);
          const ticker = d.ticker ?? '_all';
          if (d.agent) {
            setStage(ticker, d.agent, 'failed');
          }
          addEvent(ticker, {
            id: `evt-${++eventCounter}`,
            type: 'error',
            timestamp: Date.now(),
            ticker,
            agent: d.agent,
            message: d.message,
            content: d.message ?? 'Unknown error',
          });
        } catch {
          // SSE connection-level error, not a data event
        }
      });

      onSSE(es, 'done', () => {
        setIsComplete(true);
        es.close();
      });

      es.onerror = () => {
        setIsConnected(false);
        es.close();
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
  }, [jobId, addEvent, setStage, addReport]);

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
  };
}
