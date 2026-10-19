import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JobService } from '../application/job-service.js';
import type { JobWorker } from '../application/job-worker.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import { type JobStatusType, type RoutingPreferenceType } from '../domain/job.js';
import { ValidationError } from '../domain/errors.js';

const SUPPORTED_UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
  'jpeg',
  'jpg',
  'png',
  'webp',
  'mp4',
  'quicktime',
  'pdf',
] as const;

const UploadUrlSchema = z.object({
  filename: z.string().min(1, 'filename is required'),
  content_type: z
    .string()
    .min(1, 'content_type is required')
    .refine(
      (ct) => (SUPPORTED_UPLOAD_CONTENT_TYPES as readonly string[]).includes(ct.trim().toLowerCase()),
      {
        message: 'Unsupported content_type. Supported: jpeg, png, webp, mp4, quicktime, pdf',
      }
    ),
  expires_in_seconds: z.number().int().positive().max(86400).optional().default(3600),
});

const SubmitJobSchema = z.object({
  model_id: z.string().min(1, 'model_id is required'),
  routing_preference: z
    .enum([
      'auto',
      'mock',
      'local/cpu',
      'local/gpu',
      'local',
      'cloud',
      'cloud/runpod',
      'cloud/bedrock',
      'cloud/sagemaker',
      'runpod',
      'bedrock',
      'sagemaker',
      'cost_optimized',
      'low_latency',
      'local_first',
    ])
    .default('auto'),
  priority: z.number().int().min(1).max(10).default(5),
  max_retries: z.number().int().min(0).max(10).optional(),
  parameters: z.record(z.unknown()).optional(),
  input: z
    .object({
      prompt: z.string().optional(),
      media_asset_uri: z.string().optional(),
      parameters: z.record(z.unknown()).optional(),
    })
    .catchall(z.unknown())
    .optional(),
  input_uri: z.string().optional(),
});

const TransitionJobSchema = z.object({
  status: z.enum(['QUEUED', 'PROCESSING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  provider: z.string().optional(),
  output: z.record(z.unknown()).optional(),
  output_uri: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  cost_microcents: z.number().int().nonnegative().optional(),
  retry_count: z.number().int().nonnegative().optional(),
});

export interface JobRoutesOptions {
  jobService: JobService;
  jobWorker: JobWorker;
  storageClient: IStorageClient;
}

export const jobRoutes: FastifyPluginAsync<JobRoutesOptions> = async (fastify, options) => {
  const { jobService, jobWorker, storageClient } = options;

  // POST /v1/jobs - Submit an asynchronous inference job
  fastify.post(
    '/v1/jobs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Submit Asynchronous Inference Job',
        description:
          'Enqueues an asynchronous inference job with idempotency support, bounded backoff, and S3 payload offloading.',
      },
    },
    async (req, reply) => {
      const parseResult = SubmitJobSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        'Request payload validation failed',
        parseResult.error.flatten().fieldErrors
      );
    }

    const tenantId = (req as any).tenantId || 'tenant-default';
    const correlationId = (req as any).correlationId as string | undefined;
    const traceparent = (req as any).traceparent as string | undefined;
    const traceId = (req as any).traceId as string | undefined;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    const body = parseResult.data;

    const mergedParameters: Record<string, unknown> = {
      ...(body.parameters || {}),
      ...(((body.input as any)?.parameters as Record<string, unknown>) || {}),
    };

    const resolvedInput = body.input_uri
      ? body.input
      : {
          prompt: '',
          ...(body.input || {}),
          parameters: mergedParameters,
        };

    const result = await jobService.submitJob(
      tenantId,
      {
        modelId: body.model_id,
        routingPreference: body.routing_preference as RoutingPreferenceType,
        priority: body.priority,
        maxRetries: body.max_retries,
        input: resolvedInput as Record<string, unknown> | undefined,
        inputUri: body.input_uri,
        correlationId,
        traceparent,
      },
      idempotencyKey
    );

    (req as any).jobId = result.job.id;

    const statusCode = result.isReplay ? 200 : 202;
    const pollUrl = `/v1/jobs/${result.job.id}`;

    reply.header('Location', pollUrl);
    return reply.status(statusCode).send({
      job_id: result.job.id,
      status: result.job.status,
      model_id: result.job.modelId,
      correlation_id: result.job.correlationId ?? correlationId ?? null,
      trace_id: traceId ?? null,
      created_at: result.job.createdAt.toISOString(),
      poll_url: pollUrl,
      trace_url: `/v1/jobs/${result.job.id}/trace`,
    });
  });

  // POST /v1/jobs/upload-url - Generate Presigned S3 Media Upload URL
  fastify.post(
    '/v1/jobs/upload-url',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Generate Presigned S3 Media Upload URL',
        description:
          'Generates a presigned S3 PUT URL for tenant-isolated binary media upload (images, videos, documents).',
      },
    },
    async (req, reply) => {
      const parseResult = UploadUrlSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          'Request payload validation failed',
          parseResult.error.flatten().fieldErrors
        );
      }

      const tenantId = (req as any).tenantId || 'tenant-default';
      const body = parseResult.data;
      const sanitizedFilename = path.basename(body.filename);
      const uploadId = randomUUID();
      const storageKey = `tenants/${tenantId}/inputs/${uploadId}-${sanitizedFilename}`;
      const expiresInSeconds = body.expires_in_seconds ?? 3600;

      const uploadUrl = await storageClient.getPresignedUploadUrl(storageKey, expiresInSeconds);
      const assetUri = typeof storageClient.getAssetUri === 'function'
        ? storageClient.getAssetUri(storageKey)
        : `s3://${(storageClient as any).bucket || 'platform-artifacts'}/${storageKey}`;

      return reply.status(200).send({
        upload_url: uploadUrl,
        asset_uri: assetUri,
        expires_in_seconds: expiresInSeconds,
      });
    }
  );

  // GET /v1/jobs/dlq - List Dead-Letter Queue messages for tenant
  fastify.get(
    '/v1/jobs/dlq',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'List Dead-Letter Queue Messages',
        description:
          'Retrieves messages that exhausted maximum retry attempts and were routed to the Dead-Letter Queue.',
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const messages = await jobService.listDlqMessages(tenantId, 10);

      return reply.status(200).send({
        messages: messages.map((m) => ({
          message_id: m.messageId,
          job_id: m.body.jobId,
          tenant_id: m.body.tenantId,
          correlation_id: m.body.correlationId ?? null,
          traceparent: m.body.traceparent ?? null,
          model_id: m.body.modelId,
          error_code: m.body.errorCode,
          failure_reason: m.body.failureReason,
          retry_count: m.body.retryCount,
          failed_at: m.body.failedAt,
        })),
      });
    }
  );

  // POST /v1/worker/process-next - Deterministically process next queued job(s)
  fastify.post(
    '/v1/worker/process-next',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Process Next Queued Job (Worker Trigger)',
        description: 'Deterministically triggers execution of the next queued job from ElasticMQ / SQS.',
      },
    },
    async (_req, reply) => {
      const outcomes = await jobWorker.processNextBatch(1);
      return reply.status(200).send({
        processed: outcomes.length,
        outcomes,
      });
    }
  );

  // GET /v1/jobs/:id - Query job lifecycle state and results
  fastify.get<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get Job Status & Artifacts',
        description: 'Queries the current lifecycle state, execution metrics, and signed artifact download URLs for a job.',
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
    (req as any).jobId = job.id;

    // Format artifacts if an outputUri exists
    const artifacts = [];
    if (job.outputUri) {
      const isS3 = job.outputUri.startsWith('s3://');
      let downloadUrl = job.outputUri;
      if (isS3) {
        // e.g. s3://bucket/key
        const key = job.outputUri.replace(/^s3:\/\/[^/]+\//, '');
        downloadUrl = await storageClient.getPresignedDownloadUrl(key);
      }
      artifacts.push({
        name: 'output_artifact',
        download_url: downloadUrl,
      });
    }

    const traceId = job.traceparent?.split('-')[1] ?? null;

    const response: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      model_id: job.modelId,
      correlation_id: job.correlationId ?? null,
      trace_id: traceId,
      traceparent: job.traceparent ?? null,
      routing_preference: job.routingPreference,
      priority: job.priority,
      provider: job.provider,
      retry_count: job.retryCount,
      max_retries: job.maxRetries,
      created_at: job.createdAt.toISOString(),
      started_at: job.startedAt?.toISOString() ?? null,
      completed_at: job.completedAt?.toISOString() ?? null,
      duration_ms: job.durationMs,
    };

    if (job.tokensIn !== null || job.tokensOut !== null || job.costMicrocents !== null) {
      const inTokens = job.tokensIn ?? 0;
      const outTokens = job.tokensOut ?? 0;
      response.usage = {
        prompt_tokens: inTokens,
        completion_tokens: outTokens,
        total_tokens: inTokens + outTokens,
        cost_microcents: job.costMicrocents ?? 0,
      };
    }

    if (job.outputPayload) {
      response.result = job.outputPayload;
    }

    if (artifacts.length > 0) {
      response.artifacts = artifacts;
    }

    if (job.errorCode || job.errorMessage) {
      response.error = {
        code: job.errorCode,
        message: job.errorMessage,
      };
    }

    return reply.status(200).send(response);
  });

  // POST /v1/jobs/:id/cancel - Cancel in-flight job
  fastify.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/cancel',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Cancel In-Flight Job',
        description: 'Transitions an in-flight or queued job to CANCELLED and halts background worker processing.',
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
      const job = await jobService.cancelJob(tenantId, req.params.id);

      return reply.status(200).send({
        job_id: job.id,
        status: job.status,
        completed_at: job.completedAt?.toISOString() ?? null,
      });
    }
  );

  // POST /v1/jobs/:id/transition - Transition job lifecycle (worker mock / development hook)
  fastify.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/transition',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Transition Job Lifecycle State',
        description:
          'Development & worker hook to explicitly transition job state with telemetry and cost recording.',
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
      const parseResult = TransitionJobSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        'Request payload validation failed',
        parseResult.error.flatten().fieldErrors
      );
    }

    const tenantId = (req as any).tenantId || 'tenant-default';
    const body = parseResult.data;

    const updated = await jobService.transitionJob(tenantId, req.params.id, body.status as JobStatusType, {
      provider: body.provider,
      outputPayload: body.output,
      outputUri: body.output_uri,
      errorCode: body.error_code,
      errorMessage: body.error_message,
      durationMs: body.duration_ms,
      tokensIn: body.tokens_in,
      tokensOut: body.tokens_out,
      costMicrocents: body.cost_microcents,
      retryCount: body.retry_count,
    });

    return reply.status(200).send({
      job_id: updated.id,
      status: updated.status,
      provider: updated.provider,
      retry_count: updated.retryCount,
      started_at: updated.startedAt?.toISOString() ?? null,
      completed_at: updated.completedAt?.toISOString() ?? null,
      duration_ms: updated.durationMs,
    });
  });
};


