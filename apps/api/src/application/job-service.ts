import type { IJobRepository, UpdateJobOptions } from '../infrastructure/db/job-repository.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import {
  type Job,
  type JobStatusType,
  type RoutingPreferenceType,
  JobStatus,
  RoutingPreference,
} from '../domain/job.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';

export interface SubmitJobRequest {
  modelId: string;
  input?: Record<string, unknown>;
  inputUri?: string;
  routingPreference?: RoutingPreferenceType;
  priority?: number;
}

export interface SubmitJobResult {
  job: Job;
  isReplay: boolean;
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
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await this.jobRepo.findByIdempotencyKey(tenantId, idempotencyKey);
      if (existing) {
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
      inputPayload,
      inputUri,
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

    if (
      job.status === JobStatus.SUCCEEDED ||
      job.status === JobStatus.FAILED ||
      job.status === JobStatus.CANCELLED
    ) {
      throw new ConflictError(
        `Cannot cancel job '${jobId}' because it is already in terminal state '${job.status}'.`
      );
    }

    const updated = await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.CANCELLED,
      completedAt: new Date(),
    });

    if (!updated) {
      throw new NotFoundError(`Job '${jobId}' could not be updated.`);
    }

    return updated;
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
    } = {}
  ): Promise<Job> {
    const job = await this.getJob(tenantId, jobId);

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
    };

    if (targetStatus === JobStatus.PROCESSING && !job.startedAt) {
      updates.startedAt = new Date();
    }

    if (
      (targetStatus === JobStatus.SUCCEEDED ||
        targetStatus === JobStatus.FAILED ||
        targetStatus === JobStatus.CANCELLED) &&
      !job.completedAt
    ) {
      updates.completedAt = new Date();
    }

    const updated = await this.jobRepo.update(tenantId, jobId, updates);
    if (!updated) {
      throw new NotFoundError(`Job '${jobId}' could not be transitioned.`);
    }

    return updated;
  }

  async listJobs(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: JobStatusType }
  ): Promise<Job[]> {
    return this.jobRepo.list(tenantId, options);
  }
}

