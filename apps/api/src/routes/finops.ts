import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { IFinOpsPricingRepository } from '../infrastructure/db/finops-pricing-repository.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';
import {
  type DistributedTracer,
  defaultTracer,
  formatTraceparent,
} from '../infrastructure/telemetry/tracer.js';
import { providerBalanceService } from '../infrastructure/finops/provider-balance-service.js';

export interface FinOpsRoutesOptions {
  finopsRepo: IFinOpsPricingRepository;
  metrics?: MetricsRegistry;
  tracer?: DistributedTracer;
}

const GpuFilterQuerySchema = z.object({
  provider: z.string().optional(),
  hardware_sku: z.string().optional(),
  pricing_model: z.string().optional(),
});

const ModelFilterQuerySchema = z.object({
  provider: z.string().optional(),
  execution_type: z.string().optional(),
});

const HistoryQuerySchema = z.object({
  provider: z.string().optional(),
  item_id: z.string().optional(),
  hours: z.coerce.number().int().positive().optional(),
});

const SyncAuditsQuerySchema = z.object({
  provider: z.string().optional(),
  status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const finopsRoutes: FastifyPluginAsync<FinOpsRoutesOptions> = async (
  fastify,
  opts
) => {
  const { finopsRepo, tracer = defaultTracer } = opts;

  // 1. GPU Availability and Pricing per Provider (On-Demand, Spot, Serverless)
  fastify.get('/v1/finops/gpu-pricing', async (request, reply) => {
    const query = GpuFilterQuerySchema.parse(request.query);
    const snapshots = await finopsRepo.getLatestGpuPricing({
      provider: query.provider,
      hardwareSkuId: query.hardware_sku,
      pricingModel: query.pricing_model,
    });

    return reply.status(200).send({
      ok: true,
      count: snapshots.length,
      data: snapshots,
      metadata: {
        currency: 'USD',
        unit: 'hourly_normalized',
        pay_as_you_go_only: true,
        zero_long_term_commitment: true,
      },
    });
  });

  // 2. Open Models Availability and Pricing (Token Factory, Serverless, Pay-per-call)
  fastify.get('/v1/finops/model-pricing', async (request, reply) => {
    const query = ModelFilterQuerySchema.parse(request.query);
    const snapshots = await finopsRepo.getLatestModelPricing({
      provider: query.provider,
      executionType: query.execution_type,
    });

    return reply.status(200).send({
      ok: true,
      count: snapshots.length,
      data: snapshots,
      metadata: {
        supported_execution_types: ['token_factory', 'serverless_endpoint', 'pay_per_call'],
      },
    });
  });

  // 3. Pricing History per Provider and Update Frequency Analysis
  fastify.get('/v1/finops/pricing-history', async (request, reply) => {
    const query = HistoryQuerySchema.parse(request.query);
    const history = await finopsRepo.getPricingHistory({
      provider: query.provider,
      itemId: query.item_id,
      hours: query.hours,
    });

    const cadenceAudits = await finopsRepo.getSyncAudits();
    const balances = await providerBalanceService.getBalances();
    const enrichedAudits = cadenceAudits.map((a) => {
      const pKey = a.provider.toLowerCase();
      const bal = balances[pKey];
      return {
        ...a,
        availableCreditsUsd: bal !== undefined ? bal.balanceUsd : null,
        balanceStatus: bal !== undefined ? bal.status : 'UNKNOWN',
      };
    });

    return reply.status(200).send({
      ok: true,
      count: history.length,
      data: history,
      cadence_audits: enrichedAudits,
      provider_balances: balances,
    });
  });

  // 3b. Live Provider Balances across Neocloud and Hardware Fleet
  fastify.get('/v1/finops/balances', async (_request, reply) => {
    const balances = await providerBalanceService.getBalances();
    return reply.status(200).send({
      ok: true,
      balances,
    });
  });

  // 4. Trigger Instant Catalog Refresh & Emit OpenTelemetry Distributed Trace
  fastify.post(
    '/v1/finops/sync',
    {
      schema: {
        tags: ['Provider Routing'],
        summary: 'Synchronize Live Pricing Catalogs with Distributed Tracing',
        description:
          'Triggers live pricing synchronization across all connected neocloud and hardware providers, instrumented with OpenTelemetry distributed spans.',
      },
    },
    async (request, reply) => {
      const tenantId = (request as any).tenantId || 'tenant-default';
      const correlationId = (request as any).correlationId;

      return tracer.startActiveSpan(
        'finops.pricing_sync',
        {
          attributes: {
            'tenant.id': tenantId,
            ...(correlationId ? { 'correlation.id': correlationId } : {}),
            'sync.trigger': 'manual_api',
          },
        },
        async (span) => {
          try {
            const body = (request.body as any) || {};
            const requestedProviders = body.providers || (body.provider ? [body.provider] : undefined);
            const res = await finopsRepo.syncFromProviders(requestedProviders ? { providers: requestedProviders } : undefined);
            const totalIngested = (res as any).totalIngested ?? res.recordsCount ?? 0;

            span.setAttribute('sync.total_ingested', totalIngested);
            span.setAttribute('sync.synced_providers_count', res.syncedProviders.length);
            span.setAttribute('sync.failed_providers_count', res.failedProviders?.length ?? 0);

            if (res.failedProviders && res.failedProviders.length > 0) {
              span.setAttribute('sync.failed_providers', res.failedProviders.join(','));
              span.setAttribute('error', true);
            }

            // Emit granular child spans for each provider audit record
            if (res.auditRecords && Array.isArray(res.auditRecords)) {
              for (const audit of res.auditRecords) {
                await tracer.startActiveSpan(
                  `finops.sync.${audit.provider}`,
                  {
                    kind: 'CLIENT',
                    serviceName: 'finops-pricing-service',
                    attributes: {
                      'provider.name': audit.provider,
                      'sync.type': audit.syncType,
                      'sync.records_count': audit.recordsCount,
                      'sync.status': audit.status,
                      'tenant.id': tenantId,
                      ...(correlationId ? { 'correlation.id': correlationId } : {}),
                      ...(audit.details?.endpoint ? { 'http.url': String(audit.details.endpoint) } : {}),
                      ...(audit.details?.status ? { 'http.status_code': Number(audit.details.status) } : {}),
                      ...(audit.error ? { 'error.message': String(audit.error) } : {}),
                    },
                  },
                  async (childSpan) => {
                    if (audit.status === 'FAILED') {
                      childSpan.setAttribute('error', true);
                    }
                  }
                );
              }
            }

            const traceparent = span.traceparent || formatTraceparent(span.traceId, span.spanId);

            return reply.status(200).send({
              ok: true,
              message: 'Pricing catalogs synchronization executed.',
              trace_id: span.traceId,
              traceparent,
              trace_url: `/v1/traces/${span.traceId}`,
              total_ingested: totalIngested,
              synced_providers: res.syncedProviders,
              failed_providers: res.failedProviders ?? [],
              audit_records: res.auditRecords ?? [],
              ...res,
            });
          } catch (err: any) {
            span.setAttribute('error', true);
            span.setAttribute('error.message', err.message);
            throw err;
          }
        }
      );
    }
  );

  // 4b. Enterprise Resource Endpoint: Query Provider Pricing Synchronization Audits
  fastify.get(
    '/v1/finops/sync-audits',
    {
      schema: {
        tags: ['Provider Routing'],
        summary: 'Query Provider Pricing Synchronization Audits',
        description:
          'Retrieves chronological audit logs, records count, and diagnostic failure traces for provider pricing synchronizations.',
        querystring: {
          type: 'object',
          properties: {
            provider: { type: 'string', description: 'Filter by provider name (e.g. vast_ai, runpod)' },
            status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'SKIPPED'], description: 'Filter by execution status' },
            limit: { type: 'integer', default: 50, description: 'Maximum audit records to return' },
          },
        },
      },
    },
    async (request, reply) => {
      const query = SyncAuditsQuerySchema.parse(request.query);
      let audits = await finopsRepo.getSyncAudits();

      if (query.provider) {
        const p = query.provider.toLowerCase();
        audits = audits.filter((a) => a.provider.toLowerCase() === p);
      }
      if (query.status) {
        audits = audits.filter((a) => a.status === query.status);
      }
      if (query.limit && query.limit > 0) {
        audits = audits.slice(0, query.limit);
      }

      return reply.status(200).send({
        ok: true,
        total: audits.length,
        synced_at: audits[0]?.syncedAt || new Date().toISOString(),
        audits,
      });
    }
  );

  // Backwards-compatible aliases:
  fastify.get('/v1/finops/sync/audits', async (request, reply) => {
    const audits = await finopsRepo.getSyncAudits();
    return reply.status(200).send({
      ok: true,
      total: audits.length,
      synced_at: audits[0]?.syncedAt || new Date().toISOString(),
      audits,
    });
  });

  fastify.get('/v1/finops/sync/traces', async (_request, reply) => {
    const audits = await finopsRepo.getSyncAudits();
    return reply.status(200).send({
      ok: true,
      total: audits.length,
      traces: audits,
      audits,
      syncedAt: audits[0]?.syncedAt || new Date().toISOString(),
      synced_at: audits[0]?.syncedAt || new Date().toISOString(),
    });
  });

  // 5. Model Cloud Execution Option Recommendations (Cheapest, Fastest, Balanced, Recommended)
  const RecommendQuerySchema = z.object({
    model_id: z.string().optional(),
    prompt_tokens: z.coerce.number().int().positive().optional(),
    max_new_tokens: z.coerce.number().int().positive().optional(),
  });

  const RecommendBodySchema = z.object({
    model_id: z.string().optional(),
    prompt_tokens: z.number().int().positive().optional(),
    max_new_tokens: z.number().int().positive().optional(),
  });

  const handleRecommendation = async (modelId?: string, promptTokens?: number, maxNewTokens?: number) => {
    const [gpuSnapshots, modelSnapshots] = await Promise.all([
      finopsRepo.getLatestGpuPricing(),
      finopsRepo.getLatestModelPricing(),
    ]);

    const { computeModelCloudRecommendations } = await import('../domain/finops-pricing.js');
    return computeModelCloudRecommendations({
      modelId: modelId || 'meta-llama/Llama-3-8B-Instruct',
      promptTokens: promptTokens ?? 128,
      maxNewTokens: maxNewTokens ?? 64,
      gpuSnapshots,
      modelSnapshots,
    });
  };

  fastify.get('/v1/finops/recommend-options', async (request, reply) => {
    const query = RecommendQuerySchema.parse(request.query);
    const result = await handleRecommendation(query.model_id, query.prompt_tokens, query.max_new_tokens);
    return reply.status(200).send(result);
  });

  fastify.post('/v1/finops/recommend-options', async (request, reply) => {
    const body = RecommendBodySchema.parse(request.body || {});
    const result = await handleRecommendation(body.model_id, body.prompt_tokens, body.max_new_tokens);
    return reply.status(200).send(result);
  });
};

