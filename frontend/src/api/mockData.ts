import type {
  HoldingWithPrice,
  Holding,
  PortfolioSummary,
  AnalysisJob,
  PositionAnalysis,
  LatestAnalysisResponse,
  Recommendation,
  StockSuggestion,
  PortfolioInsight,
} from '../types';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Mock data is now EMPTY by default (Item 3)
// The VITE_USE_MOCKS flag can stay but returns empty arrays.
// ---------------------------------------------------------------------------

export const mockHoldings: HoldingWithPrice[] = [];

export const mockPortfolioSummary: PortfolioSummary = {
  total_value: null,
  total_cost_basis: 0,
  total_pnl: null,
  total_pnl_pct: null,
  holdings_count: 0,
  allocation: [],
  sector_breakdown: [],
  concentration: null,
  prices_as_of: null,
  any_prices_stale: false,
};

export const mockPositionAnalyses: PositionAnalysis[] = [];

export const mockAnalysisJobs: AnalysisJob[] = [];

export const mockPortfolioInsight: PortfolioInsight | null = null;

export const mockRecommendations: Recommendation[] = [];

export const mockSuggestions: StockSuggestion[] = [];

export const mockPnlHistory: { date: string; value: number; pnl: number; pnl_pct: number }[] = [];

export const mockLatestAnalysis: LatestAnalysisResponse = {
  job: null,
  position_analyses: [],
  portfolio_insight: null,
  recommendations: [],
  suggestions: [],
};

// ---------------------------------------------------------------------------
// Helper: simulate delay
// ---------------------------------------------------------------------------

export function delay(ms = 400): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Mock store for mutable operations
// ---------------------------------------------------------------------------

let holdingsStore: HoldingWithPrice[] = [];

export const mockStore = {
  getHoldings(): HoldingWithPrice[] {
    return holdingsStore;
  },

  addHolding(data: { ticker: string; shares: number; buy_price: number; notes?: string | null }): Holding {
    const holding: HoldingWithPrice = {
      id: uuid(),
      user_id: 'default',
      ticker: data.ticker.toUpperCase(),
      shares: data.shares,
      buy_price: data.buy_price,
      notes: data.notes ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_price: null,
      market_value: null,
      cost_basis: data.shares * data.buy_price,
      pnl: null,
      pnl_pct: null,
      weight: null,
      price_stale: true,
    };
    holdingsStore = [...holdingsStore, holding];
    return holding;
  },

  updateHolding(id: string, data: { ticker?: string; shares?: number; buy_price?: number; notes?: string | null }): Holding | null {
    const idx = holdingsStore.findIndex(h => h.id === id);
    if (idx === -1) return null;
    const updated = {
      ...holdingsStore[idx],
      ...data,
      updated_at: new Date().toISOString(),
    };
    if (data.shares !== undefined || data.buy_price !== undefined) {
      updated.cost_basis = (data.shares ?? updated.shares) * (data.buy_price ?? updated.buy_price);
    }
    holdingsStore = holdingsStore.map((h, i) => (i === idx ? updated : h));
    return updated;
  },

  deleteHolding(id: string): boolean {
    const len = holdingsStore.length;
    holdingsStore = holdingsStore.filter(h => h.id !== id);
    return holdingsStore.length < len;
  },

  recommendations: [] as Recommendation[],

  updateRecommendation(id: string, status: 'accepted' | 'dismissed', note?: string): Recommendation | null {
    const idx = this.recommendations.findIndex(r => r.id === id);
    if (idx === -1) return null;
    const updated = {
      ...this.recommendations[idx],
      status,
      status_changed_at: new Date().toISOString(),
      status_note: note ?? null,
      updated_at: new Date().toISOString(),
    };
    this.recommendations[idx] = updated;
    return updated;
  },
};
