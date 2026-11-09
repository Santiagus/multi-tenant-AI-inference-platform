import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemorySecurityRepository } from '../../src/infrastructure/db/security-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Showcase Mode & Data Source Isolation', () => {
  it('reports dataSource: "mock" when SHOWCASE_MODE is true', async () => {
    const config = loadConfig({ SHOWCASE_MODE: true });
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo: new InMemoryJobRepository(),
      securityRepo: new InMemorySecurityRepository(),
      storageClient: new InMemoryStorageClient(),
      queueClient: new InMemoryQueueClient(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.dataSource, 'mock');
    await app.close();
  });

  it('reports dataSource: "real" in normal mode', async () => {
    const config = loadConfig({ SHOWCASE_MODE: false });
    const originalEnv = process.env.MOCK_PROVIDERS;
    try {
      delete process.env.MOCK_PROVIDERS;
      const app = buildApp({
        config,
        db: { isHealthy: async () => true },
        jobRepo: new InMemoryJobRepository(),
        securityRepo: new InMemorySecurityRepository(),
        storageClient: new InMemoryStorageClient(),
        queueClient: new InMemoryQueueClient(),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.dataSource, 'real');
      await app.close();
    } finally {
      if (originalEnv !== undefined) {
        process.env.MOCK_PROVIDERS = originalEnv;
      }
    }
  });

  it('toggles dataSource dynamically via /v1/admin/showcase/seed and /purge', async () => {
    const config = loadConfig({ SHOWCASE_MODE: false });
    const originalEnv = process.env.MOCK_PROVIDERS;
    try {
      delete process.env.MOCK_PROVIDERS;
      const app = buildApp({
        config,
        db: { isHealthy: async () => true },
        jobRepo: new InMemoryJobRepository(),
        securityRepo: new InMemorySecurityRepository(),
        storageClient: new InMemoryStorageClient(),
        queueClient: new InMemoryQueueClient(),
      });

      // 1. Initial status: real
      const initialHealth = await app.inject({ method: 'GET', url: '/healthz' });
      assert.equal(JSON.parse(initialHealth.body).dataSource, 'real');

      // 2. Status endpoint
      const statusRes = await app.inject({ method: 'GET', url: '/v1/admin/showcase/status' });
      assert.equal(statusRes.statusCode, 200);
      assert.equal(JSON.parse(statusRes.body).dataSource, 'real');

      // 3. Seed showcase data
      const seedRes = await app.inject({ method: 'POST', url: '/v1/admin/showcase/seed' });
      assert.equal(seedRes.statusCode, 200);
      const seedBody = JSON.parse(seedRes.body);
      assert.equal(seedBody.ok, true);
      assert.equal(seedBody.dataSource, 'mock');

      // Verify healthz updated dynamically
      const seededHealth = await app.inject({ method: 'GET', url: '/healthz' });
      assert.equal(JSON.parse(seededHealth.body).dataSource, 'mock');

      // 4. Purge showcase data
      const purgeRes = await app.inject({ method: 'POST', url: '/v1/admin/showcase/purge' });
      assert.equal(purgeRes.statusCode, 200);
      const purgeBody = JSON.parse(purgeRes.body);
      assert.equal(purgeBody.ok, true);
      assert.equal(purgeBody.dataSource, 'real');

      // Verify healthz reverted to real
      const revertedHealth = await app.inject({ method: 'GET', url: '/healthz' });
      assert.equal(JSON.parse(revertedHealth.body).dataSource, 'real');

      await app.close();
    } finally {
      if (originalEnv !== undefined) {
        process.env.MOCK_PROVIDERS = originalEnv;
      }
    }
  });
});
