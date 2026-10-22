import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { JobStatus, RoutingPreference } from '../../src/domain/job.js';

describe('Analytics, Economics & Job Listing Routes (M11)', () => {
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

  test('GET /v1/jobs lists paginated jobs and supports status filtering', async () => {
    const { app, jobRepo } = createTestApp();

    // Seed jobs
    const j1 = await jobRepo.create({
      tenantId: 'tenant-acme',
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      routingPreference: RoutingPreference.LOCAL,
      priority: 5,
    });
    await jobRepo.update('tenant-acme', j1.id, {
      status: JobStatus.SUCCEEDED,
      provider: 'local_pytorch',
      tokensIn: 50,
      tokensOut: 100,
      costMicrocents: 300,
      durationMs: 250,
    });

    const j2 = await jobRepo.create({
      tenantId: 'tenant-acme',
      modelId: 'runwayml/stable-diffusion-v1-5',
      routingPreference: RoutingPreference.CLOUD,
      priority: 8,
    });
    await jobRepo.update('tenant-acme', j2.id, {
      status: JobStatus.FAILED,
      provider: 'runpod',
      errorCode: 'INFERENCE_FAILED',
      errorMessage: 'Out of memory on GPU worker',
    });

    const j3 = await jobRepo.create({
      tenantId: 'tenant-acme',
      modelId: 'anthropic/claude-3-haiku',
      routingPreference: RoutingPreference.AUTO,
      priority: 5,
    });

    // 1. List all jobs for tenant
    const resAll = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(resAll.statusCode, 200);
    const bodyAll = JSON.parse(resAll.body);
    assert.equal(bodyAll.total, 3);
    assert.equal(bodyAll.jobs.length, 3);
    assert.equal(bodyAll.jobs[0].tenant_id, 'tenant-acme');

    // 2. Filter by status=SUCCEEDED
    const resFiltered = await app.inject({
      method: 'GET',
      url: '/v1/jobs?status=SUCCEEDED',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(resFiltered.statusCode, 200);
    const bodyFiltered = JSON.parse(resFiltered.body);
    assert.equal(bodyFiltered.total, 1);
    assert.equal(bodyFiltered.jobs[0].job_id, j1.id);
    assert.equal(bodyFiltered.jobs[0].status, 'SUCCEEDED');
    assert.equal(bodyFiltered.jobs[0].usage.total_tokens, 150);

    // 3. Pagination limit & offset
    const resPaging = await app.inject({
      method: 'GET',
      url: '/v1/jobs?limit=1&offset=1',
      headers: { 'x-tenant-id': 'tenant-acme' },
    });
    assert.equal(resPaging.statusCode, 200);
    const bodyPaging = JSON.parse(resPaging.body);
    assert.equal(bodyPaging.limit, 1);
    assert.equal(bodyPaging.offset, 1);
    assert.equal(bodyPaging.jobs.length, 1);

    await app.close();
  });

  test('GET /v1/analytics/economics computes usage, costs, revenue, gross profit, and margins', async () => {
    const { app, jobRepo } = createTestApp();

    // Seed successful job with tokens
    const job = await jobRepo.create({
      tenantId: 'tenant-finops',
      modelId: 'meta-llama/Llama-3-8B-Instruct',
      routingPreference: RoutingPreference.LOCAL,
      priority: 5,
    });
    await jobRepo.update('tenant-finops', job.id, {
      status: JobStatus.SUCCEEDED,
      provider: 'local_pytorch',
      tokensIn: 1000,
      tokensOut: 500,
      costMicrocents: 3000, // $0.000030
      durationMs: 400,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/analytics/economics',
      headers: { 'x-tenant-id': 'tenant-finops' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.tenant_id, 'tenant-finops');
    assert.equal(body.summary.total_jobs, 1);
    assert.equal(body.summary.succeeded_jobs, 1);
    assert.equal(body.summary.total_tokens, 1500);
    assert.equal(body.summary.prompt_tokens, 1000);
    assert.equal(body.summary.completion_tokens, 500);
    assert.equal(body.summary.infrastructure_cost_microcents, 3000);

    // 1500 tokens * 40 microcents = 60,000 microcents projected revenue
    assert.equal(body.summary.projected_revenue_microcents, 60000);
    // 60,000 - 3,000 = 57,000 gross profit
    assert.equal(body.summary.gross_profit_microcents, 57000);
    // (57,000 / 60,000) * 100 = 95% margin
    assert.equal(body.summary.gross_margin_percentage, 95);

    // Check provider catalog integration
    assert.ok(Array.isArray(body.providers));
    const localPytorch = body.providers.find((p: any) => p.provider === 'local_pytorch');
    assert.ok(localPytorch);
    assert.equal(localPytorch.job_count, 1);
    assert.equal(localPytorch.total_tokens, 1500);

    // Check model stats integration
    assert.ok(Array.isArray(body.models));
    const llamaModel = body.models.find((m: any) => m.model_id === 'meta-llama/Llama-3-8B-Instruct');
    assert.ok(llamaModel);
    assert.equal(llamaModel.job_count, 1);
    assert.equal(llamaModel.avg_duration_ms, 400);

    // Check recent series
    assert.equal(body.recent_job_series.length, 1);
    assert.equal(body.recent_job_series[0].job_id, job.id);

    await app.close();
  });
});

