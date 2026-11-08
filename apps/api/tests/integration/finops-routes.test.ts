import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { InMemoryFinOpsPricingRepository } from '../../src/infrastructure/db/finops-pricing-repository.js';

describe('FinOps Neocloud Pricing & Availability Intelligence Routes', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  const storageClient = new InMemoryStorageClient();
  const queueClient = new InMemoryQueueClient();
  const jobRepo = new InMemoryJobRepository();
  const finopsRepo = new InMemoryFinOpsPricingRepository();

  const app = buildApp({
    config,
    db: { isHealthy: async () => true },
    jobRepo,
    storageClient,
    queueClient,
    finopsRepo,
  });

  test('GET /v1/finops/gpu-pricing returns normalized on-demand, spot, and serverless GPU pricing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finops/gpu-pricing',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.count > 0);
    assert.equal(body.metadata.currency, 'USD');
    assert.equal(body.metadata.pay_as_you_go_only, true);

    // Verify H100 pricing on RunPod
    const h100OnDemand = body.data.find(
      (item: any) => item.provider === 'runpod' && item.hardwareSkuId === 'nvidia-h100-sxm' && item.pricingModel === 'on_demand'
    );
    assert.ok(h100OnDemand);
    assert.equal(h100OnDemand.normalizedHourlyUsd, 2.99);
    assert.equal(h100OnDemand.vramGb, 80);

    const h100Spot = body.data.find(
      (item: any) => item.provider === 'runpod' && item.hardwareSkuId === 'nvidia-h100-sxm' && item.pricingModel === 'spot_bid'
    );
    assert.ok(h100Spot);
    assert.equal(h100Spot.normalizedHourlyUsd, 1.99);

    // Verify Vast.ai spot vs on-demand
    const vastSpot = body.data.find(
      (item: any) => item.provider === 'vast_ai' && item.hardwareSkuId === 'nvidia-rtx-5090' && item.pricingModel === 'spot_bid'
    );
    assert.ok(vastSpot);
    assert.equal(vastSpot.normalizedHourlyUsd, 0.24);

    // Verify filtering
    const filteredRes = await app.inject({
      method: 'GET',
      url: '/v1/finops/gpu-pricing?provider=runpod&pricing_model=spot_bid',
      headers: { 'x-tenant-id': 'tenant-test' },
    });
    assert.equal(filteredRes.statusCode, 200);
    const filteredBody = JSON.parse(filteredRes.body);
    assert.ok(filteredBody.data.every((i: any) => i.provider === 'runpod' && i.pricingModel === 'spot_bid'));
  });

  test('GET /v1/finops/model-pricing returns open models and Token Factory rates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finops/model-pricing',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.count > 0);

    // Verify DeepSeek on JarvisLabs Token Factory
    const deepseek = body.data.find((m: any) => m.modelId === 'deepseek-v4.1-flash-1017');
    assert.ok(deepseek);
    assert.equal(deepseek.developer, 'DeepSeek');
    assert.equal(deepseek.inputPricePerMillionUsd, 0.07);
    assert.equal(deepseek.outputPricePerMillionUsd, 0.49);
    assert.equal(deepseek.contextLength, 1048576);

    // Verify fal.ai media pricing
    const falFlux = body.data.find((m: any) => m.modelId === 'fal-ai/flux/schnell');
    assert.ok(falFlux);
    assert.equal(falFlux.perUnitUsd, 0.003);
    assert.equal(falFlux.unitType, 'megapixel');
  });

  test('GET /v1/finops/pricing-history returns time series data and provider update frequency', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finops/pricing-history',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.data.length > 0);
    assert.ok(body.cadence_audits.length > 0);

    const vastHistory = body.data.find((h: any) => h.provider === 'vast_ai');
    assert.ok(vastHistory);
    assert.equal(vastHistory.estimatedUpdateFrequencyMinutes, 5);
    assert.ok(vastHistory.history.length > 0);

    const runpodAudit = body.cadence_audits.find((a: any) => a.provider === 'runpod');
    assert.ok(runpodAudit);
    assert.equal(runpodAudit.updateCadenceCategory, 'dynamic_shifts');
    assert.equal(typeof runpodAudit.availableCreditsUsd, 'number');
  });

  test('GET /v1/finops/balances returns verified real-time provider balances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finops/balances',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.balances);

    // Vast.ai
    assert.equal(body.balances.vast_ai.provider, 'vast_ai');
    assert.equal(body.balances.vast_ai.balanceUsd, 0.0);
    assert.equal(body.balances.vast_ai.status, 'LIVE_VERIFIED');

    // RunPod
    assert.equal(body.balances.runpod.provider, 'runpod');
    assert.equal(body.balances.runpod.balanceUsd, 15.0);
    assert.equal(body.balances.runpod.status, 'LIVE_VERIFIED');

    // Local PyTorch
    assert.equal(body.balances.local_pytorch.provider, 'local_pytorch');
    assert.equal(body.balances.local_pytorch.balanceUsd, 0.0);
    assert.equal(body.balances.local_pytorch.status, 'LOCAL_HARDWARE');

    // AWS Bedrock (Postpaid)
    assert.equal(body.balances.bedrock.provider, 'bedrock');
    assert.equal(body.balances.bedrock.balanceUsd, null);
    assert.equal(body.balances.bedrock.status, 'POSTPAID_INVOICE');
  });

  test('POST /v1/finops/sync initiates catalog synchronization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/finops/sync',
      headers: { 'x-tenant-id': 'tenant-test' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.syncedProviders.includes('runpod'));
    assert.ok(body.syncedProviders.includes('vast_ai'));
  });

  test('POST /v1/finops/recommend-options returns cheapest, fastest, balanced, and recommended options', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/finops/recommend-options',
      headers: { 'x-tenant-id': 'tenant-test' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        prompt_tokens: 128,
        max_new_tokens: 64,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.ok(body.recommendations);
    assert.ok(body.recommendations.cheapest);
    assert.ok(body.recommendations.fastest);
    assert.ok(body.recommendations.balanced);
    assert.ok(body.recommendations.recommended);

    // Verify fastest option has low execution ms
    assert.ok(body.recommendations.fastest.forecastedExecutionMs > 0);
    assert.ok(body.recommendations.fastest.tokensPerSec >= 100);

    // Verify allOptions array contains multiple candidate providers
    assert.ok(body.allOptions.length >= 4);
    const providers = body.allOptions.map((o: any) => o.provider);
    assert.ok(providers.includes('runpod'));
    assert.ok(providers.includes('vast_ai'));
  });
});
