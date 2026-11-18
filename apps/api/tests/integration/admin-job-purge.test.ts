import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemorySecurityRepository } from '../../src/infrastructure/db/security-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { JobStatus, RoutingPreference } from '../../src/domain/job.js';

async function seedJob(
  repo: InMemoryJobRepository,
  opts: { tenantId: string; provider?: string; modelId?: string; withOutput?: boolean }
) {
  const job = await repo.create({
    tenantId: opts.tenantId,
    modelId: opts.modelId ?? 'meta-llama/Llama-3-8B',
    routingPreference: RoutingPreference.AUTO,
  });
  await repo.update(opts.tenantId, job.id, {
    status: JobStatus.SUCCEEDED,
    provider: opts.provider ?? 'runpod',
    outputUri: opts.withOutput
      ? `s3://mock-bucket/tenants/${opts.tenantId}/outputs/${job.id}/result.json`
      : undefined,
    completedAt: new Date(),
  });
  return job;
}

describe('Admin filtered purge & orphan artifacts', () => {
  it('purges tenant jobs and cascades S3 output prefixes', async () => {
    const jobRepo = new InMemoryJobRepository();
    const storage = new InMemoryStorageClient();
    const job = await seedJob(jobRepo, { tenantId: 'tenant-dev', withOutput: true });
    await storage.putObject(`tenants/tenant-dev/outputs/${job.id}/result.json`, '{}');
    await storage.putObject('tenants/tenant-dev/outputs/orphan-folder/result.json', '{}');

    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: { isHealthy: async () => true },
      jobRepo,
      securityRepo: new InMemorySecurityRepository(),
      storageClient: storage,
      queueClient: new InMemoryQueueClient(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants/tenant-dev/purge',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.deletedCount, 1);
    assert.ok(body.deletedObjects >= 1);
    assert.equal((await jobRepo.listJobIds('tenant-dev')).length, 0);
    assert.equal((await storage.listKeysByPrefix('tenants/tenant-dev/outputs/')).length, 0);
    await app.close();
  });

  it('deletes jobs matching provider filter and cascades artifacts', async () => {
    const jobRepo = new InMemoryJobRepository();
    const storage = new InMemoryStorageClient();
    const runpod = await seedJob(jobRepo, {
      tenantId: 'tenant-default',
      provider: 'runpod',
      withOutput: true,
    });
    const local = await seedJob(jobRepo, {
      tenantId: 'tenant-default',
      provider: 'local',
      withOutput: true,
    });
    await storage.putObject(`tenants/tenant-default/outputs/${runpod.id}/result.json`, '{}');
    await storage.putObject(`tenants/tenant-default/outputs/${local.id}/result.json`, '{}');

    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: { isHealthy: async () => true },
      jobRepo,
      securityRepo: new InMemorySecurityRepository(),
      storageClient: storage,
      queueClient: new InMemoryQueueClient(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/delete-matching',
      headers: { 'content-type': 'application/json' },
      payload: {
        tenant_id: 'tenant-default',
        provider: 'runpod',
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.deleted_jobs, 1);
    assert.ok(body.deleted_objects >= 1);
    assert.equal((await jobRepo.listJobIds('tenant-default')).length, 1);
    assert.equal(await storage.getObject(`tenants/tenant-default/outputs/${runpod.id}/result.json`), null);
    assert.ok(await storage.getObject(`tenants/tenant-default/outputs/${local.id}/result.json`));
    await app.close();
  });

  it('lists and purges orphan artifact prefixes', async () => {
    const jobRepo = new InMemoryJobRepository();
    const storage = new InMemoryStorageClient();
    const alive = await seedJob(jobRepo, { tenantId: 'tenant-acme', withOutput: true });
    await storage.putObject(`tenants/tenant-acme/outputs/${alive.id}/result.json`, '{}');
    await storage.putObject('tenants/tenant-acme/outputs/dead-job/result.json', '{}');

    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: { isHealthy: async () => true },
      jobRepo,
      securityRepo: new InMemorySecurityRepository(),
      storageClient: storage,
      queueClient: new InMemoryQueueClient(),
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/tenants/tenant-acme/artifacts/orphans',
    });
    assert.equal(listRes.statusCode, 200);
    const listed = JSON.parse(listRes.body);
    assert.equal(listed.count, 1);
    assert.deepEqual(listed.orphans, ['tenants/tenant-acme/outputs/dead-job/']);

    const purgeRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/tenants/tenant-acme/artifacts/orphans/purge',
    });
    assert.equal(purgeRes.statusCode, 200);
    const purged = JSON.parse(purgeRes.body);
    assert.equal(purged.purged_prefixes, 1);
    assert.equal(await storage.getObject('tenants/tenant-acme/outputs/dead-job/result.json'), null);
    assert.ok(await storage.getObject(`tenants/tenant-acme/outputs/${alive.id}/result.json`));
    await app.close();
  });

  it('includes has_artifacts on job list when outputUri is set', async () => {
    const jobRepo = new InMemoryJobRepository();
    const job = await seedJob(jobRepo, {
      tenantId: 'tenant-default',
      modelId: 'black-forest-labs/FLUX.1-schnell',
      withOutput: true,
    });

    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: { isHealthy: async () => true },
      jobRepo,
      securityRepo: new InMemorySecurityRepository(),
      storageClient: new InMemoryStorageClient(),
      queueClient: new InMemoryQueueClient(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-default' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const listed = body.jobs.find((j: { job_id: string }) => j.job_id === job.id);
    assert.ok(listed);
    assert.equal(listed.has_artifacts, true);
    assert.equal(listed.artifact_kind, 'image');
    await app.close();
  });

  it('rejects unscoped delete-matching without confirm_cross_tenant', async () => {
    const app = buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      db: { isHealthy: async () => true },
      jobRepo: new InMemoryJobRepository(),
      securityRepo: new InMemorySecurityRepository(),
      storageClient: new InMemoryStorageClient(),
      queueClient: new InMemoryQueueClient(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/delete-matching',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});
