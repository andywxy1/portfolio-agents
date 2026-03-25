import { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  action?: ToastAction;
}

interface ToastContextValue {
  addToast: (message: string, variant?: ToastVariant, duration?: number, action?: ToastAction) => void;
  success: (message: string, options?: { action?: ToastAction }) => void;
  error: (message: string, options?: { action?: ToastAction; duration?: number }) => void;
  info: (message: string, options?: { action?: ToastAction }) => void;
  warning: (message: string, options?: { action?: ToastAction }) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, variant: ToastVariant = 'info', duration = 4000, action?: ToastAction) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, variant, duration, action }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const success = useCallback((message: string, options?: { action?: ToastAction }) => addToast(message, 'success', 4000, options?.action), [addToast]);
  const error = useCallback((message: string, options?: { action?: ToastAction; duration?: number }) => addToast(message, 'error', options?.duration ?? 6000, options?.action), [addToast]);
  const info = useCallback((message: string, options?: { action?: ToastAction }) => addToast(message, 'info', 4000, options?.action), [addToast]);
  const warning = useCallback((message: string, options?: { action?: ToastAction }) => addToast(message, 'warning', 4000, options?.action), [addToast]);

  return (
    <ToastContext.Provider value={{ addToast, success, error, info, warning }}>
      {children}
      {/* Toast container - bottom right */}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 pointer-events-none sm:bottom-4" aria-live="polite">
        {toasts.map(toast => (
          <ToastCard key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Toast Card
// ---------------------------------------------------------------------------

const variantStyles: Record<ToastVariant, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-slate-800 text-white',
  warning: 'bg-amber-500 text-white',
};

const variantIcons: Record<ToastVariant, string> = {
  success: 'M9 12.75L11.25 15 15 9.75',
  error: 'M6 18L18 6M6 6l12 12',
  info: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z',
  warning: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true));

    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 200);
    }, toast.duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-all duration-200 min-w-[300px] max-w-[420px] ${
        variantStyles[toast.variant]
      } ${visible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
      role="alert"
    >
      <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={variantIcons[toast.variant]} />
      </svg>
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      {toast.action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.action!.onClick();
            setVisible(false);
            setTimeout(() => onDismiss(toast.id), 200);
          }}
          className="flex-shrink-0 rounded px-2 py-1 text-xs font-semibold bg-white/20 hover:bg-white/30 transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 200);
        }}
        className="flex-shrink-0 rounded p-0.5 hover:bg-white/20 transition-colors"
        aria-label="Close notification"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
