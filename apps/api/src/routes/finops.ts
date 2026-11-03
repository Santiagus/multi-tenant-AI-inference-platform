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
};

