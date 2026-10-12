import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { EnvConfig } from './config/env.js';
import type { IJobRepository } from './infrastructure/db/job-repository.js';
import type { IStorageClient } from './infrastructure/storage/storage-client.js';
import type { IQueueClient } from './infrastructure/queue/queue-client.js';
import { DistributedTracer } from './infrastructure/telemetry/tracer.js';
import { MetricsRegistry } from './infrastructure/telemetry/metrics.js';
import { KueueAdmissionController } from './domain/kubernetes-scheduler.js';
import { AwsPlatformController } from './domain/aws-platform.js';
import { JobService } from './application/job-service.js';
import { JobWorker, type IInferenceExecutor } from './application/job-worker.js';
import { registerRequestContextHooks } from './plugins/request-context.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { observabilityRoutes } from './routes/observability.js';
import { kubernetesRoutes } from './routes/kubernetes.js';
import { awsPlatformRoutes } from './routes/aws-platform.js';

export interface AppDependencies {
  config: EnvConfig;
  db: { isHealthy: () => Promise<boolean> };
  jobRepo: IJobRepository;
  storageClient: IStorageClient;
  queueClient: IQueueClient;
  inferenceExecutor?: IInferenceExecutor;
  jobWorker?: JobWorker;
  tracer?: DistributedTracer;
  metrics?: MetricsRegistry;
  kueueController?: KueueAdmissionController;
  awsController?: AwsPlatformController;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: deps.config.NODE_ENV !== 'test',
  });

  app.register(cors);
  app.register(sensible);

  const tracer = deps.tracer ?? new DistributedTracer();
  const metrics = deps.metrics ?? new MetricsRegistry();
  const kueueController = deps.kueueController ?? new KueueAdmissionController();
  const awsController = deps.awsController ?? new AwsPlatformController();

  const jobService = new JobService(
    deps.jobRepo,
    deps.queueClient,
    deps.storageClient,
    tracer,
    metrics
  );
  const jobWorker =
    deps.jobWorker ??
    new JobWorker(
      deps.jobRepo,
      deps.queueClient,
      deps.storageClient,
      deps.inferenceExecutor,
      { tracer, metrics }
    );

  // Modularized Lifecycle Hooks & Centralized Error Boundary
  registerRequestContextHooks(app, deps.config, tracer, metrics);
  registerErrorHandler(app, deps.config, metrics);

  // Register Routes
  app.register(healthRoutes, {
    db: deps.db,
    storage: deps.storageClient,
    queue: deps.queueClient,
  });

  app.register(observabilityRoutes, {
    tracer,
    metrics,
    jobService,
  });

  app.register(kubernetesRoutes, {
    queueClient: deps.queueClient,
    metrics,
    kueueController,
  });

  app.register(awsPlatformRoutes, {
    metrics,
    awsController,
  });

  app.register(jobRoutes, {
    jobService,
    jobWorker,
    storageClient: deps.storageClient,
  });

  return app;
}




