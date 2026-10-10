import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Job Routes & Lifecycle Integration', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createTestApp() {
    const storageClient = new InMemoryStorageClient();
    const queueClient = new InMemoryQueueClient();
    const jobRepo = new InMemoryJobRepository();
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });
    return { app, storageClient, queueClient, jobRepo };
  }

  test('POST /v1/jobs rejects payload without model_id or input with RFC 7807 Problem Details', async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      payload: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.headers['content-type'], 'application/problem+json; charset=utf-8');
    const body = JSON.parse(response.body);
    assert.equal(body.code, 'VALIDATION_FAILED');
    assert.equal(body.status, 400);
    assert.ok(body.type);
    assert.ok(body.title);
    assert.ok(body.timestamp);
    await app.close();
  });

  test('POST /v1/jobs creates job, returns 202 Accepted, and enqueues task', async () => {
    const { app, queueClient } = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        'x-tenant-id': 'tenant-acme',
      },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'auto',
        priority: 5,
        input: {
          prompt: 'What is distributed systems consensus?',
        },
      },
    });

    assert.equal(response.statusCode, 202);
    const body = JSON.parse(response.body);
    assert.ok(body.job_id);
    assert.equal(body.status, 'QUEUED');
    assert.equal(body.model_id, 'meta-llama/Llama-3-8B-Instruct');
    assert.equal(body.poll_url, `/v1/jobs/${body.job_id}`);
    assert.equal(response.headers['location'], `/v1/jobs/${body.job_id}`);

    // Verify queue received message
    assert.equal(queueClient.getQueueLength(), 1);
    await app.close();
  });

  test('POST /v1/jobs handles Idempotency-Key header idempotently', async () => {
    const { app, queueClient } = createTestApp();
    const idempotencyKey = 'req-unique-uuid-999';

    // First submission
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        'idempotency-key': idempotencyKey,
        'x-tenant-id': 'tenant-acme',
      },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Hello once' },
      },
    });
    assert.equal(res1.statusCode, 202);
    const body1 = JSON.parse(res1.body);
    assert.equal(queueClient.getQueueLength(), 1);

    // Second submission with identical Idempotency-Key
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        'idempotency-key': idempotencyKey,
        'x-tenant-id': 'tenant-acme',
      },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Hello once' },
      },
    });
    assert.equal(res2.statusCode, 200);
    const body2 = JSON.parse(res2.body);
    assert.equal(body2.job_id, body1.job_id);
    // Queue should not have another message
    assert.equal(queueClient.getQueueLength(), 1);

    await app.close();
  });

  test('Full lifecycle: submit -> inspect -> transition processing -> succeed -> get results', async () => {
    const { app, storageClient } = createTestApp();

    // 1. Submit
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Explain Raft consensus.' },
      },
    });
    assert.equal(submitRes.statusCode, 202);
    const { job_id } = JSON.parse(submitRes.body);

    // 2. Query initial status
    const queryRes1 = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${job_id}`,
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(queryRes1.statusCode, 200);
    const initialJob = JSON.parse(queryRes1.body);
    assert.equal(initialJob.status, 'QUEUED');

    // 3. Worker transitions to PROCESSING
    const procRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job_id}/transition`,
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        status: 'PROCESSING',
        provider: 'local_pytorch',
      },
    });
    assert.equal(procRes.statusCode, 200);

    // 4. Put an artifact in storage
    const artifactKey = `tenants/tenant-acme/outputs/${job_id}/result.json`;
    await storageClient.putObject(artifactKey, '{"tokens": 120}');

    // 5. Worker completes job to SUCCEEDED
    const succRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job_id}/transition`,
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        status: 'SUCCEEDED',
        provider: 'local_pytorch',
        output: {
          output_text: 'Raft is a leader-based consensus algorithm.',
          finish_reason: 'stop',
        },
        output_uri: `s3://mock-bucket/${artifactKey}`,
        duration_ms: 1240,
        tokens_in: 12,
        tokens_out: 48,
        cost_microcents: 240,
      },
    });
    assert.equal(succRes.statusCode, 200);

    // 6. Inspect completed job
    const finalRes = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${job_id}`,
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(finalRes.statusCode, 200);
    const finalJob = JSON.parse(finalRes.body);
    assert.equal(finalJob.status, 'SUCCEEDED');
    assert.equal(finalJob.provider, 'local_pytorch');
    assert.equal(finalJob.duration_ms, 1240);
    assert.equal(finalJob.usage.prompt_tokens, 12);
    assert.equal(finalJob.usage.completion_tokens, 48);
    assert.equal(finalJob.usage.total_tokens, 60);
    assert.equal(finalJob.result.output_text, 'Raft is a leader-based consensus algorithm.');
    assert.ok(finalJob.artifacts && finalJob.artifacts.length > 0);
    assert.ok(finalJob.artifacts[0].download_url);

    await app.close();
  });

  test('POST /v1/jobs/:id/cancel cancels queued job', async () => {
    const { app } = createTestApp();

    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Doomed job' },
      },
    });
    const { job_id } = JSON.parse(submitRes.body);

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job_id}/cancel`,
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(cancelRes.statusCode, 200);
    const cancelBody = JSON.parse(cancelRes.body);
    assert.equal(cancelBody.status, 'CANCELLED');

    // Confirm cancel on query
    const queryRes = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${job_id}`,
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(JSON.parse(queryRes.body).status, 'CANCELLED');

    await app.close();
  });
});

