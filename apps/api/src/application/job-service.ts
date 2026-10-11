import { createHash } from 'node:crypto';
import type { IJobRepository, UpdateJobOptions } from '../infrastructure/db/job-repository.js';
import type { IQueueClient, ReceivedDlqMessage } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
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
    private storageClient: IStorageClient
  ) {}

  async submitJob(
    tenantId: string,
    request: SubmitJobRequest,
    idempotencyKey?: string | null
  ): Promise<SubmitJobResult> {
    const requestHash = computeRequestHash(request);

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

    // 3. Persist Job to DB in QUEUED state
    const job = await this.jobRepo.create({
      tenantId,
      modelId: request.modelId,
      routingPreference: request.routingPreference ?? RoutingPreference.AUTO,
      priority: request.priority ?? 5,
      idempotencyKey: idempotencyKey ?? null,
      requestHash,
      inputPayload,
      inputUri,
      maxRetries: request.maxRetries ?? 3,
    });

    // 4. Publish message envelope to Queue
    await this.queueClient.sendMessage({
      jobId: job.id,
      tenantId: job.tenantId,
      modelId: job.modelId,
      routingPreference: job.routingPreference,
      priority: job.priority,
      inputUri: job.inputUri,
      inputPayload: job.inputPayload,
      createdAt: job.createdAt.toISOString(),
    });

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
      updates.startedAt = new Date();
    }

    if (isTerminalStatus(targetStatus) && !job.completedAt) {
      updates.completedAt = new Date();
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
    return messages.filter((msg) => msg.body.tenantId === tenantId);
  }
}



