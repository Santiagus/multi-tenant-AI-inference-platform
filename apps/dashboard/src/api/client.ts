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
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }
      const message =
        typeof errorData === 'object' && errorData !== null && 'title' in errorData
          ? (errorData as { title: string }).title
          : typeof errorData === 'object' && errorData !== null && 'message' in errorData
            ? (errorData as { message: string }).message
            : `API Error ${response.status}: ${response.statusText}`;

      throw new ApiError(response.status, message, errorData);
    }

    return response.json() as Promise<T>;
  }

  async getHealth(): Promise<{ ok: boolean; status: string }> {
    try {
      const data = await this.request<{ status: string }>('/healthz');
      return { ok: true, status: data.status || 'healthy' };
    } catch {
      return { ok: false, status: 'unhealthy' };
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

  async getDlqMessages(tenantId: string): Promise<{ messages: DlqMessage[] }> {
    return this.request<{ messages: DlqMessage[] }>('/v1/jobs/dlq', {}, tenantId);
  }

  async processNextJob(): Promise<{ processed: number }> {
    return this.request<{ processed: number }>('/v1/worker/process-next', {
      method: 'POST',
    });
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
}

export const apiClient = new PlatformApiClient();

