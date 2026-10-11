import type { IJobRepository } from '../infrastructure/db/job-repository.js';
import type { IQueueClient, ReceivedMessage } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import {
  type Job,
  JobStatus,
  calculateBackoffSeconds,
  isTerminalStatus,
} from '../domain/job.js';

export class InferenceExecutionError extends Error {
  public readonly code: string;
  public readonly isTransient: boolean;

  constructor(message: string, code: string, isTransient = false) {
    super(message);
    this.name = 'InferenceExecutionError';
    this.code = code;
    this.isTransient = isTransient;
  }
}

export interface InferenceExecutionResult {
  provider: string;
  outputText: string;
  finishReason: string;
  tokensIn: number;
  tokensOut: number;
  costMicrocents: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface IInferenceExecutor {
  execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>
  ): Promise<InferenceExecutionResult>;
}

export class DefaultLocalInferenceExecutor implements IInferenceExecutor {
  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>
  ): Promise<InferenceExecutionResult> {
    const startTime = Date.now();

    if (await checkCancelled()) {
      throw new InferenceExecutionError('Job cancelled before inference start', 'JOB_CANCELLED', false);
    }

    const simulateFailure = resolvedInput._simulate_failure as string | undefined;
    if (simulateFailure === 'permanent') {
      throw new InferenceExecutionError(
        'Permanent model execution failure: unsupported context length',
        'INVALID_MODEL_PARAMETERS',
        false
      );
    }

    if (simulateFailure === 'transient') {
      throw new InferenceExecutionError(
        'Transient provider capacity timeout while allocating compute',
        'PROVIDER_TRANSIENT_TIMEOUT',
        true
      );
    }

    if (simulateFailure === 'transient_once' && job.retryCount === 0) {
      throw new InferenceExecutionError(
        'Transient worker warm-up error on initial attempt',
        'WORKER_WARMUP_TRANSIENT',
        true
      );
    }

    const prompt = typeof resolvedInput.prompt === 'string' ? resolvedInput.prompt : '';
    const tokensIn = Math.max(Math.ceil(prompt.length / 4), 1);
    const outputText = `Inference completed for model '${job.modelId}': ${prompt.slice(0, 120)}`;
    const tokensOut = Math.max(Math.ceil(outputText.length / 4), 8);
    const durationMs = Math.max(Date.now() - startTime, 5);
    const costMicrocents = (tokensIn + tokensOut) * 5;

    return {
      provider: 'local_cpu_worker',
      outputText,
      finishReason: 'stop',
      tokensIn,
      tokensOut,
      costMicrocents,
      durationMs,
    };
  }
}

/**
 * Russian Doll (Decorator) wrapper around IInferenceExecutor that profiles
 * execution wall-clock latency, computes token throughput, and attaches audit metadata.
 */
export class ProfilingInferenceExecutor implements IInferenceExecutor {
  constructor(private readonly inner: IInferenceExecutor) {}

  async execute(
    job: Job,
    resolvedInput: Record<string, unknown>,
    checkCancelled: () => Promise<boolean>
  ): Promise<InferenceExecutionResult> {
    const startNs = process.hrtime.bigint();
    const result = await this.inner.execute(job, resolvedInput, checkCancelled);
    const measuredMs = Math.max(Number(process.hrtime.bigint() - startNs) / 1_000_000, 1);
    const durationMs = result.durationMs > 0 ? result.durationMs : Math.round(measuredMs);
    const tokensPerSec = Number(((result.tokensOut / durationMs) * 1000).toFixed(2));

    return {
      ...result,
      durationMs,
      metadata: {
        ...result.metadata,
        profiled_wall_ms: Number(measuredMs.toFixed(3)),
        tokens_per_sec: tokensPerSec,
      },
    };
  }
}

export interface JobWorkerOptions {
  maxRetries?: number;
  baseBackoffSeconds?: number;
  maxBackoffSeconds?: number;
  pollIntervalMs?: number;
}

export interface ProcessMessageOutcome {
  jobId: string;
  action: 'succeeded' | 'retrying' | 'failed_dlq' | 'skipped_terminal' | 'cancelled' | 'discarded_missing';
  retryCount?: number;
  backoffSeconds?: number;
}

export class JobWorker {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private maxRetries: number;
  private baseBackoffSeconds: number;
  private maxBackoffSeconds: number;
  private pollIntervalMs: number;
  private executor: IInferenceExecutor;

  constructor(
    private jobRepo: IJobRepository,
    private queueClient: IQueueClient,
    private storageClient: IStorageClient,
    executor?: IInferenceExecutor,
    options: JobWorkerOptions = {}
  ) {
    this.executor =
      executor ?? new ProfilingInferenceExecutor(new DefaultLocalInferenceExecutor());
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffSeconds = options.baseBackoffSeconds ?? 2;
    this.maxBackoffSeconds = options.maxBackoffSeconds ?? 60;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private scheduleNextPoll(): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.processNextBatch(1);
      } catch {
        // Poll cycle errors are isolated so the daemon loop remains alive
      } finally {
        this.scheduleNextPoll();
      }
    }, this.pollIntervalMs);
  }

  async processNextBatch(maxMessages = 1): Promise<ProcessMessageOutcome[]> {
    const messages = await this.queueClient.receiveMessages(maxMessages, 0);
    const outcomes: ProcessMessageOutcome[] = [];
    for (const msg of messages) {
      const outcome = await this.processMessage(msg);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  async processMessage(msg: ReceivedMessage): Promise<ProcessMessageOutcome> {
    const { tenantId, jobId } = msg.body;
    const job = await this.jobRepo.findById(tenantId, jobId);

    if (!job) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'discarded_missing' };
    }

    // Transition to PROCESSING if not already in a terminal state
    const processingJob = await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.PROCESSING,
      expectedCurrentStatuses: [JobStatus.QUEUED, JobStatus.RETRYING, JobStatus.PROCESSING],
      startedAt: job.startedAt ?? new Date(),
    });

    if (!processingJob) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'skipped_terminal' };
    }

    try {
      const resolvedInput = await this.resolveJobInput(processingJob);

      const checkCancelled = async (): Promise<boolean> => {
        const latest = await this.jobRepo.findById(tenantId, jobId);
        return !latest || latest.status === JobStatus.CANCELLED;
      };

      const result = await this.executor.execute(processingJob, resolvedInput, checkCancelled);

      // Persist output artifact to S3-compatible storage
      const artifactKey = `tenants/${tenantId}/outputs/${jobId}/result.json`;
      const artifactPayload = {
        job_id: jobId,
        tenant_id: tenantId,
        model_id: processingJob.modelId,
        provider: result.provider,
        output_text: result.outputText,
        finish_reason: result.finishReason,
        usage: {
          prompt_tokens: result.tokensIn,
          completion_tokens: result.tokensOut,
          total_tokens: result.tokensIn + result.tokensOut,
          cost_microcents: result.costMicrocents,
        },
        completed_at: new Date().toISOString(),
      };
      const outputUri = await this.storageClient.putObject(
        artifactKey,
        JSON.stringify(artifactPayload),
        'application/json'
      );

      // Atomically transition to SUCCEEDED only if still PROCESSING
      const succeededJob = await this.jobRepo.update(tenantId, jobId, {
        status: JobStatus.SUCCEEDED,
        expectedCurrentStatuses: [JobStatus.PROCESSING],
        provider: result.provider,
        outputPayload: {
          output_text: result.outputText,
          finish_reason: result.finishReason,
          ...(result.metadata ? { metadata: result.metadata } : {}),
        },
        outputUri,
        durationMs: result.durationMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costMicrocents: result.costMicrocents,
        completedAt: new Date(),
      });

      await this.queueClient.deleteMessage(msg.receiptHandle);

      if (!succeededJob) {
        return { jobId, action: 'cancelled' };
      }

      return { jobId, action: 'succeeded', retryCount: succeededJob.retryCount };
    } catch (err: unknown) {
      return this.handleExecutionFailure(msg, processingJob, err);
    }
  }

  private async resolveJobInput(job: Job): Promise<Record<string, unknown>> {
    const payload = job.inputPayload ?? {};
    const targetUri = (payload._offloaded && typeof payload.inputUri === 'string')
      ? payload.inputUri
      : job.inputUri;

    if (targetUri && targetUri.startsWith('s3://')) {
      const key = targetUri.replace(/^s3:\/\/[^/]+\//, '');
      const buffer = await this.storageClient.getObject(key);
      if (!buffer) {
        throw new InferenceExecutionError(
          `Input artifact not found at '${targetUri}'`,
          'INPUT_ARTIFACT_NOT_FOUND',
          false
        );
      }
      return JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>;
    }

    return payload;
  }

  private async handleExecutionFailure(
    msg: ReceivedMessage,
    job: Job,
    err: unknown
  ): Promise<ProcessMessageOutcome> {
    const { tenantId, jobId } = msg.body;

    // Check if cancelled concurrently
    const current = await this.jobRepo.findById(tenantId, jobId);
    if (!current || current.status === JobStatus.CANCELLED) {
      await this.queueClient.deleteMessage(msg.receiptHandle);
      return { jobId, action: 'cancelled' };
    }

    const isInferenceErr = err instanceof InferenceExecutionError;
    const isTransient = isInferenceErr ? err.isTransient : true;
    const errorCode = isInferenceErr ? err.code : 'WORKER_EXECUTION_ERROR';
    const errorMessage = err instanceof Error ? err.message : String(err);

    const maxAllowedRetries = job.maxRetries ?? this.maxRetries;
    const nextRetryCount = job.retryCount + 1;

    if (isTransient && nextRetryCount <= maxAllowedRetries) {
      const backoffSeconds = calculateBackoffSeconds(nextRetryCount, {
        baseDelaySeconds: this.baseBackoffSeconds,
        maxDelaySeconds: this.maxBackoffSeconds,
      });

      await this.jobRepo.update(tenantId, jobId, {
        status: JobStatus.RETRYING,
        expectedCurrentStatuses: [JobStatus.PROCESSING],
        retryCount: nextRetryCount,
        errorCode,
        errorMessage,
      });

      await this.queueClient.changeMessageVisibility(msg.receiptHandle, backoffSeconds);

      return {
        jobId,
        action: 'retrying',
        retryCount: nextRetryCount,
        backoffSeconds,
      };
    }

    // Retries exhausted or permanent error -> mark FAILED and quarantine in DLQ
    const finalRetryCount = isTransient ? job.retryCount : job.retryCount;
    await this.jobRepo.update(tenantId, jobId, {
      status: JobStatus.FAILED,
      expectedCurrentStatuses: [JobStatus.PROCESSING, JobStatus.RETRYING, JobStatus.QUEUED],
      errorCode,
      errorMessage,
      completedAt: new Date(),
    });

    await this.queueClient.sendToDlq({
      ...msg.body,
      failureReason: errorMessage,
      errorCode,
      retryCount: finalRetryCount,
      failedAt: new Date().toISOString(),
    });

    await this.queueClient.deleteMessage(msg.receiptHandle);

    return {
      jobId,
      action: 'failed_dlq',
      retryCount: finalRetryCount,
    };
  }
}
