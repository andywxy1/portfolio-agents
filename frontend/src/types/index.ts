// =============================================================================
// portfolio-agents TypeScript interfaces
// Derived from api-contract.ts
// =============================================================================

// Common Types
export type ISODateTime = string;
export type ISODate = string;
export type UUID = string;

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export interface Holding {
  id: UUID;
  user_id: string;
  ticker: string;
  shares: number;
  buy_price: number;
  notes: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface HoldingCreate {
  ticker: string;
  shares: number;
  buy_price: number;
  notes?: string | null;
}

export interface HoldingUpdate {
  ticker?: string;
  shares?: number;
  buy_price?: number;
  notes?: string | null;
}

export interface HoldingWithPrice extends Holding {
  current_price: number | null;
  market_value: number | null;
  cost_basis: number;
  pnl: number | null;
  pnl_pct: number | null;
  weight: number | null;
  price_stale: boolean;
}

// ---------------------------------------------------------------------------
// Analysis Jobs
// ---------------------------------------------------------------------------

export type AnalysisJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type AnalysisDepth = "full" | "standard" | "quick";
export type Signal = "BUY" | "OVERWEIGHT" | "HOLD" | "UNDERWEIGHT" | "SELL";

export interface AnalysisJobConfig {
  depth_overrides?: Record<string, AnalysisDepth>;
  max_debate_rounds?: number;
}

export interface AnalysisJob {
  id: UUID;
  user_id: string;
  status: AnalysisJobStatus;
  mode?: AnalysisMode;
  tickers: string[];
  total_tickers: number;
  completed_tickers: number;
  config: AnalysisJobConfig | null;
  error_message: string | null;
  created_at: ISODateTime;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  position_analyses?: PositionAnalysisSummary[];
}

export type AnalysisMode = "portfolio" | "all_individual" | "single";

export interface StartAnalysisRequest {
  mode?: AnalysisMode;
  ticker?: string;
  tickers?: string[];
  config?: AnalysisJobConfig;
}

export interface StartAnalysisResponse {
  job_id: UUID;
  status: AnalysisJobStatus;
  tickers: string[];
  total_tickers: number;
}

// ---------------------------------------------------------------------------
// Position Analysis
// ---------------------------------------------------------------------------

export interface InvestmentDebate {
  bull_case: string;
  bear_case: string;
  debate_history: string;
  judge_decision: string;
}

export interface RiskDebate {
  aggressive_view: string;
  conservative_view: string;
  neutral_view: string;
  debate_history: string;
  judge_decision: string;
}

export interface PositionAnalysisSummary {
  id: UUID;
  ticker: string;
  status: AnalysisJobStatus;
  signal: Signal | null;
  analysis_depth: AnalysisDepth;
  current_price: number | null;
}

export interface PositionAnalysis {
  id: UUID;
  job_id: UUID;
  user_id: string;
  ticker: string;
  analysis_depth: AnalysisDepth;
  status: AnalysisJobStatus;
  signal: Signal | null;
  raw_decision: string | null;
  market_report: Record<string, unknown> | null;
  sentiment_report: Record<string, unknown> | null;
  news_report: Record<string, unknown> | null;
  fundamentals_report: Record<string, unknown> | null;
  investment_debate: InvestmentDebate | null;
  risk_debate: RiskDebate | null;
  investment_plan: Record<string, unknown> | null;
  current_price: number | null;
  price_change_pct: number | null;
  error_message: string | null;
  created_at: ISODateTime;
  completed_at: ISODateTime | null;
}

export interface LatestAnalysisResponse {
  job: AnalysisJob | null;
  position_analyses: PositionAnalysis[];
  portfolio_insight: PortfolioInsight | null;
  recommendations: Recommendation[];
  suggestions: StockSuggestion[];
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "conditional";
export type OrderSide = "buy" | "sell";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";
export type RecommendationStatus = "pending" | "accepted" | "dismissed" | "expired" | "executed";

export interface Recommendation {
  id: UUID;
  job_id: UUID | null;
  user_id: string;
  ticker: string;
  order_type: OrderType;
  side: OrderSide;
  quantity: number;
  limit_price: number | null;
  stop_price: number | null;
  time_in_force: TimeInForce;
  expiration: ISODate | null;
  condition_text: string | null;
  confidence: number | null;
  rationale: string;
  priority: number;
  tags: string[] | null;
  status: RecommendationStatus;
  status_changed_at: ISODateTime | null;
  status_note: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface UpdateRecommendationRequest {
  status: "accepted" | "dismissed";
  status_note?: string;
}

// ---------------------------------------------------------------------------
// Portfolio Summary & Insights
// ---------------------------------------------------------------------------

export interface AllocationEntry {
  ticker: string;
  shares: number;
  buy_price: number;
  current_price: number | null;
  market_value: number | null;
  cost_basis: number;
  weight: number | null;
  pnl: number | null;
  pnl_pct: number | null;
}

export interface SectorEntry {
  sector: string;
  weight: number;
  tickers: string[];
}

export interface ConcentrationMetrics {
  hhi: number;
  top3_weight: number;
  top5_weight: number;
  max_position_weight: number;
  max_position_ticker: string;
}

export interface PortfolioSummary {
  total_value: number | null;
  total_cost_basis: number;
  total_pnl: number | null;
  total_pnl_pct: number | null;
  holdings_count: number;
  allocation: AllocationEntry[];
  sector_breakdown: SectorEntry[];
  concentration: ConcentrationMetrics | null;
  prices_as_of: ISODateTime | null;
  any_prices_stale: boolean;
}

export interface PortfolioInsight {
  id: UUID;
  job_id: UUID;
  user_id: string;
  total_value: number | null;
  total_cost_basis: number | null;
  total_pnl: number | null;
  total_pnl_pct: number | null;
  allocation_breakdown: AllocationEntry[];
  sector_breakdown: SectorEntry[] | null;
  concentration_metrics: ConcentrationMetrics;
  risk_assessment: Record<string, unknown> | null;
  summary: string;
  strengths: string[] | null;
  weaknesses: string[] | null;
  action_items: string[] | null;
  created_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportType =
  | "market_analysis"
  | "sentiment_analysis"
  | "news_analysis"
  | "fundamentals_analysis"
  | "investment_debate"
  | "risk_debate"
  | "investment_plan"
  | "final_decision"
  | "portfolio_overview";

export interface Report {
  id: UUID;
  job_id: UUID;
  position_analysis_id: UUID | null;
  user_id: string;
  ticker: string;
  report_type: ReportType;
  title: string;
  content: Record<string, unknown>;
  summary: string | null;
  created_at: ISODateTime;
}

export interface ReportListItem {
  id: UUID;
  job_id: UUID;
  ticker: string;
  report_type: ReportType;
  title: string;
  summary: string | null;
  created_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Stock Suggestions
// ---------------------------------------------------------------------------

export type GapType = "sector_gap" | "diversification" | "opportunity" | "hedge";
export type SuggestionStatus = "pending" | "added" | "dismissed" | "expired";

export interface StockSuggestion {
  id: UUID;
  job_id: UUID | null;
  user_id: string;
  ticker: string;
  company_name: string;
  sector: string;
  industry: string | null;
  rationale: string;
  gap_type: GapType;
  current_price: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  suggested_weight: number | null;
  suggested_shares: number | null;
  status: SuggestionStatus;
  status_changed_at: ISODateTime | null;
  created_at: ISODateTime;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface TechnicalIndicators {
  sma_20: number | null;
  sma_50: number | null;
  sma_200: number | null;
  ema_12: number | null;
  ema_26: number | null;
  rsi_14: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_histogram: number | null;
  bollinger_upper: number | null;
  bollinger_lower: number | null;
  atr_14: number | null;
  volume_sma_20: number | null;
}

export interface PriceData {
  ticker: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change: number | null;
  change_pct: number | null;
  market_status: "open" | "closed" | "pre" | "post" | null;
  indicators: TechnicalIndicators | null;
  fetched_at: ISODateTime | null;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export interface GetRecommendationsParams {
  status?: RecommendationStatus;
  ticker?: string;
  side?: OrderSide;
  page?: number;
  page_size?: number;
}

export interface GetReportsParams {
  job_id?: UUID;
  ticker?: string;
  report_type?: ReportType;
  page?: number;
  page_size?: number;
}

export interface GetSuggestionsParams {
  status?: SuggestionStatus;
  gap_type?: GapType;
}

// ---------------------------------------------------------------------------
// PnL History
// ---------------------------------------------------------------------------

export interface PnlHistoryEntry {
  date: string;
  total_value: number;
  total_cost: number;
  pnl: number;
  pnl_pct: number;
}

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------

export interface AppConfig {
  api_key: string;
  alpaca_api_key: string;
  alpaca_secret_key: string;
  alpaca_base_url: string;
  llm_base_url: string;
  llm_api_key: string;
  llm_deep_model: string;
  llm_quick_model: string;
  weight_heavy_threshold: number;
  weight_medium_threshold: number;
}

export interface ConfigStatus {
  configured: boolean;
  missing_keys: string[];
}

export interface ValidationResult {
  alpaca: { ok: boolean; error?: string };
  llm: { ok: boolean; error?: string };
}
