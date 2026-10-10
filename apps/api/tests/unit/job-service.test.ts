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

  test('throws NotFoundError for non-existent job or wrong tenant', async () => {
    await assert.rejects(
      async () => {
        await service.getJob('tenant-1', '00000000-0000-0000-0000-000000000000');
      },
      (err) => err instanceof NotFoundError
    );
  });
});

