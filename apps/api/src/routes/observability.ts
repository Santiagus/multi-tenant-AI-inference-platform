import type { FastifyPluginAsync } from 'fastify';
import type { DistributedTracer } from '../infrastructure/telemetry/tracer.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';
import type { JobService } from '../application/job-service.js';
import { parseTraceparent } from '../infrastructure/telemetry/tracer.js';

export interface ObservabilityRoutesOptions {
  tracer: DistributedTracer;
  metrics: MetricsRegistry;
  jobService: JobService;
}

export const observabilityRoutes: FastifyPluginAsync<ObservabilityRoutesOptions> = async (
  fastify,
  options
) => {
  const { tracer, metrics, jobService } = options;

  // GET /metrics - Prometheus exposition format endpoint
  fastify.get(
    '/metrics',
    {
      schema: {
        tags: ['Observability'],
        summary: 'Prometheus Metrics Exposition',
        description:
          'Exposes Prometheus text exposition format metrics for request latencies, queue depths, job durations, and status counts.',
      },
    },
    async (_req, reply) => {
      const body = metrics.renderPrometheus();
      return reply
        .status(200)
        .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(body);
    }
  );

  // GET /v1/jobs/:id/trace - Follow a single job across API -> authZ -> queue -> worker -> inference -> artifact
  fastify.get<{ Params: { id: string } }>(
    '/v1/jobs/:id/trace',
    {
      schema: {
        tags: ['Observability'],
        summary: 'Inspect Distributed Job Trace',
        description:
          'Retrieves end-to-end W3C distributed trace spans linking API submission -> authZ -> queue -> worker -> inference -> artifact.',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Job UUID' },
          },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const job = await jobService.getJob(tenantId, req.params.id);

      const parsedTrace = parseTraceparent(job.traceparent);
      const traceId = parsedTrace?.traceId ?? null;

      // Collect spans linked by job.id, traceId, or correlationId for this tenant
      const byJob = tracer.getSpansByJobId(job.id, tenantId);
      const byTrace = traceId ? tracer.getSpansByTraceId(traceId, tenantId) : [];
      const byCorrelation = job.correlationId
        ? tracer.getSpansByCorrelationId(job.correlationId, tenantId)
        : [];

      const seenSpanIds = new Set<string>();
      const combinedSpans = [...byTrace, ...byCorrelation, ...byJob]
        .filter((s) => {
          if (seenSpanIds.has(s.spanId)) return false;
          seenSpanIds.add(s.spanId);
          return true;
        })
        .sort((a, b) => a.startTimeIso.localeCompare(b.startTimeIso));

      const stages = Array.from(new Set(combinedSpans.map((s) => s.name)));

      return reply.status(200).send({
        job_id: job.id,
        tenant_id: job.tenantId,
        correlation_id: job.correlationId ?? null,
        trace_id: traceId ?? combinedSpans[0]?.traceId ?? null,
        traceparent: job.traceparent ?? null,
        status: job.status,
        stages,
        span_count: combinedSpans.length,
        spans: combinedSpans.map((s) => ({
          trace_id: s.traceId,
          span_id: s.spanId,
          parent_span_id: s.parentSpanId,
          name: s.name,
          kind: s.kind,
          service_name: s.serviceName,
          start_time: s.startTimeIso,
          end_time: s.endTimeIso,
          duration_ms: s.durationMs,
          status: s.status,
          ...(s.errorMessage ? { error_message: s.errorMessage } : {}),
          attributes: s.attributes,
        })),
      });
    }
  );

  // GET /v1/traces/by-correlation/:correlationId - Query all spans by correlation_id
  fastify.get<{ Params: { correlationId: string } }>(
    '/v1/traces/by-correlation/:correlationId',
    {
      schema: {
        tags: ['Observability'],
        summary: 'Query Trace Spans by Correlation ID',
        description: 'Finds all distributed spans and job IDs associated with a cross-service correlation ID.',
        params: {
          type: 'object',
          properties: {
            correlationId: { type: 'string', description: 'Correlation UUID or tracking identifier' },
          },
          required: ['correlationId'],
        },
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const correlationId = req.params.correlationId;
      const spans = tracer.getSpansByCorrelationId(correlationId, tenantId);
      const traceIds = Array.from(new Set(spans.map((s) => s.traceId)));
      const jobIds = Array.from(
        new Set(
          spans
            .map((s) => s.attributes['job.id'])
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      );

      return reply.status(200).send({
        correlation_id: correlationId,
        tenant_id: tenantId,
        trace_ids: traceIds,
        job_ids: jobIds,
        span_count: spans.length,
        spans: spans.map((s) => ({
          trace_id: s.traceId,
          span_id: s.spanId,
          parent_span_id: s.parentSpanId,
          name: s.name,
          kind: s.kind,
          service_name: s.serviceName,
          start_time: s.startTimeIso,
          end_time: s.endTimeIso,
          duration_ms: s.durationMs,
          status: s.status,
          ...(s.errorMessage ? { error_message: s.errorMessage } : {}),
          attributes: s.attributes,
        })),
      });
    }
  );
};

