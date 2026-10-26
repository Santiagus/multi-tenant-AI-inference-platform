import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('GitOps, CI/CD & Argo CD Reconciliation Routes (M10)', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createGitOpsTestApp() {
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

  test('GET /v1/gitops/status returns controller status, OIDC config, and non-bypass policy', async () => {
    const { app } = createGitOpsTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/gitops/status',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'healthy');
    assert.equal(body.gitops_reconciler, 'Argo CD v2.10');
    assert.match(body.github_oidc_role_arn, /github-oidc-deployer/);
    assert.equal(body.app_of_apps, 'inference-platform-root-apps');
    assert.equal(body.bypass_policy.direct_apply_prohibited, true);
    assert.ok(body.environments.staging);
    assert.ok(body.environments.production);
  });

  test('GET /v1/gitops/environments returns all declared environments and individual details', async () => {
    const { app } = createGitOpsTestApp();

    // List all
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/gitops/environments',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.equal(Array.isArray(listBody), true);
    assert.equal(listBody.length, 2);

    // Get staging
    const stgRes = await app.inject({
      method: 'GET',
      url: '/v1/gitops/environments/staging',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(stgRes.statusCode, 200);
    const stgBody = JSON.parse(stgRes.body);
    assert.equal(stgBody.environment, 'staging');
    assert.equal(stgBody.sync_policy, 'automated');

    // Get production
    const prodRes = await app.inject({
      method: 'GET',
      url: '/v1/gitops/environments/production',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(prodRes.statusCode, 200);
    const prodBody = JSON.parse(prodRes.body);
    assert.equal(prodBody.environment, 'production');
    assert.equal(prodBody.approval_required, true);

    // Invalid environment
    const invalidRes = await app.inject({
      method: 'GET',
      url: '/v1/gitops/environments/nonexistent',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(invalidRes.statusCode, 400);
  });

  test('POST /v1/gitops/promote validates body and promotes staging', async () => {
    const { app } = createGitOpsTestApp();

    // Invalid body
    const badBodyRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/promote',
      headers: { 'x-tenant-id': 'tenant-gitops' },
      payload: { environment: 'staging' }, // missing image_tag
    });
    assert.equal(badBodyRes.statusCode, 400);

    // Promote staging
    const stgPromoteRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/promote',
      headers: { 'x-tenant-id': 'tenant-gitops' },
      payload: {
        environment: 'staging',
        image_tag: '0.10.1-staging',
        target_revision: 'release/0.10.1',
      },
    });
    assert.equal(stgPromoteRes.statusCode, 200);
    const stgPromoteBody = JSON.parse(stgPromoteRes.body);
    assert.equal(stgPromoteBody.promoted, true);
    assert.equal(stgPromoteBody.environment, 'staging');
    assert.equal(stgPromoteBody.new_image_tag, '0.10.1-staging');
    assert.equal(stgPromoteBody.reconciliation_mode, 'automated-prune-self-heal');
  });

  test('POST /v1/gitops/promote enforces production approval gate', async () => {
    const { app } = createGitOpsTestApp();

    // Production without approver -> rejected
    const unapprovedRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/promote',
      headers: { 'x-tenant-id': 'tenant-gitops' },
      payload: {
        environment: 'production',
        image_tag: '0.10.1',
      },
    });
    assert.equal(unapprovedRes.statusCode, 400);
    const unapprovedBody = JSON.parse(unapprovedRes.body);
    assert.equal(unapprovedBody.code, 'PRODUCTION_APPROVAL_REQUIRED');

    // Production with valid approver and approval_token -> approved
    const approvedRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/promote',
      headers: { 'x-tenant-id': 'tenant-gitops' },
      payload: {
        environment: 'production',
        image_tag: '0.10.1',
        approver: 'release-lead',
        approval_token: 'signed-approval-token-999',
      },
    });
    assert.equal(approvedRes.statusCode, 200);
    const approvedBody = JSON.parse(approvedRes.body);
    assert.equal(approvedBody.promoted, true);
    assert.equal(approvedBody.environment, 'production');
    assert.equal(approvedBody.new_image_tag, '0.10.1');
    assert.equal(approvedBody.approver, 'release-lead');
    assert.equal(approvedBody.reconciliation_mode, 'manual-sync-window');
  });

  test('POST /v1/gitops/promote enforces acceptance criteria: blocks direct_cluster_apply', async () => {
    const { app } = createGitOpsTestApp();

    const bypassRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/promote',
      headers: { 'x-tenant-id': 'tenant-gitops' },
      payload: {
        environment: 'staging',
        image_tag: '0.10.1-staging',
        direct_cluster_apply: true,
      },
    });
    assert.equal(bypassRes.statusCode, 403);
    const bypassBody = JSON.parse(bypassRes.body);
    assert.equal(bypassBody.code, 'GITOPS_BYPASS_PROHIBITED');
  });

  test('POST /v1/gitops/sync/:environment triggers Argo CD reconciliation', async () => {
    const { app } = createGitOpsTestApp();

    // Trigger sync for staging
    const syncRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/sync/staging',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(syncRes.statusCode, 200);
    const syncBody = JSON.parse(syncRes.body);
    assert.equal(syncBody.synced, true);
    assert.equal(syncBody.environment, 'staging');
    assert.equal(syncBody.sync_status, 'Synced');
    assert.equal(syncBody.health_status, 'Healthy');

    // Trigger sync for invalid environment
    const invalidSyncRes = await app.inject({
      method: 'POST',
      url: '/v1/gitops/sync/invalid-env',
      headers: { 'x-tenant-id': 'tenant-gitops' },
    });
    assert.equal(invalidSyncRes.statusCode, 400);
  });
});

