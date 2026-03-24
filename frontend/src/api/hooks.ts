import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getConfigStatus, getConfig, updateConfig, validateConfig } from './client';
import {
  mockStore,
  mockPortfolioSummary,
  mockAnalysisJobs,
  mockPositionAnalyses,
  mockLatestAnalysis,
  mockSuggestions,
  mockPnlHistory,
  delay,
} from './mockData';
import type {
  HoldingWithPrice,
  Holding,
  HoldingCreate,
  HoldingUpdate,
  PortfolioSummary,
  AnalysisJob,
  StartAnalysisRequest,
  StartAnalysisResponse,
  LatestAnalysisResponse,
  Recommendation,
  UpdateRecommendationRequest,
  PaginatedResponse,
  StockSuggestion,
  AppConfig,
  ConfigStatus,
  ValidationResult,
  PriceData,
} from '../types';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';

// Keys to invalidate when holdings change (Item 4)
const HOLDINGS_RELATED_KEYS = [
  ['holdings'],
  ['portfolio-summary'],
  ['recommendations'],
  ['analysis', 'latest'],
] as const;

function invalidateHoldingsRelated(qc: ReturnType<typeof useQueryClient>) {
  for (const key of HOLDINGS_RELATED_KEYS) {
    qc.invalidateQueries({ queryKey: [...key] });
  }
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export function useHoldings() {
  return useQuery<HoldingWithPrice[]>({
    queryKey: ['holdings'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockStore.getHoldings();
      }
      return apiClient.get<HoldingWithPrice[]>('/holdings');
    },
  });
}

export function useCreateHolding() {
  const qc = useQueryClient();
  return useMutation<Holding, Error, HoldingCreate>({
    mutationFn: async (data) => {
      if (USE_MOCKS) {
        await delay(300);
        return mockStore.addHolding(data);
      }
      return apiClient.post<Holding>('/holdings', data);
    },
    onSuccess: () => {
      invalidateHoldingsRelated(qc);
    },
  });
}

export function useUpdateHolding() {
  const qc = useQueryClient();
  return useMutation<Holding | null, Error, { id: string; data: HoldingUpdate }>({
    mutationFn: async ({ id, data }) => {
      if (USE_MOCKS) {
        await delay(200);
        return mockStore.updateHolding(id, data);
      }
      return apiClient.put<Holding>(`/holdings/${id}`, data);
    },
    onSuccess: () => {
      invalidateHoldingsRelated(qc);
    },
  });
}

export function useDeleteHolding() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, string>({
    mutationFn: async (id) => {
      if (USE_MOCKS) {
        await delay(200);
        return mockStore.deleteHolding(id);
      }
      await apiClient.delete(`/holdings/${id}`);
      return true;
    },
    onSuccess: () => {
      invalidateHoldingsRelated(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Prices - batch polling (Item 1)
// ---------------------------------------------------------------------------

export function useBatchPrices(tickers: string[], enabled = true) {
  return useQuery<Record<string, PriceData>>({
    queryKey: ['prices', 'batch', tickers],
    queryFn: async () => {
      if (USE_MOCKS || tickers.length === 0) return {};
      const qs = `tickers=${tickers.map(t => encodeURIComponent(t)).join(',')}`;
      const resp = await apiClient.get<{ prices: Record<string, PriceData> }>(`/prices/batch?${qs}`);
      return resp.prices;
    },
    enabled: enabled && tickers.length > 0,
    refetchInterval: 30_000, // Poll every 30 seconds
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Ticker validation (Item 11)
// ---------------------------------------------------------------------------

export function useValidateTicker(ticker: string) {
  return useQuery<{ valid: boolean; name?: string }>({
    queryKey: ['ticker-validate', ticker],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay(200);
        // In mock mode, accept any 1-5 char uppercase ticker
        const valid = /^[A-Z]{1,5}$/.test(ticker.toUpperCase());
        return { valid };
      }
      return apiClient.get<{ valid: boolean; name?: string }>(`/tickers/validate?ticker=${encodeURIComponent(ticker)}`);
    },
    enabled: ticker.length >= 1 && ticker.length <= 5,
    staleTime: 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Import / Export (Item 2)
// ---------------------------------------------------------------------------

export function useExportHoldings() {
  return useMutation<Blob, Error, void>({
    mutationFn: async () => {
      const response = await fetch('/api/holdings/export', {
        method: 'GET',
        headers: { 'Content-Type': 'text/csv' },
      });
      if (!response.ok) throw new Error('Export failed');
      return response.blob();
    },
  });
}

export function useImportHoldings() {
  const qc = useQueryClient();
  return useMutation<{ imported: number; errors: string[] }, Error, File>({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/holdings/import', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: { message: 'Import failed' } }));
        throw new Error(err.error?.message ?? 'Import failed');
      }
      return response.json();
    },
    onSuccess: () => {
      invalidateHoldingsRelated(qc);
    },
  });
}

// ---------------------------------------------------------------------------
// Portfolio Summary
// ---------------------------------------------------------------------------

export function usePortfolioSummary() {
  return useQuery<PortfolioSummary>({
    queryKey: ['portfolio-summary'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockPortfolioSummary;
      }
      return apiClient.get<PortfolioSummary>('/portfolio/summary');
    },
  });
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export function useStartAnalysis() {
  const qc = useQueryClient();
  return useMutation<StartAnalysisResponse, Error, StartAnalysisRequest>({
    mutationFn: async (data) => {
      if (USE_MOCKS) {
        await delay(500);
        return {
          job_id: crypto.randomUUID(),
          status: 'pending' as const,
          tickers: data.tickers ?? mockStore.getHoldings().map(h => h.ticker),
          total_tickers: data.tickers?.length ?? mockStore.getHoldings().length,
        };
      }
      return apiClient.post<StartAnalysisResponse>('/analysis/start', data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['analysis'] });
    },
  });
}

export function useAnalysisJob(jobId: string | undefined) {
  return useQuery<AnalysisJob>({
    queryKey: ['analysis', 'job', jobId],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockAnalysisJobs.find(j => j.id === jobId) ?? mockAnalysisJobs[0];
      }
      return apiClient.get<AnalysisJob>(`/analysis/jobs/${jobId}`);
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'pending' || status === 'running') return 3000;
      return false;
    },
  });
}

export function useLatestAnalysis() {
  return useQuery<LatestAnalysisResponse>({
    queryKey: ['analysis', 'latest'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockLatestAnalysis;
      }
      return apiClient.get<LatestAnalysisResponse>('/analysis/latest');
    },
  });
}

// ---------------------------------------------------------------------------
// Analysis History
// ---------------------------------------------------------------------------

export function useAnalysisHistory() {
  return useQuery<AnalysisJob[]>({
    queryKey: ['analysis', 'history'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockAnalysisJobs;
      }
      return apiClient.get<AnalysisJob[]>('/analysis/jobs');
    },
  });
}

export function usePnlHistory() {
  return useQuery({
    queryKey: ['pnl-history'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockPnlHistory;
      }
      return apiClient.get<typeof mockPnlHistory>('/portfolio/pnl-history');
    },
  });
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export function useRecommendations(params?: { status?: string }) {
  return useQuery<PaginatedResponse<Recommendation>>({
    queryKey: ['recommendations', params],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        let data = mockStore.recommendations;
        if (params?.status) {
          data = data.filter(r => r.status === params.status);
        }
        return {
          data,
          total: data.length,
          page: 1,
          page_size: 50,
          has_more: false,
        };
      }
      const qs = params?.status ? `?status=${params.status}` : '';
      return apiClient.get<PaginatedResponse<Recommendation>>(`/recommendations${qs}`);
    },
  });
}

export function useUpdateRecommendation() {
  const qc = useQueryClient();
  return useMutation<Recommendation | null, Error, { id: string; data: UpdateRecommendationRequest }>({
    mutationFn: async ({ id, data }) => {
      if (USE_MOCKS) {
        await delay(300);
        return mockStore.updateRecommendation(id, data.status, data.status_note);
      }
      return apiClient.patch<Recommendation>(`/recommendations/${id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recommendations'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export function useSuggestions() {
  return useQuery<StockSuggestion[]>({
    queryKey: ['suggestions'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockSuggestions;
      }
      return apiClient.get<StockSuggestion[]>('/suggestions');
    },
  });
}

// ---------------------------------------------------------------------------
// Position Analysis detail
// ---------------------------------------------------------------------------

export function usePositionAnalyses() {
  return useQuery({
    queryKey: ['position-analyses'],
    queryFn: async () => {
      if (USE_MOCKS) {
        await delay();
        return mockPositionAnalyses;
      }
      const latest = await apiClient.get<LatestAnalysisResponse>('/analysis/latest');
      return latest.position_analyses;
    },
  });
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function useConfigStatus() {
  return useQuery<ConfigStatus>({
    queryKey: ['config-status'],
    queryFn: getConfigStatus,
    retry: false,
    staleTime: 0,
  });
}

export function useConfig() {
  return useQuery<AppConfig>({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation<AppConfig, Error, Partial<AppConfig>>({
    mutationFn: updateConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      qc.invalidateQueries({ queryKey: ['config-status'] });
    },
  });
}

export function useValidateConfig() {
  return useMutation<ValidationResult, Error, Partial<AppConfig>>({
    mutationFn: validateConfig,
  });
}
