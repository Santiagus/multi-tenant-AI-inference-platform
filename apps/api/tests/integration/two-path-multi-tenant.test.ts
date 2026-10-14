import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Two-Path Architecture & Multi-Tenant Capacity Integration', () => {
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
    return { app };
  }

  test('executes Path A (SQS+KEDA) and Path B (Flyte+Kueue) concurrently across multiple tenants with strict isolation', async () => {
    const { app } = createTestApp();
    const tenants = ['tenant-alpha', 'tenant-beta', 'tenant-gamma'];

    // 1. Path A (Low-Latency Single-Hop): Concurrent execution across tenants
    for (const tenantId of tenants) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cloud/aws/workflows/execute',
        headers: { 'x-tenant-id': tenantId },
        payload: {
          path: 'path_a_sqs_keda',
          modality: 'text_to_image',
          job_id: `job-${tenantId}-keyframe`,
          tenant_id: tenantId,
          prompt: `High-speed sports keyframe for ${tenantId}`,
          asset_uri: 'tests/fixtures/media/fernando_alonso_f1.jpg',
          use_torchscript: true,
          max_new_tokens: 16,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.path, 'path_a_sqs_keda');
      assert.equal(body.tenantId, tenantId);
      assert.ok(body.artifacts.s3ArtifactKey.startsWith(`tenants/${tenantId}/`));
      assert.ok(body.artifacts.cloudfrontMediaUrl.includes(`/${tenantId}/`));
      assert.equal(body.kueueKyvernoAdmission.enforced, false);
      assert.equal(body.kinesisMeteringEvent.partitionKey, tenantId);
    }

    // 2. Path B (Flyte Multi-Stage DAG): Video modification on Bunny clip across tenants
    for (const tenantId of tenants) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/cloud/aws/workflows/execute',
        headers: { 'x-tenant-id': tenantId },
        payload: {
          path: 'path_b_flyte_dag',
          modality: 'video_to_video',
          job_id: `job-${tenantId}-video-mod`,
          tenant_id: tenantId,
          prompt: `Stylize video for ${tenantId}`,
          asset_uri: 'tests/fixtures/media/sample_bunny_clip.mp4',
          fps: 24,
          duration_seconds: 4,
          edit_operation: 'style_transfer',
          edit_strength: 0.8,
          use_torchscript: true,
          max_new_tokens: 32,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.path, 'path_b_flyte_dag');
      assert.equal(body.modality, 'video_to_video');
      assert.equal(body.tenantId, tenantId);
      assert.ok(body.artifacts.s3MediaKey.endsWith('/output.mp4'));
      assert.ok(body.artifacts.flytePreprocessingCacheKey.startsWith(`tenants/${tenantId}/`));
      assert.equal(body.kueueKyvernoAdmission.enforced, true);
      assert.equal(body.kueueKyvernoAdmission.localQueueName, 'tenant-default-gpu-queue');
      assert.equal(body.kinesisMeteringEvent.partitionKey, tenantId);
      assert.equal(body.usageAndBilling.framesGenerated, 96);
    }

    // 3. Verify Prometheus metrics attribute token counters to each tenant independently
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    for (const tenantId of tenants) {
      assert.ok(
        metricsRes.body.includes(`tenant_id="${tenantId}"`),
        `Metrics must attribute usage to ${tenantId}`
      );
    }

    await app.close();
  });
});

