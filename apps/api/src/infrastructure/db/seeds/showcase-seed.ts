import pg from 'pg';
import { REAL_HISTORICAL_PRICING } from '../../finops/real-historical-prices.js';
import { LiveProviderCatalogService } from '../../finops/live-provider-catalog.js';
import { PostgresFinOpsPricingRepository } from '../postgres-finops-pricing-repository.js';
import type { DatabasePool } from '../pool.js';

export interface ShowcaseSeedOptions {
  connectionString?: string;
  clearExisting?: boolean;
  pool?: pg.Pool;
}

export async function runShowcaseSeed(options: ShowcaseSeedOptions = {}): Promise<{
  jobsCount: number;
  snapshotsCount: number;
  auditsCount: number;
}> {
  const connectionString =
    options.connectionString ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/platform';

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new pg.Pool({ connectionString });

  try {
    const client = await pool.connect();
    try {
      console.log(`Connected to Postgres at ${connectionString.replace(/:[^:]+@/, ':****@')}`);

      if (options.clearExisting) {
        console.log('Clearing existing showcase demo records (painted jobs and mock audits)...');
        await client.query("DELETE FROM jobs WHERE id::text LIKE '00000000-%'");
        await client.query("DELETE FROM pricing_sync_audit WHERE id::text LIKE '00000000-%'");
        console.log('Cleared painted demo jobs and mock audit logs.');

        const dbAdapter = {
          getPool: () => pool,
          query: (text: string, params?: unknown[]) => pool.query(text, params),
          isHealthy: async () => true,
          close: async () => {},
        } as unknown as DatabasePool;

        const finopsRepo = new PostgresFinOpsPricingRepository(dbAdapter, false);
        const baselineCount = await finopsRepo.ensureHistoricalSnapshots();
        console.log(`Verified historical baseline snapshots: ${baselineCount} snapshots present.`);

        console.log('Synchronizing real live provider catalogs from active APIs...');
        const liveCatalog = new LiveProviderCatalogService(dbAdapter);
        const liveResult = await liveCatalog.syncAll();
        console.log(
          `Live sync complete: ${liveResult.gpuSnapshotsCount} GPU snapshots from [${liveResult.syncedProviders.join(', ')}].`
        );

        return {
          jobsCount: 0,
          snapshotsCount: liveResult.gpuSnapshotsCount,
          auditsCount: liveResult.auditRecordsCount,
        };
      }

      // 1. Ensure required tenants exist
      const tenants = ['tenant-default', 'tenant-acme', 'tenant-finops', 'tenant-enterprise'];
      for (const t of tenants) {
        await client.query(
          `INSERT INTO tenants (id, name, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [t, `Enterprise ${t.replace('tenant-', '').toUpperCase()}`]
        );
      }

      // 2. Seed 7-day realistic market pricing snapshots grounded in REAL open-source datasets
      console.log(
        `Seeding 7-day hourly pricing snapshots grounded in open datasets (${REAL_HISTORICAL_PRICING.provenance.dataset})...`
      );
      const dbAdapter = {
        getPool: () => pool,
        query: (text: string, params?: unknown[]) => pool.query(text, params),
        isHealthy: async () => true,
        close: async () => {},
      } as unknown as DatabasePool;

      const finopsRepo = new PostgresFinOpsPricingRepository(dbAdapter, false);
      const snapshotCount = await finopsRepo.seedHistoricalBaseline();
      console.log(`Seeded ${snapshotCount} baseline snapshots.`);

      // 3. Seed Pricing Sync Audit logs
      console.log('Seeding pricing synchronization audit history...');
      const nowMs = Date.now();
      const providers = [
        { name: 'vast_ai', interval: 60, cat: 'realtime_auction' },
        { name: 'runpod', interval: 120, cat: 'realtime_auction' },
        { name: 'hivenet', interval: 60, cat: 'realtime_auction' },
        { name: 'nebius', interval: 300, cat: 'dynamic_shifts' },
        { name: 'coreweave', interval: 300, cat: 'dynamic_shifts' },
        { name: 'sagemaker', interval: 3600, cat: 'scheduled' },
        { name: 'bedrock', interval: 3600, cat: 'scheduled' },
        { name: 'baseten', interval: 86400, cat: 'scheduled' },
        { name: 'jarvislabs', interval: 43200, cat: 'scheduled' },
      ];

      let auditCount = 0;
      for (const p of providers) {
        for (let i = 0; i < 5; i++) {
          const t = new Date(nowMs - i * p.interval * 1000);
          const auditId = `00000000-0000-4000-c000-${String(auditCount + 1).padStart(12, '0')}`;
          await client.query(
            `INSERT INTO pricing_sync_audit (
              id, provider, sync_type, records_count, update_cadence_category,
              estimated_update_interval_sec, status, details, synced_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING`,
            [
              auditId,
              p.name,
              'gpu_hardware',
              8,
              p.cat,
              p.interval,
              'SUCCESS',
              JSON.stringify({
                latencyMs: Math.floor(Math.random() * 200 + 40),
                dataset: REAL_HISTORICAL_PRICING.provenance.dataset,
                provenanceUrl: REAL_HISTORICAL_PRICING.provenance.sourceUrl,
                license: REAL_HISTORICAL_PRICING.provenance.license,
                window: `${REAL_HISTORICAL_PRICING.provenance.windowStart} to ${REAL_HISTORICAL_PRICING.provenance.windowEnd}`,
              }),
              t,
            ]
          );
          auditCount++;
        }
      }

      // 4. Seed Showcase Multi-Tenant Inference Jobs
      console.log('Seeding showcase multi-tenant inference jobs with token metrics & FinOps costs...');
      const sampleJobs = [
        { model: 'meta-llama/llama-3-8b', inTok: 2048, outTok: 512, durMs: 840, cost: 240, tenant: 'tenant-default', status: 'COMPLETED' },
        { model: 'meta-llama/llama-3-8b', inTok: 4096, outTok: 1024, durMs: 1420, cost: 480, tenant: 'tenant-acme', status: 'COMPLETED' },
        { model: 'THUDM/cogvideox-5b', inTok: 120, outTok: 0, durMs: 10700, cost: 2140, tenant: 'tenant-finops', status: 'COMPLETED' },
        { model: 'THUDM/cogvideox-5b', inTok: 180, outTok: 0, durMs: 12400, cost: 2480, tenant: 'tenant-default', status: 'COMPLETED' },
        { model: 'black-forest-labs/flux-1-schnell', inTok: 64, outTok: 0, durMs: 2300, cost: 690, tenant: 'tenant-enterprise', status: 'COMPLETED' },
        { model: 'deepseek-ai/deepseek-r1', inTok: 8192, outTok: 2048, durMs: 4100, cost: 820, tenant: 'tenant-default', status: 'COMPLETED' },
        { model: 'openai/whisper-large-v3', inTok: 500, outTok: 250, durMs: 1600, cost: 320, tenant: 'tenant-acme', status: 'COMPLETED' },
        { model: 'meta-llama/llama-3-8b', inTok: 1024, outTok: 256, durMs: 510, cost: 120, tenant: 'tenant-finops', status: 'COMPLETED' },
        { model: 'THUDM/cogvideox-5b', inTok: 90, outTok: 0, durMs: 9800, cost: 1960, tenant: 'tenant-enterprise', status: 'PROCESSING' },
        { model: 'deepseek-ai/deepseek-r1', inTok: 4096, outTok: 1024, durMs: 2200, cost: 440, tenant: 'tenant-default', status: 'QUEUED' },
      ];

      let jobCount = 0;
      for (let i = 0; i < 30; i++) {
        const template = sampleJobs[i % sampleJobs.length];
        const ageSec = (30 - i) * 600; // spread over several hours
        const createdAt = new Date(nowMs - ageSec * 1000);
        const startedAt = new Date(createdAt.getTime() + 100);
        const completedAt = template.status === 'COMPLETED' ? new Date(startedAt.getTime() + template.durMs) : null;
        const jobId = `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`;

        await client.query(
          `INSERT INTO jobs (
            id, tenant_id, model_id, routing_preference, priority, max_retries, retry_count,
            status, duration_ms, tokens_in, tokens_out, cost_microcents, provider,
            created_at, started_at, completed_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            cost_microcents = EXCLUDED.cost_microcents,
            tokens_in = EXCLUDED.tokens_in,
            tokens_out = EXCLUDED.tokens_out,
            duration_ms = EXCLUDED.duration_ms`,
          [
            jobId,
            template.tenant,
            template.model,
            'auto',
            1,
            3,
            0,
            template.status,
            template.durMs,
            template.inTok,
            template.outTok,
            template.cost,
            'vast_ai',
            createdAt,
            startedAt,
            completedAt,
            completedAt ?? createdAt,
          ]
        );
        jobCount++;
      }

      console.log(`Successfully seeded showcase dataset: ${jobCount} jobs, ${snapshotCount} pricing snapshots, ${auditCount} sync audits.`);
      return { jobsCount: jobCount, snapshotsCount: snapshotCount, auditsCount: auditCount };
    } finally {
      client.release();
    }
  } finally {
    if (shouldClosePool) {
      await pool.end();
    }
  }
}

// Run directly from CLI
if (process.argv[1]?.endsWith('showcase-seed.ts') || process.argv[1]?.endsWith('showcase-seed.js')) {
  const isClear = process.argv.includes('--clear');
  runShowcaseSeed({ clearExisting: isClear })
    .then((res) => {
      console.log('Done!', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Showcase seed failed:', err);
      process.exit(1);
    });
}
