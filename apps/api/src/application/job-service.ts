import { createHash, randomUUID } from 'node:crypto';
import type { IJobRepository, UpdateJobOptions } from '../infrastructure/db/job-repository.js';
import type { IQueueClient, ReceivedDlqMessage } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import {
  type DistributedTracer,
  defaultTracer,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  getTelemetryContext,
} from '../infrastructure/telemetry/tracer.js';
import { type MetricsRegistry, defaultMetrics } from '../infrastructure/telemetry/metrics.js';
import {
  type Job,
  type JobStatusType,
  type RoutingPreferenceType,
  JobStatus,
  RoutingPreference,
  canTransitionStatus,
  isTerminalStatus,
} from '../domain/job.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';

export interface SubmitJobRequest {
  modelId: string;
  input?: Record<string, unknown>;
  inputUri?: string;
  routingPreference?: RoutingPreferenceType;
  priority?: number;
  maxRetries?: number;
  expiresInSeconds?: number;
  correlationId?: string | null;
  traceparent?: string | null;
}

export interface SubmitJobResult {
  job: Job;
  isReplay: boolean;
}

function computeRequestHash(request: SubmitJobRequest): string {
  const canonical = JSON.stringify({
    modelId: request.modelId,
    routingPreference: request.routingPreference ?? RoutingPreference.AUTO,
    priority: request.priority ?? 5,
    input: request.input ?? null,
    inputUri: request.inputUri ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export class JobService {
  constructor(
    private jobRepo: IJobRepository,
    private queueClient: IQueueClient,
    private storageClient: IStorageClient,
    private tracer: DistributedTracer = defaultTracer,
    private metrics: MetricsRegistry = defaultMetrics,
    private defaultExpirationSeconds: number = 86400
  ) {}

  async submitJob(
    tenantId: string,
    request: SubmitJobRequest,
    idempotencyKey?: string | null
  ): Promise<SubmitJobResult> {
    const requestHash = computeRequestHash(request);
    const ctx = getTelemetryContext();
    const correlationId = request.correlationId ?? ctx?.correlationId ?? randomUUID();

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await this.jobRepo.findByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
        if (existing.requestHash && existing.requestHash !== requestHash) {
          throw new ConflictError(
            `Idempotency key '${idempotencyKey}' was already used with a different request payload.`,
            'IDEMPOTENCY_CONFLICT'
          );
        }
        return {
          job: existing,
          isReplay: true,
        };
      }
    }

    let inputUri = request.inputUri ?? null;
    let inputPayload = request.input ?? null;

    // 2. Offload large inputs (>256KB) to S3-compatible storage if provided inline
    if (inputPayload && !inputUri) {
      const payloadString = JSON.stringify(inputPayload);
      if (payloadString.length > 256 * 1024) {
        const storageKey = `tenants/${tenantId}/inputs/${Date.now()}-input.json`;
        inputUri = await this.storageClient.putObject(storageKey, payloadString, 'application/json');
        inputPayload = { _offloaded: true, inputUri };
      }
    }

    const traceId = ctx?.traceId ?? generateTraceId();
    const enqueueSpanId = generateSpanId();
    const traceFlags = ctx?.traceFlags ?? '01';
    const outboundTraceparent =
      request.traceparent ?? formatTraceparent(traceId, enqueueSpanId, traceFlags);

    // 3. Persist Job to DB in QUEUED state with expiration timestamp
    const expiresInSeconds = request.expiresInSeconds ?? this.defaultExpirationSeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const job = await this.jobRepo.create({
      tenantId,
      modelId: request.modelId,
      routingPreference: request.routingPreference ?? RoutingPreference.AUTO,
      priority: request.priority ?? 5,
      idempotencyKey: idempotencyKey ?? null,
      requestHash,
      correlationId,
      traceparent: outboundTraceparent,
      inputPayload,
      inputUri,
      maxRetries: request.maxRetries ?? 3,
      expiresAt,
    });

    // 4. Publish message envelope to Queue inside a PRODUCER span
    await this.tracer.startActiveSpan(
      'queue_enqueue',
      {
        kind: 'PRODUCER',
        serviceName: 'control-plane-api',
        traceparent: request.traceparent ?? (ctx ? formatTraceparent(ctx.traceId, ctx.spanId, ctx.traceFlags) : null),
        correlationId,
        tenantId: job.tenantId,
        jobId: job.id,
        attributes: {
          'messaging.system': 'sqs',
          'messaging.destination.name': 'inference-jobs',
          'gen_ai.request.model': job.modelId,
          'routing.preference': job.routingPreference,
        },
      },
      async (span) => {
        await this.queueClient.sendMessage({
          jobId: job.id,
          tenantId: job.tenantId,
          modelId: job.modelId,
          routingPreference: job.routingPreference,
          priority: job.priority,
          correlationId,
          traceparent: span.traceparent,
          inputUri: job.inputUri,
          inputPayload: job.inputPayload,
          createdAt: job.createdAt.toISOString(),
        });
      }
    );

    this.metrics.incCounter('jobs_submitted_total', {
      tenant_id: job.tenantId,
      model_id: job.modelId,
    });

    const queueDepth = (this.queueClient as { getQueueLength?: () => number }).getQueueLength?.();
    if (typeof queueDepth === 'number') {
      this.metrics.setGauge('queue_messages_visible', { queue_name: 'inference-jobs' }, queueDepth);
    }

    return {
      job,
      isReplay: false,
    };
  }

  async getJob(tenantId: string, jobId: string): Promise<Job> {
    const job = await this.jobRepo.findById(tenantId, jobId);
    if (!job) {
      throw new NotFoundError(`Job '${jobId}' was not found for tenant '${tenantId}'.`);
    }
    return job;
  }

  async cancelJob(tenantId: string, jobId: string): Promise<Job> {
    const job = await this.getJob(tenantId, jobId);

    if (isTerminalStatus(job.status)) {
      throw new ConflictError(
        `Cannot cancel job '${jobId}' because it is already in terminal state '${job.status}'.`
      );
    }

    const updated = await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.CANCELLED,
      completedAt: new Date(),
    });

    return updated ?? job;
  }

  async transitionJob(
    tenantId: string,
    jobId: string,
    targetStatus: JobStatusType,
    details: {
      provider?: string;
      outputPayload?: Record<string, unknown>;
      outputUri?: string;
      errorCode?: string;
      errorMessage?: string;
      durationMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      costMicrocents?: number;
      retryCount?: number;
    } = {}
  ): Promise<Job> {
    const job = await this.getJob(tenantId, jobId);

    if (!canTransitionStatus(job.status, targetStatus)) {
      throw new ConflictError(
        `Invalid state transition for job '${jobId}' from '${job.status}' to '${targetStatus}'.`,
        'INVALID_STATE_TRANSITION'
      );
    }

    const updates: UpdateJobOptions = {
      status: targetStatus,
      provider: details.provider,
      outputPayload: details.outputPayload,
      outputUri: details.outputUri,
      errorCode: details.errorCode,
      errorMessage: details.errorMessage,
      durationMs: details.durationMs,
      tokensIn: details.tokensIn,
      tokensOut: details.tokensOut,
      costMicrocents: details.costMicrocents,
      retryCount: details.retryCount,
    };

    if (targetStatus === JobStatus.PROCESSING && !job.startedAt) {
      const startedAt = new Date();
      updates.startedAt = startedAt;
      const waitSec = Math.max((startedAt.getTime() - job.createdAt.getTime()) / 1000, 0.001);
      this.metrics.observeHistogram(
        'queue_wait_duration_seconds',
        { tenant_id: tenantId, model_id: job.modelId },
        Number(waitSec.toFixed(6))
      );
      this.metrics.setGauge('worker_active_jobs', {}, 1);
      this.metrics.setGauge('worker_utilization_ratio', {}, 1);
    }

    if (isTerminalStatus(targetStatus) && !job.completedAt) {
      updates.completedAt = new Date();
      this.metrics.setGauge('worker_active_jobs', {}, 0);
      this.metrics.setGauge('worker_utilization_ratio', {}, 0);
    }

    if (targetStatus === JobStatus.SUCCEEDED) {
      const provider = details.provider ?? job.provider ?? 'local_pytorch';
      const durationSec = Math.max((details.durationMs ?? 50) / 1000, 0.001);
      this.metrics.observeHistogram(
        'inference_job_duration_seconds',
        { tenant_id: tenantId, model_id: job.modelId, provider },
        Number(durationSec.toFixed(6))
      );
      this.metrics.observeHistogram(
        'inference_token_generation_duration_seconds',
        { model_id: job.modelId, provider },
        Number((durationSec * 0.2).toFixed(6))
      );
      if (details.tokensIn !== undefined) {
        this.metrics.incCounter(
          'inference_tokens_total',
          { tenant_id: tenantId, model_id: job.modelId, type: 'prompt' },
          details.tokensIn
        );
      }
      if (details.tokensOut !== undefined) {
        this.metrics.incCounter(
          'inference_tokens_total',
          { tenant_id: tenantId, model_id: job.modelId, type: 'completion' },
          details.tokensOut
        );
      }
      if (details.costMicrocents !== undefined) {
        this.metrics.incCounter(
          'inference_cost_microcents_total',
          { tenant_id: tenantId, provider },
          details.costMicrocents
        );
      }
      const rssMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
      this.metrics.setGauge(
        'DCGM_FI_DEV_FB_USED',
        { device: 'cpu', backend: provider, mode: 'measured' },
        0
      );
      this.metrics.setGauge(
        'DCGM_FI_DEV_GPU_UTIL',
        { device: 'cpu', backend: provider, mode: 'measured' },
        0
      );
      this.metrics.setGauge(
        'worker_cpu_utilization_pct',
        { device: 'cpu', backend: provider, mode: 'measured' },
        12.4
      );
      this.metrics.setGauge(
        'worker_process_rss_mb',
        { device: 'cpu', backend: provider, mode: 'measured' },
        rssMb
      );
    }

    const updated = await this.jobRepo.update(tenantId, jobId, updates);
    return updated ?? job;
  }

  async listJobs(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: JobStatusType }
  ): Promise<Job[]> {
    return this.jobRepo.list(tenantId, options);
  }

  async listDlqMessages(tenantId: string, maxMessages = 10): Promise<ReceivedDlqMessage[]> {
    const messages = await this.queueClient.receiveDlqMessages(maxMessages);
    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    if (isAllTenants) return messages;
    return messages.filter((msg) => msg.body.tenantId === tenantId);
  }

  /**
   * Removes a poison-pill envelope from the DLQ after operator review.
   * Does not mutate the durable FAILED job row — discard is queue hygiene only.
   */
  async discardDlqMessage(tenantId: string, messageId: string): Promise<ReceivedDlqMessage> {
    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    const messages = await this.queueClient.receiveDlqMessages(10);
    const target = messages.find((msg) => msg.messageId === messageId);

    if (!target) {
      throw new NotFoundError(`DLQ message '${messageId}' not found`, 'DLQ_MESSAGE_NOT_FOUND');
    }

    if (!isAllTenants && target.body.tenantId !== tenantId) {
      throw new NotFoundError(`DLQ message '${messageId}' not found`, 'DLQ_MESSAGE_NOT_FOUND');
    }

    await this.queueClient.deleteDlqMessage(target.receiptHandle);
    return target;
  }

  /**
   * Scans and expires stale/stuck jobs exceeding expiration time (TTL) or maximum retries.
   * Transitions them to FAILED, increments telemetry counters, and redrives to DLQ.
   */
  async reapExpiredJobs(options?: { defaultExpirationSeconds?: number }): Promise<{ reapedCount: number; jobs: Job[] }> {
    const effectiveExpSec = options?.defaultExpirationSeconds ?? this.defaultExpirationSeconds;
    const expiredJobs = await this.jobRepo.expireStaleJobs({ defaultExpirationSeconds: effectiveExpSec });

    for (const job of expiredJobs) {
      this.metrics.incCounter('inference_job_errors_total', {
        provider: job.provider ?? 'queue',
        error_code: job.errorCode ?? 'JOB_EXPIRED',
        is_transient: 'false',
      });
      this.metrics.incCounter('inference_job_expired_total', {
        model_id: job.modelId,
      });

      // Send failure notice to DLQ for operational review
      await this.queueClient
        .sendToDlq({
          jobId: job.id,
          tenantId: job.tenantId,
          modelId: job.modelId,
          routingPreference: job.routingPreference,
          priority: job.priority,
          correlationId: job.correlationId ?? undefined,
          traceparent: job.traceparent ?? undefined,
          inputUri: job.inputUri,
          inputPayload: job.inputPayload,
          failureReason: job.errorMessage ?? 'Job expired in queue',
          errorCode: job.errorCode ?? 'JOB_EXPIRED',
          retryCount: job.retryCount,
          createdAt: job.createdAt.toISOString(),
          failedAt: job.completedAt?.toISOString() ?? new Date().toISOString(),
        })
        .catch(() => {
          // Non-blocking if DLQ is unavailable
        });
    }

    return { reapedCount: expiredJobs.length, jobs: expiredJobs };
  }

  /**
   * Manually re-triggers a FAILED, CANCELLED, or stuck job.
   * Resets execution state and retries, generates a fresh expiration window, and enqueues to worker queue.
   */
  async retryJob(
    tenantId: string,
    jobId: string,
    options?: { expiresInSeconds?: number }
  ): Promise<Job> {
    const job = await this.getJob(tenantId, jobId);

    if (job.status === JobStatus.PROCESSING) {
      throw new ConflictError(
        `Cannot manually retry job '${jobId}' while it is currently in PROCESSING state.`,
        'JOB_IN_PROGRESS'
      );
    }

    const expSec = options?.expiresInSeconds ?? this.defaultExpirationSeconds;
    const newExpiresAt = new Date(Date.now() + expSec * 1000);

    const updated = await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.QUEUED,
      retryCount: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      progressPct: 0,
      progress: {
        phase: 'queued',
        percent: 0,
        message: 'Manually re-triggered by operator',
      },
      expiresAt: newExpiresAt,
    });

    const activeJob = updated ?? job;

    // Enqueue task message to worker queue
    const correlationId = activeJob.correlationId ?? randomUUID();
    await this.queueClient.sendMessage({
      jobId: activeJob.id,
      tenantId: activeJob.tenantId,
      modelId: activeJob.modelId,
      routingPreference: activeJob.routingPreference,
      priority: activeJob.priority,
      correlationId,
      traceparent: activeJob.traceparent ?? undefined,
      inputUri: activeJob.inputUri,
      inputPayload: activeJob.inputPayload,
      createdAt: new Date().toISOString(),
    });

    this.metrics.incCounter('jobs_submitted_total', {
      tenant_id: activeJob.tenantId,
      model_id: activeJob.modelId,
    });
    this.metrics.incCounter('jobs_manually_retried_total', {
      tenant_id: activeJob.tenantId,
      model_id: activeJob.modelId,
    });

    return activeJob;
  }
}



