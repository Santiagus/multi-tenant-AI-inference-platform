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

  test('POST /v1/worker/process-next executes job end-to-end and GET /v1/jobs/dlq inspects poison pills', async () => {
    const { app } = createTestApp();

    // 1. Submit valid job and process via worker endpoint
    const submitGood = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        'x-tenant-id': 'tenant-acme',
        'x-correlation-id': 'corr-test-123',
      },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Run via worker endpoint' },
      },
    });
    assert.equal(submitGood.headers['x-correlation-id'], 'corr-test-123');
    assert.ok(submitGood.headers['x-response-time-ms']);
    const goodJobId = JSON.parse(submitGood.body).job_id;

    const procGood = await app.inject({
      method: 'POST',
      url: '/v1/worker/process-next',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(procGood.statusCode, 200);
    const procBody = JSON.parse(procGood.body);
    assert.equal(procBody.processed, 1);
    assert.equal(procBody.outcomes[0].action, 'succeeded');

    const getGood = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${goodJobId}`,
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    const goodData = JSON.parse(getGood.body);
    assert.equal(goodData.status, 'SUCCEEDED');
    assert.ok(goodData.artifacts && goodData.artifacts.length === 1);
    assert.ok(goodData.result.metadata.profiled_wall_ms >= 0);
    assert.ok(goodData.result.metadata.tokens_per_sec > 0);

    // 2. Submit permanent failure job -> routes to DLQ
    const submitBad = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: {
          prompt: 'Trigger permanent failure',
          _simulate_failure: 'permanent',
        },
      },
    });
    const badJobId = JSON.parse(submitBad.body).job_id;

    const procBad = await app.inject({
      method: 'POST',
      url: '/v1/worker/process-next',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(JSON.parse(procBad.body).outcomes[0].action, 'failed_dlq');

    const dlqRes = await app.inject({
      method: 'GET',
      url: '/v1/jobs/dlq',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(dlqRes.statusCode, 200);
    const dlqBody = JSON.parse(dlqRes.body);
    assert.equal(dlqBody.messages.length, 1);
    assert.equal(dlqBody.messages[0].job_id, badJobId);
    assert.equal(dlqBody.messages[0].error_code, 'INVALID_MODEL_PARAMETERS');

    await app.close();
  });

  test('POST /v1/jobs accepts instant mock, real CPU, real GPU, and cloud routing preferences', async () => {
    const { app, jobRepo } = createTestApp();

    // 1. Instant Mock: POST /v1/jobs -d '{"model_id": "mock", "routing_preference": "auto"}'
    const mockRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        model_id: 'mock',
        routing_preference: 'auto',
      },
    });
    assert.equal(mockRes.statusCode, 202);
    const mockJobId = JSON.parse(mockRes.body).job_id;
    const mockJob = await jobRepo.findById('tenant-test', mockJobId);
    assert.equal(mockJob?.modelId, 'mock');
    assert.equal(mockJob?.routingPreference, 'auto');

    // 2. Real CPU Inference: POST /v1/jobs -d '{"model_id": "TinyLlama/TinyLlama-1.1B-Chat-v1.0", "routing_preference": "local/cpu"}'
    const cpuRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        routing_preference: 'local/cpu',
      },
    });
    assert.equal(cpuRes.statusCode, 202);
    const cpuJobId = JSON.parse(cpuRes.body).job_id;
    const cpuJob = await jobRepo.findById('tenant-test', cpuJobId);
    assert.equal(cpuJob?.modelId, 'TinyLlama/TinyLlama-1.1B-Chat-v1.0');
    assert.equal(cpuJob?.routingPreference, 'local/cpu');

    // 3. Real GPU Inference: POST /v1/jobs -d '{"model_id": "meta-llama/Llama-3-8B-Instruct", "routing_preference": "local/gpu", "parameters": {"engine": "torch-compile"}}'
    const gpuRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'local/gpu',
        parameters: { engine: 'torch-compile' },
      },
    });
    assert.equal(gpuRes.statusCode, 202);
    const gpuJobId = JSON.parse(gpuRes.body).job_id;
    const gpuJob = await jobRepo.findById('tenant-test', gpuJobId);
    assert.equal(gpuJob?.modelId, 'meta-llama/Llama-3-8B-Instruct');
    assert.equal(gpuJob?.routingPreference, 'local/gpu');
    assert.equal((gpuJob?.inputPayload?.parameters as any)?.engine, 'torch-compile');

    // 4. Cloud Inference: POST /v1/jobs -d '{"model_id": "meta-llama/Llama-3-8B-Instruct", "routing_preference": "cloud"}'
    const cloudRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'cloud',
      },
    });
    assert.equal(cloudRes.statusCode, 202);
    const cloudJobId = JSON.parse(cloudRes.body).job_id;
    const cloudJob = await jobRepo.findById('tenant-test', cloudJobId);
    assert.equal(cloudJob?.routingPreference, 'cloud');

    await app.close();
  });

  test('POST /v1/jobs/upload-url generates presigned S3 upload URL with tenant isolation', async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs/upload-url',
      headers: {
        'x-tenant-id': 'tenant-acme',
      },
      payload: {
        filename: 'telemetry_photo.png',
        content_type: 'image/png',
        expires_in_seconds: 1800,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.upload_url);
    assert.ok(body.asset_uri);
    assert.equal(body.expires_in_seconds, 1800);
    assert.ok(decodeURIComponent(body.upload_url).includes('tenants/tenant-acme/inputs/'));
    assert.ok(decodeURIComponent(body.upload_url).includes('telemetry_photo.png'));
    assert.ok(body.asset_uri.startsWith('s3://'));
    assert.ok(body.asset_uri.includes('tenants/tenant-acme/inputs/'));

    await app.close();
  });

  test('POST /v1/jobs/upload-url rejects unsupported content types and missing filenames', async () => {
    const { app } = createTestApp();

    // 1. Missing filename
    const missingNameRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs/upload-url',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        content_type: 'image/jpeg',
      },
    });
    assert.equal(missingNameRes.statusCode, 400);

    // 2. Unsupported mime type
    const badTypeRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs/upload-url',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        filename: 'exploit.exe',
        content_type: 'application/x-msdownload',
      },
    });
    assert.equal(badTypeRes.statusCode, 400);
    const body = JSON.parse(badTypeRes.body);
    assert.equal(body.code, 'VALIDATION_FAILED');

    await app.close();
  });

  test('POST /v1/jobs accepts jobs with media_asset_uri and multimodal inputs', async () => {
    const { app, queueClient } = createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-acme' },
      payload: {
        model_id: 'Qwen/Qwen2.5-VL-7B-Instruct',
        routing_preference: 'local/gpu',
        input: {
          prompt: 'Identify the vehicle in this frame',
          media_asset_uri: 's3://platform-artifacts/tenants/tenant-acme/inputs/sample_car.jpg',
        },
      },
    });

    assert.equal(response.statusCode, 202);
    const body = JSON.parse(response.body);
    assert.ok(body.job_id);
    assert.equal(body.model_id, 'Qwen/Qwen2.5-VL-7B-Instruct');
    assert.equal(queueClient.getQueueLength(), 1);

    await app.close();
  });
});


