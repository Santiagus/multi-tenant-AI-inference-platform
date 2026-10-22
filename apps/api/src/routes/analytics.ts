import type { FastifyPluginAsync } from 'fastify';
import type { JobService } from '../application/job-service.js';
import type { ProviderRouterController } from '../domain/provider-routing.js';

export interface AnalyticsRoutesOptions {
  jobService: JobService;
  routerController: ProviderRouterController;
}

export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (fastify, options) => {
  const { jobService, routerController } = options;

  // GET /v1/analytics/economics - Aggregated usage, cost, revenue, and gross margin
  fastify.get(
    '/v1/analytics/economics',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Aggregated Economics & Usage Metrics',
        description:
          'Computes end-to-end economic metrics including token usage, infrastructure costs, projected revenue, gross profit, and gross margin breakdown by provider and model.',
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const jobs = await jobService.listJobs(tenantId, { limit: 100 });
      const catalog = routerController.getProviderCatalog();

      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalCostMicrocents = 0;
      let totalDurationMs = 0;
      let durationJobCount = 0;

      let succeededCount = 0;
      let failedCount = 0;
      let inFlightCount = 0;
      let cancelledCount = 0;

      // Groupings
      const providerStats: Record<
        string,
        { jobCount: number; totalTokens: number; costMicrocents: number; revenueMicrocents: number }
      > = {};
      const modelStats: Record<
        string,
        { jobCount: number; totalTokens: number; costMicrocents: number; totalDurationMs: number }
      > = {};

      const recentSeries: Array<{
        timestamp: string;
        job_id: string;
        model_id: string;
        provider: string;
        tokens: number;
        cost_usd: number;
        revenue_usd: number;
        margin_pct: number;
        duration_ms: number;
      }> = [];

      // Default tenant billed rate: 40 microcents / token ($0.0004 / token)
      const billedRateMicrocentsPerToken = 40;

      for (const job of jobs) {
        if (job.status === 'SUCCEEDED') succeededCount++;
        else if (job.status === 'FAILED') failedCount++;
        else if (job.status === 'CANCELLED') cancelledCount++;
        else inFlightCount++;

        const inTok = job.tokensIn ?? 0;
        const outTok = job.tokensOut ?? 0;
        const tokens = inTok + outTok;
        const cost = job.costMicrocents ?? 0;
        const revenue = tokens * billedRateMicrocentsPerToken;

        promptTokens += inTok;
        completionTokens += outTok;
        totalTokens += tokens;
        totalCostMicrocents += cost;

        if (job.durationMs) {
          totalDurationMs += job.durationMs;
          durationJobCount++;
        }

        const providerKey = job.provider ?? 'unassigned';
        if (!providerStats[providerKey]) {
          providerStats[providerKey] = {
            jobCount: 0,
            totalTokens: 0,
            costMicrocents: 0,
            revenueMicrocents: 0,
          };
        }
        providerStats[providerKey].jobCount++;
        providerStats[providerKey].totalTokens += tokens;
        providerStats[providerKey].costMicrocents += cost;
        providerStats[providerKey].revenueMicrocents += revenue;

        const modelKey = job.modelId;
        if (!modelStats[modelKey]) {
          modelStats[modelKey] = {
            jobCount: 0,
            totalTokens: 0,
            costMicrocents: 0,
            totalDurationMs: 0,
          };
        }
        modelStats[modelKey].jobCount++;
        modelStats[modelKey].totalTokens += tokens;
        modelStats[modelKey].costMicrocents += cost;
        if (job.durationMs) {
          modelStats[modelKey].totalDurationMs += job.durationMs;
        }

        if (job.status === 'SUCCEEDED' && recentSeries.length < 20) {
          const jobMarginPct = revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0;
          recentSeries.push({
            timestamp: (job.completedAt ?? job.createdAt).toISOString(),
            job_id: job.id,
            model_id: job.modelId,
            provider: providerKey,
            tokens,
            cost_usd: Number((cost / 100_000_000).toFixed(6)),
            revenue_usd: Number((revenue / 100_000_000).toFixed(6)),
            margin_pct: Number(jobMarginPct.toFixed(2)),
            duration_ms: job.durationMs ?? 0,
          });
        }
      }

      const totalRevenueMicrocents = totalTokens * billedRateMicrocentsPerToken;
      const totalGrossProfitMicrocents = totalRevenueMicrocents - totalCostMicrocents;
      const grossMarginPct =
        totalRevenueMicrocents > 0 ? (totalGrossProfitMicrocents / totalRevenueMicrocents) * 100 : 0;

      // Format providers array
      const providers = Object.entries(catalog).map(([name, prof]) => {
        const stats = providerStats[name] ?? {
          jobCount: 0,
          totalTokens: 0,
          costMicrocents: 0,
          revenueMicrocents: 0,
        };
        const rev = stats.revenueMicrocents;
        const cst = stats.costMicrocents;
        const profit = rev - cst;
        const marginPct = rev > 0 ? (profit / rev) * 100 : 0;

        return {
          provider: name,
          healthy: prof.healthy,
          cost_per_token_microcents: prof.costMicrocentsPerToken,
          is_cloud: prof.isCloudApi,
          supports_vpc: prof.supportsVpc,
          mock_mode: Boolean(prof.mockMode),
          job_count: stats.jobCount,
          total_tokens: stats.totalTokens,
          cost_microcents: cst,
          cost_usd: Number((cst / 100_000_000).toFixed(6)),
          revenue_microcents: rev,
          revenue_usd: Number((rev / 100_000_000).toFixed(6)),
          gross_profit_usd: Number((profit / 100_000_000).toFixed(6)),
          gross_margin_percentage: Number(marginPct.toFixed(2)),
        };
      });

      // Format models array
      const models = Object.entries(modelStats).map(([modelId, stats]) => {
        const rev = stats.totalTokens * billedRateMicrocentsPerToken;
        const profit = rev - stats.costMicrocents;
        const marginPct = rev > 0 ? (profit / rev) * 100 : 0;
        return {
          model_id: modelId,
          job_count: stats.jobCount,
          total_tokens: stats.totalTokens,
          cost_microcents: stats.costMicrocents,
          cost_usd: Number((stats.costMicrocents / 100_000_000).toFixed(6)),
          revenue_usd: Number((rev / 100_000_000).toFixed(6)),
          gross_margin_percentage: Number(marginPct.toFixed(2)),
          avg_duration_ms: stats.jobCount > 0 ? Math.round(stats.totalDurationMs / stats.jobCount) : 0,
        };
      });

      return reply.status(200).send({
        tenant_id: tenantId,
        summary: {
          total_jobs: jobs.length,
          succeeded_jobs: succeededCount,
          failed_jobs: failedCount,
          in_flight_jobs: inFlightCount,
          cancelled_jobs: cancelledCount,
          total_tokens: totalTokens,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          infrastructure_cost_microcents: totalCostMicrocents,
          infrastructure_cost_usd: Number((totalCostMicrocents / 100_000_000).toFixed(6)),
          projected_revenue_microcents: totalRevenueMicrocents,
          projected_revenue_usd: Number((totalRevenueMicrocents / 100_000_000).toFixed(6)),
          gross_profit_microcents: totalGrossProfitMicrocents,
          gross_profit_usd: Number((totalGrossProfitMicrocents / 100_000_000).toFixed(6)),
          gross_margin_percentage: Number(grossMarginPct.toFixed(2)),
          avg_duration_ms: durationJobCount > 0 ? Math.round(totalDurationMs / durationJobCount) : 0,
        },
        providers,
        models,
        recent_job_series: recentSeries,
      });
    }
  );
};
