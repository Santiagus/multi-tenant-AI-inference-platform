import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { EnvConfig } from './config/env.js';
import type { IJobRepository } from './infrastructure/db/job-repository.js';
import type { IStorageClient } from './infrastructure/storage/storage-client.js';
import type { IQueueClient } from './infrastructure/queue/queue-client.js';
import { JobService } from './application/job-service.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { AppError } from './domain/errors.js';

export interface AppDependencies {
  config: EnvConfig;
  db: { isHealthy: () => Promise<boolean> };
  jobRepo: IJobRepository;
  storageClient: IStorageClient;
  queueClient: IQueueClient;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: deps.config.NODE_ENV !== 'test',
  });

  app.register(cors);
  app.register(sensible);

  const jobService = new JobService(deps.jobRepo, deps.queueClient, deps.storageClient);

  // Tenant Authentication & Context Hook
  app.addHook('onRequest', async (req) => {
    const authHeader = req.headers['authorization'];
    const tenantHeader = req.headers['x-tenant-id'];

    let tenantId = deps.config.DEFAULT_TENANT_ID;

    if (typeof tenantHeader === 'string' && tenantHeader.trim().length > 0) {
      tenantId = tenantHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      // In development / skeleton, parse token or fallback
      const token = authHeader.substring(7).trim();
      if (token && token.length > 0) {
        tenantId = token === 'test-tenant-key' ? 'tenant-test' : deps.config.DEFAULT_TENANT_ID;
      }
    }

    (req as any).tenantId = tenantId;
  });

  // RFC 7807 Uniform Error Handler
  app.setErrorHandler((error, req, reply) => {
    const instance = req.url;

    if (error instanceof AppError) {
      const problem = error.toProblemDetails(instance);
      return reply.status(error.status).header('Content-Type', 'application/problem+json').send(problem);
    }

    // Fastify built-in validation error
    if (error.validation) {
      const problem = {
        type: 'https://api.platform.local/errors/validation-failed',
        title: 'Validation Failed',
        status: 400,
        detail: error.message,
        instance,
        code: 'VALIDATION_FAILED',
        timestamp: new Date().toISOString(),
        errors: error.validation,
      };
      return reply.status(400).header('Content-Type', 'application/problem+json').send(problem);
    }

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const problem = {
      type: 'https://api.platform.local/errors/internal-server-error',
      title: statusCode === 500 ? 'Internal Server Error' : 'Request Error',
      status: statusCode,
      detail: deps.config.NODE_ENV === 'production' && statusCode === 500 ? 'An unexpected error occurred.' : error.message,
      instance,
      code: statusCode === 500 ? 'INTERNAL_ERROR' : 'ERROR',
      timestamp: new Date().toISOString(),
    };

    return reply.status(statusCode).header('Content-Type', 'application/problem+json').send(problem);
  });

  // Register Routes
  app.register(healthRoutes, {
    db: deps.db,
    storage: deps.storageClient,
    queue: deps.queueClient,
  });

  app.register(jobRoutes, {
    jobService,
    storageClient: deps.storageClient,
  });

  return app;
}

