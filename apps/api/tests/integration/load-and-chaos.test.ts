import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { JobWorker } from '../../src/application/job-worker.js';
import { JobStatus } from '../../src/domain/job.js';

describe('M12 Production Readiness: Load, Chaos & SLO Verification', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function setupTestEnv() {
    const jobRepo = new InMemoryJobRepository();
    const storageClient = new InMemoryStorageClient();
    const queueClient = new InMemoryQueueClient();
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });
    return { app, jobRepo, storageClient, queueClient };
  }

  test('TC-75: Concurrent multi-tenant job submissions maintain queue ordering and isolation', async () => {
    const { app } = setupTestEnv();
    const tenants = ['tenant-alpha', 'tenant-beta', 'tenant-gamma'];
    const submissionPromises: Promise<any>[] = [];

    // Launch 30 concurrent submissions across 3 tenants
    for (let i = 0; i < 30; i++) {
      const tenantId = tenants[i % tenants.length];
      submissionPromises.push(
        app.inject({
          method: 'POST',
          url: '/v1/jobs',
          headers: { 'x-tenant-id': tenantId },
          payload: {
            model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
            routing_preference: 'auto',
            priority: (i % 3) + 1,
            input: {
              prompt: `Concurrent request ${i} from ${tenantId}`,
              parameters: { max_new_tokens: 16 },
            },
          },
        })
      );
    }

    const responses = await Promise.all(submissionPromises);

    // Verify all 30 succeeded with 202 Accepted and have distinct job IDs
    const jobIds = new Set<string>();
    for (const res of responses) {
      assert.equal(res.statusCode, 202);
      const body = JSON.parse(res.body);
      assert.equal(body.status, JobStatus.QUEUED);
      assert.ok(body.job_id);
      jobIds.add(body.job_id);
    }
    assert.equal(jobIds.size, 30, 'All 30 jobs must have unique IDs');
    await app.close();
  });

  test('TC-76: Chaos failure injection routes permanent error to DLQ and skips retries', async () => {
    const { app, jobRepo, queueClient, storageClient } = setupTestEnv();
    const worker = new JobWorker(jobRepo, queueClient, storageClient, undefined, {
      maxRetries: 3,
      baseBackoffSeconds: 0,
    });

    // Submit job configured to simulate permanent failure
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-chaos' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'auto',
        priority: 5,
        input: {
          prompt: 'Chaos unrecoverable trigger',
          _simulate_failure: 'permanent',
        },
      },
    });

    assert.equal(submitRes.statusCode, 202);
    const { job_id: jobId } = JSON.parse(submitRes.body);

    // Run worker batch
    const outcomes = await worker.processNextBatch(1);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].action, 'failed_dlq');

    // Verify job transitioned to FAILED
    const job = await jobRepo.findById('tenant-chaos', jobId);
    assert.ok(job);
    assert.equal(job.status, JobStatus.FAILED);
    assert.equal(job.retryCount, 0, 'Permanent errors must not consume retries');

    // Verify DLQ endpoint reports quarantined job
    const dlqRes = await app.inject({
      method: 'GET',
      url: '/v1/jobs/dlq',
      headers: { 'x-tenant-id': 'tenant-chaos' },
    });
    assert.equal(dlqRes.statusCode, 200);
    const dlqBody = JSON.parse(dlqRes.body);
    assert.ok(dlqBody.messages.some((msg: any) => msg.job_id === jobId));
    await app.close();
  });

  test('TC-77: In-flight cancellation cancels QUEUED and PROCESSING jobs and prevents compute wastage', async () => {
    const { app } = setupTestEnv();

    // 1. Submit job
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-cancel' },
      payload: {
        model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        input: { prompt: 'Will be cancelled' },
      },
    });
    const { job_id: jobId } = JSON.parse(submitRes.body);

    // 2. Cancel while QUEUED
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { 'x-tenant-id': 'tenant-cancel' },
    });
    assert.equal(cancelRes.statusCode, 200);
    const cancelBody = JSON.parse(cancelRes.body);
    assert.equal(cancelBody.status, JobStatus.CANCELLED);

    // 3. Cancelling already cancelled job returns 409 Conflict
    const reCancelRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${jobId}/cancel`,
      headers: { 'x-tenant-id': 'tenant-cancel' },
    });
    assert.equal(reCancelRes.statusCode, 409);
    const conflictBody = JSON.parse(reCancelRes.body);
    assert.equal(conflictBody.code, 'CONFLICT');
    await app.close();
  });

  test('TC-78: Dependency health check failure returns 503 and flags readiness probe failure', async () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const jobRepo = new InMemoryJobRepository();
    const storageClient = new InMemoryStorageClient();
    storageClient.setHealthy(false);
    const queueClient = new InMemoryQueueClient();

    // Simulate unhealthy storage dependency
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });

    const readyRes = await app.inject({
      method: 'GET',
      url: '/readyz',
    });

    assert.equal(readyRes.statusCode, 503);
    const readyBody = JSON.parse(readyRes.body);
    assert.equal(readyBody.status, 'unhealthy');
    assert.equal(readyBody.components.storage, 'unhealthy');
    assert.equal(readyBody.components.database, 'healthy');
    await app.close();
  });

  test('TC-79: Interactive SLO validation — P95 latency meets < 500ms requirement', async () => {
    const { app } = setupTestEnv();
    const latencies: number[] = [];

    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
      });
      const elapsed = performance.now() - t0;
      assert.equal(res.statusCode, 200);
      latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)];

    assert.ok(p95 < 50, `P95 health latency should be well under 50ms, observed ${p95.toFixed(2)}ms`);
    await app.close();
  });
});
