import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JobService } from '../application/job-service.js';
import {
  type JobWorker,
  getJobOutputModality,
  getInferenceExecutionMode,
  setInferenceExecutionMode,
  isTestEnvironment,
} from '../application/job-worker.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import { type Job, type JobStatusType, type RoutingPreferenceType } from '../domain/job.js';
import { ForbiddenError, ValidationError } from '../domain/errors.js';
import { requireScopes } from '../plugins/security.js';
import { SecurityScope, type TenantSecurityContext } from '../domain/security.js';

/** Expose the submitted prompt + model parameters for job inspection / DLQ debugging. */
function resolveJobInputFields(job: Job): {
  prompt: string | null;
  parameters: Record<string, unknown> | null;
  input_uri: string | null;
  input: Record<string, unknown> | null;
} {
  const input = (job.inputPayload ?? null) as Record<string, unknown> | null;
  if (!input) {
    return { prompt: null, parameters: null, input_uri: job.inputUri ?? null, input: null };
  }
  const nestedParams = input.parameters;
  const parameters =
    nestedParams && typeof nestedParams === 'object' && !Array.isArray(nestedParams)
      ? (nestedParams as Record<string, unknown>)
      : null;
  return {
    prompt: typeof input.prompt === 'string' ? input.prompt : null,
    parameters,
    input_uri: job.inputUri ?? null,
    input,
  };
}

/** Derive mock vs real inference from worker metadata (or explicit mock routing). */
function resolveJobInferenceMode(job: Job): {
  inference_mode: 'mock' | 'real' | null;
  is_mocked: boolean | null;
} {
  const payload = (job.outputPayload ?? {}) as Record<string, unknown>;
  const metadata = (
    (payload.metadata as Record<string, unknown> | undefined) ?? payload
  ) as Record<string, unknown>;

  if (typeof metadata.is_mocked === 'boolean') {
    return {
      inference_mode: metadata.is_mocked ? 'mock' : 'real',
      is_mocked: metadata.is_mocked,
    };
  }

  const execMode = String(metadata.execution_mode ?? '').toLowerCase();
  if (execMode === 'mock') return { inference_mode: 'mock', is_mocked: true };
  if (execMode === 'live' || execMode === 'real') return { inference_mode: 'real', is_mocked: false };

  if (job.routingPreference === 'mock') {
    return { inference_mode: 'mock', is_mocked: true };
  }

  // Painted showcase fixtures are simulated (no live worker inference pass).
  if (job.id.startsWith('00000000-') || metadata.showcase === true) {
    return { inference_mode: 'mock', is_mocked: true };
  }

  if (metadata.production_weights === true || metadata.weights === 'production') {
    return { inference_mode: 'real', is_mocked: false };
  }

  const telemetry = (metadata.telemetry as Record<string, unknown> | undefined) ?? {};
  const vramPeak = Number(telemetry.vram_peak_mb ?? metadata.vram_peak_mb ?? 0);
  if (vramPeak > 64 && (job.durationMs ?? 0) > 100) {
    return { inference_mode: 'real', is_mocked: false };
  }

  if (
    (job.provider === 'local_cpu_worker' || job.provider === 'local_pytorch' || job.provider === 'local') &&
    (job.durationMs ?? 0) > 0 &&
    (job.durationMs ?? 0) <= 50
  ) {
    return { inference_mode: 'mock', is_mocked: true };
  }

  return { inference_mode: null, is_mocked: null };
}

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
  expires_in_seconds: z.number().int().positive().max(604800).optional(),
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

const ListJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum(['SUBMITTED', 'QUEUED', 'PROCESSING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
    .optional(),
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
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
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
    const securityContext = (req as any).securityContext as TenantSecurityContext | undefined;
    const correlationId = (req as any).correlationId as string | undefined;
    const traceparent = (req as any).traceparent as string | undefined;
    const traceId = (req as any).traceId as string | undefined;
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    const body = parseResult.data;

    // ABAC Model allowance verification
    if (securityContext?.allowedModels && securityContext.allowedModels.size > 0) {
      if (!securityContext.allowedModels.has(body.model_id) && !securityContext.scopes.has(SecurityScope.ADMIN)) {
        throw new ForbiddenError(
          `Model access restricted: Model '${body.model_id}' is not in the allowed list for this credential.`
        );
      }
    }

    // S3 Tenant isolation: Prevent reading inputs or media from another tenant
    if (body.input_uri) {
      const match = body.input_uri.match(/tenants\/([^/]+)\//);
      if (match && match[1] !== tenantId) {
        throw new ForbiddenError(
          `Cross-tenant artifact access forbidden: Cannot access input artifact belonging to '${match[1]}'.`
        );
      }
    }
    const mediaUri = (body.input as any)?.media_asset_uri;
    if (typeof mediaUri === 'string') {
      const match = mediaUri.match(/tenants\/([^/]+)\//);
      if (match && match[1] !== tenantId) {
        throw new ForbiddenError(
          `Cross-tenant artifact access forbidden: Cannot access media asset belonging to '${match[1]}'.`
        );
      }
    }

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
        expiresInSeconds: body.expires_in_seconds,
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
      preHandler: [requireScopes(SecurityScope.STORAGE_WRITE)],
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

  // GET /v1/jobs - List asynchronous inference jobs for tenant
  fastify.get(
    '/v1/jobs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'List Inference Jobs',
        description:
          'Returns a paginated list of inference jobs for the tenant, filterable by lifecycle status.',
      },
    },
    async (req, reply) => {
      const parseResult = ListJobsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError('Invalid query parameters', parseResult.error.flatten().fieldErrors);
      }
      const tenantId = (req as any).tenantId || 'tenant-default';
      const { limit, offset, status } = parseResult.data;
      await jobService.reapExpiredJobs();
      const jobs = await jobService.listJobs(tenantId, { limit, offset, status: status as JobStatusType | undefined });

      return reply.status(200).send({
        total: jobs.length,
        limit,
        offset,
        jobs: jobs.map((job) => {
          let progressPct = job.progressPct ?? 0;
          let progress = job.progress ?? null;
          if (!progress) {
            if (job.status === 'SUCCEEDED') {
              progressPct = 100;
              progress = { phase: 'completed', percent: 100 };
            } else if (job.status === 'FAILED') {
              progress = { phase: 'failed', percent: progressPct, message: job.errorMessage ?? undefined };
            } else if (job.status === 'PROCESSING') {
              progressPct = Math.max(progressPct, 15);
              progress = { phase: 'generating', percent: progressPct };
            } else {
              progressPct = 0;
              progress = { phase: 'queued', percent: 0 };
            }
          } else {
            progressPct = job.progressPct ?? progress.percent;
          }

          const traceId = job.traceparent?.split('-')[1] ?? null;

          return {
            job_id: job.id,
            tenant_id: job.tenantId,
            status: job.status,
            model_id: job.modelId,
            correlation_id: job.correlationId ?? null,
            trace_id: traceId,
            traceparent: job.traceparent ?? null,
            routing_preference: job.routingPreference,
            priority: job.priority,
            provider: job.provider,
            ...resolveJobInferenceMode(job),
            ...resolveJobInputFields(job),
            retry_count: job.retryCount,
            max_retries: job.maxRetries,
            retries_used:
              ((job.outputPayload?.metadata as Record<string, unknown> | undefined)?.retries_used as number | undefined) ??
              ((job.inputPayload?._retry_info as Record<string, unknown> | undefined)?.retries_used as number | undefined) ??
              job.retryCount,
            is_manual_retry: Boolean(
              ((job.outputPayload?.metadata as Record<string, unknown> | undefined)?.manually_retried as boolean | undefined) ??
              ((job.inputPayload?._retry_info as Record<string, unknown> | undefined)?.manual_retry as boolean | undefined) ??
              job.progress?.message?.includes('Manually re-triggered')
            ),
            created_at: job.createdAt.toISOString(),
            started_at: job.startedAt?.toISOString() ?? null,
            completed_at: job.completedAt?.toISOString() ?? null,
            expires_at: job.expiresAt?.toISOString() ?? null,
            duration_ms: job.durationMs,
            progress_pct: progressPct,
            progress,
            usage:
              job.tokensIn !== null || job.tokensOut !== null || job.costMicrocents !== null
                ? {
                    prompt_tokens: job.tokensIn ?? 0,
                    completion_tokens: job.tokensOut ?? 0,
                    total_tokens: (job.tokensIn ?? 0) + (job.tokensOut ?? 0),
                    cost_microcents: job.costMicrocents ?? 0,
                  }
                : undefined,
            result: job.outputPayload ?? undefined,
            error:
              job.errorCode || job.errorMessage
                ? {
                    code: job.errorCode,
                    message: job.errorMessage,
                  }
                : undefined,
          };
        }),
      });
    }
  );

  // GET /v1/jobs/dlq - List Dead-Letter Queue messages for tenant
  fastify.get(
    '/v1/jobs/dlq',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_READ)],
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
        messages: messages.map((m) => {
          const input = (m.body.inputPayload ?? {}) as Record<string, unknown>;
          const parameters =
            (input.parameters as Record<string, unknown> | undefined) ??
            (typeof input.parameters === 'object' ? (input.parameters as Record<string, unknown>) : undefined);
          return {
            message_id: m.messageId,
            job_id: m.body.jobId,
            tenant_id: m.body.tenantId,
            correlation_id: m.body.correlationId ?? null,
            traceparent: m.body.traceparent ?? null,
            model_id: m.body.modelId,
            routing_preference: m.body.routingPreference,
            error_code: m.body.errorCode,
            failure_reason: m.body.failureReason,
            retry_count: m.body.retryCount,
            failed_at: m.body.failedAt,
            prompt: typeof input.prompt === 'string' ? input.prompt : null,
            parameters: parameters ?? null,
            input_uri: m.body.inputUri ?? null,
            input: input,
          };
        }),
      });
    }
  );

  // DELETE /v1/jobs/dlq/:messageId - Discard a poison-pill envelope from the DLQ
  fastify.delete<{ Params: { messageId: string } }>(
    '/v1/jobs/dlq/:messageId',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
      schema: {
        tags: ['Jobs'],
        summary: 'Discard Dead-Letter Queue Message',
        description:
          'Removes a quarantined DLQ envelope after operator review. The durable FAILED job record is left unchanged.',
        params: {
          type: 'object',
          required: ['messageId'],
          properties: {
            messageId: { type: 'string', description: 'SQS / ElasticMQ DLQ message id' },
          },
        },
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const discarded = await jobService.discardDlqMessage(tenantId, req.params.messageId);
      return reply.status(200).send({
        ok: true,
        message_id: discarded.messageId,
        job_id: discarded.body.jobId,
        tenant_id: discarded.body.tenantId,
      });
    }
  );

  // GET /v1/worker/inference-mode - Get current local inference execution mode (mock vs real)
  fastify.get(
    '/v1/worker/inference-mode',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get Inference Execution Mode',
        description: 'Returns whether local inference is in mock (synthetic, 0 VRAM) or real (PyTorch / GPU) mode.',
      },
    },
    async (_req, reply) => {
      const mode = getInferenceExecutionMode();
      return reply.status(200).send({
        mode,
        isTest: isTestEnvironment(),
        description:
          mode === 'real'
            ? 'Real local inference active (executes Python/PyTorch subprocess on host GPU/CPU).'
            : 'Mock inference active (instant simulated responses with synthetic telemetry).',
      });
    }
  );

  // POST /v1/worker/inference-mode - Set local inference execution mode (mock vs real)
  fastify.post<{ Body?: { mode?: 'mock' | 'real' } }>(
    '/v1/worker/inference-mode',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Set Inference Execution Mode',
        description: 'Toggles between mock and real local inference execution.',
      },
    },
    async (req, reply) => {
      const targetMode = req.body?.mode;
      if (targetMode !== 'mock' && targetMode !== 'real') {
        return reply.status(400).send({
          error: 'Invalid inference mode. Must be "mock" or "real".',
        });
      }

      try {
        setInferenceExecutionMode(targetMode);
        return reply.status(200).send({
          ok: true,
          mode: getInferenceExecutionMode(),
          message: `Local inference execution mode set to ${targetMode}.`,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Failed to set inference execution mode',
        });
      }
    }
  );

  // POST /v1/worker/process-next - Deterministically process next queued job(s)
  fastify.post<{ Body?: { mode?: 'mock' | 'real'; count?: number } }>(
    '/v1/worker/process-next',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Process Next Queued Job (Worker Trigger)',
        description: 'Deterministically triggers execution of the next queued job from ElasticMQ / SQS.',
      },
    },
    async (req, reply) => {
      if (req.body?.mode && (req.body.mode === 'mock' || req.body.mode === 'real')) {
        try {
          setInferenceExecutionMode(req.body.mode);
        } catch {
          // Keep current if prohibited in test environment
        }
      }
      const count = Math.max(1, Math.min(Number(req.body?.count || 1), 10));
      const outcomes = await jobWorker.processNextBatch(count);
      return reply.status(200).send({
        processed: outcomes.length,
        inferenceMode: getInferenceExecutionMode(),
        outcomes,
      });
    }
  );

  // GET /v1/jobs/:id - Query job lifecycle state and results
  fastify.get<{ Params: { id: string } }>(
    '/v1/jobs/:id',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_READ)],
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

      const modality = getJobOutputModality(job.modelId);
      if (modality === 'image') {
        const imageKey = `tenants/${tenantId}/outputs/${job.id}/output.png`;
        const imageDownloadUrl = await storageClient.getPresignedDownloadUrl(imageKey);
        artifacts.push({
          name: 'output_image',
          download_url: imageDownloadUrl,
        });
      } else if (modality === 'video') {
        const videoKey = `tenants/${tenantId}/outputs/${job.id}/output.mp4`;
        const posterKey = `tenants/${tenantId}/outputs/${job.id}/poster.png`;
        const videoDownloadUrl = await storageClient.getPresignedDownloadUrl(videoKey);
        const posterDownloadUrl = await storageClient.getPresignedDownloadUrl(posterKey);
        artifacts.push({
          name: 'output_video',
          download_url: videoDownloadUrl,
        });
        artifacts.push({
          name: 'output_poster',
          download_url: posterDownloadUrl,
        });
      }
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
      ...resolveJobInferenceMode(job),
      ...resolveJobInputFields(job),
      retry_count: job.retryCount,
      max_retries: job.maxRetries,
      retries_used:
        ((job.outputPayload?.metadata as Record<string, unknown> | undefined)?.retries_used as number | undefined) ??
        ((job.inputPayload?._retry_info as Record<string, unknown> | undefined)?.retries_used as number | undefined) ??
        job.retryCount,
      is_manual_retry: Boolean(
        ((job.outputPayload?.metadata as Record<string, unknown> | undefined)?.manually_retried as boolean | undefined) ??
        ((job.inputPayload?._retry_info as Record<string, unknown> | undefined)?.manual_retry as boolean | undefined) ??
        job.progress?.message?.includes('Manually re-triggered')
      ),
      created_at: job.createdAt.toISOString(),
      started_at: job.startedAt?.toISOString() ?? null,
      completed_at: job.completedAt?.toISOString() ?? null,
      expires_at: job.expiresAt?.toISOString() ?? null,
      duration_ms: job.durationMs,
    };

    // Granular progress reporting for REST polling
    let progressPct = job.progressPct ?? 0;
    let progress = job.progress ?? null;
    if (!progress) {
      if (job.status === 'SUCCEEDED') {
        progressPct = 100;
        progress = { phase: 'completed', percent: 100 };
      } else if (job.status === 'FAILED') {
        progress = { phase: 'failed', percent: progressPct, message: job.errorMessage ?? undefined };
      } else if (job.status === 'PROCESSING') {
        progressPct = Math.max(progressPct, 15);
        progress = { phase: 'generating', percent: progressPct };
      } else {
        progressPct = 0;
        progress = { phase: 'queued', percent: 0 };
      }
    } else {
      progressPct = job.progressPct ?? progress.percent;
    }
    response.progress_pct = progressPct;
    response.progress = progress;

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
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
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

  // POST /v1/jobs/:id/retry - Manually trigger / retry a failed or cancelled job
  fastify.post<{ Params: { id: string }; Body?: { expires_in_seconds?: number } }>(
    '/v1/jobs/:id/retry',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
      schema: {
        tags: ['Jobs'],
        summary: 'Manually Trigger / Retry Job',
        description: 'Manually re-triggers a FAILED, CANCELLED, or stuck job, resetting retry counters and re-enqueuing.',
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
      const expiresInSeconds = req.body?.expires_in_seconds;
      const job = await jobService.retryJob(tenantId, req.params.id, { expiresInSeconds });

      return reply.status(200).send({
        job_id: job.id,
        status: job.status,
        model_id: job.modelId,
        retry_count: job.retryCount,
        max_retries: job.maxRetries,
        expires_at: job.expiresAt?.toISOString() ?? null,
        message: 'Job successfully re-triggered and enqueued for worker execution',
      });
    }
  );

  // POST /v1/jobs/reap - Scan and expire stale or retries-exhausted jobs
  fastify.post(
    '/v1/jobs/reap',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
      schema: {
        tags: ['Jobs'],
        summary: 'Reap Expired Jobs',
        description: 'Scans non-terminal jobs exceeding queue TTL expiration or maximum retries and marks them FAILED.',
      },
    },
    async (_req, reply) => {
      const result = await jobService.reapExpiredJobs();
      return reply.status(200).send({
        reaped_count: result.reapedCount,
        reaped_jobs: result.jobs.map((j) => ({
          job_id: j.id,
          status: j.status,
          error_code: j.errorCode,
          error_message: j.errorMessage,
        })),
      });
    }
  );

  // POST /v1/jobs/:id/transition - Transition job lifecycle (worker mock / development hook)
  fastify.post<{ Params: { id: string } }>(
    '/v1/jobs/:id/transition',
    {
      preHandler: [requireScopes(SecurityScope.JOBS_WRITE)],
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


