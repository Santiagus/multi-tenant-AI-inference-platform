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
  retry_count: number;
  max_retries?: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  progress_pct?: number;
  progress?: JobProgress | null;
  usage?: JobUsage;
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
  error_code: string;
  failure_reason: string;
  retry_count: number;
  failed_at: string;
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

