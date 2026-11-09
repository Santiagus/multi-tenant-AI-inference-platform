import pg from 'pg';

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
        console.log('Clearing existing showcase demo records...');
        await client.query("DELETE FROM jobs WHERE id::text LIKE '00000000-%'");
        await client.query("DELETE FROM provider_pricing_snapshots WHERE id::text LIKE '00000000-%'");
        await client.query("DELETE FROM pricing_sync_audit WHERE id::text LIKE '00000000-%'");
        console.log('Cleared showcase demo records.');
        return { jobsCount: 0, snapshotsCount: 0, auditsCount: 0 };
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

      // 2. Seed 7-day realistic market pricing snapshots for compatible GPUs
      console.log('Seeding 7-day historical pricing snapshots across neocloud and hyperscaler fleet...');
      const gpuItems = [
        { provider: 'vast_ai', sku: 'nvidia-rtx-5070-ti', baseUsd: 0.32, spotRatio: 0.65, vol: 0.08, vram: 16 },
        { provider: 'runpod', sku: 'nvidia-rtx-5070-ti', baseUsd: 0.44, spotRatio: 0.72, vol: 0.05, vram: 16 },
        { provider: 'hivenet', sku: 'nvidia-rtx-5070-ti', baseUsd: 0.38, spotRatio: 0.68, vol: 0.07, vram: 16 },
        { provider: 'nebius', sku: 'nvidia-rtx-5070-ti', baseUsd: 0.48, spotRatio: 0.85, vol: 0.03, vram: 16 },
        { provider: 'runpod', sku: 'nvidia-rtx-4090', baseUsd: 0.74, spotRatio: 0.70, vol: 0.06, vram: 24 },
        { provider: 'vast_ai', sku: 'nvidia-rtx-4090', baseUsd: 0.58, spotRatio: 0.62, vol: 0.09, vram: 24 },
        { provider: 'coreweave', sku: 'nvidia-rtx-4090', baseUsd: 0.82, spotRatio: 0.88, vol: 0.02, vram: 24 },
        { provider: 'runpod', sku: 'nvidia-a100-80gb', baseUsd: 1.89, spotRatio: 0.75, vol: 0.04, vram: 80 },
        { provider: 'nebius', sku: 'nvidia-a100-80gb', baseUsd: 1.95, spotRatio: 0.80, vol: 0.03, vram: 80 },
        { provider: 'sagemaker', sku: 'nvidia-a100-80gb', baseUsd: 4.10, spotRatio: 1.00, vol: 0.01, vram: 80 },
        { provider: 'runpod', sku: 'nvidia-h100-sxm', baseUsd: 2.89, spotRatio: 0.78, vol: 0.05, vram: 80 },
        { provider: 'nebius', sku: 'nvidia-h100-sxm', baseUsd: 2.95, spotRatio: 0.82, vol: 0.03, vram: 80 },
        { provider: 'coreweave', sku: 'nvidia-h100-sxm', baseUsd: 3.25, spotRatio: 0.85, vol: 0.02, vram: 80 },
        { provider: 'sagemaker', sku: 'nvidia-h100-sxm', baseUsd: 5.60, spotRatio: 1.00, vol: 0.01, vram: 80 },
        { provider: 'baseten', sku: 'nvidia-l4', baseUsd: 0.65, spotRatio: 0.88, vol: 0.02, vram: 24 },
        { provider: 'jarvislabs', sku: 'nvidia-rtx-5070-ti', baseUsd: 0.42, spotRatio: 0.75, vol: 0.05, vram: 16 },
      ];

      const nowMs = Date.now();
      let snapshotCount = 0;

      for (const item of gpuItems) {
        // Step every 4 hours over 7 days = 42 points per GPU option
        for (let h = 168; h >= 0; h -= 4) {
          const t = new Date(nowMs - h * 3600 * 1000);
          const hourUtc = t.getUTCHours();

          // Session multiplier simulating USA / EU / ASIA spot market fluctuations
          let sessionMultiplier = 1.0;
          if (hourUtc >= 15 && hourUtc < 22) sessionMultiplier = 1.08; // USA peak demand
          else if (hourUtc >= 8 && hourUtc < 15) sessionMultiplier = 1.03; // EU session
          else if (hourUtc >= 0 && hourUtc < 8) sessionMultiplier = 0.95; // Asia session
          else sessionMultiplier = 0.91; // Off-peak UTC

          const randomWalk = 1 + Math.sin(h * 0.25) * item.vol;
          const onDemandUsd = Math.round(item.baseUsd * 100) / 100;
          const spotUsd = Math.round(item.baseUsd * item.spotRatio * sessionMultiplier * randomWalk * 100) / 100;
          const hourlyMicrocents = Math.round(spotUsd * 100_000_000);

          const snapshotId = `00000000-0000-4000-b000-${String(snapshotCount + 1).padStart(12, '0')}`;
          await client.query(
            `INSERT INTO provider_pricing_snapshots (
              id, provider, hardware_sku_id, zone, pricing_model,
              rate_microcents, billing_unit, normalized_hourly_microcents,
              obtainability_raw, obtainability_score, interruption_risk_tier,
              is_available, recorded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              rate_microcents = EXCLUDED.rate_microcents,
              normalized_hourly_microcents = EXCLUDED.normalized_hourly_microcents`,
            [
              snapshotId,
              item.provider,
              item.sku,
              `${item.provider}-us-east`,
              'spot_bid',
              hourlyMicrocents,
              'hour',
              hourlyMicrocents,
              'High',
              0.88,
              '<5%',
              true,
              t,
            ]
          );
          snapshotCount++;
        }
      }

      // 3. Seed Pricing Sync Audit logs
      console.log('Seeding pricing synchronization audit history...');
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
              JSON.stringify({ latencyMs: Math.floor(Math.random() * 200 + 40) }),
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
