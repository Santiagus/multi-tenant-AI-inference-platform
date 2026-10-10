import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { JobService } from '../application/job-service.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import { JobStatus, type JobStatusType, type RoutingPreferenceType } from '../domain/job.js';
import { ValidationError } from '../domain/errors.js';

const SubmitJobSchema = z.object({
  model_id: z.string().min(1, 'model_id is required'),
  routing_preference: z
    .enum(['auto', 'local', 'cloud', 'cost_optimized', 'low_latency'])
    .default('auto'),
  priority: z.number().int().min(1).max(10).default(5),
  input: z
    .object({
      prompt: z.string().optional(),
      parameters: z.record(z.unknown()).optional(),
    })
    .catchall(z.unknown())
    .optional(),
  input_uri: z.string().url().optional(),
}).refine((data) => data.input !== undefined || data.input_uri !== undefined, {
  message: 'Either input or input_uri must be provided',
  path: ['input'],
});

const TransitionJobSchema = z.object({
  status: z.enum(['QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  provider: z.string().optional(),
  output: z.record(z.unknown()).optional(),
  output_uri: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  cost_microcents: z.number().int().nonnegative().optional(),
});

export interface JobRoutesOptions {
  jobService: JobService;
  storageClient: IStorageClient;
}

export const jobRoutes: FastifyPluginAsync<JobRoutesOptions> = async (fastify, options) => {
  const { jobService, storageClient } = options;

  // POST /v1/jobs - Submit an asynchronous inference job
  fastify.post('/v1/jobs', async (req, reply) => {
    const parseResult = SubmitJobSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(
        'Request payload validation failed',
        parseResult.error.flatten().fieldErrors
      );
    }

    const tenantId = (req as any).tenantId || 'tenant-default';
    const idempotencyKey = (req.headers['idempotency-key'] as string) || null;
    const body = parseResult.data;

    const result = await jobService.submitJob(
      tenantId,
      {
        modelId: body.model_id,
        routingPreference: body.routing_preference as RoutingPreferenceType,
        priority: body.priority,
        input: body.input,
        inputUri: body.input_uri,
      },
      idempotencyKey
    );

    const statusCode = result.isReplay ? 200 : 202;
    const pollUrl = `/v1/jobs/${result.job.id}`;

    reply.header('Location', pollUrl);
    return reply.status(statusCode).send({
      job_id: result.job.id,
      status: result.job.status,
      model_id: result.job.modelId,
      created_at: result.job.createdAt.toISOString(),
      poll_url: pollUrl,
    });
  });

  // GET /v1/jobs/:id - Query job lifecycle state and results
  fastify.get<{ Params: { id: string } }>('/v1/jobs/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || 'tenant-default';
    const job = await jobService.getJob(tenantId, req.params.id);

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

    const response: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      model_id: job.modelId,
      routing_preference: job.routingPreference,
      priority: job.priority,
      provider: job.provider,
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
  fastify.post<{ Params: { id: string } }>('/v1/jobs/:id/cancel', async (req, reply) => {
    const tenantId = (req as any).tenantId || 'tenant-default';
    const job = await jobService.cancelJob(tenantId, req.params.id);

    return reply.status(200).send({
      job_id: job.id,
      status: job.status,
      completed_at: job.completedAt?.toISOString() ?? null,
    });
  });

  // POST /v1/jobs/:id/transition - Transition job lifecycle (worker mock / development hook)
  fastify.post<{ Params: { id: string } }>('/v1/jobs/:id/transition', async (req, reply) => {
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
    });

    return reply.status(200).send({
      job_id: updated.id,
      status: updated.status,
      provider: updated.provider,
      started_at: updated.startedAt?.toISOString() ?? null,
      completed_at: updated.completedAt?.toISOString() ?? null,
      duration_ms: updated.durationMs,
    });
  });
};

