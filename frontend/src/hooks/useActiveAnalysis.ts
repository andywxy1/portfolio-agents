import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'portfolio_active_analysis_job';

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
    if (e.key === STORAGE_KEY) cb();
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
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
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
