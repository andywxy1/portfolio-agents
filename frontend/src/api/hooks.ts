import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
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
} from '../types';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';

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
      qc.invalidateQueries({ queryKey: ['holdings'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
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
      qc.invalidateQueries({ queryKey: ['holdings'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
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
      qc.invalidateQueries({ queryKey: ['holdings'] });
      qc.invalidateQueries({ queryKey: ['portfolio-summary'] });
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
      // Backend would need a list endpoint; for now use mock
      return mockAnalysisJobs;
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
      return mockPnlHistory;
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
