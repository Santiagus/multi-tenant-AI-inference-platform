import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../domain/errors.js';
import {
  type ProviderProfile,
  ProviderRouterController,
  type RoutingDecision,
} from '../domain/provider-routing.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';
import { type DistributedTracer, defaultTracer } from '../infrastructure/telemetry/tracer.js';

export interface ProviderRoutingRoutesOptions {
  metrics: MetricsRegistry;
  routerController: ProviderRouterController;
  tracer?: DistributedTracer;
}

const WorkloadSchema = z.object({
  model_id: z.string().min(1, 'model_id must not be empty'),
  prompt_tokens: z.number().int().nonnegative().default(16),
  max_new_tokens: z.number().int().nonnegative().default(32),
  estimated_vram_mb: z.number().nonnegative().default(8192),
  modality: z.string().default('text_to_text'),
  requires_vpc: z.boolean().default(false),
  is_proprietary: z.boolean().default(false),
});

const CapacitySchema = z
  .object({
    local_vram_total_mb: z.number().nonnegative().default(16384),
    local_vram_allocated_mb: z.number().nonnegative().default(4096),
    local_queue_depth: z.number().int().nonnegative().default(0),
    local_queue_threshold: z.number().int().nonnegative().default(10),
    worker_concurrency: z.number().int().positive().default(4),
    estimated_job_compute_ms: z.number().positive().default(150),
  })
  .optional();

const SloSchema = z
  .object({
    latency_slo_ms: z.number().positive().default(1500),
  })
  .optional();

const TenantPolicySchema = z
  .object({
    tenant_id: z.string().default('tenant-default'),
    tenant_tier: z.enum(['free', 'standard', 'pro', 'enterprise']).default('standard'),
    routing_preference: z
      .enum(['local_first', 'cost_optimized', 'latency_optimized', 'tenant_pinned'])
      .default('local_first'),
    pinned_provider: z.string().optional(),
    allowed_providers: z.array(z.string()).default([
      'local_pytorch',
      'runpod',
      'bedrock',
      'sagemaker',
    ]),
    disallowed_providers: z.array(z.string()).default([]),
    max_cost_microcents: z.number().int().nonnegative().default(500000),
    billed_rate_microcents_per_token: z.number().int().nonnegative().default(40),
  })
  .optional();

const EconomicsSchema = z
  .object({
    target_gross_margin: z.number().min(0).max(1).default(0.4),
    allow_margin_degradation_for_slo: z.boolean().default(false),
  })
  .optional();

const EvaluateRoutingBodySchema = z.object({
  workload: WorkloadSchema,
  capacity: CapacitySchema,
  slo: SloSchema,
  tenant_policy: TenantPolicySchema,
  economics: EconomicsSchema,
});

const SetProviderHealthSchema = z.object({
  healthy: z.boolean(),
});

const SimulateSweepSchema = z.object({
  workload: WorkloadSchema,
  queue_depth_range: z.array(z.number().int().nonnegative()).default([0, 5, 10, 15, 20]),
  tenant_policy: TenantPolicySchema,
  economics: EconomicsSchema,
});

export const providerRoutingRoutes: FastifyPluginAsync<ProviderRoutingRoutesOptions> = async (
  fastify,
  options
) => {
  const { metrics, routerController, tracer = defaultTracer } = options;

  // GET /v1/routing/providers - Provider catalog, health, and latency stats
  fastify.get('/v1/routing/providers', async (req, reply) => {
    const catalog = routerController.getProviderCatalog();
    for (const [name, prof] of Object.entries(catalog)) {
      metrics.setGauge('provider_health_status', { provider: name }, prof.healthy ? 1 : 0);
      const isMock = Boolean(prof.mockMode);
      metrics.setGauge('provider_is_mock', { provider: name }, isMock ? 1 : 0);
      metrics.setGauge('provider_environment_mode', { provider: name, mode: 'mock' }, isMock ? 1 : 0);
      metrics.setGauge('provider_environment_mode', { provider: name, mode: 'live' }, isMock ? 0 : 1);
    }
    return reply.send({
      ok: true,
      count: Object.keys(catalog).length,
      providers: catalog,
    });
  });

  // PATCH /v1/routing/providers/:name/health - Update provider health for failover/chaos testing
  fastify.patch('/v1/routing/providers/:name/health', async (req, reply) => {
    const { name } = req.params as { name: string };
    const parsed = SetProviderHealthSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid health update body', parsed.error.flatten());
    }

    routerController.setProviderHealth(name, parsed.data.healthy);
    metrics.setGauge('provider_health_status', { provider: name }, parsed.data.healthy ? 1 : 0);

    return reply.send({
      ok: true,
      provider: name,
      healthy: parsed.data.healthy,
    });
  });

  // POST /v1/routing/evaluate - Deterministic routing policy evaluation with explainability
  fastify.post('/v1/routing/evaluate', async (req, reply) => {
    const parsed = EvaluateRoutingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid routing evaluation request', parsed.error.flatten());
    }

    const { workload, capacity, slo, tenant_policy, economics } = parsed.data;

    const spanOptions = {
      tenantId: tenant_policy?.tenant_id ?? 'tenant-default',
      attributes: {
        'model.id': workload.model_id,
        'routing.preference': tenant_policy?.routing_preference ?? 'local_first',
      },
    };

    return tracer.startActiveSpan(
      'routing.evaluate_policy',
      spanOptions,
      async (span) => {
        const decision: RoutingDecision = routerController.evaluate(
          {
            modelId: workload.model_id,
            promptTokens: workload.prompt_tokens,
            maxNewTokens: workload.max_new_tokens,
            estimatedVramMb: workload.estimated_vram_mb,
            modality: workload.modality,
            requiresVpc: workload.requires_vpc,
            isProprietary: workload.is_proprietary,
          },
          capacity
            ? {
                localVramTotalMb: capacity.local_vram_total_mb,
                localVramAllocatedMb: capacity.local_vram_allocated_mb,
                localQueueDepth: capacity.local_queue_depth,
                localQueueThreshold: capacity.local_queue_threshold,
                workerConcurrency: capacity.worker_concurrency,
                estimatedJobComputeMs: capacity.estimated_job_compute_ms,
              }
            : undefined,
          slo ? { latencySloMs: slo.latency_slo_ms } : undefined,
          tenant_policy
            ? {
                tenantId: tenant_policy.tenant_id,
                tenantTier: tenant_policy.tenant_tier,
                routingPreference: tenant_policy.routing_preference,
                pinnedProvider: tenant_policy.pinned_provider,
                allowedProviders: tenant_policy.allowed_providers,
                disallowedProviders: tenant_policy.disallowed_providers,
                maxCostMicrocents: tenant_policy.max_cost_microcents,
                billedRateMicrocentsPerToken: tenant_policy.billed_rate_microcents_per_token,
              }
            : undefined,
          economics
            ? {
                targetGrossMargin: economics.target_gross_margin,
                allowMarginDegradationForSlo: economics.allow_margin_degradation_for_slo,
              }
            : undefined
        );

        // Record telemetry metrics
        metrics.incCounter('provider_routing_decisions_total', {
          provider: decision.selectedProvider,
          decision_code: decision.decisionCode,
          preference: decision.routingPreference,
        });

        if (decision.decisionCode === 'SLO_RISK_SPILLOVER_EXTERNAL_GPU') {
          metrics.incCounter('provider_routing_spillover_total', {
            provider: decision.selectedProvider,
            reason: 'slo_risk_or_vram_overflow',
          });
        }

        const selectedMargin = decision.candidateMargins[decision.selectedProvider] ?? 0;
        metrics.setGauge(
          'provider_gross_margin_ratio',
          { provider: decision.selectedProvider },
          selectedMargin
        );

        const selectedProf = routerController.getProviderCatalog()[decision.selectedProvider];
        const isMocked = Boolean(selectedProf?.mockMode ?? (decision.selectedProvider !== 'local_pytorch'));
        const executionMode = isMocked ? 'mock' : 'live';

        span.setAttribute('routing.selected_provider', decision.selectedProvider);
        span.setAttribute('routing.decision_code', decision.decisionCode);
        span.setAttribute('routing.gross_margin', selectedMargin);
        span.setAttribute('provider.name', decision.selectedProvider);
        span.setAttribute('provider.execution_mode', executionMode);
        span.setAttribute('provider.is_mocked', isMocked);

        req.log.info(
          {
            provider: decision.selectedProvider,
            execution_mode: executionMode,
            is_mocked: isMocked,
            decision_code: decision.decisionCode,
            trace_id: span.traceId,
          },
          `[PROVIDER_ROUTING] Selected provider '${decision.selectedProvider}' in mode '${executionMode}' (is_mocked=${isMocked})`
        );

        return reply.send({
          ok: true,
          decision,
        });
      }
    );
  });

  // POST /v1/routing/simulate - Queue depth parameter sweep simulation
  fastify.post('/v1/routing/simulate', async (req, reply) => {
    const parsed = SimulateSweepSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid simulation request', parsed.error.flatten());
    }

    const { workload, queue_depth_range, tenant_policy, economics } = parsed.data;
    const sweepResults: Array<{
      queue_depth: number;
      selected_provider: string;
      decision_code: string;
      explanation: string;
      margin: number;
    }> = [];

    for (const qd of queue_depth_range) {
      const dec = routerController.evaluate(
        {
          modelId: workload.model_id,
          promptTokens: workload.prompt_tokens,
          maxNewTokens: workload.max_new_tokens,
          estimatedVramMb: workload.estimated_vram_mb,
          modality: workload.modality,
          requiresVpc: workload.requires_vpc,
          isProprietary: workload.is_proprietary,
        },
        {
          localQueueDepth: qd,
          localQueueThreshold: 10,
        },
        undefined,
        tenant_policy
          ? {
              tenantId: tenant_policy.tenant_id,
              tenantTier: tenant_policy.tenant_tier,
              routingPreference: tenant_policy.routing_preference,
              pinnedProvider: tenant_policy.pinned_provider,
              allowedProviders: tenant_policy.allowed_providers,
              disallowedProviders: tenant_policy.disallowed_providers,
              maxCostMicrocents: tenant_policy.max_cost_microcents,
              billedRateMicrocentsPerToken: tenant_policy.billed_rate_microcents_per_token,
            }
          : undefined,
        economics
          ? {
              targetGrossMargin: economics.target_gross_margin,
              allowMarginDegradationForSlo: economics.allow_margin_degradation_for_slo,
            }
          : undefined
      );

      sweepResults.push({
        queue_depth: qd,
        selected_provider: dec.selectedProvider,
        decision_code: dec.decisionCode,
        explanation: dec.explanation,
        margin: dec.candidateMargins[dec.selectedProvider] ?? 0,
      });
    }

    return reply.send({
      ok: true,
      model_id: workload.model_id,
      simulated_steps: sweepResults.length,
      sweep: sweepResults,
    });
  });
};
