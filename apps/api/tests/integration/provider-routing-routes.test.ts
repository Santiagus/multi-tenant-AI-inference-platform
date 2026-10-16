import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { MetricsRegistry } from '../../src/infrastructure/telemetry/metrics.js';
import { ProviderRouterController } from '../../src/domain/provider-routing.js';

describe('Provider Routing & Deterministic Policy Routes (M08)', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createRoutingTestApp() {
    const storageClient = new InMemoryStorageClient();
    const queueClient = new InMemoryQueueClient();
    const jobRepo = new InMemoryJobRepository();
    const metrics = new MetricsRegistry();
    const routerController = new ProviderRouterController();

    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
      metrics,
      routerController,
    });

    return { app, metrics, routerController };
  }

  test('GET /v1/routing/providers returns provider catalog, readiness, latency, and costs', async () => {
    const { app } = createRoutingTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/routing/providers',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.count, 4);
    assert.ok(body.providers.local_pytorch);
    assert.ok(body.providers.runpod);
    assert.ok(body.providers.bedrock);
    assert.ok(body.providers.sagemaker);
    assert.equal(body.providers.runpod.isExternalGpu, true);
    assert.equal(body.providers.sagemaker.supportsVpc, true);

    await app.close();
  });

  test('POST /v1/routing/evaluate validates schemas and returns explainable routing decision', async () => {
    const { app, metrics } = createRoutingTestApp();

    // 1. Invalid payload: missing model_id
    const badRes = await app.inject({
      method: 'POST',
      url: '/v1/routing/evaluate',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        workload: { model_id: '' },
      },
    });
    assert.equal(badRes.statusCode, 400);

    // 2. Local capacity optimal decision
    const localRes = await app.inject({
      method: 'POST',
      url: '/v1/routing/evaluate',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 64,
          max_new_tokens: 32,
          estimated_vram_mb: 4096,
        },
        capacity: {
          local_queue_depth: 2,
          local_queue_threshold: 10,
        },
      },
    });
    assert.equal(localRes.statusCode, 200);
    const localBody = JSON.parse(localRes.body);
    assert.equal(localBody.ok, true);
    assert.equal(localBody.decision.selectedProvider, 'local_pytorch');
    assert.equal(localBody.decision.decisionCode, 'LOCAL_CAPACITY_OPTIMAL');

    // 3. Spillover decision: queue backlog = 15 > threshold = 10
    const spillRes = await app.inject({
      method: 'POST',
      url: '/v1/routing/evaluate',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 128,
          max_new_tokens: 64,
          estimated_vram_mb: 4096,
        },
        capacity: {
          local_queue_depth: 15,
          local_queue_threshold: 10,
        },
        slo: {
          latency_slo_ms: 1500,
        },
        tenant_policy: {
          tenant_id: 'tenant-test',
          routing_preference: 'local_first',
          billed_rate_microcents_per_token: 40,
        },
        economics: {
          target_gross_margin: 0.4,
        },
      },
    });
    assert.equal(spillRes.statusCode, 200);
    const spillBody = JSON.parse(spillRes.body);
    assert.equal(spillBody.ok, true);
    assert.equal(spillBody.decision.selectedProvider, 'runpod');
    assert.equal(spillBody.decision.decisionCode, 'SLO_RISK_SPILLOVER_EXTERNAL_GPU');
    assert.match(spillBody.decision.explanation, /local queue high/);
    assert.match(spillBody.decision.explanation, /external GPU provider/);

    // Verify metrics recorded
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    assert.match(metricsRes.body, /provider_routing_decisions_total/);
    assert.match(metricsRes.body, /provider_routing_spillover_total/);
    assert.match(metricsRes.body, /provider_gross_margin_ratio/);

    await app.close();
  });

  test('POST /v1/routing/simulate runs queue depth sweep and reveals spillover threshold', async () => {
    const { app } = createRoutingTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/routing/simulate',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 128,
          max_new_tokens: 32,
        },
        queue_depth_range: [0, 5, 10, 15],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.simulated_steps, 4);
    assert.equal(body.sweep[0].queue_depth, 0);
    assert.equal(body.sweep[0].selected_provider, 'local_pytorch');
    assert.equal(body.sweep[3].queue_depth, 15);
    assert.equal(body.sweep[3].selected_provider, 'runpod');

    await app.close();
  });

  test('PATCH /v1/routing/providers/:name/health toggles provider health for failover testing', async () => {
    const { app } = createRoutingTestApp();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/v1/routing/providers/runpod/health',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: { healthy: false },
    });
    assert.equal(patchRes.statusCode, 200);
    const patchBody = JSON.parse(patchRes.body);
    assert.equal(patchBody.healthy, false);

    // Now evaluate with high queue depth: RunPod is unhealthy, so it cannot select RunPod
    const evalRes = await app.inject({
      method: 'POST',
      url: '/v1/routing/evaluate',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 128,
          max_new_tokens: 64,
        },
        capacity: {
          local_queue_depth: 15,
          local_queue_threshold: 10,
        },
      },
    });
    assert.equal(evalRes.statusCode, 200);
    const evalBody = JSON.parse(evalRes.body);
    assert.notEqual(evalBody.decision.selectedProvider, 'runpod');

    await app.close();
  });
});

