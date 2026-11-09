import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JobService } from '../../src/application/job-service.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { JobStatus } from '../../src/domain/job.js';
import { ConflictError, NotFoundError } from '../../src/domain/errors.js';

describe('JobService Application Service', () => {
  let jobRepo: InMemoryJobRepository;
  let queueClient: InMemoryQueueClient;
  let storageClient: InMemoryStorageClient;
  let service: JobService;

  beforeEach(() => {
    jobRepo = new InMemoryJobRepository();
    queueClient = new InMemoryQueueClient();
    storageClient = new InMemoryStorageClient();
    service = new JobService(jobRepo, queueClient, storageClient);
  });

  test('submits job and enqueues task envelope', async () => {
    const result = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Hello world' },
    });

    assert.equal(result.isReplay, false);
    assert.ok(result.job.id);
    assert.equal(result.job.status, JobStatus.QUEUED);
    assert.equal(result.job.modelId, 'meta-llama/Llama-3-8B-Instruct');

    // Verify queue received message
    assert.equal(queueClient.getQueueLength(), 1);
    const messages = await queueClient.receiveMessages(1);
    assert.equal(messages[0].body.jobId, result.job.id);
  });

  test('enforces idempotency and returns existing job on replay without re-queueing', async () => {
    const key = 'req-dedup-1234';
    const first = await service.submitJob(
      'tenant-1',
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Once' },
      },
      key
    );

    assert.equal(first.isReplay, false);
    assert.equal(queueClient.getQueueLength(), 1);

    const second = await service.submitJob(
      'tenant-1',
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Once' },
      },
      key
    );

    assert.equal(second.isReplay, true);
    assert.equal(second.job.id, first.job.id);
    // Queue should not receive duplicate message
    assert.equal(queueClient.getQueueLength(), 1);
  });

  test('offloads large input payloads to object storage', async () => {
    const largePrompt = 'x'.repeat(300 * 1024); // 300KB > 256KB threshold
    const result = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: largePrompt },
    });

    assert.ok(result.job.inputUri);
    assert.ok(result.job.inputUri.startsWith('s3://mock-bucket/tenants/tenant-1/inputs/'));
  });

  test('cancels in-flight job successfully', async () => {
    const submitted = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Cancel me' },
    });

    const cancelled = await service.cancelJob('tenant-1', submitted.job.id);
    assert.equal(cancelled.status, JobStatus.CANCELLED);
    assert.ok(cancelled.completedAt);
  });

  test('throws ConflictError when trying to cancel completed job', async () => {
    const submitted = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Done' },
    });

    await service.transitionJob('tenant-1', submitted.job.id, JobStatus.SUCCEEDED, {
      durationMs: 150,
      outputPayload: { output: 'finished' },
    });

    await assert.rejects(
      async () => {
        await service.cancelJob('tenant-1', submitted.job.id);
      },
      (err) => err instanceof ConflictError
    );
  });

  test('throws ConflictError for idempotency key reused with different payload', async () => {
    const key = 'req-dedup-mismatch';
    await service.submitJob(
      'tenant-1',
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Original prompt' },
      },
      key
    );

    await assert.rejects(
      async () => {
        await service.submitJob(
          'tenant-1',
          {
            modelId: 'meta-llama/Llama-3-8B-Instruct',
            input: { prompt: 'Modified prompt' },
          },
          key
        );
      },
      (err: unknown) => err instanceof ConflictError && err.code === 'IDEMPOTENCY_CONFLICT'
    );
  });

  test('throws ConflictError on invalid backward state transition from terminal state', async () => {
    const submitted = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Finish me' },
    });

    await service.transitionJob('tenant-1', submitted.job.id, JobStatus.SUCCEEDED);

    await assert.rejects(
      async () => {
        await service.transitionJob('tenant-1', submitted.job.id, JobStatus.PROCESSING);
      },
      (err: unknown) => err instanceof ConflictError && err.code === 'INVALID_STATE_TRANSITION'
    );
  });

  test('throws NotFoundError for non-existent job or wrong tenant', async () => {
    await assert.rejects(
      async () => {
        await service.getJob('tenant-1', '00000000-0000-0000-0000-000000000000');
      },
      (err) => err instanceof NotFoundError
    );
  });

  test('reaps expired queued jobs exceeding expiration time (TTL) and marks them FAILED', async () => {
    // 1. Submit a job that expires in 1 second
    const { job: expiredCandidate } = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Expiring job' },
      expiresInSeconds: 1,
    });

    // Artificially age the job into the past
    await jobRepo.update('tenant-1', expiredCandidate.id, {
      expiresAt: new Date(Date.now() - 5000), // 5 seconds ago
    });

    // 2. Submit a fresh job that expires in 3600 seconds
    const { job: freshJob } = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Fresh job' },
      expiresInSeconds: 3600,
    });

    // Run reaper
    const result = await service.reapExpiredJobs();
    assert.equal(result.reapedCount, 1);
    assert.equal(result.jobs[0].id, expiredCandidate.id);

    // Verify expired job transitioned to FAILED with JOB_EXPIRED
    const inspected = await service.getJob('tenant-1', expiredCandidate.id);
    assert.equal(inspected.status, JobStatus.FAILED);
    assert.equal(inspected.errorCode, 'JOB_EXPIRED');
    assert.ok(inspected.completedAt);
    assert.ok(inspected.errorMessage?.includes('queue expiration timeout'));

    // Verify fresh job is untouched
    const freshInspected = await service.getJob('tenant-1', freshJob.id);
    assert.equal(freshInspected.status, JobStatus.QUEUED);
  });

  test('reaps queued jobs exceeding maximum retry count and marks them FAILED', async () => {
    const { job } = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Max retries job' },
      maxRetries: 3,
    });

    // Simulate 3 retries exhausted while remaining queued/retrying
    await jobRepo.update('tenant-1', job.id, {
      retryCount: 3,
    });

    const result = await service.reapExpiredJobs();
    assert.ok(result.reapedCount >= 1);

    const inspected = await service.getJob('tenant-1', job.id);
    assert.equal(inspected.status, JobStatus.FAILED);
    assert.equal(inspected.errorCode, 'MAX_RETRIES_EXCEEDED');
    assert.ok(inspected.errorMessage?.includes('maximum retry attempts'));
  });

  test('manually triggers/retries a failed job: resets counters, enqueues to worker, and sets fresh expiration', async () => {
    // 1. Submit and fail a job
    const { job } = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Failed job to retry' },
      expiresInSeconds: 10,
    });

    await service.transitionJob('tenant-1', job.id, JobStatus.FAILED, {
      errorCode: 'JOB_EXPIRED',
      errorMessage: 'Job expired in queue',
    });

    const initialQueueDepth = queueClient.getQueueLength();

    // 2. Trigger manually
    const retried = await service.retryJob('tenant-1', job.id, { expiresInSeconds: 7200 });

    assert.equal(retried.status, JobStatus.QUEUED);
    assert.equal(retried.retryCount, 0);
    assert.equal(retried.errorCode, null);
    assert.equal(retried.errorMessage, null);
    assert.equal(retried.completedAt, null);
    assert.ok(retried.expiresAt);
    assert.ok(retried.expiresAt.getTime() > Date.now() + 7000 * 1000);

    // Verify message re-enqueued to worker queue
    assert.equal(queueClient.getQueueLength(), initialQueueDepth + 1);
  });

  test('refuses to manually retry a job that is currently in PROCESSING state', async () => {
    const { job } = await service.submitJob('tenant-1', {
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      input: { prompt: 'Processing job' },
    });

    await service.transitionJob('tenant-1', job.id, JobStatus.PROCESSING);

    await assert.rejects(
      async () => {
        await service.retryJob('tenant-1', job.id);
      },
      (err: unknown) => err instanceof ConflictError && err.code === 'JOB_IN_PROGRESS'
    );
  });
});


