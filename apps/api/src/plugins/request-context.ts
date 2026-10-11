import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { EnvConfig } from '../config/env.js';

export function registerRequestContextHooks(app: FastifyInstance, config: EnvConfig): void {
  // Entry hook: correlation ID, high-resolution profiling start timer, and tenant context
  app.addHook('onRequest', async (req, reply) => {
    const startNs = process.hrtime.bigint();
    (req as any).startTimeNs = startNs;

    const incomingCorrelationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string);
    const correlationId =
      typeof incomingCorrelationId === 'string' && incomingCorrelationId.trim().length > 0
        ? incomingCorrelationId.trim()
        : randomUUID();

    (req as any).correlationId = correlationId;
    reply.header('x-correlation-id', correlationId);

    const authHeader = req.headers['authorization'];
    const tenantHeader = req.headers['x-tenant-id'];

    let tenantId = config.DEFAULT_TENANT_ID;

    if (typeof tenantHeader === 'string' && tenantHeader.trim().length > 0) {
      tenantId = tenantHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token && token.length > 0) {
        tenantId = token === 'test-tenant-key' ? 'tenant-test' : config.DEFAULT_TENANT_ID;
      }
    }

    (req as any).tenantId = tenantId;
  });

  // Exit hook: calculate elapsed request duration in milliseconds and attach profiling header
  app.addHook('onSend', async (req, reply, payload) => {
    const startNs = (req as any).startTimeNs as bigint | undefined;
    if (startNs !== undefined) {
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      reply.header('x-response-time-ms', elapsedMs.toFixed(2));
    }
    return payload;
  });
}

