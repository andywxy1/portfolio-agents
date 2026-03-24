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

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
const weekAgo = new Date(Date.now() - 604800000).toISOString();

function uuid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export const mockHoldings: HoldingWithPrice[] = [
  {
    id: uuid(), user_id: 'default', ticker: 'AAPL', shares: 150, buy_price: 142.50,
    notes: 'Core position', created_at: weekAgo, updated_at: yesterday,
    current_price: 178.72, market_value: 26808, cost_basis: 21375, pnl: 5433,
    pnl_pct: 0.2542, weight: 0.2215, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'NVDA', shares: 80, buy_price: 450.00,
    notes: 'AI thesis', created_at: weekAgo, updated_at: yesterday,
    current_price: 875.30, market_value: 70024, cost_basis: 36000, pnl: 34024,
    pnl_pct: 0.9451, weight: 0.5787, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'MSFT', shares: 25, buy_price: 310.00,
    notes: null, created_at: weekAgo, updated_at: yesterday,
    current_price: 415.60, market_value: 10390, cost_basis: 7750, pnl: 2640,
    pnl_pct: 0.3406, weight: 0.0858, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'GOOGL', shares: 40, buy_price: 125.00,
    notes: 'Cloud growth', created_at: weekAgo, updated_at: yesterday,
    current_price: 155.80, market_value: 6232, cost_basis: 5000, pnl: 1232,
    pnl_pct: 0.2464, weight: 0.0515, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'AMZN', shares: 20, buy_price: 145.00,
    notes: null, created_at: weekAgo, updated_at: yesterday,
    current_price: 186.40, market_value: 3728, cost_basis: 2900, pnl: 828,
    pnl_pct: 0.2855, weight: 0.0308, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'TSLA', shares: 30, buy_price: 220.00,
    notes: 'Speculative', created_at: weekAgo, updated_at: yesterday,
    current_price: 175.50, market_value: 5265, cost_basis: 6600, pnl: -1335,
    pnl_pct: -0.2023, weight: 0.0435, price_stale: false,
  },
  {
    id: uuid(), user_id: 'default', ticker: 'JPM', shares: 15, buy_price: 165.00,
    notes: 'Financials exposure', created_at: weekAgo, updated_at: twoDaysAgo,
    current_price: 198.20, market_value: 2973, cost_basis: 2475, pnl: 498,
    pnl_pct: 0.2012, weight: 0.0246, price_stale: true,
  },
];

// ---------------------------------------------------------------------------
// Portfolio Summary
// ---------------------------------------------------------------------------

export const mockPortfolioSummary: PortfolioSummary = {
  total_value: 125420,
  total_cost_basis: 82100,
  total_pnl: 43320,
  total_pnl_pct: 0.5277,
  holdings_count: 7,
  allocation: mockHoldings.map(h => ({
    ticker: h.ticker,
    shares: h.shares,
    buy_price: h.buy_price,
    current_price: h.current_price,
    market_value: h.market_value,
    cost_basis: h.cost_basis,
    weight: h.weight,
    pnl: h.pnl,
    pnl_pct: h.pnl_pct,
  })),
  sector_breakdown: [
    { sector: 'Technology', weight: 0.88, tickers: ['AAPL', 'NVDA', 'MSFT', 'GOOGL'] },
    { sector: 'Consumer Discretionary', weight: 0.074, tickers: ['AMZN', 'TSLA'] },
    { sector: 'Financials', weight: 0.025, tickers: ['JPM'] },
  ],
  concentration: {
    hhi: 3780,
    top3_weight: 0.886,
    top5_weight: 0.968,
    max_position_weight: 0.5787,
    max_position_ticker: 'NVDA',
  },
  prices_as_of: now,
  any_prices_stale: true,
};

// ---------------------------------------------------------------------------
// Analysis Jobs & Results
// ---------------------------------------------------------------------------

const completedJobId = uuid();

const makeAnalysis = (
  ticker: string,
  signal: PositionAnalysis['signal'],
  depth: PositionAnalysis['analysis_depth']
): PositionAnalysis => ({
  id: uuid(),
  job_id: completedJobId,
  user_id: 'default',
  ticker,
  analysis_depth: depth,
  status: 'completed',
  signal,
  raw_decision: `After thorough analysis, the recommendation for ${ticker} is ${signal}.`,
  market_report: {
    summary: `${ticker} shows strong technical momentum with price trading above 20-day and 50-day SMAs. Volume has been above average for the past 5 trading sessions. RSI at 62 indicates bullish momentum without being overbought.`,
    trend: 'bullish',
    support: ticker === 'NVDA' ? 820 : 170,
    resistance: ticker === 'NVDA' ? 920 : 190,
  },
  sentiment_report: {
    summary: `Social sentiment for ${ticker} is overwhelmingly positive. Reddit and Twitter mention volume up 35% week-over-week. Institutional sentiment remains constructive with 78% of recent analyst reports maintaining buy/overweight ratings.`,
    overall_sentiment: 'positive',
    social_score: 0.82,
    institutional_score: 0.78,
  },
  news_report: {
    summary: `Key news: ${ticker} reported strong quarterly earnings beating estimates by 12%. Management raised full-year guidance. Multiple analyst upgrades followed the earnings release. No significant negative catalysts identified.`,
    key_events: ['Earnings beat', 'Guidance raise', 'Analyst upgrades'],
    sentiment: 'positive',
  },
  fundamentals_report: {
    summary: `${ticker} fundamentals are solid. Revenue growth of 28% YoY, expanding margins, and strong free cash flow generation. Valuation is premium but justified by growth trajectory. Balance sheet is healthy with low debt-to-equity.`,
    revenue_growth: 0.28,
    margin_trend: 'expanding',
    valuation: 'premium',
  },
  investment_debate: {
    bull_case: `Strong secular tailwinds in AI and cloud computing. ${ticker} is well-positioned with dominant market share and expanding margins. Multiple catalysts ahead including new product launches and enterprise adoption acceleration.`,
    bear_case: `Valuation is stretched at current levels. Competition is intensifying from both established players and startups. Regulatory risks remain an overhang. Revenue growth may decelerate as the base effect grows larger.`,
    debate_history: `The bull case presents compelling arguments around secular growth and market positioning. The bear case raises valid concerns about valuation. However, the growth trajectory and competitive moat outweigh near-term valuation concerns.`,
    judge_decision: `The bull case is more compelling. While valuation is elevated, the fundamental growth drivers remain intact and the competitive position is strengthening. Recommend maintaining position with a ${signal} rating.`,
  },
  risk_debate: {
    aggressive_view: `Add to position aggressively. The AI supercycle is just beginning and ${ticker} is the clear leader. Any pullback should be viewed as a buying opportunity.`,
    conservative_view: `Trim position to reduce concentration risk. While fundamentals are strong, the portfolio is overexposed to this single name. Take some profits to rebalance.`,
    neutral_view: `Maintain current position size. The risk/reward is balanced at current levels. Wait for either a significant pullback to add or a deterioration in fundamentals to trim.`,
    debate_history: `All three perspectives have merit. The aggressive view correctly identifies the secular trend. The conservative view rightly flags concentration risk. The neutral view offers the most balanced approach.`,
    judge_decision: `A balanced approach is warranted. Maintain core position but consider small trims if weight exceeds 60% of portfolio. Set trailing stop at 15% below current levels for risk management.`,
  },
  investment_plan: {
    action: signal,
    timeframe: '3-6 months',
    entry_zones: [{ low: 840, high: 860 }],
    targets: [900, 950],
    stop_loss: 780,
  },
  current_price: ticker === 'NVDA' ? 875.30 : ticker === 'AAPL' ? 178.72 : 415.60,
  price_change_pct: ticker === 'TSLA' ? -0.0245 : 0.0132,
  error_message: null,
  created_at: yesterday,
  completed_at: now,
});

export const mockPositionAnalyses: PositionAnalysis[] = [
  makeAnalysis('NVDA', 'HOLD', 'full'),
  makeAnalysis('AAPL', 'BUY', 'full'),
  makeAnalysis('MSFT', 'OVERWEIGHT', 'standard'),
  makeAnalysis('GOOGL', 'BUY', 'standard'),
  makeAnalysis('AMZN', 'HOLD', 'standard'),
  makeAnalysis('TSLA', 'SELL', 'full'),
  makeAnalysis('JPM', 'HOLD', 'quick'),
];

export const mockAnalysisJobs: AnalysisJob[] = [
  {
    id: completedJobId,
    user_id: 'default',
    status: 'completed',
    tickers: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'JPM'],
    total_tickers: 7,
    completed_tickers: 7,
    config: null,
    error_message: null,
    created_at: yesterday,
    started_at: yesterday,
    completed_at: now,
    position_analyses: mockPositionAnalyses.map(p => ({
      id: p.id,
      ticker: p.ticker,
      status: p.status,
      signal: p.signal,
      analysis_depth: p.analysis_depth,
      current_price: p.current_price,
    })),
  },
  {
    id: uuid(),
    user_id: 'default',
    status: 'completed',
    tickers: ['NVDA', 'AAPL', 'MSFT'],
    total_tickers: 3,
    completed_tickers: 3,
    config: null,
    error_message: null,
    created_at: twoDaysAgo,
    started_at: twoDaysAgo,
    completed_at: twoDaysAgo,
  },
  {
    id: uuid(),
    user_id: 'default',
    status: 'completed',
    tickers: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'],
    total_tickers: 5,
    completed_tickers: 5,
    config: null,
    error_message: null,
    created_at: weekAgo,
    started_at: weekAgo,
    completed_at: weekAgo,
  },
];

// ---------------------------------------------------------------------------
// Portfolio Insight
// ---------------------------------------------------------------------------

export const mockPortfolioInsight: PortfolioInsight = {
  id: uuid(),
  job_id: completedJobId,
  user_id: 'default',
  total_value: 125420,
  total_cost_basis: 82100,
  total_pnl: 43320,
  total_pnl_pct: 0.5277,
  allocation_breakdown: mockPortfolioSummary.allocation,
  sector_breakdown: mockPortfolioSummary.sector_breakdown,
  concentration_metrics: mockPortfolioSummary.concentration!,
  risk_assessment: {
    overall_risk: 'moderate-high',
    concentration_risk: 'high',
    sector_risk: 'high',
    volatility_risk: 'moderate',
  },
  summary: 'Portfolio is heavily concentrated in Technology sector (88%) with NVDA representing over 57% of total value. While P&L is strongly positive (+52.8%), the concentration risk is elevated. Consider diversifying into Healthcare, Energy, or Utilities to reduce sector-specific risk.',
  strengths: [
    'Strong overall P&L performance (+52.8%)',
    'Core positions in market-leading companies',
    'Good exposure to AI/cloud computing secular trends',
  ],
  weaknesses: [
    'NVDA concentration at 57.9% creates single-stock risk',
    'Technology sector overweight at 88%',
    'Limited diversification across sectors',
    'No fixed income or defensive positions',
  ],
  action_items: [
    'Consider trimming NVDA position to below 40% of portfolio',
    'Add Healthcare sector exposure (e.g., UNH, JNJ)',
    'Add Energy sector position for inflation hedge',
    'Evaluate TSLA position given negative P&L and SELL signal',
  ],
  created_at: now,
};

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export const mockRecommendations: Recommendation[] = [
  {
    id: uuid(), job_id: completedJobId, user_id: 'default', ticker: 'NVDA',
    order_type: 'limit', side: 'sell', quantity: 15, limit_price: 890.00,
    stop_price: null, time_in_force: 'gtc', expiration: '2026-04-07',
    condition_text: null, confidence: 0.72,
    rationale: 'Trim NVDA position to reduce concentration risk. Current weight of 57.9% significantly exceeds recommended 40% maximum. Take profits on a portion while maintaining core exposure.',
    priority: 1, tags: ['rebalance', 'risk-reduction'],
    status: 'pending', status_changed_at: null, status_note: null,
    created_at: now, updated_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default', ticker: 'AAPL',
    order_type: 'limit', side: 'buy', quantity: 25, limit_price: 174.00,
    stop_price: null, time_in_force: 'gtc', expiration: '2026-04-07',
    condition_text: null, confidence: 0.81,
    rationale: 'Add to AAPL position on pullback. Strong BUY signal from analysis with solid fundamentals and reasonable valuation relative to peers.',
    priority: 2, tags: ['conviction-buy'],
    status: 'pending', status_changed_at: null, status_note: null,
    created_at: now, updated_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default', ticker: 'TSLA',
    order_type: 'stop', side: 'sell', quantity: 30, limit_price: null,
    stop_price: 165.00, time_in_force: 'gtc', expiration: '2026-04-14',
    condition_text: null, confidence: 0.68,
    rationale: 'Exit TSLA position. SELL signal from analysis with deteriorating fundamentals and negative P&L. Set stop-loss to limit further downside.',
    priority: 1, tags: ['risk-reduction', 'exit'],
    status: 'pending', status_changed_at: null, status_note: null,
    created_at: now, updated_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default', ticker: 'GOOGL',
    order_type: 'limit', side: 'buy', quantity: 20, limit_price: 150.00,
    stop_price: null, time_in_force: 'gtc', expiration: '2026-04-07',
    condition_text: null, confidence: 0.75,
    rationale: 'Increase GOOGL position for cloud and AI exposure diversification away from NVDA concentration.',
    priority: 3, tags: ['diversification'],
    status: 'accepted', status_changed_at: yesterday, status_note: 'Will execute on next dip',
    created_at: yesterday, updated_at: yesterday,
  },
  {
    id: uuid(), job_id: null, user_id: 'default', ticker: 'MSFT',
    order_type: 'limit', side: 'buy', quantity: 10, limit_price: 405.00,
    stop_price: null, time_in_force: 'day', expiration: null,
    condition_text: null, confidence: 0.65,
    rationale: 'Add to MSFT on weakness. OVERWEIGHT signal supports increasing position in cloud leader.',
    priority: 4, tags: ['conviction-buy'],
    status: 'dismissed', status_changed_at: twoDaysAgo, status_note: 'Waiting for better entry',
    created_at: twoDaysAgo, updated_at: twoDaysAgo,
  },
];

// ---------------------------------------------------------------------------
// Stock Suggestions
// ---------------------------------------------------------------------------

export const mockSuggestions: StockSuggestion[] = [
  {
    id: uuid(), job_id: completedJobId, user_id: 'default',
    ticker: 'UNH', company_name: 'UnitedHealth Group',
    sector: 'Healthcare', industry: 'Managed Healthcare',
    rationale: 'Portfolio has zero Healthcare exposure. UNH is the sector leader with consistent earnings growth, strong moat from Optum, and defensive characteristics that would reduce portfolio volatility.',
    gap_type: 'sector_gap',
    current_price: 520.40, market_cap: 480000000000, pe_ratio: 21.5, dividend_yield: 0.015,
    suggested_weight: 0.05, suggested_shares: 12,
    status: 'pending', status_changed_at: null, created_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default',
    ticker: 'XOM', company_name: 'Exxon Mobil',
    sector: 'Energy', industry: 'Oil & Gas Integrated',
    rationale: 'Adding Energy exposure provides inflation hedge and sector diversification. XOM offers strong free cash flow, growing dividend, and benefits from elevated energy prices.',
    gap_type: 'sector_gap',
    current_price: 118.90, market_cap: 500000000000, pe_ratio: 13.2, dividend_yield: 0.033,
    suggested_weight: 0.04, suggested_shares: 42,
    status: 'pending', status_changed_at: null, created_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default',
    ticker: 'BRK.B', company_name: 'Berkshire Hathaway B',
    sector: 'Financials', industry: 'Diversified Financials',
    rationale: 'Provides broad market exposure with defensive characteristics. Berkshire\'s diversified business model and strong balance sheet serve as a portfolio stabilizer.',
    gap_type: 'diversification',
    current_price: 425.00, market_cap: 920000000000, pe_ratio: 9.8, dividend_yield: 0,
    suggested_weight: 0.04, suggested_shares: 12,
    status: 'pending', status_changed_at: null, created_at: now,
  },
  {
    id: uuid(), job_id: completedJobId, user_id: 'default',
    ticker: 'LLY', company_name: 'Eli Lilly',
    sector: 'Healthcare', industry: 'Pharmaceuticals',
    rationale: 'High-growth pharmaceutical with dominant GLP-1 franchise. Would add Healthcare diversification while maintaining growth orientation.',
    gap_type: 'opportunity',
    current_price: 780.00, market_cap: 740000000000, pe_ratio: 58.0, dividend_yield: 0.007,
    suggested_weight: 0.03, suggested_shares: 5,
    status: 'pending', status_changed_at: null, created_at: now,
  },
];

// ---------------------------------------------------------------------------
// History data points (for P&L timeline)
// ---------------------------------------------------------------------------

export const mockPnlHistory = Array.from({ length: 90 }, (_, i) => {
  const date = new Date(Date.now() - (89 - i) * 86400000);
  const baseValue = 80000 + i * 500 + Math.sin(i / 7) * 3000 + (Math.random() - 0.4) * 2000;
  return {
    date: date.toISOString().split('T')[0],
    value: Math.round(baseValue),
    pnl: Math.round(baseValue - 82100),
    pnl_pct: Number(((baseValue - 82100) / 82100).toFixed(4)),
  };
});

// ---------------------------------------------------------------------------
// Latest Analysis Response (composite)
// ---------------------------------------------------------------------------

export const mockLatestAnalysis: LatestAnalysisResponse = {
  job: mockAnalysisJobs[0],
  position_analyses: mockPositionAnalyses,
  portfolio_insight: mockPortfolioInsight,
  recommendations: mockRecommendations.filter(r => r.status === 'pending'),
  suggestions: mockSuggestions,
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

let holdingsStore = [...mockHoldings];

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

  recommendations: [...mockRecommendations],

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
