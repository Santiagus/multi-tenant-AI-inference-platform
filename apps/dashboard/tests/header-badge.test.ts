import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiClient } from '../src/api/client';

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
});
