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
            timestamp: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const health = await apiClient.getHealth();
      assert.equal(health.ok, true);
      assert.equal(health.dataSource, 'mock');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
