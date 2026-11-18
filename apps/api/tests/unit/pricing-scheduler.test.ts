import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_SYNC_POLICIES,
  PricingSyncScheduler,
} from '../../src/infrastructure/finops/pricing-scheduler.js';
import { InMemoryFinOpsPricingRepository } from '../../src/infrastructure/db/finops-pricing-repository.js';

describe('Pricing Sync Scheduler & Policies', () => {
  it('defines spaced sync intervals per provider quota budget and volatility', () => {
    // Vast.ai: 15 min (900,000 ms) to stay comfortably within 20,000 daily row quota
    const vast = PROVIDER_SYNC_POLICIES.find((p) => p.provider === 'vast_ai');
    assert.ok(vast);
    assert.equal(vast.cadenceCategory, 'realtime_auction');
    assert.equal(vast.intervalMs, 15 * 60 * 1000);

    // Nebius: 2 hours (7,200,000 ms) for model catalog pricing
    const nebius = PROVIDER_SYNC_POLICIES.find((p) => p.provider === 'nebius');
    assert.ok(nebius);
    assert.equal(nebius.cadenceCategory, 'dynamic_shifts');
    assert.equal(nebius.intervalMs, 2 * 60 * 60 * 1000);

    // Baseten: 6 hours (21,600,000 ms) for serverless cards
    const baseten = PROVIDER_SYNC_POLICIES.find((p) => p.provider === 'baseten');
    assert.ok(baseten);
    assert.equal(baseten.cadenceCategory, 'scheduled');
    assert.equal(baseten.intervalMs, 6 * 60 * 60 * 1000);

    // SageMaker: 24 hours (86,400,000 ms) for static hyperscaler cards
    const sagemaker = PROVIDER_SYNC_POLICIES.find((p) => p.provider === 'sagemaker');
    assert.ok(sagemaker);
    assert.equal(sagemaker.cadenceCategory, 'scheduled');
    assert.equal(sagemaker.intervalMs, 24 * 60 * 60 * 1000);
  });

  it('starts and stops scheduler cleanly with initial sync', async () => {
    let synced = false;
    const mockRepo = {
      ...new InMemoryFinOpsPricingRepository(),
      syncFromProviders: async () => {
        synced = true;
        return { syncedProviders: ['runpod'], recordsCount: 1, syncedAt: new Date().toISOString() };
      },
    };

    const scheduler = new PricingSyncScheduler(mockRepo);
    scheduler.start();
    // allow microtask to run initial sync
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(synced, true);
    scheduler.stop();
  });

  it('supports selective provider synchronization via repository', async () => {
    const repo = new InMemoryFinOpsPricingRepository();
    const result = await repo.syncFromProviders({ providers: ['vast_ai', 'runpod'] });
    assert.deepEqual(result.syncedProviders, ['runpod', 'vast_ai']);
  });
});
