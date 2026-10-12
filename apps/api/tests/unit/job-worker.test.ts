import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  JobWorker,
  InferenceExecutionError,
  DefaultLocalInferenceExecutor,
  type IInferenceExecutor,
  type InferenceExecutionResult,
} from '../../src/application/job-worker.js';
import { JobService } from '../../src/application/job-service.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { JobStatus, calculateBackoffSeconds, canTransitionStatus, isTerminalStatus } from '../../src/domain/job.js';

describe('JobWorker & Failure Recovery Lifecycle', () => {
  let jobRepo: InMemoryJobRepository;
  let queueClient: InMemoryQueueClient;
  let storageClient: InMemoryStorageClient;
  let jobService: JobService;

  beforeEach(() => {
    jobRepo = new InMemoryJobRepository();
    queueClient = new InMemoryQueueClient({ maxReceiveCount: 4 });
    storageClient = new InMemoryStorageClient();
    jobService = new JobService(jobRepo, queueClient, storageClient);
  });

  test('domain state machine helpers validate transitions and bounded backoff', () => {
    assert.equal(isTerminalStatus(JobStatus.SUCCEEDED), true);
    assert.equal(isTerminalStatus(JobStatus.FAILED), true);
    assert.equal(isTerminalStatus(JobStatus.CANCELLED), true);
    assert.equal(isTerminalStatus(JobStatus.QUEUED), false);
    assert.equal(isTerminalStatus(JobStatus.PROCESSING), false);
    assert.equal(isTerminalStatus(JobStatus.RETRYING), false);

    assert.equal(canTransitionStatus(JobStatus.SUBMITTED, JobStatus.QUEUED), true);
    assert.equal(canTransitionStatus(JobStatus.QUEUED, JobStatus.PROCESSING), true);
    assert.equal(canTransitionStatus(JobStatus.PROCESSING, JobStatus.RETRYING), true);
    assert.equal(canTransitionStatus(JobStatus.RETRYING, JobStatus.PROCESSING), true);
    assert.equal(canTransitionStatus(JobStatus.PROCESSING, JobStatus.PROCESSING), true);
    assert.equal(canTransitionStatus(JobStatus.SUCCEEDED, JobStatus.SUCCEEDED), false);
    assert.equal(canTransitionStatus(JobStatus.SUCCEEDED, JobStatus.PROCESSING), false);
    assert.equal(canTransitionStatus(JobStatus.CANCELLED, JobStatus.SUCCEEDED), false);

    // Bounded exponential backoff: min(base * 2^(attempt-1), max)
    assert.equal(calculateBackoffSeconds(1, { baseDelaySeconds: 2, maxDelaySeconds: 10 }), 2);
    assert.equal(calculateBackoffSeconds(2, { baseDelaySeconds: 2, maxDelaySeconds: 10 }), 4);
    assert.equal(calculateBackoffSeconds(3, { baseDelaySeconds: 2, maxDelaySeconds: 10 }), 8);
    assert.equal(calculateBackoffSeconds(4, { baseDelaySeconds: 2, maxDelaySeconds: 10 }), 10);
    assert.equal(calculateBackoffSeconds(1), 2);
  });

  test('executes happy path job, persists S3 output artifact, and transitions to SUCCEEDED', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient);
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Summarize distributed consensus.' },
    });

    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].action, 'succeeded');
    assert.equal(outcomes[0].jobId, job.id);

    const updated = await jobService.getJob('tenant-1', job.id);
    assert.equal(updated.status, JobStatus.SUCCEEDED);
    assert.equal(updated.provider, 'local_cpu_worker');
    assert.ok(updated.startedAt);
    assert.ok(updated.completedAt);
    assert.ok(updated.outputUri);
    assert.ok(updated.outputPayload?.output_text);

    // Verify artifact persisted in storage
    const key = updated.outputUri!.replace(/^s3:\/\/[^/]+\//, '');
    const storedBuffer = await storageClient.getObject(key);
    assert.ok(storedBuffer);
    const storedJson = JSON.parse(storedBuffer.toString('utf-8'));
    assert.equal(storedJson.job_id, job.id);
    assert.equal(storedJson.tenant_id, 'tenant-1');
    assert.equal(queueClient.getQueueLength(), 0);
  });

  test('loads offloaded large input from S3 before running inference', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient);
    const largePrompt = 'A'.repeat(270 * 1024);
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: largePrompt },
    });

    assert.ok(job.inputUri);
    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'succeeded');

    const completed = await jobService.getJob('tenant-1', job.id);
    assert.equal(completed.status, JobStatus.SUCCEEDED);
  });

  test('fails with INPUT_ARTIFACT_NOT_FOUND and routes to DLQ if S3 input is missing', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient);
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      inputUri: 's3://mock-bucket/tenants/tenant-1/inputs/nonexistent.json',
    });

    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'failed_dlq');

    const failedJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(failedJob.status, JobStatus.FAILED);
    assert.equal(failedJob.errorCode, 'INPUT_ARTIFACT_NOT_FOUND');
    assert.equal(queueClient.getDlqLength(), 1);
  });

  test('retries transient failure with bounded backoff and recovers on subsequent attempt', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient, undefined, {
      maxRetries: 3,
      baseBackoffSeconds: 0,
      maxBackoffSeconds: 0,
    });

    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: {
        prompt: 'Recoverable prompt',
        _simulate_failure: 'transient_once',
      },
    });

    // Attempt 1: transient failure -> transitions to RETRYING, retryCount = 1
    const outcome1 = await worker.processNextBatch(1);
    assert.equal(outcome1[0].action, 'retrying');
    assert.equal(outcome1[0].retryCount, 1);

    const retryingJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(retryingJob.status, JobStatus.RETRYING);
    assert.equal(retryingJob.retryCount, 1);
    assert.equal(retryingJob.errorCode, 'WORKER_WARMUP_TRANSIENT');

    // Attempt 2: message becomes visible again -> worker succeeds!
    const outcome2 = await worker.processNextBatch(1);
    assert.equal(outcome2[0].action, 'succeeded');
    assert.equal(outcome2[0].retryCount, 1);

    const finalJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(finalJob.status, JobStatus.SUCCEEDED);
    assert.equal(finalJob.retryCount, 1);
    assert.equal(queueClient.getDlqLength(), 0);
  });

  test('exhausts maxRetries on persistent transient failures and routes to DLQ', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient, undefined, {
      maxRetries: 2,
      baseBackoffSeconds: 0,
      maxBackoffSeconds: 0,
    });

    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      maxRetries: 2,
      input: {
        prompt: 'Always failing transiently',
        _simulate_failure: 'transient',
      },
    });

    // Attempt 1 -> RETRYING (retryCount = 1)
    const out1 = await worker.processNextBatch(1);
    assert.equal(out1[0].action, 'retrying');
    assert.equal(out1[0].retryCount, 1);

    // Attempt 2 -> RETRYING (retryCount = 2)
    const out2 = await worker.processNextBatch(1);
    assert.equal(out2[0].action, 'retrying');
    assert.equal(out2[0].retryCount, 2);

    // Attempt 3 -> Exceeds maxRetries (2), transitions to FAILED and routes to DLQ
    const out3 = await worker.processNextBatch(1);
    assert.equal(out3[0].action, 'failed_dlq');
    assert.equal(out3[0].retryCount, 2);

    const failedJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(failedJob.status, JobStatus.FAILED);
    assert.equal(failedJob.retryCount, 2);
    assert.equal(failedJob.errorCode, 'PROVIDER_TRANSIENT_TIMEOUT');

    const dlqMessages = await jobService.listDlqMessages('tenant-1');
    assert.equal(dlqMessages.length, 1);
    assert.equal(dlqMessages[0].body.jobId, job.id);
    assert.equal(dlqMessages[0].body.retryCount, 2);
  });

  test('immediately fails and routes to DLQ on permanent error without retrying', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient, undefined, {
      maxRetries: 3,
      baseBackoffSeconds: 0,
    });

    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: {
        prompt: 'Bad parameters',
        _simulate_failure: 'permanent',
      },
    });

    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'failed_dlq');
    assert.equal(outcomes[0].retryCount, 0);

    const failedJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(failedJob.status, JobStatus.FAILED);
    assert.equal(failedJob.retryCount, 0);
    assert.equal(failedJob.errorCode, 'INVALID_MODEL_PARAMETERS');
    assert.equal(queueClient.getDlqLength(), 1);
  });

  test('skips execution if job was cancelled while queued', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient);
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Cancel before worker' },
    });

    await jobService.cancelJob('tenant-1', job.id);

    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'skipped_terminal');

    const current = await jobService.getJob('tenant-1', job.id);
    assert.equal(current.status, JobStatus.CANCELLED);
    assert.equal(queueClient.getQueueLength(), 0);
  });

  test('aborts and preserves CANCELLED state if job is cancelled mid-execution', async () => {
    const midCancelExecutor: IInferenceExecutor = {
      async execute(job, _input, checkCancelled): Promise<InferenceExecutionResult> {
        // Simulate client cancelling job while worker is mid-inference
        await jobService.cancelJob(job.tenantId, job.id);
        assert.equal(await checkCancelled(), true);
        return {
          provider: 'local_cpu_worker',
          outputText: 'Should be discarded',
          finishReason: 'stop',
          tokensIn: 5,
          tokensOut: 5,
          costMicrocents: 50,
          durationMs: 10,
        };
      },
    };

    const worker = new JobWorker(jobRepo, queueClient, storageClient, midCancelExecutor);
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Cancel during execution' },
    });

    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'cancelled');

    const finalJob = await jobService.getJob('tenant-1', job.id);
    assert.equal(finalJob.status, JobStatus.CANCELLED);
    assert.equal(finalJob.outputPayload, null);
  });

  test('handles cancellation check inside DefaultLocalInferenceExecutor and unknown errors', async () => {
    const defaultExec = new DefaultLocalInferenceExecutor();
    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Test' },
    });

    await assert.rejects(
      async () => {
        await defaultExec.execute(job, {}, async () => true);
      },
      (err: unknown) => err instanceof InferenceExecutionError && err.code === 'JOB_CANCELLED'
    );

    // Discards missing job gracefully
    await queueClient.clear();
    await queueClient.sendMessage({
      jobId: '00000000-0000-0000-0000-000000000000',
      tenantId: 'tenant-1',
      modelId: 'llama-3',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });

    const worker = new JobWorker(jobRepo, queueClient, storageClient);
    const missingOutcome = await worker.processNextBatch(1);
    assert.equal(missingOutcome[0].action, 'discarded_missing');

    // Executor throws non-Error after job was cancelled mid-execution
    const cancelAndThrowExecutor: IInferenceExecutor = {
      async execute(j, _inp, checkCancelled) {
        await jobService.cancelJob(j.tenantId, j.id);
        await checkCancelled();
        throw 'Aborted due to cancellation';
      },
    };
    const cancelThrowWorker = new JobWorker(jobRepo, queueClient, storageClient, cancelAndThrowExecutor);
    await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Cancel and throw' },
    });
    const cancelThrowOut = await cancelThrowWorker.processNextBatch(1);
    assert.equal(cancelThrowOut[0].action, 'cancelled');

    // Executor throws non-Error on active job
    const rawThrowExecutor: IInferenceExecutor = {
      async execute() {
        throw 'Raw string error';
      },
    };
    const rawThrowWorker = new JobWorker(jobRepo, queueClient, storageClient, rawThrowExecutor, {
      maxRetries: 0,
    });
    await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      maxRetries: 0,
      input: { prompt: 'Raw throw' },
    });
    const rawThrowOut = await rawThrowWorker.processNextBatch(1);
    assert.equal(rawThrowOut[0].action, 'failed_dlq');
  });

  test('starts and stops background polling loop cleanly', async () => {
    const worker = new JobWorker(jobRepo, queueClient, storageClient, undefined, {
      pollIntervalMs: 20,
    });
    assert.equal(worker.isRunning(), false);
    worker.start();
    assert.equal(worker.isRunning(), true);
    // Calling start again is idempotent
    worker.start();

    await jobService.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Polled by background daemon' },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    await worker.stop();
    assert.equal(worker.isRunning(), false);

    const jobs = await jobService.listJobs('tenant-1');
    assert.equal(jobs[0].status, JobStatus.SUCCEEDED);
  });

  test('executes real PythonWorkerInferenceExecutor and handles success, cancellation, and error paths', async () => {
    const { PythonWorkerInferenceExecutor } = await import('../../src/application/job-worker.js');
    const pyExec = new PythonWorkerInferenceExecutor();

    const { job } = await jobService.submitJob('tenant-1', {
      modelId: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      input: { prompt: 'Run Python worker bridge test', parameters: { max_new_tokens: 6 } },
    });

    // 1. Pre-flight cancellation check
    await assert.rejects(
      async () => {
        await pyExec.execute(job, { prompt: 'Cancelled' }, async () => true);
      },
      (err: unknown) => err instanceof InferenceExecutionError && err.code === 'JOB_CANCELLED'
    );

    // 2. Real subprocess execution against apps.worker.consumer
    const res = await pyExec.execute(
      job,
      { prompt: 'Run Python worker bridge test', parameters: { max_new_tokens: 6 } },
      async () => false
    );
    assert.equal(res.provider, 'local_pytorch');
    assert.equal(res.tokensOut, 6);
    assert.ok(res.outputText.includes('[TinyLlama/TinyLlama-1.1B-Chat-v1.0]'));
    assert.ok(res.metadata?.telemetry);

    // 3. Structured error returned by Python worker (non-zero exit with JSON stdout)
    await assert.rejects(
      async () => {
        await pyExec.execute(
          job,
          { prompt: 'Fail permanently', _simulate_failure: 'permanent' },
          async () => false
        );
      },
      (err: unknown) =>
        err instanceof InferenceExecutionError &&
        err.code === 'INVALID_MODEL_PARAMETERS' &&
        err.isTransient === false
    );

    // 4. Fallback defaults on sparse JSON response via custom runner
    const sparseExec = new PythonWorkerInferenceExecutor('python3', async () => ({
      stdout: JSON.stringify({ ok: true }),
      stderr: '',
    }));
    const sparseRes = await sparseExec.execute(job, {}, async () => false);
    assert.equal(sparseRes.provider, 'local_pytorch');
    assert.equal(sparseRes.tokensIn, 1);

    // 5. Fallback error defaults on sparse error JSON response
    const sparseErrExec = new PythonWorkerInferenceExecutor('python3', async () => ({
      stdout: JSON.stringify({ ok: false }),
      stderr: '',
    }));
    await assert.rejects(
      async () => {
        await sparseErrExec.execute(job, {}, async () => false);
      },
      (err: unknown) =>
        err instanceof InferenceExecutionError && err.code === 'WORKER_EXECUTION_ERROR'
    );

    // 6. Unhandled process spawn error (missing binary)
    const badBinExec = new PythonWorkerInferenceExecutor('/nonexistent-python-binary');
    await assert.rejects(
      async () => {
        await badBinExec.execute(job, {}, async () => false);
      },
      (err: unknown) =>
        err instanceof InferenceExecutionError &&
        err.code === 'PYTHON_WORKER_PROCESS_ERROR' &&
        err.isTransient === true
    );

    // 7. Full JobWorker run with PythonWorkerInferenceExecutor records hardware telemetry gauges
    const pyWorker = new JobWorker(jobRepo, queueClient, storageClient, pyExec);
    const outcomes = await pyWorker.processNextBatch(1);
    assert.equal(outcomes[0].action, 'succeeded');
  });
});

