import type { FastifyInstance } from 'fastify';
import type { EnvConfig } from '../config/env.js';
import { AppError } from '../domain/errors.js';
import { type MetricsRegistry, defaultMetrics } from '../infrastructure/telemetry/metrics.js';

export function registerErrorHandler(
  app: FastifyInstance,
  config: EnvConfig,
  metrics: MetricsRegistry = defaultMetrics
): void {
  app.setErrorHandler((error, req, reply) => {
    const instance = req.url;
    const correlationId = (req as any).correlationId as string | undefined;
    const traceId = (req as any).traceId as string | undefined;
    const tenantId = ((req as any).tenantId as string | undefined) ?? config.DEFAULT_TENANT_ID;

    if (error instanceof AppError) {
      metrics.incCounter('jobs_rejected_total', {
        tenant_id: tenantId,
        reason: error.code,
      });
      const problem = error.toProblemDetails(instance) as Record<string, unknown>;
      if (correlationId) {
        problem.correlation_id = correlationId;
      }
      if (traceId) {
        problem.trace_id = traceId;
      }
      return reply
        .status(error.status)
        .header('Content-Type', 'application/problem+json')
        .send(problem);
    }

    // Fastify built-in validation error
    if (error.validation) {
      metrics.incCounter('jobs_rejected_total', {
        tenant_id: tenantId,
        reason: 'VALIDATION_FAILED',
      });
      const problem = {
        type: 'https://api.platform.local/errors/validation-failed',
        title: 'Validation Failed',
        status: 400,
        detail: error.message,
        instance,
        code: 'VALIDATION_FAILED',
        timestamp: new Date().toISOString(),
        ...(correlationId ? { correlation_id: correlationId } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
        errors: error.validation,
      };
      return reply
        .status(400)
        .header('Content-Type', 'application/problem+json')
        .send(problem);
    }

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const problem = {
      type: 'https://api.platform.local/errors/internal-server-error',
      title: statusCode === 500 ? 'Internal Server Error' : 'Request Error',
      status: statusCode,
      detail:
        config.NODE_ENV === 'production' && statusCode === 500
          ? 'An unexpected error occurred.'
          : error.message,
      instance,
      code: statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR',
      timestamp: new Date().toISOString(),
      ...(correlationId ? { correlation_id: correlationId } : {}),
      ...(traceId ? { trace_id: traceId } : {}),
    };

    return reply
      .status(statusCode)
      .header('Content-Type', 'application/problem+json')
      .send(problem);
  });
}


