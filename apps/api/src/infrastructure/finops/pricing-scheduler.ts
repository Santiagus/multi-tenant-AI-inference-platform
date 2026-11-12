import type { IFinOpsPricingRepository } from '../db/finops-pricing-repository.js';

export interface ProviderSyncPolicy {
  provider: string;
  cadenceCategory: 'realtime_auction' | 'dynamic_shifts' | 'scheduled';
  intervalMs: number;
}

/**
 * Spaced polling policies calculated from daily API quotas and empirical price volatility:
 * - Realtime spot auctions (Vast.ai, RunPod, HiveNet): 15m (96 calls/day)
 *   Vast.ai 20,000 daily row quota @ ~35 rows/query = 3,360 rows/day (~16.8% of daily limit)
 * - Dynamic model & datacenter catalogs (Nebius, CoreWeave, Fal, Runware): 2h (12 calls/day)
 * - Managed platform models & GPU cards (Baseten, JarvisLabs): 6h (4 calls/day)
 * - Hyperscaler static catalog rate cards (SageMaker, Bedrock): 24h (1 call/day)
 */
export const PROVIDER_SYNC_POLICIES: ProviderSyncPolicy[] = [
  // 1. Real-time dynamic auctions (15 min cadence)
  { provider: 'vast_ai', cadenceCategory: 'realtime_auction', intervalMs: 15 * 60 * 1000 },
  { provider: 'runpod', cadenceCategory: 'realtime_auction', intervalMs: 15 * 60 * 1000 },
  { provider: 'hivenet', cadenceCategory: 'realtime_auction', intervalMs: 15 * 60 * 1000 },

  // 2. Dynamic datacenter spot & cloud shifts (2 hour cadence)
  { provider: 'nebius', cadenceCategory: 'dynamic_shifts', intervalMs: 2 * 60 * 60 * 1000 },
  { provider: 'coreweave', cadenceCategory: 'dynamic_shifts', intervalMs: 2 * 60 * 60 * 1000 },
  { provider: 'fal', cadenceCategory: 'dynamic_shifts', intervalMs: 2 * 60 * 60 * 1000 },
  { provider: 'runware', cadenceCategory: 'dynamic_shifts', intervalMs: 2 * 60 * 60 * 1000 },

  // 3. Platform managed serverless & token factories (6 hour cadence)
  { provider: 'baseten', cadenceCategory: 'scheduled', intervalMs: 6 * 60 * 60 * 1000 },
  { provider: 'jarvislabs', cadenceCategory: 'scheduled', intervalMs: 6 * 60 * 60 * 1000 },

  // 4. Hyperscaler published pricing cards (24 hour cadence)
  { provider: 'sagemaker', cadenceCategory: 'scheduled', intervalMs: 24 * 60 * 60 * 1000 },
  { provider: 'bedrock', cadenceCategory: 'scheduled', intervalMs: 24 * 60 * 60 * 1000 },
];

export class PricingSyncScheduler {
  private timers: NodeJS.Timeout[] = [];
  private isRunning = false;

  constructor(private finopsRepo: IFinOpsPricingRepository) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run an initial sync on startup for all providers
    this.finopsRepo.syncFromProviders().catch((err) => {
      console.warn('Initial pricing sync error:', err);
    });

    // If an explicit interval override is provided (e.g. testing or local speedups), respect it
    if (process.env.PRICING_SYNC_INTERVAL_MS) {
      const overrideMs = Number(process.env.PRICING_SYNC_INTERVAL_MS);
      const timer = setInterval(async () => {
        try {
          await this.finopsRepo.syncFromProviders();
        } catch (err) {
          console.warn('Error during overridden pricing sync:', err);
        }
      }, overrideMs);
      this.timers.push(timer);
      return;
    }

    // In unit test environment without override, keep interval short to avoid hanging workers
    if (process.env.NODE_ENV === 'test') {
      const testTimer = setInterval(async () => {
        try {
          await this.finopsRepo.syncFromProviders();
        } catch (err) {
          console.warn('Error during test pricing sync:', err);
        }
      }, 60 * 1000);
      this.timers.push(testTimer);
      return;
    }

    // Group policies by interval to schedule distinct cadence loops per provider tier
    const cadenceGroups = new Map<number, string[]>();
    for (const policy of PROVIDER_SYNC_POLICIES) {
      const existing = cadenceGroups.get(policy.intervalMs) || [];
      existing.push(policy.provider);
      cadenceGroups.set(policy.intervalMs, existing);
    }

    for (const [intervalMs, providers] of cadenceGroups.entries()) {
      const timer = setInterval(async () => {
        try {
          await this.finopsRepo.syncFromProviders({ providers });
        } catch (err) {
          console.warn(`Error during scheduled pricing sync for [${providers.join(', ')}]:`, err);
        }
      }, intervalMs);
      this.timers.push(timer);
    }
  }

  stop(): void {
    this.isRunning = false;
    for (const t of this.timers) {
      clearInterval(t);
    }
    this.timers = [];
  }
}
