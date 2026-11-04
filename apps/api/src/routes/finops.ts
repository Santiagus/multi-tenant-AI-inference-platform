import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { IFinOpsPricingRepository } from '../infrastructure/db/finops-pricing-repository.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';

export interface FinOpsRoutesOptions {
  finopsRepo: IFinOpsPricingRepository;
  metrics?: MetricsRegistry;
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
});

export const finopsRoutes: FastifyPluginAsync<FinOpsRoutesOptions> = async (
  fastify,
  opts
) => {
  const { finopsRepo } = opts;

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
    });

    const cadenceAudits = await finopsRepo.getSyncAudits();

    return reply.status(200).send({
      ok: true,
      count: history.length,
      data: history,
      cadence_audits: cadenceAudits,
    });
  });

  // 4. Trigger Instant Catalog Refresh
  fastify.post('/v1/finops/sync', async (_request, reply) => {
    const res = await finopsRepo.syncFromProviders();
    return reply.status(200).send({
      ok: true,
      message: 'Pricing catalogs successfully synchronized from neocloud providers.',
      ...res,
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

