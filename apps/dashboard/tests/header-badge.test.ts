import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../src/api/client';
import { TENANT_OPTIONS, getTenantPurpose } from '../src/components/Header';
import { artifactPaperclipTitle } from '../src/components/jobs/JobsView';

describe('Tenant selector purpose tooltips', () => {
  it('exposes a purpose tooltip for every catalog tenant', () => {
    assert.ok(TENANT_OPTIONS.length >= 7);
    for (const tenant of TENANT_OPTIONS) {
      assert.equal(typeof tenant.purpose, 'string');
      assert.ok(tenant.purpose.length > 20, `${tenant.value} purpose too short`);
      assert.equal(getTenantPurpose(tenant.value), tenant.purpose);
    }
  });

  it('falls back for unknown tenant ids', () => {
    assert.match(getTenantPurpose('tenant-unknown'), /tenant-unknown/);
  });
});

describe('Job artifact paperclip tooltip', () => {
  it('describes attached artifact kind for list rows', () => {
    assert.equal(artifactPaperclipTitle({ has_artifacts: false }), '');
    assert.match(
      artifactPaperclipTitle({ has_artifacts: true, artifact_kind: 'image' }),
      /Artifacts attached \(image\)/
    );
  });
});

describe('Dashboard Data Source Mode & Health API', () => {
  it('client parses dataSource from /healthz response', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            dataSource: 'real',
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const health = await apiClient.getHealth();
      assert.equal(health.ok, true);
      assert.equal(health.status, 'ok');
      assert.equal(health.dataSource, 'real');
      assert.equal(health.environment, 'LOCAL');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('client detects mock dataSource mode when reported by API', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            dataSource: 'mock',
            inferenceMode: 'real',
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const health = await apiClient.getHealth();
      assert.equal(health.ok, true);
      assert.equal(health.dataSource, 'mock');
      assert.equal(health.inferenceMode, 'real');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('client invokes showcase seed and purge endpoints successfully', async () => {
    const originalFetch = globalThis.fetch;
    const actionsCalled: string[] = [];
    try {
      globalThis.fetch = async (url: any, opts: any) => {
        actionsCalled.push(`${opts?.method || 'GET'} ${url}`);
        if (String(url).endsWith('/seed')) {
          return new Response(JSON.stringify({ ok: true, dataSource: 'mock', stats: { jobsCount: 30 } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true, dataSource: 'real' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const seedRes = await apiClient.seedShowcaseData();
      assert.equal(seedRes.ok, true);
      assert.equal(seedRes.dataSource, 'mock');

      const purgeRes = await apiClient.purgeShowcaseData();
      assert.equal(purgeRes.ok, true);
      assert.equal(purgeRes.dataSource, 'real');

      assert.equal(actionsCalled[0], 'POST /v1/admin/showcase/seed');
      assert.equal(actionsCalled[1], 'POST /v1/admin/showcase/purge');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('client invokes purgeTenantData endpoint successfully', async () => {
    const originalFetch = globalThis.fetch;
    const actionsCalled: string[] = [];
    try {
      globalThis.fetch = async (url: any, opts: any) => {
        actionsCalled.push(`${opts?.method || 'GET'} ${url}`);
        return new Response(JSON.stringify({ ok: true, tenantId: 'tenant-dev', deletedCount: 5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const res = await apiClient.purgeTenantData('tenant-dev');
      assert.equal(res.ok, true);
      assert.equal(res.tenantId, 'tenant-dev');
      assert.equal(res.deletedCount, 5);
      assert.equal(actionsCalled[0], 'POST /v1/admin/tenants/tenant-dev/purge');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('client invokes delete-matching and orphan artifact endpoints', async () => {
    const originalFetch = globalThis.fetch;
    const actionsCalled: string[] = [];
    try {
      globalThis.fetch = async (url: any, opts: any) => {
        actionsCalled.push(`${opts?.method || 'GET'} ${url}`);
        if (String(url).includes('delete-matching')) {
          return new Response(
            JSON.stringify({ ok: true, deleted_jobs: 2, deleted_objects: 3, filters: {}, message: 'ok' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (String(url).endsWith('/orphans/purge')) {
          return new Response(
            JSON.stringify({
              ok: true,
              tenantId: 'tenant-default',
              purged_prefixes: 1,
              deleted_objects: 2,
              orphans: ['tenants/tenant-default/outputs/x/'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            tenantId: 'tenant-default',
            orphans: ['tenants/tenant-default/outputs/x/'],
            count: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const del = await apiClient.deleteMatchingJobs({ tenant_id: 'tenant-default', provider: 'runpod' });
      assert.equal(del.deleted_jobs, 2);

      const orphans = await apiClient.getOrphanArtifacts('tenant-default');
      assert.equal(orphans.count, 1);

      const purged = await apiClient.purgeOrphanArtifacts('tenant-default');
      assert.equal(purged.purged_prefixes, 1);

      assert.equal(actionsCalled[0], 'POST /v1/admin/jobs/delete-matching');
      assert.equal(actionsCalled[1], 'GET /v1/admin/tenants/tenant-default/artifacts/orphans');
      assert.equal(actionsCalled[2], 'POST /v1/admin/tenants/tenant-default/artifacts/orphans/purge');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
