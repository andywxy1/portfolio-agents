import { useState, useMemo, useCallback } from 'react';
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
} from '../../api/hooks';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import {
  formatCurrency,
  formatPnl,
  formatPnlPercent,
  formatPercent,
  pnlColor,
} from '../../utils/format';
import type { HoldingWithPrice } from '../../types';

export default function Holdings() {
  const { data: holdings, isLoading } = useHoldings();
  const createMutation = useCreateHolding();
  const updateMutation = useUpdateHolding();
  const deleteMutation = useDeleteHolding();
  const analysisMutation = useStartAnalysis();

  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [showAddRow, setShowAddRow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [newRow, setNewRow] = useState({ ticker: '', shares: '', buy_price: '', notes: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const startEdit = useCallback((row: HoldingWithPrice) => {
    setEditingId(row.id);
    setEditValues({
      ticker: row.ticker,
      shares: String(row.shares),
      buy_price: String(row.buy_price),
      notes: row.notes ?? '',
    });
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId) return;
    updateMutation.mutate({
      id: editingId,
      data: {
        ticker: editValues.ticker,
        shares: Number(editValues.shares),
        buy_price: Number(editValues.buy_price),
        notes: editValues.notes || null,
      },
    });
    setEditingId(null);
  }, [editingId, editValues, updateMutation]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValues({});
  }, []);

  const handleAdd = useCallback(() => {
    if (!newRow.ticker || !newRow.shares || !newRow.buy_price) return;
    createMutation.mutate(
      {
        ticker: newRow.ticker.toUpperCase(),
        shares: Number(newRow.shares),
        buy_price: Number(newRow.buy_price),
        notes: newRow.notes || null,
      },
      { onSuccess: () => { setShowAddRow(false); setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' }); } }
    );
  }, [newRow, createMutation]);

  const handleDelete = useCallback((id: string) => {
    deleteMutation.mutate(id, { onSuccess: () => setDeleteConfirm(null) });
  }, [deleteMutation]);

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
              onChange={e => setEditValues(v => ({ ...v, ticker: e.target.value }))}
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
              onChange={e => setEditValues(v => ({ ...v, shares: e.target.value }))}
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
              onChange={e => setEditValues(v => ({ ...v, buy_price: e.target.value }))}
            />
          );
        }
        return <span className="text-right block tabular-nums">{formatCurrency(row.original.buy_price)}</span>;
      },
    },
    {
      accessorKey: 'current_price',
      header: 'Current Price',
      cell: ({ row }) => (
        <div className="text-right">
          <span className="tabular-nums">{formatCurrency(row.original.current_price)}</span>
          {row.original.price_stale && (
            <span className="ml-1 text-xs text-amber-500" title="Price may be stale">*</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'market_value',
      header: 'Market Value',
      cell: ({ row }) => <span className="text-right block tabular-nums">{formatCurrency(row.original.market_value)}</span>,
    },
    {
      accessorKey: 'pnl',
      header: 'P&L',
      cell: ({ row }) => (
        <div className="text-right">
          <span className={`tabular-nums font-medium ${pnlColor(row.original.pnl)}`}>
            {formatPnl(row.original.pnl)}
          </span>
          <span className={`block text-xs ${pnlColor(row.original.pnl_pct)}`}>
            {formatPnlPercent(row.original.pnl_pct)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'weight',
      header: 'Weight',
      cell: ({ row }) => <span className="text-right block tabular-nums">{formatPercent(row.original.weight)}</span>,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        if (editingId === row.original.id) {
          return (
            <div className="flex gap-1">
              <button onClick={saveEdit} className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Save</button>
              <button onClick={cancelEdit} className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">Cancel</button>
            </div>
          );
        }
        if (deleteConfirm === row.original.id) {
          return (
            <div className="flex gap-1">
              <button onClick={() => handleDelete(row.original.id)} className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">Confirm</button>
              <button onClick={() => setDeleteConfirm(null)} className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">Cancel</button>
            </div>
          );
        }
        return (
          <div className="flex gap-1">
            <button onClick={() => startEdit(row.original)} className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">Edit</button>
            <button onClick={() => setDeleteConfirm(row.original.id)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
          </div>
        );
      },
    },
  ], [editingId, editValues, deleteConfirm, saveEdit, cancelEdit, startEdit, handleDelete]);

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

  if (isLoading) return <LoadingSpinner label="Loading holdings..." />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holdings</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your portfolio positions</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => analysisMutation.mutate({})}
            disabled={analysisMutation.isPending}
            className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {analysisMutation.isPending ? 'Starting...' : 'Run Analysis'}
          </button>
          <button
            onClick={() => setShowAddRow(true)}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors"
          >
            Add Position
          </button>
        </div>
      </div>

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
        <EmptyState
          title="No holdings yet"
          description="Add your first position to get started."
          action={{ label: 'Add Position', onClick: () => setShowAddRow(true) }}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
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
                    <input
                      placeholder="AAPL"
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm font-semibold uppercase"
                      value={newRow.ticker}
                      onChange={e => setNewRow(r => ({ ...r, ticker: e.target.value }))}
                      autoFocus
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      placeholder="100"
                      className="w-24 rounded border border-gray-300 px-2 py-1 text-sm text-right"
                      value={newRow.shares}
                      onChange={e => setNewRow(r => ({ ...r, shares: e.target.value }))}
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
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">--</td>
                  <td className="px-4 py-3 text-sm text-gray-400">--</td>
                  <td className="px-4 py-3 text-sm text-gray-400">--</td>
                  <td className="px-4 py-3 text-sm text-gray-400">--</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={handleAdd} disabled={createMutation.isPending} className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                        {createMutation.isPending ? 'Adding...' : 'Add'}
                      </button>
                      <button onClick={() => { setShowAddRow(false); setNewRow({ ticker: '', shares: '', buy_price: '', notes: '' }); }} className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">
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

      {analysisMutation.isSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            Analysis started. Check the Analysis page for results.
          </p>
        </div>
      )}
    </div>
  );
}
