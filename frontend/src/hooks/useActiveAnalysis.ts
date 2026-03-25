import { useCallback, useState, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'portfolio_active_analysis_job';
const COMPLETION_KEY = 'portfolio_analysis_completed';

// Fix #17: Keep "Last Analysis" link visible for 5 minutes after completion
const COMPLETION_LINGER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function getSnapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerSnapshot(): string | null {
  return null;
}

// Listeners for useSyncExternalStore
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Also listen for cross-tab changes
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === COMPLETION_KEY) cb();
  };
  window.addEventListener('storage', handler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', handler);
  };
}

function notify() {
  listeners.forEach(cb => cb());
}

// ---------------------------------------------------------------------------
// Completion timestamp helpers
// ---------------------------------------------------------------------------

interface CompletionData {
  jobId: string;
  timestamp: number;
}

function getCompletionData(): CompletionData | null {
  try {
    const raw = localStorage.getItem(COMPLETION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CompletionData;
  } catch {
    return null;
  }
}

function setCompletionData(jobId: string) {
  try {
    localStorage.setItem(COMPLETION_KEY, JSON.stringify({ jobId, timestamp: Date.now() }));
  } catch {
    // storage full or unavailable
  }
  notify();
}

function clearCompletionData() {
  try {
    localStorage.removeItem(COMPLETION_KEY);
  } catch {
    // ignore
  }
  notify();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Set the active analysis job ID (call when analysis starts). */
export function setActiveAnalysisJob(jobId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, jobId);
  } catch {
    // storage full or unavailable
  }
  notify();
}

/** Clear the active analysis job (call when analysis completes/fails/cancels). */
export function clearActiveAnalysisJob() {
  const currentJobId = getSnapshot();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  // Fix #17: Store completion timestamp so sidebar can linger
  if (currentJobId) {
    setCompletionData(currentJobId);
  }
  notify();
}

/**
 * React hook that returns the currently active analysis job ID (or null).
 * Reactively updates when the value changes (same tab or cross-tab).
 */
export function useActiveAnalysisJob(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * React hook returning helpers to manage the active analysis job.
 */
export function useActiveAnalysisActions() {
  const set = useCallback((jobId: string) => setActiveAnalysisJob(jobId), []);
  const clear = useCallback(() => clearActiveAnalysisJob(), []);
  return { setActiveJob: set, clearActiveJob: clear };
}

/**
 * Fix #17: Hook that exposes both active job and recent completion state.
 * Returns { activeJobId, completedRecently, completionJobId }.
 */
export function useActiveAnalysis() {
  const activeJobId = useActiveAnalysisJob();
  const [completedRecently, setCompletedRecently] = useState(false);
  const [completionJobId, setCompletionJobId] = useState<string | null>(null);

  useEffect(() => {
    function check() {
      const data = getCompletionData();
      if (!data) {
        setCompletedRecently(false);
        setCompletionJobId(null);
        return;
      }
      const elapsed = Date.now() - data.timestamp;
      if (elapsed < COMPLETION_LINGER_MS) {
        setCompletedRecently(true);
        setCompletionJobId(data.jobId);
        // Schedule cleanup when linger period expires
        const remaining = COMPLETION_LINGER_MS - elapsed;
        const timer = setTimeout(() => {
          clearCompletionData();
          setCompletedRecently(false);
          setCompletionJobId(null);
        }, remaining);
        return () => clearTimeout(timer);
      } else {
        clearCompletionData();
        setCompletedRecently(false);
        setCompletionJobId(null);
      }
    }

    const cleanup = check();

    // Re-check when storage changes
    const unsub = subscribe(() => check());
    return () => {
      if (typeof cleanup === 'function') cleanup();
      unsub();
    };
  }, [activeJobId]);

  return { activeJobId, completedRecently, completionJobId };
}
