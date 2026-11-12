import type {
  DlqMessage,
  EconomicsResponse,
  JobItem,
  JobsListResponse,
  ProviderCatalogResponse,
  RoutingDecision,
  RoutingPreference,
} from '../types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class PlatformApiClient {
  private baseUrl: string;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    tenantId = 'tenant-default'
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (!headers.has('x-tenant-id')) {
      headers.set('x-tenant-id', tenantId);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorData: unknown;
      if (typeof response.clone === 'function') {
        try {
          const cloned = response.clone();
          errorData = await cloned.json();
        } catch {
          try {
            errorData = await response.text();
          } catch {
            errorData = response.statusText;
          }
        }
      } else {
        try {
          if (typeof response.json === 'function') {
            errorData = await response.json();
          } else if (typeof response.text === 'function') {
            const raw = await response.text();
            try {
              errorData = JSON.parse(raw);
            } catch {
              errorData = raw;
            }
          }
        } catch {
          if (typeof response.text === 'function') {
            try {
              errorData = await response.text();
            } catch {
              errorData = response.statusText;
            }
          }
        }
      }

      const message =
        typeof errorData === 'object' && errorData !== null && 'title' in errorData
          ? (errorData as { title: string }).title
          : typeof errorData === 'object' && errorData !== null && 'message' in errorData
            ? (errorData as { message: string }).message
            : typeof errorData === 'object' && errorData !== null && 'error' in errorData
              ? typeof (errorData as any).error === 'string'
                ? (errorData as any).error
                : typeof (errorData as any).error?.message === 'string'
                  ? (errorData as any).error.message
                  : `API Error ${response.status}: ${response.statusText}`
              : typeof errorData === 'string' && errorData.trim().length > 0
                ? errorData
                : `API Error ${response.status}: ${response.statusText}`;

      throw new ApiError(response.status, message, errorData);
    }

    return response.json() as Promise<T>;
  }

  async getHealth(): Promise<{ ok: boolean; status: string; dataSource: 'real' | 'mock'; environment: string; inferenceMode: 'mock' | 'real' }> {
    try {
      const data = await this.request<{ status: string; dataSource?: 'real' | 'mock'; environment?: string; inferenceMode?: 'mock' | 'real' }>('/healthz');
      return {
        ok: true,
        status: data.status || 'healthy',
        dataSource: data.dataSource || 'real',
        environment: data.environment || 'LOCAL',
        inferenceMode: data.inferenceMode || 'mock',
      };
    } catch {
      return { ok: false, status: 'unhealthy', dataSource: 'real', environment: 'LOCAL', inferenceMode: 'mock' };
    }
  }

  async getJobs(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: string } = {}
  ): Promise<JobsListResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));
    if (options.status) params.set('status', options.status);
    const qs = params.toString();
    return this.request<JobsListResponse>(`/v1/jobs${qs ? `?${qs}` : ''}`, {}, tenantId);
  }

  async getJob(tenantId: string, jobId: string): Promise<JobItem> {
    return this.request<JobItem>(`/v1/jobs/${jobId}`, {}, tenantId);
  }

  async submitJob(
    tenantId: string,
    payload: {
      model_id: string;
      routing_preference?: RoutingPreference;
      priority?: number;
      max_retries?: number;
      input?: { prompt?: string; parameters?: Record<string, unknown> };
    }
  ): Promise<{ job_id: string; status: string; poll_url: string }> {
    return this.request<{ job_id: string; status: string; poll_url: string }>(
      '/v1/jobs',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      tenantId
    );
  }

  async cancelJob(tenantId: string, jobId: string): Promise<{ job_id: string; status: string }> {
    return this.request<{ job_id: string; status: string }>(
      `/v1/jobs/${jobId}/cancel`,
      {
        method: 'POST',
      },
      tenantId
    );
  }

  async retryJob(tenantId: string, jobId: string, expiresInSeconds?: number): Promise<{ job_id: string; status: string; message: string }> {
    return this.request<{ job_id: string; status: string; message: string }>(
      `/v1/jobs/${jobId}/retry`,
      {
        method: 'POST',
        body: expiresInSeconds ? JSON.stringify({ expires_in_seconds: expiresInSeconds }) : undefined,
      },
      tenantId
    );
  }

  async reapExpiredJobs(): Promise<{ reaped_count: number; reaped_jobs: Array<{ job_id: string; status: string; error_code?: string; error_message?: string }> }> {
    return this.request<{ reaped_count: number; reaped_jobs: Array<{ job_id: string; status: string; error_code?: string; error_message?: string }> }>(
      '/v1/jobs/reap',
      {
        method: 'POST',
      }
    );
  }

  async getDlqMessages(tenantId: string): Promise<{ messages: DlqMessage[] }> {
    return this.request<{ messages: DlqMessage[] }>('/v1/jobs/dlq', {}, tenantId);
  }

  async discardDlqMessage(
    tenantId: string,
    messageId: string
  ): Promise<{ ok: boolean; message_id: string; job_id: string; tenant_id: string }> {
    return this.request(`/v1/jobs/dlq/${encodeURIComponent(messageId)}`, { method: 'DELETE' }, tenantId);
  }

  async getInferenceMode(): Promise<{ mode: 'mock' | 'real'; isTest?: boolean; description?: string }> {
    return this.request<{ mode: 'mock' | 'real'; isTest?: boolean; description?: string }>(
      '/v1/worker/inference-mode'
    );
  }

  async setInferenceMode(mode: 'mock' | 'real'): Promise<{ ok: boolean; mode: 'mock' | 'real'; message: string }> {
    return this.request<{ ok: boolean; mode: 'mock' | 'real'; message: string }>(
      '/v1/worker/inference-mode',
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }
    );
  }

  async processNextJob(mode?: 'mock' | 'real', count?: number): Promise<{ processed: number; inferenceMode?: 'mock' | 'real'; outcomes?: unknown[] }> {
    return this.request<{ processed: number; inferenceMode?: 'mock' | 'real'; outcomes?: unknown[] }>(
      '/v1/worker/process-next',
      {
        method: 'POST',
        body: JSON.stringify({ mode, count }),
      }
    );
  }

  async getProviders(): Promise<ProviderCatalogResponse> {
    return this.request<ProviderCatalogResponse>('/v1/routing/providers');
  }

  async setProviderHealth(provider: string, healthy: boolean): Promise<{ ok: boolean; healthy: boolean }> {
    return this.request<{ ok: boolean; healthy: boolean }>(`/v1/routing/providers/${provider}/health`, {
      method: 'PATCH',
      body: JSON.stringify({ healthy }),
    });
  }

  async evaluateRouting(payload: {
    workload: {
      model_id: string;
      prompt_tokens?: number;
      max_new_tokens?: number;
      estimated_vram_mb?: number;
      modality?: string;
      requires_vpc?: boolean;
      is_proprietary?: boolean;
    };
    capacity?: {
      local_vram_total_mb?: number;
      local_vram_allocated_mb?: number;
      local_queue_depth?: number;
      local_queue_threshold?: number;
      worker_concurrency?: number;
      estimated_job_compute_ms?: number;
    };
    slo?: {
      latency_slo_ms?: number;
    };
    tenant_policy?: {
      tenant_id?: string;
      tenant_tier?: string;
      routing_preference?: string;
      pinned_provider?: string;
      allowed_providers?: string[];
      disallowed_providers?: string[];
      max_cost_microcents?: number;
      billed_rate_microcents_per_token?: number;
    };
    economics?: {
      target_gross_margin?: number;
      allow_margin_degradation_for_slo?: boolean;
    };
  }): Promise<{ ok: boolean; decision: RoutingDecision }> {
    return this.request<{ ok: boolean; decision: RoutingDecision }>('/v1/routing/evaluate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async simulateRoutingSweep(payload: {
    workload: { model_id: string };
    queue_depth_range: number[];
    tenant_policy?: Record<string, unknown>;
    economics?: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    results: Array<{
      queue_depth: number;
      selected_provider: string;
      decision_code: string;
      explanation: string;
      slo_risk_detected: boolean;
      local_queue_saturated: boolean;
      candidate_margins: Record<string, number>;
      candidate_costs: Record<string, number>;
    }>;
  }> {
    return this.request('/v1/routing/simulate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getEconomics(tenantId: string): Promise<EconomicsResponse> {
    return this.request<EconomicsResponse>('/v1/analytics/economics', {}, tenantId);
  }

  async getGpuPricing(options?: {
    provider?: string;
    hardware_sku?: string;
    pricing_model?: string;
  }): Promise<{ ok: boolean; count: number; data: import('../types').GpuPricingItem[] }> {
    const params = new URLSearchParams();
    if (options?.provider) params.set('provider', options.provider);
    if (options?.hardware_sku) params.set('hardware_sku', options.hardware_sku);
    if (options?.pricing_model) params.set('pricing_model', options.pricing_model);
    const qs = params.toString();
    return this.request(`/v1/finops/gpu-pricing${qs ? `?${qs}` : ''}`);
  }

  async getModelPricing(options?: {
    provider?: string;
    execution_type?: string;
  }): Promise<{ ok: boolean; count: number; data: import('../types').ModelPricingItem[] }> {
    const params = new URLSearchParams();
    if (options?.provider) params.set('provider', options.provider);
    if (options?.execution_type) params.set('execution_type', options.execution_type);
    const qs = params.toString();
    return this.request(`/v1/finops/model-pricing${qs ? `?${qs}` : ''}`);
  }

  async getPricingHistory(options?: {
    provider?: string;
    item_id?: string;
    hours?: number;
  }): Promise<{
    ok: boolean;
    count: number;
    data: import('../types').PricingHistorySummary[];
    cadence_audits: import('../types').PricingSyncAudit[];
    provider_balances?: Record<string, import('../types').ProviderBalanceStatus>;
  }> {
    const params = new URLSearchParams();
    if (options?.provider) params.set('provider', options.provider);
    if (options?.item_id) params.set('item_id', options.item_id);
    if (options?.hours) params.set('hours', String(options.hours));
    const qs = params.toString();
    return this.request(`/v1/finops/pricing-history${qs ? `?${qs}` : ''}`);
  }

  async getProviderBalances(): Promise<{
    ok: boolean;
    balances: Record<string, import('../types').ProviderBalanceStatus>;
  }> {
    return this.request('/v1/finops/balances');
  }

  async syncPricing(): Promise<{
    ok: boolean;
    message: string;
    trace_id?: string;
    trace_url?: string;
    traceparent?: string;
    syncedProviders: string[];
    failedProviders?: Array<{ provider: string; error?: string; status: string; syncType?: string; details?: any }>;
    auditRecords?: import('../types').PricingSyncAudit[];
    recordsCount: number;
    syncedAt: string;
  }> {
    return this.request('/v1/finops/sync', { method: 'POST' });
  }

  async getSyncAudits(params?: {
    provider?: string;
    status?: string;
    limit?: number;
  }): Promise<{
    ok: boolean;
    total: number;
    synced_at: string;
    audits: import('../types').PricingSyncAudit[];
  }> {
    const q = new URLSearchParams();
    if (params?.provider) q.set('provider', params.provider);
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request(`/v1/finops/sync-audits${qs}`);
  }

  async getSyncTraces(): Promise<{
    ok: boolean;
    traces: import('../types').PricingSyncAudit[];
    syncedAt: string;
  }> {
    return this.request('/v1/finops/sync/traces');
  }

  async getTrace(traceId: string): Promise<import('../types').TraceDetailResponse> {
    return this.request(`/v1/traces/${encodeURIComponent(traceId)}`);
  }

  async getCloudRecommendations(payload: {
    model_id?: string;
    prompt_tokens?: number;
    max_new_tokens?: number;
  }): Promise<import('../types').ModelCloudOptionsResponse> {
    return this.request('/v1/finops/recommend-options', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getShowcaseStatus(): Promise<{
    dataSource: 'real' | 'mock';
    isPopulated: boolean;
    stats: { jobsCount: number; snapshotsCount: number; auditsCount: number };
  }> {
    return this.request('/v1/admin/showcase/status');
  }

  async seedShowcaseData(): Promise<{
    ok: boolean;
    dataSource: 'mock';
    message: string;
    stats: { jobsCount: number; snapshotsCount: number; auditsCount: number };
  }> {
    return this.request('/v1/admin/showcase/seed', { method: 'POST' });
  }

  async purgeShowcaseData(): Promise<{
    ok: boolean;
    dataSource: 'real';
    message: string;
  }> {
    return this.request('/v1/admin/showcase/purge', { method: 'POST' });
  }

  async purgeTenantData(tenantId: string): Promise<{
    ok: boolean;
    tenantId: string;
    deletedCount: number;
    message: string;
  }> {
    return this.request(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/purge`, { method: 'POST' });
  }
}

export const apiClient = new PlatformApiClient();

