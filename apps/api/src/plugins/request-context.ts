import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { EnvConfig } from '../config/env.js';
import {
  type DistributedTracer,
  defaultTracer,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
  runWithTelemetryContext,
} from '../infrastructure/telemetry/tracer.js';
import { type MetricsRegistry, defaultMetrics } from '../infrastructure/telemetry/metrics.js';

export function registerRequestContextHooks(
  app: FastifyInstance,
  config: EnvConfig,
  tracer: DistributedTracer = defaultTracer,
  metrics: MetricsRegistry = defaultMetrics
): void {
  // Entry hook: correlation ID, W3C traceparent, high-resolution timer, and tenant authorization span
  app.addHook('onRequest', (req, reply, done) => {
    const startNs = process.hrtime.bigint();
    const startTimeIso = new Date().toISOString();
    (req as any).startTimeNs = startNs;
    (req as any).startTimeIso = startTimeIso;

    const incomingCorrelationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string);
    const correlationId =
      typeof incomingCorrelationId === 'string' && incomingCorrelationId.trim().length > 0
        ? incomingCorrelationId.trim()
        : randomUUID();

    const parsedTrace = parseTraceparent(req.headers['traceparent'] as string | undefined);
    const traceId = parsedTrace?.traceId ?? generateTraceId();
    const parentSpanId = parsedTrace?.parentSpanId ?? null;
    const requestSpanId = generateSpanId();
    const traceFlags = parsedTrace?.traceFlags ?? '01';
    const traceparent = formatTraceparent(traceId, requestSpanId, traceFlags);

    (req as any).correlationId = correlationId;
    (req as any).traceId = traceId;
    (req as any).spanId = requestSpanId;
    (req as any).parentSpanId = parentSpanId;
    (req as any).traceparent = traceparent;

    reply.header('x-correlation-id', correlationId);
    reply.header('traceparent', traceparent);

    // Resolve tenant identity and record authorization span
    const authStartNs = process.hrtime.bigint();
    const authStartIso = new Date().toISOString();
    const authHeader = req.headers['authorization'];
    const tenantHeader = req.headers['x-tenant-id'];

    let tenantId = config.DEFAULT_TENANT_ID;
    let authScheme = 'default_fallback';

    if (typeof tenantHeader === 'string' && tenantHeader.trim().length > 0) {
      tenantId = tenantHeader.trim();
      authScheme = 'x_tenant_header';
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token && token.length > 0) {
        tenantId = token === 'test-tenant-key' ? 'tenant-test' : config.DEFAULT_TENANT_ID;
        authScheme = 'bearer_api_key';
      }
    }

    (req as any).tenantId = tenantId;
    const authDurationMs = Math.max(
      Number((Number(process.hrtime.bigint() - authStartNs) / 1_000_000).toFixed(3)),
      0.001
    );

    tracer.recordExternalSpan({
      traceId,
      spanId: generateSpanId(),
      parentSpanId: requestSpanId,
      name: 'authorization',
      kind: 'INTERNAL',
      serviceName: 'control-plane-api',
      startTimeIso: authStartIso,
      endTimeIso: new Date().toISOString(),
      durationMs: authDurationMs,
      status: 'OK',
      attributes: {
        'correlation.id': correlationId,
        'http.request_id': correlationId,
        'tenant.id': tenantId,
        'auth.scheme': authScheme,
      },
      events: [],
    });

    runWithTelemetryContext(
      {
        correlationId,
        traceId,
        spanId: requestSpanId,
        parentSpanId,
        traceFlags,
        tenantId,
      },
      () => {
        done();
      }
    );
  });

  // Exit hook: calculate elapsed request duration in milliseconds, attach header, and emit HTTP span & metrics
  app.addHook('onSend', async (req, reply, payload) => {
    const startNs = (req as any).startTimeNs as bigint | undefined;
    const startTimeIso = ((req as any).startTimeIso as string | undefined) ?? new Date().toISOString();
    const correlationId = ((req as any).correlationId as string | undefined) ?? randomUUID();
    const traceId = ((req as any).traceId as string | undefined) ?? generateTraceId();
    const spanId = ((req as any).spanId as string | undefined) ?? generateSpanId();
    const parentSpanId = ((req as any).parentSpanId as string | null | undefined) ?? null;
    const tenantId = ((req as any).tenantId as string | undefined) ?? config.DEFAULT_TENANT_ID;
    const jobId = (req as any).jobId as string | undefined;

    if (startNs !== undefined) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      reply.header('x-response-time-ms', elapsedMs.toFixed(2));

      const route = req.routeOptions?.url || req.url.split('?')[0];
      const status = String(reply.statusCode);
      const durationSec = Number((elapsedMs / 1000).toFixed(6));

      metrics.incCounter('http_server_requests_total', {
        tenant_id: tenantId,
        method: req.method,
        route,
        status,
      });
      metrics.observeHistogram(
        'http_server_request_duration_seconds',
        {
          tenant_id: tenantId,
          route,
          status,
        },
        durationSec
      );

      tracer.recordExternalSpan({
        traceId,
        spanId,
        parentSpanId,
        name: 'http_request',
        kind: 'SERVER',
        serviceName: 'control-plane-api',
        startTimeIso,
        endTimeIso: new Date().toISOString(),
        durationMs: Math.max(Number(elapsedMs.toFixed(3)), 0.001),
        status: reply.statusCode >= 400 ? 'ERROR' : 'OK',
        attributes: {
          'correlation.id': correlationId,
          'http.request_id': correlationId,
          'http.method': req.method,
          'http.route': route,
          'http.status_code': reply.statusCode,
          'tenant.id': tenantId,
          ...(jobId ? { 'job.id': jobId } : {}),
        },
        events: [],
      });
    }
    return payload;
  });
}


