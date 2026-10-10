import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Health & Readiness Endpoints', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  test('GET /healthz returns 200 OK', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'ok');
    assert.ok(body.timestamp);
    await app.close();
  });

  test('GET /readyz returns 200 when all dependencies healthy', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/readyz',
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'ready');
    assert.equal(body.components.database, 'healthy');
    assert.equal(body.components.storage, 'healthy');
    assert.equal(body.components.queue, 'healthy');
    await app.close();
  });

  test('GET /readyz returns 503 when a dependency is down', async () => {
    const storageClient = new InMemoryStorageClient();
    storageClient.setHealthy(false);
    const queueClient = new InMemoryQueueClient();
    const jobRepo = new InMemoryJobRepository();

    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/readyz',
    });

    assert.equal(response.statusCode, 503);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'unhealthy');
    assert.equal(body.components.storage, 'unhealthy');
    assert.equal(body.components.database, 'healthy');
    await app.close();
  });
});

