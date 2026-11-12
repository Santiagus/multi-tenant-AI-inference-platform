export type JobStatus =
  | 'SUBMITTED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type RoutingPreference =
  | 'auto'
  | 'mock'
  | 'local/cpu'
  | 'local/gpu'
  | 'local'
  | 'cloud'
  | 'cloud/runpod'
  | 'cloud/bedrock'
  | 'cloud/sagemaker'
  | 'runpod'
  | 'bedrock'
  | 'sagemaker'
  | 'cost_optimized'
  | 'low_latency'
  | 'local_first';

export interface JobProgress {
  phase: 'queued' | 'loading_model' | 'denoising' | 'generating' | 'encoding_artifact' | 'completed' | 'failed';
  step?: number;
  totalSteps?: number;
  percent: number;
  message?: string;
}

export interface JobUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_microcents: number;
}

export interface JobArtifact {
  name: string;
  download_url: string;
}

export interface JobItem {
  job_id: string;
  tenant_id: string;
  status: JobStatus;
  model_id: string;
  correlation_id: string | null;
  trace_id: string | null;
  traceparent: string | null;
  routing_preference: RoutingPreference;
  priority: number;
  provider: string | null;
  execution_mode?: 'on_demand' | 'spot' | 'serverless' | 'token_factory' | 'local' | string;
  /** Whether the job ran mock or real inference (from worker metadata). */
  inference_mode?: 'mock' | 'real' | null;
  is_mocked?: boolean | null;
  hardware?: string;
  retry_count: number;
  max_retries?: number;
  retries_used?: number;
  is_manual_retry?: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at?: string | null;
  duration_ms: number | null;
  progress_pct?: number;
  progress?: JobProgress | null;
  usage?: JobUsage;
  /** Submitted prompt text (from input_payload). */
  prompt?: string | null;
  /** Model / inference parameters submitted with the job. */
  parameters?: Record<string, unknown> | null;
  input_uri?: string | null;
  /** Full input payload as stored (prompt, parameters, internal flags). */
  input?: Record<string, unknown> | null;
  result?: Record<string, unknown>;
  artifacts?: JobArtifact[];
  error?: {
    code?: string | null;
    message?: string | null;
  };
}

export interface JobsListResponse {
  total: number;
  limit: number;
  offset: number;
  jobs: JobItem[];
}

export interface DlqMessage {
  message_id: string;
  job_id: string;
  tenant_id: string;
  correlation_id: string | null;
  traceparent: string | null;
  model_id: string;
  routing_preference?: string;
  error_code: string;
  failure_reason: string;
  retry_count: number;
  failed_at: string;
  prompt?: string | null;
  parameters?: Record<string, unknown> | null;
  input_uri?: string | null;
  input?: Record<string, unknown> | null;
}

export interface ProviderProfile {
  name?: string;
  healthy: boolean;
  costMicrocentsPerToken: number;
  cost_per_token_microcents?: number;
  baseLatencyMs: number;
  maxConcurrency: number;
  vramTotalMb: number;
  vramAllocatedMb: number;
  isCloudApi: boolean;
  supportsVpc: boolean;
  mockMode?: boolean;
}

export interface ProviderCatalogResponse {
  ok: boolean;
  count: number;
  providers: Record<string, ProviderProfile>;
}

export interface RoutingStageTrace {
  stage: string;
  passed: string[];
  rejected: Array<{
    provider: string;
    reason: string;
    details?: string;
    [key: string]: unknown;
  }>;
}

export interface RoutingDecision {
  selectedProvider: string;
  routingPreference: string;
  decisionCode: string;
  explanation: string;
  stages: RoutingStageTrace[];
  candidateMargins: Record<string, number>;
  candidateCosts: Record<string, number>;
  projectedRevenueMicrocents: number;
  sloRiskDetected: boolean;
  localQueueSaturated: boolean;
}

export interface RoutingEvaluationResponse {
  ok: boolean;
  decision: RoutingDecision;
}

export interface EconomicsSummary {
  total_jobs: number;
  succeeded_jobs: number;
  failed_jobs: number;
  in_flight_jobs: number;
  cancelled_jobs: number;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  infrastructure_cost_microcents: number;
  infrastructure_cost_usd: number;
  projected_revenue_microcents: number;
  projected_revenue_usd: number;
  gross_profit_microcents: number;
  gross_profit_usd: number;
  gross_margin_percentage: number;
  avg_duration_ms: number;
}

export interface ProviderEconomics {
  provider: string;
  healthy: boolean;
  cost_per_token_microcents: number;
  is_cloud: boolean;
  supports_vpc: boolean;
  mock_mode: boolean;
  job_count: number;
  total_tokens: number;
  cost_microcents: number;
  cost_usd: number;
  revenue_microcents: number;
  revenue_usd: number;
  gross_profit_usd: number;
  gross_margin_percentage: number;
}

export interface ModelEconomics {
  model_id: string;
  job_count: number;
  total_tokens: number;
  cost_microcents: number;
  cost_usd: number;
  revenue_usd: number;
  gross_margin_percentage: number;
  avg_duration_ms: number;
}

export interface RecentJobSeriesItem {
  timestamp: string;
  job_id: string;
  model_id: string;
  provider: string;
  tokens: number;
  cost_usd: number;
  revenue_usd: number;
  margin_pct: number;
  duration_ms: number;
}

export interface EconomicsResponse {
  tenant_id: string;
  summary: EconomicsSummary;
  providers: ProviderEconomics[];
  models: ModelEconomics[];
  recent_job_series: RecentJobSeriesItem[];
}

export type GpuPricingModel = 'on_demand' | 'spot_bid' | 'preemptible' | 'serverless';

export interface GpuPricingItem {
  id: string;
  provider: string;
  hardwareSkuId: string;
  hardwareDisplayName: string;
  vramGb: number;
  zone: string;
  pricingModel: GpuPricingModel;
  rateMicrocents: number;
  billingUnit: 'second' | 'minute' | 'hour';
  normalizedHourlyMicrocents: number;
  normalizedHourlyUsd: number;
  obtainabilityScore: number;
  obtainabilityLabel: 'High' | 'Medium' | 'Low' | 'Out of Stock';
  interruptionRiskTier: '<5%' | '5-10%' | '10-20%' | '>20%' | 'guaranteed';
  isAvailable: boolean;
  commitment: string;
  recordedAt: string;
  // HW performance benchmark & cost-efficiency
  tokensPerSec?: number;
  costPerMillionTokensUsd?: number;
  tokensPerDollar?: number;
  availabilitySourceUrl?: string;
  availabilityCalculationDetails?: string;
  riskTierCalculationDetails?: string;
  riskTierDocUrl?: string;
}

export type ModelExecutionType = 'token_factory' | 'serverless_endpoint' | 'pay_per_call';

export interface ModelPricingItem {
  id: string;
  provider: string;
  modelId: string;
  modelName: string;
  developer: string;
  executionType: ModelExecutionType;
  inputTokenPriceMicrocents?: number;
  outputTokenPriceMicrocents?: number;
  cachedInputTokenPriceMicrocents?: number;
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
  cachedPricePerMillionUsd?: number;
  perUnitPriceMicrocents?: number;
  perUnitUsd?: number;
  unitType: 'token_1m' | 'megapixel' | 'compute_second';
  contextLength?: number;
  isAvailable: boolean;
  recordedAt: string;
}

export interface PricingHistoryPoint {
  recordedAt: string;
  priceUsd: number;
  spotPriceUsd?: number;
  availability: string;
}

export interface PricingHistorySummary {
  provider: string;
  itemType: 'gpu' | 'model';
  itemId: string;
  displayName: string;
  updateCadence: string;
  estimatedUpdateFrequencyMinutes: number;
  latestPriceUsd: number;
  priceChange24hPct: number;
  history: PricingHistoryPoint[];
}

export interface PricingSyncAudit {
  id: string;
  provider: string;
  syncType: string;
  recordsCount: number;
  updateCadenceCategory: 'realtime_auction' | 'dynamic_shifts' | 'scheduled';
  estimatedUpdateIntervalSec: number;
  updateFrequencyDescription: string;
  status: string;
  syncedAt: string;
  details?: Record<string, unknown> | null;
  error?: string | null;
  availableCreditsUsd?: number | null;
  balanceStatus?: string;
}

export interface ProviderBalanceStatus {
  provider: string;
  displayName: string;
  balanceUsd: number | null;
  currency: string;
  status: 'LIVE_VERIFIED' | 'POSTPAID_INVOICE' | 'LOCAL_HARDWARE' | 'UNKNOWN' | 'NO_API_KEY';
  creditType: 'prepaid_credits' | 'postpaid_invoice' | 'zero_commitment';
  checkedAt: string;
  rawDetails?: string;
}

export type RecommendationCategory = 'cheapest' | 'fastest' | 'balanced' | 'recommended';

export interface CloudOption {
  id: string;
  category: RecommendationCategory;
  provider: string;
  displayName: string;
  hardwareOrExecution: string;
  vramGb?: number;
  pricingModel: string;
  hourlyRateUsd?: number;
  forecastedExecutionMs: number;
  forecastedCostUsd: number;
  forecastedCostMicrocents: number;
  tokensPerSec: number;
  obtainabilityLabel: string;
  interruptionRiskTier: string;
  finopsInsight: string;
  routingPreference: string;
  coldStartEstimatedMs: number;
  isPowerfulGpuFastExecutionWin?: boolean;
}

export interface ModelCloudOptionsResponse {
  ok: boolean;
  modelId: string;
  promptTokens: number;
  maxNewTokens: number;
  recommendations: {
    cheapest: CloudOption;
    fastest: CloudOption;
    balanced: CloudOption;
    recommended: CloudOption;
  };
  allOptions: CloudOption[];
  analysisNote: string;
}

export type PricingModalityBadge = 'on_demand' | 'spot' | 'serverless' | 'token_factory' | 'pay_per_call' | 'local';

export interface SpotPolicyInfo {
  noticeWindowMinutes: number; // e.g. 0, 2, 7 (or 0.5 for 30s)
  noticeWindowLabel: string; // e.g. '2m grace', '0m instant', '30s SIGTERM'
  pricingType: 'floating_bid' | 'fixed_discount' | 'dynamic_fixed' | 'guaranteed';
  pricingTypeLabel: 'Floating Bid' | 'Fixed Discount' | 'Dynamic Fixed' | 'Guaranteed';
  description: string;
}

export interface ProviderFleetStatus {
  provider: string;
  displayName: string;
  isHealthy: boolean;
  syncStatus: 'live' | 'syncing' | 'stale';
  lastSyncedAt: string;
  updateCadenceCategory: 'realtime_auction' | 'dynamic_shifts' | 'scheduled';
  updateFrequencyDescription: string;
  estimatedUpdateIntervalSec: number;
  allowedPricingModels: PricingModalityBadge[];
  availableCreditsUsd: number | null;
  creditType: 'prepaid_credits' | 'postpaid_invoice' | 'zero_commitment';
  interruptionRiskTier: string;
  interruptionNoticeWindow: string;
  // Provider links & policies
  websiteUrl?: string;
  pricingUrl?: string;
  spotPricingUrl?: string;
  billingUrl?: string;
  syncDocUrl?: string;
  cadenceDocUrl?: string;
  cadenceExplanation?: string;
  spotPolicy?: SpotPolicyInfo;
}

export type ModelPurpose =
  | 'all'
  | 'text_to_text'
  | 'text_to_image'
  | 'text_to_video'
  | 'speech_to_text'
  | 'code_reasoning';

export type ModelWeightType = 'open' | 'proprietary';

export interface CuratedModelDefinition {
  id: string;
  name: string;
  developer: string;
  purpose: ModelPurpose;
  weightType: ModelWeightType;
  minVramGb: number;
  weightsSizeGb: number;
  defaultProvider: string;
  storageCostMonthlyUsd: number;
  coldStartSec: number;
  cacheTtlMinutes: number;
  recommendedGpuSku: string;
  cheapestGpuSku: string;
  description: string;
}

export interface DistributedSpanRecord {
  trace_id: string;
  span_id: string;
  parent_span_id?: string | null;
  name: string;
  kind: string;
  service_name: string;
  start_time: string;
  end_time: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  error_message?: string;
  attributes?: Record<string, unknown>;
}

export interface TraceDetailResponse {
  trace_id: string;
  tenant_id: string;
  status: 'OK' | 'ERROR';
  root_span_name: string | null;
  stages: string[];
  span_count: number;
  duration_ms?: number;
  spans: DistributedSpanRecord[];
}




