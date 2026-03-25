import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  useHoldings,
  useCreateHolding,
  useUpdateHolding,
  useDeleteHolding,
  useStartAnalysis,
  useCancelAnalysis,
  useBatchPrices,
  useValidateTicker,
  useExportHoldings,
  useImportHoldings,
} from '../../api/hooks';
import { ApiRequestError } from '../../api/client';
import { SkeletonTable } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import { setActiveAnalysisJob } from '../../hooks/useActiveAnalysis';
import {
  formatCurrency,
  formatPnl,
  formatPnlPercent,
  formatPercent,
  pnlColor,
} from '../../utils/format';
import { DepthSelector, estimateTime, estimateAutoBreakdown } from '../../components/DepthSelector';
import type { HoldingWithPrice, AnalysisMode, AnalysisRequestDepth } from '../../types';

// Maximum retries for 409 conflict (Fix #5)
const MAX_409_RETRIES = 1;

export default function Holdings() {
  usePageTitle('Holdings');
  const navigate = useNavigate();
  const toast = useToast();

  const { data: holdings, isLoading, error: holdingsError } = useHoldings();
  const createMutation = useCreateHolding();
  const updateMutation = useUpdateHolding();
  const deleteMutation = useDeleteHolding();
  const analysisMutation = useStartAnalysis();
  const cancelMutation = useCancelAnalysis();
  const exportMutation = useExportHoldings();
  const importMutation = useImportHoldings();

  // Price polling (Item 1)
  const tickers = useMemo(() => (holdings ?? []).map(h => h.ticker), [holdings]);
  // Batch price polling -- keeps React Query cache fresh, triggers re-render via holdings invalidation
  useBatchPrices(tickers, tickers.length > 0);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newRow, setNewRow] = useState({ ticker: '', shares: '', buy_price: '', notes: '' });

  // Confirm dialogs (Item 7)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [analysisConfirmOpen, setAnalysisConfirmOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('portfolio');
  const [analysisDropdownOpen, setAnalysisDropdownOpen] = useState(false);
  const analysisDropdownRef = useRef<HTMLDivElement>(null);

  // Fix #4: Separate depth state for portfolio and single-ticker
  const [portfolioDepth, setPortfolioDepth] = useState<AnalysisRequestDepth>('auto');
  const [singleTickerDepth, setSingleTickerDepth] = useState<AnalysisRequestDepth>('auto');

  const [singleTickerPopover, setSingleTickerPopover] = useState<string | null>(null);
  const singleTickerPopoverRef = useRef<HTMLDivElement>(null);

  // Fix #4: Reset single-ticker depth each time a popover opens
  useEffect(() => {
    if (singleTickerPopover) {
      setSingleTickerDepth('auto');
    }
  }, [singleTickerPopover]);

  // Ticker validation (Item 11)
  const [tickerInput, setTickerInput] = useState('');
  const [tickerDebounced, setTickerDebounced] = useState('');
  const tickerTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current);
    tickerTimerRef.current = setTimeout(() => {
      setTickerDebounced(tickerInput.toUpperCase().trim());
    }, 300);
    return () => { if (tickerTimerRef.current) clearTimeout(tickerTimerRef.current); };
  }, [tickerInput]);

  const { data: tickerValidation, isFetching: validatingTicker } = useValidateTicker(tickerDebounced);

  // UX-38: Save-on-blur instead of debounced-on-change
  const [savingIndicator, setSavingIndicator] = useState<string | null>(null);
  // UX-39: Inline edit validation errors
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const validateEditValues = useCallback((values: Record<string, string>): Record<string, string> => {
    const errors: Record<string, string> = {};
    const shares = Number(values.shares);
    const buyPrice = Number(values.buy_price);
    if (isNaN(shares) || shares <= 0) errors.shares = 'Shares must be > 0';
    if (isNaN(buyPrice) || buyPrice < 0) errors.buy_price = 'Price must be >= 0';
    return errors;
  }, []);

  const saveEdit = useCallback((id: string, values: Record<string, string>) => {
    const errors = validateEditValues(values);
    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSavingIndicator(id);
    updateMutation.mutate(
      {
        id,
        data: {
          ticker: values.ticker,
          shares: Number(values.shares),
          buy_price: Number(values.buy_price),
          notes: values.notes || null,
        },
      },
      {
        onSuccess: () => {
          setTimeout(() => setSavingIndicator(prev => prev === id ? null : prev), 1500);
          toast.success('Holding updated');
        },
        onError: () => {
          setSavingIndicator(null);
          toast.error('Failed to save changes');
        },
      }
    );
  }, [updateMutation, toast, validateEditValues]);

  // Import handling (Item 2)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleImportFile = useCallback((file: File) => {
    importMutation.mutate(file, {
      onSuccess: (result) => {
        toast.success(`Imported ${result.imported} holdings${result.errors.length > 0 ? ` (${result.errors.length} errors)` : ''}`);
      },
      onError: (err) => {
        toast.error(`Import failed: ${err.message}`);
      },
    });
  }, [importMutation, toast]);

  const handleExport = useCallback(() => {
    exportMutation.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'holdings.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Holdings exported');
      },
      onError: () => {
        toast.error('Export failed');
      },
    });
  }, [exportMutation, toast]);

  // Close analysis dropdown on outside click
  useEffect(() => {
    if (!analysisDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (analysisDropdownRef.current && !analysisDropdownRef.current.contains(e.target as Node)) {
        setAnalysisDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [analysisDropdownOpen]);

  // Close single-ticker depth popover on outside click
  useEffect(() => {
    if (!singleTickerPopover) return;
    const handler = (e: MouseEvent) => {
      if (singleTickerPopoverRef.current && !singleTickerPopoverRef.current.contains(e.target as Node)) {
        setSingleTickerPopover(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [singleTickerPopover]);

  // Keyboard shortcuts (Item 12)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (singleTickerPopover) {
          setSingleTickerPopover(null);
        }
        if (editingId) {
          setEditingId(null);
          setEditValues({});
          setEditErrors({});
        }
        if (showAddRow) {
          setShowAddRow(false);
          setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' });
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editingId, showAddRow, singleTickerPopover]);

  const startEdit = useCallback((row: HoldingWithPrice) => {
    setEditingId(row.id);
    setEditValues({
      ticker: row.ticker,
      shares: String(row.shares),
      buy_price: String(row.buy_price),
      notes: row.notes ?? '',
    });
    setEditErrors({});
  }, []);

  // UX-38: Just update local state; save happens on blur
  const handleEditChange = useCallback((field: string, value: string, _id: string) => {
    setEditValues(prev => ({ ...prev, [field]: value }));
    // Clear field error on change
    setEditErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // UX-38: Save when input loses focus
  const handleEditBlur = useCallback((id: string) => {
    setEditValues(prev => {
      saveEdit(id, prev);
      return prev;
    });
  }, [saveEdit]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditErrors({});
    setEditValues({});
  }, []);

  // Fix #2: Track newly added tickers to show loading spinner
  const [fetchingPriceTickers, setFetchingPriceTickers] = useState<Set<string>>(new Set());

  const handleAdd = useCallback(() => {
    if (!newRow.ticker || !newRow.shares || !newRow.buy_price) return;
    // Block if ticker is invalid (Item 11)
    if (tickerValidation && !tickerValidation.valid) return;
    const upperTicker = newRow.ticker.toUpperCase();
    createMutation.mutate(
      {
        ticker: upperTicker,
        shares: Number(newRow.shares),
        buy_price: Number(newRow.buy_price),
        notes: newRow.notes || null,
      },
      {
        onSuccess: () => {
          setShowAddRow(false);
          setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' });
          setTickerInput('');
          // Fix #2: Mark this ticker as fetching price
          setFetchingPriceTickers(prev => new Set(prev).add(upperTicker));
          toast.success(`${upperTicker} added to holdings`);
        },
        onError: (err) => {
          toast.error(`Failed to add holding: ${err.message}`);
        },
      }
    );
  }, [newRow, createMutation, toast, tickerValidation]);

  // Fix #2: Clear fetching state once the price arrives
  useEffect(() => {
    if (fetchingPriceTickers.size === 0 || !holdings) return;
    const stillFetching = new Set<string>();
    for (const t of fetchingPriceTickers) {
      const h = holdings.find(h => h.ticker === t);
      if (h && h.current_price == null) {
        stillFetching.add(t);
      }
    }
    if (stillFetching.size !== fetchingPriceTickers.size) {
      setFetchingPriceTickers(stillFetching);
    }
  }, [holdings, fetchingPriceTickers]);

  const handleDelete = useCallback((id: string) => {
    const ticker = holdings?.find(h => h.id === id)?.ticker ?? 'Holding';
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeleteConfirmId(null);
        toast.success(`${ticker} removed from holdings`);
      },
      onError: () => {
        toast.error('Failed to delete holding');
      },
    });
  }, [deleteMutation, holdings, toast]);

  // Fix #5: Track 409 retry count per invocation
  const retryCountRef = useRef(0);

  const handleStartAnalysis = useCallback((mode: AnalysisMode = 'portfolio', ticker?: string, depth?: AnalysisRequestDepth) => {
    setAnalysisConfirmOpen(false);
    setAnalysisDropdownOpen(false);
    setSingleTickerPopover(null);
    // Fix #4: Use the correct depth state depending on mode
    const depthToSend = depth ?? (mode === 'single' ? singleTickerDepth : portfolioDepth);
    analysisMutation.mutate(
      { mode, ...(ticker ? { ticker } : {}), depth: depthToSend },
      {
        onSuccess: (result) => {
          retryCountRef.current = 0;
          setActiveAnalysisJob(result.job_id);
          toast.info(`Analysis started for ${result.total_tickers} position${result.total_tickers !== 1 ? 's' : ''}`);
          navigate(`/analysis/progress/${result.job_id}`);
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.status === 409) {
            const activeJobId = err.details.active_job_id as string | undefined;
            // Fix #5: Only allow one auto-retry after cancel
            if (retryCountRef.current >= MAX_409_RETRIES) {
              retryCountRef.current = 0;
              toast.error('Still blocked -- try again manually after the current analysis finishes.');
              return;
            }
            toast.warning('Analysis already running', {
              action: activeJobId ? {
                label: 'Cancel it',
                onClick: () => {
                  cancelMutation.mutate(activeJobId, {
                    onSuccess: () => {
                      toast.info('Previous analysis cancelled. Retrying...');
                      retryCountRef.current += 1;
                      setTimeout(() => handleStartAnalysis(mode, ticker, depthToSend), 500);
                    },
                    onError: (cancelErr) => {
                      toast.error(`Failed to cancel: ${cancelErr.message}`);
                    },
                  });
                },
              } : undefined,
            });
          } else {
            toast.error(`Analysis failed: ${err.message}`);
          }
        },
      }
    );
  }, [analysisMutation, cancelMutation, navigate, toast, portfolioDepth, singleTickerDepth]);

  // Check for any stale prices (Item 16)
  const hasStalePrice = useMemo(
    () => (holdings ?? []).some(h => h.price_stale || h.current_price == null),
    [holdings]
  );

  // Fix #6: Extract edit state checks into stable callbacks to reduce column dependency array
  const isEditing = useCallback((id: string) => editingId === id, [editingId]);
  const getEditValue = useCallback((field: string) => editValues[field] ?? '', [editValues]);
  const getEditError = useCallback((field: string) => editErrors[field] ?? '', [editErrors]);
  const isSaving = useCallback((id: string) => savingIndicator === id, [savingIndicator]);
  const isFetchingPrice = useCallback((ticker: string) => fetchingPriceTickers.has(ticker), [fetchingPriceTickers]);

  // Fix #6: Stabilize columns -- only depend on identity-stable callbacks, not the entire edit state
  const columns = useMemo<ColumnDef<HoldingWithPrice>[]>(() => [
    {
      accessorKey: 'ticker',
      header: 'Ticker',
      cell: ({ row }) => {
        if (isEditing(row.original.id)) {
          return (
            <input
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm font-semibold uppercase"
              value={getEditValue('ticker')}
              onChange={e => handleEditChange('ticker', e.target.value, row.original.id)}
              onBlur={() => handleEditBlur(row.original.id)}
            />
          );
        }
        return <span className="font-semibold text-gray-900">{row.original.ticker}</span>;
      },
    },
    {
      accessorKey: 'shares',
      header: 'Shares',
      cell: ({ row }) => {
        if (isEditing(row.original.id)) {
          const hasError = !!getEditError('shares');
          return (
            <div>
              <input
                type="number"
                className={`w-24 rounded border px-2 py-1 text-sm text-right ${hasError ? 'border-red-500' : 'border-gray-300'}`}
                value={getEditValue('shares')}
                onChange={e => handleEditChange('shares', e.target.value, row.original.id)}
                onBlur={() => handleEditBlur(row.original.id)}
              />
              {hasError && <p className="text-[10px] text-red-500 mt-0.5">{getEditError('shares')}</p>}
            </div>
          );
        }
        return <span className="text-right block tabular-nums">{row.original.shares}</span>;
      },
    },
    {
      accessorKey: 'buy_price',
      header: 'Buy Price',
      cell: ({ row }) => {
        if (isEditing(row.original.id)) {
          const hasError = !!getEditError('buy_price');
          return (
            <div>
              <input
                type="number"
                step="0.01"
                className={`w-28 rounded border px-2 py-1 text-sm text-right ${hasError ? 'border-red-500' : 'border-gray-300'}`}
                value={getEditValue('buy_price')}
                onChange={e => handleEditChange('buy_price', e.target.value, row.original.id)}
                onBlur={() => handleEditBlur(row.original.id)}
              />
              {hasError && <p className="text-[10px] text-red-500 mt-0.5">{getEditError('buy_price')}</p>}
            </div>
          );
        }
        return <span className="text-right block tabular-nums">{formatCurrency(row.original.buy_price)}</span>;
      },
    },
    {
      accessorKey: 'current_price',
      header: 'Current Price',
      cell: ({ row }) => {
        const h = row.original;
        // Fix #2: Show loading spinner for newly-added tickers
        if (h.current_price == null && isFetchingPrice(h.ticker)) {
          return (
            <div className="text-right flex items-center justify-end gap-1.5">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
              <span className="text-xs text-gray-400">fetching price...</span>
            </div>
          );
        }
        // Item 16: graceful price failures
        if (h.current_price == null) {
          return (
            <div className="text-right">
              <span className="tabular-nums text-gray-400">{formatCurrency(h.buy_price)}</span>
              <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-500">no price</span>
            </div>
          );
        }
        return (
          <div className="text-right">
            <span className="tabular-nums">{formatCurrency(h.current_price)}</span>
            {h.price_stale && (
              <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-600" title="Price may be stale">stale</span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'market_value',
      header: 'Market Value',
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {row.original.market_value != null ? formatCurrency(row.original.market_value) : formatCurrency(row.original.cost_basis)}
        </span>
      ),
    },
    {
      accessorKey: 'pnl',
      header: 'P&L',
      cell: ({ row }) => {
        const h = row.original;
        if (h.pnl == null) return <span className="text-right block text-gray-400">--</span>;
        return (
          <div className="text-right">
            <span className={`tabular-nums font-medium ${pnlColor(h.pnl)}`}>
              {formatPnl(h.pnl)}
            </span>
            <span className={`block text-xs ${pnlColor(h.pnl_pct)}`}>
              {formatPnlPercent(h.pnl_pct)}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'weight',
      header: 'Weight',
      cell: ({ row }) => (
        <span className="text-right block tabular-nums">
          {row.original.weight != null ? formatPercent(row.original.weight) : '--'}
        </span>
      ),
    },
    // Fix #1: Notes column
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ row }) => {
        if (isEditing(row.original.id)) {
          return (
            <input
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
              value={getEditValue('notes')}
              onChange={e => handleEditChange('notes', e.target.value, row.original.id)}
              onBlur={() => handleEditBlur(row.original.id)}
              placeholder="Add note..."
            />
          );
        }
        const notes = row.original.notes;
        if (!notes) return <span className="text-gray-300">--</span>;
        return (
          <span className="text-sm text-gray-600 block truncate max-w-[10rem]" title={notes}>
            {notes}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        if (isEditing(row.original.id)) {
          return (
            <div className="flex items-center gap-1">
              {isSaving(row.original.id) ? (
                <span className="text-xs text-emerald-600 font-medium">Saved</span>
              ) : (
                <span className="text-xs text-gray-400">Auto-saves</span>
              )}
              <button onClick={cancelEdit} className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">Done</button>
            </div>
          );
        }
        return (
          <div className="flex gap-1">
            <div className="relative" ref={singleTickerPopover === row.original.ticker ? singleTickerPopoverRef : undefined}>
              <button
                onClick={() => setSingleTickerPopover(prev => prev === row.original.ticker ? null : row.original.ticker)}
                disabled={analysisMutation.isPending}
                className="rounded px-1.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                title={`Analyze ${row.original.ticker}`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </button>
              {singleTickerPopover === row.original.ticker && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
                  role="dialog"
                  aria-label={`Analyze ${row.original.ticker}`}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setSingleTickerPopover(null); } }}
                >
                  <p className="text-xs font-semibold text-gray-900 mb-2">Analyze {row.original.ticker}</p>
                  {/* Fix #4: Use singleTickerDepth state */}
                  <DepthSelector value={singleTickerDepth} onChange={setSingleTickerDepth} compact />
                  <button
                    onClick={() => handleStartAnalysis('single', row.original.ticker, singleTickerDepth)}
                    disabled={analysisMutation.isPending}
                    className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                    autoFocus
                  >
                    {analysisMutation.isPending ? 'Starting...' : 'Start Analysis'}
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => startEdit(row.original)} className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</button>
            <button onClick={() => setDeleteConfirmId(row.original.id)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
          </div>
        );
      },
    },
  ], [isEditing, getEditValue, getEditError, isSaving, isFetchingPrice, handleEditChange, handleEditBlur, cancelEdit, startEdit, handleStartAnalysis, analysisMutation.isPending, singleTickerPopover, singleTickerDepth]);

  const table = useReactTable({
    data: holdings ?? [],
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  // Loading skeleton (Item 8)
  if (isLoading) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holdings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your portfolio positions</p>
        </div>
      </div>
      <SkeletonTable rows={5} columns={9} />
    </div>
  );

  // Error state (Item 9)
  if (holdingsError) return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Holdings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your portfolio positions</p>
      </div>
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm font-medium text-red-800">Failed to load holdings: {holdingsError.message}</p>
      </div>
    </div>
  );

  const deleteTarget = holdings?.find(h => h.id === deleteConfirmId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holdings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your portfolio positions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Split button: Analyze Portfolio (primary) + dropdown for other modes */}
          <div className="relative inline-flex" ref={analysisDropdownRef}>
            <button
              onClick={() => {
                if (!holdings || holdings.length === 0) {
                  toast.warning('Add holdings before running analysis');
                  return;
                }
                setAnalysisMode('portfolio');
                setAnalysisConfirmOpen(true);
              }}
              disabled={analysisMutation.isPending}
              className="rounded-l-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors"
            >
              {analysisMutation.isPending ? 'Starting...' : 'Analyze Portfolio'}
            </button>
            <button
              onClick={() => {
                if (!holdings || holdings.length === 0) {
                  toast.warning('Add holdings before running analysis');
                  return;
                }
                setAnalysisDropdownOpen(prev => !prev);
              }}
              disabled={analysisMutation.isPending}
              className="rounded-r-lg border-l border-emerald-700 bg-emerald-600 px-2 py-2.5 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              aria-label="More analysis options"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
            {analysisDropdownOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => {
                    setAnalysisMode('portfolio');
                    setAnalysisDropdownOpen(false);
                    setAnalysisConfirmOpen(true);
                  }}
                  className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-900">Analyze Portfolio</span>
                  <span className="text-xs text-gray-500">Tiered depth with portfolio synthesis</span>
                </button>
                <button
                  onClick={() => {
                    setAnalysisMode('all_individual');
                    setAnalysisDropdownOpen(false);
                    setAnalysisConfirmOpen(true);
                  }}
                  className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="text-sm font-medium text-gray-900">Analyze All (Full Depth)</span>
                  <span className="text-xs text-gray-500">Full analysis on every holding -- may take a while</span>
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={exportMutation.isPending || !holdings?.length}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {importMutation.isPending ? 'Importing...' : 'Import CSV'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => setShowAddRow(true)}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
          >
            Add Position
          </button>
        </div>
      </div>

      {/* Stale price banner (Item 16) */}
      {hasStalePrice && holdings && holdings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-amber-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-amber-700">Price data may be delayed. Prices refresh every 30 seconds.</p>
        </div>
      )}

      {/* Filter */}
      <div>
        <input
          type="text"
          placeholder="Filter by ticker..."
          value={globalFilter}
          onChange={e => setGlobalFilter(e.target.value)}
          className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>

      {/* Table */}
      {(!holdings || holdings.length === 0) && !showAddRow ? (
        <>
          {/* Import drag-drop zone (Item 2) -- full size when empty */}
          <div
            className={`rounded-xl border-2 border-dashed p-8 text-center text-sm transition-colors ${
              dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-gray-50/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file && file.name.endsWith('.csv')) handleImportFile(file);
              else toast.warning('Please drop a CSV file');
            }}
          >
            <p className="text-gray-500">Drag and drop a CSV file here to import holdings</p>
          </div>
          <EmptyState
            title="No holdings yet"
            description="Add your first position above, or import a CSV."
            action={{ label: 'Add Position', onClick: () => setShowAddRow(true) }}
          />
        </>
      ) : (
        <>
          {/* UX-37: Mobile card layout (<768px) */}
          <div className="md:hidden space-y-3">
            {table.getRowModel().rows.map(row => {
              const h = row.original;
              const pnlVal = h.pnl;
              return (
                <div key={row.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-900">{h.ticker}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSingleTickerPopover(prev => prev === h.ticker ? null : h.ticker)}
                        disabled={analysisMutation.isPending}
                        className="rounded px-1.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        title={`Analyze ${h.ticker}`}
                      >
                        Analyze
                      </button>
                      <button onClick={() => startEdit(h)} className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</button>
                      <button onClick={() => setDeleteConfirmId(h.id)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <span className="text-xs text-gray-500">Shares</span>
                      <p className="tabular-nums">{h.shares}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Buy Price</span>
                      <p className="tabular-nums">{formatCurrency(h.buy_price)}</p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Current Price</span>
                      <p className="tabular-nums">
                        {h.current_price != null ? formatCurrency(h.current_price) : formatCurrency(h.buy_price)}
                        {h.price_stale && <span className="ml-1 text-[10px] text-amber-600">stale</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">P&L</span>
                      {pnlVal != null ? (
                        <p className={`tabular-nums font-medium ${pnlColor(pnlVal)}`}>
                          {formatPnl(pnlVal)} ({formatPnlPercent(h.pnl_pct)})
                        </p>
                      ) : (
                        <p className="text-gray-400">--</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table (hidden on mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              {/* Fix #7: aria-sort on sorted column headers, button elements for sort triggers */}
              <thead className="bg-gray-50">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => {
                      const sorted = header.column.getIsSorted();
                      const ariaSort: 'ascending' | 'descending' | 'none' =
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
                      const canSort = header.column.getCanSort();
                      return (
                        <th
                          key={header.id}
                          className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                          aria-sort={canSort ? ariaSort : undefined}
                        >
                          {canSort ? (
                            <button
                              type="button"
                              className="flex items-center gap-1 hover:text-gray-700 select-none cursor-pointer"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' && <span className="text-gray-400">^</span>}
                              {sorted === 'desc' && <span className="text-gray-400">v</span>}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-gray-100">
                {showAddRow && (
                  <tr className="bg-blue-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          placeholder="AAPL"
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-sm font-semibold uppercase"
                          value={newRow.ticker}
                          onChange={e => {
                            const val = e.target.value;
                            setNewRow(r => ({ ...r, ticker: val }));
                            setTickerInput(val);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                          autoFocus
                        />
                        {/* Ticker validation indicator (Item 11) */}
                        {tickerInput.length > 0 && !validatingTicker && tickerValidation && (
                          tickerValidation.valid ? (
                            <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Valid ticker">
                              <title>Valid ticker symbol</title>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-label="Invalid ticker">
                              <title>Ticker not recognized</title>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )
                        )}
                        {validatingTicker && tickerInput.length > 0 && (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        placeholder="100"
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm text-right"
                        value={newRow.shares}
                        onChange={e => setNewRow(r => ({ ...r, shares: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="150.00"
                        className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-right"
                        value={newRow.buy_price}
                        onChange={e => setNewRow(r => ({ ...r, buy_price: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">--</td>
                    <td className="px-4 py-3 text-sm text-gray-400">--</td>
                    <td className="px-4 py-3 text-sm text-gray-400">--</td>
                    <td className="px-4 py-3 text-sm text-gray-400">--</td>
                    {/* Fix #1: Notes input in add row form */}
                    <td className="px-4 py-3">
                      <input
                        placeholder="Notes..."
                        className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                        value={newRow.notes}
                        onChange={e => setNewRow(r => ({ ...r, notes: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={handleAdd}
                          disabled={createMutation.isPending || (tickerValidation != null && !tickerValidation.valid)}
                          className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {createMutation.isPending ? 'Adding...' : 'Add'}
                        </button>
                        <button
                          onClick={() => {
                            setShowAddRow(false);
                            setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' });
                            setTickerInput('');
                          }}
                          className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 text-sm">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fix #3: Always-visible CSV drop zone when holdings exist (subtle/compact) */}
          <div
            className={`rounded-lg border-2 border-dashed px-4 py-2.5 text-center text-xs transition-colors ${
              dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-gray-50/30'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file && file.name.endsWith('.csv')) handleImportFile(file);
              else toast.warning('Please drop a CSV file');
            }}
          >
            <p className="text-gray-400">Drop CSV to import more holdings</p>
          </div>
        </>
      )}

      {/* Confirm Dialogs (Item 7) */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="Delete Holding"
        message={`Are you sure you want to remove ${deleteTarget?.ticker ?? 'this holding'}? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <ConfirmDialog
        open={analysisConfirmOpen}
        title={analysisMode === 'all_individual' ? 'Analyze All' : 'Analyze Portfolio'}
        confirmLabel="Start Analysis"
        onConfirm={() => handleStartAnalysis(analysisMode)}
        onCancel={() => { setAnalysisConfirmOpen(false); setPortfolioDepth('auto'); }}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {holdings?.length ?? 0} position{(holdings?.length ?? 0) !== 1 ? 's' : ''} will be analyzed.
          </p>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Analysis Depth</label>
            {/* Fix #4: Use portfolioDepth for the main dialog */}
            <DepthSelector value={portfolioDepth} onChange={setPortfolioDepth} />
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span>Estimated time</span>
              <span className="font-semibold text-gray-900">{estimateTime(holdings?.length ?? 0, portfolioDepth)}</span>
            </div>
            {portfolioDepth === 'auto' && (holdings?.length ?? 0) > 0 && (() => {
              const breakdown = estimateAutoBreakdown(holdings?.length ?? 0);
              return (
                <div className="flex justify-between text-gray-500">
                  <span>Estimated breakdown</span>
                  <span>{breakdown.deep} deep, {breakdown.medium} medium, {breakdown.light} light</span>
                </div>
              );
            })()}
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
