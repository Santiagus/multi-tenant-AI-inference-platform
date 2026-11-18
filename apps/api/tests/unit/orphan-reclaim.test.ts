import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import { JobService } from '../../src/application/job-service.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { JobStatus } from '../../src/domain/job.js';

describe('Orphan PROCESSING reclaim', () => {
  let jobRepo: InMemoryJobRepository;
  let queue: InMemoryQueueClient;
  let service: JobService;

  beforeEach(() => {
    jobRepo = new InMemoryJobRepository();
    queue = new InMemoryQueueClient();
    service = new JobService(jobRepo, queue, new InMemoryStorageClient(), undefined, undefined, 3600);
  });

  test('reclaims lease-expired PROCESSING by re-enqueueing when retries remain', async () => {
    const created = await jobRepo.create({
      tenantId: 'tenant-default',
      modelId: 'Lightricks/LTX-Video',
      maxRetries: 3,
      expiresInSeconds: 3600,
    });
    const past = new Date(Date.now() - 60_000);
    await jobRepo.update('tenant-default', created.id, {
      status: JobStatus.PROCESSING,
      startedAt: past,
      leaseOwner: 'dead-api:1',
      leaseExpiresAt: past,
      progressPct: 22,
      progress: { phase: 'loading_model', percent: 22, message: 'stuck' },
    });

    const result = await service.reapExpiredJobs();
    assert.equal(result.reapedCount, 0);
    assert.equal(result.reclaimedOrphans, 1);
    assert.equal(result.orphanJobs[0]?.status, JobStatus.QUEUED);
    assert.equal(result.orphanJobs[0]?.errorCode, 'ORPHANED_WORKER');
    assert.equal(result.orphanJobs[0]?.retryCount, 1);

    const depth = await queue.getQueueDepth?.();
    assert.ok((depth ?? 0) >= 1);
  });

  test('does not reclaim PROCESSING with a live lease', async () => {
    const created = await jobRepo.create({
      tenantId: 'tenant-default',
      modelId: 'openai/whisper-tiny',
      maxRetries: 3,
      expiresInSeconds: 3600,
    });
    await jobRepo.update('tenant-default', created.id, {
      status: JobStatus.PROCESSING,
      startedAt: new Date(),
      leaseOwner: 'live-api:1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.reclaimOrphanedProcessing();
    assert.equal(result.reclaimedCount, 0);
  });

  test('skips showcase seed PROCESSING ids', async () => {
    const showcaseId = '00000000-0000-4000-a000-000000000058';
    // Inject showcase-shaped row via create + rewrite id is not supported; use update path after create
    // by manually inserting through repository internals is awkward — create then overwrite map.
    const created = await jobRepo.create({
      tenantId: 'tenant-demo',
      modelId: 'deepseek-ai/deepseek-r1',
      maxRetries: 3,
    });
    const job = await jobRepo.findById('tenant-demo', created.id);
    assert.ok(job);
    // Replace with showcase id in the in-memory map
    (jobRepo as unknown as { jobs: Map<string, typeof job> }).jobs.delete(created.id);
    const seeded = {
      ...job!,
      id: showcaseId,
      status: JobStatus.PROCESSING,
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    (jobRepo as unknown as { jobs: Map<string, typeof seeded> }).jobs.set(showcaseId, seeded);

    const result = await service.reclaimOrphanedProcessing();
    assert.equal(result.reclaimedCount, 0);
  });

  test('fails orphan when retries are exhausted', async () => {
    const created = await jobRepo.create({
      tenantId: 'tenant-default',
      modelId: 'Wan-AI/Wan2.1-T2V-1.3B',
      maxRetries: 1,
      expiresInSeconds: 3600,
    });
    await jobRepo.update('tenant-default', created.id, {
      status: JobStatus.PROCESSING,
      retryCount: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
    });

    const result = await service.reclaimOrphanedProcessing();
    assert.equal(result.reclaimedCount, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.jobs[0]?.status, JobStatus.FAILED);
    assert.equal(result.jobs[0]?.errorCode, 'ORPHANED_WORKER');
  });
});

describe('Model-affinity queue receive', () => {
  test('prefers matching modelId ahead of earlier different-model messages', async () => {
    const queue = new InMemoryQueueClient();
    await queue.sendMessage({
      jobId: 'j1',
      tenantId: 't1',
      modelId: 'model-a',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });
    await queue.sendMessage({
      jobId: 'j2',
      tenantId: 't1',
      modelId: 'model-b',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });
    await queue.sendMessage({
      jobId: 'j3',
      tenantId: 't1',
      modelId: 'model-b',
      routingPreference: 'auto',
      priority: 5,
      createdAt: new Date().toISOString(),
    });

    const batch = await queue.receiveMessages(1, 0, { preferModelId: 'model-b' });
    assert.equal(batch.length, 1);
    assert.equal(batch[0]?.body.modelId, 'model-b');
    assert.equal(batch[0]?.body.jobId, 'j2');
  });
});
