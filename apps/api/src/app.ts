import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { EnvConfig } from './config/env.js';
import type { IJobRepository } from './infrastructure/db/job-repository.js';
import type { IStorageClient } from './infrastructure/storage/storage-client.js';
import type { IQueueClient } from './infrastructure/queue/queue-client.js';
import { DistributedTracer } from './infrastructure/telemetry/tracer.js';
import { MetricsRegistry } from './infrastructure/telemetry/metrics.js';
import { KueueAdmissionController } from './domain/kubernetes-scheduler.js';
import { AwsPlatformController } from './domain/aws-platform.js';
import { ProviderRouterController } from './domain/provider-routing.js';
import { GitOpsController } from './domain/gitops.js';
import { JobService } from './application/job-service.js';
import { JobWorker, type IInferenceExecutor } from './application/job-worker.js';
import { registerRequestContextHooks } from './plugins/request-context.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { observabilityRoutes } from './routes/observability.js';
import { kubernetesRoutes } from './routes/kubernetes.js';
import { awsPlatformRoutes } from './routes/aws-platform.js';
import { providerRoutingRoutes } from './routes/provider-routing.js';
import { analyticsRoutes } from './routes/analytics.js';
import { securityRoutes } from './routes/security.js';
import { gitOpsRoutes } from './routes/gitops.js';
import { registerSecurityHooks } from './plugins/security.js';
import type { ISecurityRepository } from './infrastructure/db/security-repository.js';
import { SlidingWindowRateLimiter } from './domain/security.js';
import { ENDPOINT_OPENAPI_CONFIGS } from './infrastructure/openapi/endpoint-schemas.js';

export interface AppDependencies {
  config: EnvConfig;
  db: { isHealthy: () => Promise<boolean> };
  jobRepo: IJobRepository;
  securityRepo?: ISecurityRepository;
  rateLimiter?: SlidingWindowRateLimiter;
  storageClient: IStorageClient;
  queueClient: IQueueClient;
  inferenceExecutor?: IInferenceExecutor;
  jobWorker?: JobWorker;
  tracer?: DistributedTracer;
  metrics?: MetricsRegistry;
  kueueController?: KueueAdmissionController;
  awsController?: AwsPlatformController;
  routerController?: ProviderRouterController;
  gitOpsController?: GitOpsController;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: deps.config.NODE_ENV !== 'test',
  });

  app.register(cors);
  app.register(sensible);

  // OpenAPI (Swagger) Specification and Interactive UI
  app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Multi-Tenant AI Inference Platform API',
        description:
          'Production-oriented reference platform demonstrating the complete lifecycle of asynchronous, multi-tenant AI inference workloads.',
        version: '0.1.0',
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development server',
        },
      ],
      components: {
        securitySchemes: {
          tenantId: {
            type: 'apiKey',
            name: 'x-tenant-id',
            in: 'header',
            description: 'Tenant identifier for isolation boundary enforcement',
          },
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'API bearer token or dev-secret-key',
          },
        },
      },
      security: [{ tenantId: [] }],
      tags: [
        { name: 'Health', description: 'Platform health and readiness probes' },
        { name: 'Jobs', description: 'Asynchronous inference job submission, polling, cancellation, and DLQ' },
        { name: 'Observability', description: 'Prometheus metrics and W3C distributed trace inspection' },
        { name: 'Provider Routing', description: 'Multi-provider policy routing and cost evaluation' },
        { name: 'Kubernetes', description: 'KEDA queue autoscaling & Kueue batch admission hooks' },
        { name: 'AWS Cloud', description: 'Ephemeral AWS infrastructure and workflow execution' },
        { name: 'Security', description: 'API key lifecycle, ABAC scopes, rate limits, and audit logs' },
      ],
    },
    transform: ({ schema, url, route }) => {
      const s = { ...(schema || {}) };
      const rawMethod = (route as any)?.method;
      const method = (
        Array.isArray(rawMethod)
          ? rawMethod[0]
          : typeof rawMethod === 'string'
            ? rawMethod
            : 'GET'
      ).toUpperCase();
      const endpointKey = `${method} ${url}`;
      const config = ENDPOINT_OPENAPI_CONFIGS[endpointKey];

      if (config) {
        if (config.tags && (!s.tags || s.tags.length === 0)) s.tags = config.tags;
        if (config.summary && !s.summary) s.summary = config.summary;
        if (config.description && !s.description) s.description = config.description;
        if (config.params) s.params = config.params;
        if (config.querystring) s.querystring = config.querystring;
        if (config.body) s.body = config.body;
      }

      if (!s.tags || s.tags.length === 0) {
        if (url.startsWith('/healthz') || url.startsWith('/readyz')) s.tags = ['Health'];
        else if (url.startsWith('/v1/auth') || url.startsWith('/v1/security')) s.tags = ['Security'];
        else if (url.startsWith('/v1/jobs') || url.startsWith('/v1/worker')) s.tags = ['Jobs'];
        else if (url.startsWith('/metrics') || url.startsWith('/v1/traces')) s.tags = ['Observability'];
        else if (url.startsWith('/v1/routing')) s.tags = ['Provider Routing'];
        else if (url.startsWith('/v1/k8s')) s.tags = ['Kubernetes'];
        else if (url.startsWith('/v1/cloud/aws')) s.tags = ['AWS Cloud'];
        else if (url.startsWith('/v1/gitops')) s.tags = ['GitOps'];
      }

      // Pre-fill x-tenant-id header default so Try-It-Out works immediately without typing
      if (!url.startsWith('/healthz') && !url.startsWith('/readyz')) {
        s.headers = {
          type: 'object',
          properties: {
            'x-tenant-id': {
              type: 'string',
              default: 'tenant-default',
              example: 'tenant-default',
              description: 'Tenant identifier for boundary isolation',
            },
            ...((s.headers as any)?.properties || {}),
          },
        };
      }

      return { schema: s, url };
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
  });

  // Convenience Aliases for API documentation (hidden from Swagger UI)
  app.get('/documentation', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/docs'));
  app.get('/swagger', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/docs'));
  app.get('/redoc', { schema: { hide: true } }, async (_req, reply) => reply.redirect('/docs'));

  const tracer = deps.tracer ?? new DistributedTracer();
  const metrics = deps.metrics ?? new MetricsRegistry();
  const kueueController = deps.kueueController ?? new KueueAdmissionController();
  const awsController = deps.awsController ?? new AwsPlatformController();
  const routerController = deps.routerController ?? new ProviderRouterController();
  const gitOpsController = deps.gitOpsController ?? new GitOpsController();

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
  const { securityRepo, rateLimiter } = registerSecurityHooks(app, {
    config: deps.config,
    securityRepo: deps.securityRepo,
    rateLimiter: deps.rateLimiter,
  });
  registerRequestContextHooks(app, deps.config, tracer, metrics);
  registerErrorHandler(app, deps.config, metrics);

  // Register Routes
  app.register(securityRoutes, {
    securityRepo,
    rateLimiter,
  });

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

  app.register(providerRoutingRoutes, {
    metrics,
    routerController,
    tracer,
  });

  app.register(jobRoutes, {
    jobService,
    jobWorker,
    storageClient: deps.storageClient,
  });

  app.register(analyticsRoutes, {
    jobService,
    routerController,
  });

  app.register(gitOpsRoutes, {
    metrics,
    gitOpsController,
  });

  return app;
}




