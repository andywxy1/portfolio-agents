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
  useBatchPrices,
  useValidateTicker,
  useExportHoldings,
  useImportHoldings,
} from '../../api/hooks';
import { SkeletonTable } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  formatCurrency,
  formatPnl,
  formatPnlPercent,
  formatPercent,
  pnlColor,
} from '../../utils/format';
import type { HoldingWithPrice } from '../../types';

export default function Holdings() {
  usePageTitle('Holdings');
  const navigate = useNavigate();
  const toast = useToast();

  const { data: holdings, isLoading, error: holdingsError } = useHoldings();
  const createMutation = useCreateHolding();
  const updateMutation = useUpdateHolding();
  const deleteMutation = useDeleteHolding();
  const analysisMutation = useStartAnalysis();
  const exportMutation = useExportHoldings();
  const importMutation = useImportHoldings();

  // Price polling (Item 1)
  const tickers = useMemo(() => (holdings ?? []).map(h => h.ticker), [holdings]);
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

  // Auto-save debounce for inline edits (Item 17)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [savingIndicator, setSavingIndicator] = useState<string | null>(null);

  const triggerAutoSave = useCallback((id: string, values: Record<string, string>) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
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
    }, 500);
  }, [updateMutation, toast]);

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

  // Keyboard shortcuts (Item 12)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null);
          setEditValues({});
        }
        if (showAddRow) {
          setShowAddRow(false);
          setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' });
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editingId, showAddRow]);

  const startEdit = useCallback((row: HoldingWithPrice) => {
    setEditingId(row.id);
    setEditValues({
      ticker: row.ticker,
      shares: String(row.shares),
      buy_price: String(row.buy_price),
      notes: row.notes ?? '',
    });
  }, []);

  const handleEditChange = useCallback((field: string, value: string, id: string) => {
    setEditValues(prev => {
      const updated = { ...prev, [field]: value };
      triggerAutoSave(id, updated);
      return updated;
    });
  }, [triggerAutoSave]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValues({});
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
  }, []);

  const handleAdd = useCallback(() => {
    if (!newRow.ticker || !newRow.shares || !newRow.buy_price) return;
    // Block if ticker is invalid (Item 11)
    if (tickerValidation && !tickerValidation.valid) return;
    createMutation.mutate(
      {
        ticker: newRow.ticker.toUpperCase(),
        shares: Number(newRow.shares),
        buy_price: Number(newRow.buy_price),
        notes: newRow.notes || null,
      },
      {
        onSuccess: () => {
          setShowAddRow(false);
          setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' });
          setTickerInput('');
          toast.success(`${newRow.ticker.toUpperCase()} added to holdings`);
        },
        onError: (err) => {
          toast.error(`Failed to add holding: ${err.message}`);
        },
      }
    );
  }, [newRow, createMutation, toast, tickerValidation]);

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

  const handleStartAnalysis = useCallback(() => {
    setAnalysisConfirmOpen(false);
    analysisMutation.mutate(
      {},
      {
        onSuccess: (result) => {
          toast.info(`Analysis started for ${result.total_tickers} positions`);
          navigate(`/analysis/progress/${result.job_id}`);
        },
        onError: (err) => {
          toast.error(`Analysis failed: ${err.message}`);
        },
      }
    );
  }, [analysisMutation, navigate, toast]);

  // Check for any stale prices (Item 16)
  const hasStalePrice = useMemo(
    () => (holdings ?? []).some(h => h.price_stale || h.current_price == null),
    [holdings]
  );

  const columns = useMemo<ColumnDef<HoldingWithPrice>[]>(() => [
    {
      accessorKey: 'ticker',
      header: 'Ticker',
      cell: ({ row }) => {
        if (editingId === row.original.id) {
          return (
            <input
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm font-semibold uppercase"
              value={editValues.ticker}
              onChange={e => handleEditChange('ticker', e.target.value, row.original.id)}
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
        if (editingId === row.original.id) {
          return (
            <input
              type="number"
              className="w-24 rounded border border-gray-300 px-2 py-1 text-sm text-right"
              value={editValues.shares}
              onChange={e => handleEditChange('shares', e.target.value, row.original.id)}
            />
          );
        }
        return <span className="text-right block tabular-nums">{row.original.shares}</span>;
      },
    },
    {
      accessorKey: 'buy_price',
      header: 'Buy Price',
      cell: ({ row }) => {
        if (editingId === row.original.id) {
          return (
            <input
              type="number"
              step="0.01"
              className="w-28 rounded border border-gray-300 px-2 py-1 text-sm text-right"
              value={editValues.buy_price}
              onChange={e => handleEditChange('buy_price', e.target.value, row.original.id)}
            />
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
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        if (editingId === row.original.id) {
          return (
            <div className="flex items-center gap-1">
              {savingIndicator === row.original.id ? (
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
            <button onClick={() => startEdit(row.original)} className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</button>
            <button onClick={() => setDeleteConfirmId(row.original.id)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
          </div>
        );
      },
    },
  ], [editingId, editValues, savingIndicator, handleEditChange, cancelEdit, startEdit]);

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
      <SkeletonTable rows={5} columns={8} />
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
          <button
            onClick={() => {
              if (!holdings || holdings.length === 0) {
                toast.warning('Add holdings before running analysis');
                return;
              }
              setAnalysisConfirmOpen(true);
            }}
            disabled={analysisMutation.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {analysisMutation.isPending ? 'Starting...' : 'Run Analysis'}
          </button>
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

      {/* Import drag-drop zone (Item 2) */}
      <div
        className={`rounded-xl border-2 border-dashed p-4 text-center text-sm transition-colors ${
          dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-gray-50/50'
        } ${holdings && holdings.length > 0 ? 'hidden' : ''}`}
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

      {/* Table */}
      {(!holdings || holdings.length === 0) && !showAddRow ? (
        <EmptyState
          title="No holdings yet"
          description="Add your first position above, or import a CSV."
          action={{ label: 'Add Position', onClick: () => setShowAddRow(true) }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && <span className="text-gray-400">^</span>}
                        {header.column.getIsSorted() === 'desc' && <span className="text-gray-400">v</span>}
                      </div>
                    </th>
                  ))}
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
                          <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
        title="Run Analysis"
        message={`Analyze ${holdings?.length ?? 0} position${(holdings?.length ?? 0) !== 1 ? 's' : ''}? This will use AI to evaluate each holding.`}
        confirmLabel="Start Analysis"
        onConfirm={handleStartAnalysis}
        onCancel={() => setAnalysisConfirmOpen(false)}
      />
    </div>
  );
}
