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
      const tenants = ['tenant-default', 'tenant-demo', 'tenant-dev', 'tenant-acme', 'tenant-finops', 'tenant-enterprise'];
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
      // tenant-demo is the filter showcase: every job status + every platform provider/HW/mode.
      console.log('Seeding showcase multi-tenant inference jobs with token metrics & FinOps costs...');

      type SeedJob = {
        model: string;
        inTok: number;
        outTok: number;
        durMs: number;
        cost: number;
        tenant: string;
        status: string;
        provider: string;
        routing: string;
        hardware: string;
        retryCount?: number;
        errorCode?: string | null;
        errorMessage?: string | null;
      };

      const models = [
        { model: 'meta-llama/llama-3-8b', inTok: 2048, outTok: 512, durMs: 840, cost: 240 },
        { model: 'deepseek-ai/deepseek-r1', inTok: 8192, outTok: 2048, durMs: 4100, cost: 820 },
        { model: 'THUDM/cogvideox-5b', inTok: 120, outTok: 0, durMs: 10700, cost: 2140 },
        { model: 'black-forest-labs/flux-1-schnell', inTok: 64, outTok: 0, durMs: 2300, cost: 690 },
        { model: 'openai/whisper-large-v3', inTok: 500, outTok: 250, durMs: 1600, cost: 320 },
        { model: 'mistralai/mistral-7b-instruct', inTok: 1536, outTok: 384, durMs: 720, cost: 180 },
      ];

      // Covers all dashboard providers and execution modes (local / spot / serverless /
      // token_factory / pay_per_call / on_demand) with distinct hardware labels.
      const demoProviders: Array<{ provider: string; routing: string; hardware: string }> = [
        { provider: 'local', routing: 'local/gpu', hardware: 'RTX 5070 Ti (16 GB)' },
        { provider: 'runpod', routing: 'cloud/runpod', hardware: 'RTX 4090 (24 GB)' },
        { provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { provider: 'baseten', routing: 'auto', hardware: 'L4 Tensor Core (24 GB)' },
        { provider: 'nebius', routing: 'auto', hardware: 'H200 SXM (141 GB)' },
        { provider: 'jarvislabs', routing: 'auto', hardware: 'Token Factory' },
        { provider: 'coreweave', routing: 'auto', hardware: 'H100 SXM5 (80 GB)' },
        { provider: 'fal', routing: 'auto', hardware: 'Tensor Core Pipeline' },
        { provider: 'runware', routing: 'auto', hardware: 'Tensor Core Pipeline' },
        { provider: 'hivenet', routing: 'auto', hardware: 'A100 80GB (80 GB)' },
        { provider: 'wavespeed', routing: 'auto', hardware: 'L40S (48 GB)' },
        { provider: 'neocloudz', routing: 'auto', hardware: 'A6000 (48 GB)' },
        { provider: 'bedrock', routing: 'cloud/bedrock', hardware: 'AWS Bedrock' },
        { provider: 'sagemaker', routing: 'cloud/sagemaker', hardware: 'Inferentia2 / G5 (24 GB)' },
      ];

      const allStatuses = [
        'SUBMITTED',
        'QUEUED',
        'PROCESSING',
        'RETRYING',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED',
      ] as const;

      const sampleJobs: SeedJob[] = [];

      // (A) One job per status × a rotating provider so every status filter is non-empty.
      for (let i = 0; i < allStatuses.length; i++) {
        const status = allStatuses[i];
        const prov = demoProviders[i % demoProviders.length];
        const model = models[i % models.length];
        sampleJobs.push({
          ...model,
          tenant: 'tenant-demo',
          status,
          provider: prov.provider,
          routing: prov.routing,
          hardware: prov.hardware,
          retryCount: status === 'RETRYING' ? 1 : 0,
          errorCode: status === 'FAILED' ? 'INFERENCE_ERROR' : null,
          errorMessage: status === 'FAILED' ? 'Simulated showcase failure for filter demos' : null,
        });
      }

      // (B) One SUCCEEDED job per provider so provider/HW/mode panels all have rows to filter.
      for (let i = 0; i < demoProviders.length; i++) {
        const prov = demoProviders[i];
        const model = models[i % models.length];
        // Skip first provider+status combo already covered by the SUCCEEDED slot above when i===4
        // by using a second SUCCEEDED pass for every provider.
        sampleJobs.push({
          ...model,
          // Slightly vary tokens/cost so aggregates are non-degenerate.
          inTok: model.inTok + i * 16,
          outTok: model.outTok + (model.outTok > 0 ? i * 4 : 0),
          durMs: model.durMs + i * 35,
          cost: model.cost + i * 12,
          tenant: 'tenant-demo',
          status: 'SUCCEEDED',
          provider: prov.provider,
          routing: prov.routing,
          hardware: prov.hardware,
        });
      }

      // (C) Extra in-flight / terminal variety on tenant-demo (deepseek → H100 path on RunPod).
      sampleJobs.push(
        {
          model: 'deepseek-ai/deepseek-r1',
          inTok: 4096,
          outTok: 1024,
          durMs: 2200,
          cost: 440,
          tenant: 'tenant-demo',
          status: 'PROCESSING',
          provider: 'runpod',
          routing: 'cloud/runpod',
          hardware: 'H100 SXM5 (80 GB)',
        },
        {
          model: 'meta-llama/llama-3-8b',
          inTok: 1024,
          outTok: 256,
          durMs: 510,
          cost: 120,
          tenant: 'tenant-demo',
          status: 'QUEUED',
          provider: 'local',
          routing: 'local/cpu',
          hardware: 'CPU Fallback',
        },
        {
          model: 'THUDM/cogvideox-5b',
          inTok: 90,
          outTok: 0,
          durMs: 9800,
          cost: 1960,
          tenant: 'tenant-demo',
          status: 'FAILED',
          provider: 'vast_ai',
          routing: 'auto',
          hardware: 'RTX 5090 Blackwell (32 GB)',
          errorCode: 'PROVIDER_TIMEOUT',
          errorMessage: 'Provider auction timed out before worker claim',
        },
        {
          model: 'openai/whisper-large-v3',
          inTok: 500,
          outTok: 250,
          durMs: 1600,
          cost: 320,
          tenant: 'tenant-demo',
          status: 'RETRYING',
          provider: 'baseten',
          routing: 'auto',
          hardware: 'L4 Tensor Core (24 GB)',
          retryCount: 2,
        },
        {
          model: 'black-forest-labs/flux-1-schnell',
          inTok: 64,
          outTok: 0,
          durMs: 2300,
          cost: 690,
          tenant: 'tenant-demo',
          status: 'CANCELLED',
          provider: 'fal',
          routing: 'auto',
          hardware: 'Tensor Core Pipeline',
        },
        {
          model: 'mistralai/mistral-7b-instruct',
          inTok: 768,
          outTok: 192,
          durMs: 640,
          cost: 95,
          tenant: 'tenant-demo',
          status: 'SUBMITTED',
          provider: 'nebius',
          routing: 'auto',
          hardware: 'H200 SXM (141 GB)',
        }
      );

      // (D) Sparse jobs on other tenants so "All Tenants" aggregation still has cross-tenant rows.
      const otherTenantJobs: SeedJob[] = [
        { model: 'meta-llama/llama-3-8b', inTok: 2048, outTok: 512, durMs: 840, cost: 240, tenant: 'tenant-default', status: 'SUCCEEDED', provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { model: 'meta-llama/llama-3-8b', inTok: 4096, outTok: 1024, durMs: 1420, cost: 480, tenant: 'tenant-acme', status: 'SUCCEEDED', provider: 'runpod', routing: 'auto', hardware: 'RTX 4090 (24 GB)' },
        { model: 'THUDM/cogvideox-5b', inTok: 120, outTok: 0, durMs: 10700, cost: 2140, tenant: 'tenant-finops', status: 'SUCCEEDED', provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { model: 'black-forest-labs/flux-1-schnell', inTok: 64, outTok: 0, durMs: 2300, cost: 690, tenant: 'tenant-enterprise', status: 'SUCCEEDED', provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { model: 'deepseek-ai/deepseek-r1', inTok: 8192, outTok: 2048, durMs: 4100, cost: 820, tenant: 'tenant-default', status: 'SUCCEEDED', provider: 'runpod', routing: 'auto', hardware: 'H100 SXM5 (80 GB)' },
        { model: 'openai/whisper-large-v3', inTok: 500, outTok: 250, durMs: 1600, cost: 320, tenant: 'tenant-acme', status: 'SUCCEEDED', provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { model: 'meta-llama/llama-3-8b', inTok: 1024, outTok: 256, durMs: 510, cost: 120, tenant: 'tenant-finops', status: 'SUCCEEDED', provider: 'local', routing: 'local/gpu', hardware: 'RTX 5070 Ti (16 GB)' },
        { model: 'THUDM/cogvideox-5b', inTok: 90, outTok: 0, durMs: 9800, cost: 1960, tenant: 'tenant-enterprise', status: 'PROCESSING', provider: 'vast_ai', routing: 'auto', hardware: 'RTX 5090 Blackwell (32 GB)' },
        { model: 'deepseek-ai/deepseek-r1', inTok: 4096, outTok: 1024, durMs: 2200, cost: 440, tenant: 'tenant-default', status: 'QUEUED', provider: 'runpod', routing: 'auto', hardware: 'H100 SXM5 (80 GB)' },
      ];
      sampleJobs.push(...otherTenantJobs);

      let jobCount = 0;
      for (let i = 0; i < sampleJobs.length; i++) {
        const template = sampleJobs[i];
        const ageSec = (sampleJobs.length - i) * 420; // spread over several hours
        const createdAt = new Date(nowMs - ageSec * 1000);
        const isTerminal = template.status === 'SUCCEEDED' || template.status === 'FAILED' || template.status === 'CANCELLED';
        const hasStarted =
          template.status === 'PROCESSING' ||
          template.status === 'RETRYING' ||
          isTerminal;
        const startedAt = hasStarted ? new Date(createdAt.getTime() + 100) : null;
        const completedAt =
          template.status === 'SUCCEEDED' || template.status === 'FAILED' || template.status === 'CANCELLED'
            ? new Date((startedAt ?? createdAt).getTime() + template.durMs)
            : null;
        const jobId = `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`;
        const isLocal =
          template.provider === 'local' ||
          template.provider === 'local_pytorch' ||
          template.routing.includes('local');
        const isCpuRoute = template.routing.includes('cpu');
        const engine = isCpuRoute ? 'eager' : i % 3 === 0 ? 'torchscript' : i % 3 === 1 ? 'eager' : 'torch-compile';
        const deviceType = isCpuRoute ? 'cpu' : 'cuda';
        const backend =
          engine === 'torch-compile'
            ? `pytorch_torch_compile_${deviceType}`
            : engine === 'torchscript'
              ? `pytorch_torchscript_${deviceType}`
              : `pytorch_${deviceType}`;
        const outputPayload =
          template.status === 'SUCCEEDED' ||
          template.status === 'FAILED' ||
          template.status === 'CANCELLED' ||
          template.status === 'PROCESSING' ||
          template.status === 'RETRYING'
            ? JSON.stringify({
                hardware: template.hardware,
                provider: template.provider,
                showcase: true,
                is_mocked: true,
                execution_mode: 'mock',
                engine_executed: engine,
                engine_requested: engine,
                device: deviceType,
                metadata: {
                  showcase: true,
                  is_mocked: true,
                  execution_mode: 'mock',
                  engine_executed: engine,
                  engine_requested: engine,
                  hardware: template.hardware,
                  device: deviceType,
                  telemetry: {
                    device_type: deviceType,
                    device_name: template.hardware,
                    backend,
                    measurement_mode: 'simulated',
                  },
                },
              })
            : null;

        await client.query(
          `INSERT INTO jobs (
            id, tenant_id, model_id, routing_preference, priority, max_retries, retry_count,
            status, duration_ms, tokens_in, tokens_out, cost_microcents, provider,
            output_payload, error_code, error_message,
            created_at, started_at, completed_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          ON CONFLICT (id) DO UPDATE SET
            tenant_id = EXCLUDED.tenant_id,
            model_id = EXCLUDED.model_id,
            routing_preference = EXCLUDED.routing_preference,
            status = EXCLUDED.status,
            cost_microcents = EXCLUDED.cost_microcents,
            tokens_in = EXCLUDED.tokens_in,
            tokens_out = EXCLUDED.tokens_out,
            duration_ms = EXCLUDED.duration_ms,
            provider = EXCLUDED.provider,
            output_payload = EXCLUDED.output_payload,
            error_code = EXCLUDED.error_code,
            error_message = EXCLUDED.error_message,
            retry_count = EXCLUDED.retry_count,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            updated_at = EXCLUDED.updated_at`,
          [
            jobId,
            template.tenant,
            template.model,
            template.routing ?? 'auto',
            1,
            3,
            template.retryCount ?? 0,
            template.status,
            template.durMs,
            template.inTok,
            template.outTok,
            template.cost,
            template.provider ?? 'vast_ai',
            outputPayload,
            template.errorCode ?? null,
            template.errorMessage ?? null,
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
