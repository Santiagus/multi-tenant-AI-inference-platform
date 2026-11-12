import pg from 'pg';
import { REAL_HISTORICAL_PRICING } from '../../finops/real-historical-prices.js';
import { LiveProviderCatalogService } from '../../finops/live-provider-catalog.js';
import { PostgresFinOpsPricingRepository } from '../postgres-finops-pricing-repository.js';
import type { DatabasePool } from '../pool.js';
import type { DlqMessage, IQueueClient } from '../../queue/queue-client.js';
import { SqsQueueClient } from '../../queue/sqs-queue.js';
import {
  buildShowcaseJobTemplates,
  isPaintedShowcaseJobId,
  paintedJobId,
  telemetryBackend,
  type SeedJobTemplate,
} from './showcase-coverage.js';

export interface ShowcaseSeedOptions {
  connectionString?: string;
  clearExisting?: boolean;
  pool?: pg.Pool;
  /** Optional queue client for DLQ fixtures. When omitted, CLI attempts ElasticMQ via env. */
  queueClient?: IQueueClient;
}

export interface ShowcaseSeedResult {
  jobsCount: number;
  snapshotsCount: number;
  auditsCount: number;
  dlqCount: number;
}

function createDbAdapter(pool: pg.Pool): DatabasePool {
  return {
    getPool: () => pool,
    query: (text: string, params?: unknown[]) => pool.query(text, params),
    isHealthy: async () => true,
    close: async () => {},
  } as unknown as DatabasePool;
}

function tryCreateQueueClientFromEnv(): IQueueClient | null {
  try {
    const queueUrl =
      process.env.SQS_QUEUE_URL ?? 'http://localhost:9324/000000000000/inference-jobs';
    const dlqUrl =
      process.env.SQS_DLQ_URL ?? 'http://localhost:9324/000000000000/inference-jobs-dlq';
    return new SqsQueueClient({
      queueUrl,
      dlqUrl,
      region: process.env.SQS_REGION ?? 'eu-central-1',
      endpoint: process.env.SQS_ENDPOINT ?? 'http://localhost:9324',
    });
  } catch {
    return null;
  }
}

/** Remove painted showcase poison pills from the DLQ (job ids prefixed with 00000000-). */
export async function purgeShowcaseDlq(queueClient: IQueueClient): Promise<number> {
  let purged = 0;
  // Multiple passes — ElasticMQ/SQS return at most 10 messages per receive.
  for (let pass = 0; pass < 20; pass++) {
    const messages = await queueClient.receiveDlqMessages(10);
    if (messages.length === 0) break;

    let deletedThisPass = 0;
    for (const msg of messages) {
      if (!isPaintedShowcaseJobId(msg.body.jobId)) continue;
      await queueClient.deleteDlqMessage(msg.receiptHandle);
      purged++;
      deletedThisPass++;
    }
    if (deletedThisPass === 0) break;
  }
  return purged;
}

/** Publish DLQ envelopes for templates marked `seedDlq`. */
export async function seedShowcaseDlq(
  queueClient: IQueueClient,
  jobs: Array<{ jobId: string; template: SeedJobTemplate }>
): Promise<number> {
  let count = 0;
  const now = new Date().toISOString();
  for (const { jobId, template } of jobs) {
    if (!template.seedDlq) continue;
    const envelope: DlqMessage = {
      jobId,
      tenantId: template.tenant,
      modelId: template.model,
      routingPreference: template.routing,
      priority: template.priority,
      correlationId: `showcase-dlq-${jobId}`,
      createdAt: now,
      failureReason: template.errorMessage ?? 'Showcase DLQ fixture',
      errorCode: template.errorCode ?? 'INFERENCE_ERROR',
      retryCount: template.retryCount ?? template.maxRetries ?? 3,
      failedAt: now,
    };
    await queueClient.sendToDlq(envelope);
    count++;
  }
  return count;
}

function buildOutputPayload(template: SeedJobTemplate): string | null {
  const needsPayload =
    template.status === 'SUCCEEDED' ||
    template.status === 'FAILED' ||
    template.status === 'CANCELLED' ||
    template.status === 'PROCESSING' ||
    template.status === 'RETRYING';
  if (!needsPayload) return null;

  const backend = telemetryBackend(
    template.engineExecuted,
    template.device,
    template.engineRequested
  );

  return JSON.stringify({
    hardware: template.hardware,
    provider: template.provider,
    showcase: true,
    is_mocked: true,
    // Inference is mocked; placement economics come from provider via getJobExecutionMode().
    engine_executed: template.engineExecuted,
    engine_requested: template.engineRequested,
    device: template.device,
    modality: template.modality,
    metadata: {
      showcase: true,
      is_mocked: true,
      engine_executed: template.engineExecuted,
      engine_requested: template.engineRequested,
      hardware: template.hardware,
      device: template.device,
      modality: template.modality,
      telemetry: {
        device_type: template.device,
        device_name: template.hardware,
        backend,
        measurement_mode: 'simulated',
      },
    },
  });
}

export async function runShowcaseSeed(options: ShowcaseSeedOptions = {}): Promise<ShowcaseSeedResult> {
  const connectionString =
    options.connectionString ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/platform';

  const shouldClosePool = !options.pool;
  const pool = options.pool ?? new pg.Pool({ connectionString });
  const queueClient = options.queueClient ?? tryCreateQueueClientFromEnv();

  try {
    const client = await pool.connect();
    try {
      console.log(`Connected to Postgres at ${connectionString.replace(/:[^:]+@/, ':****@')}`);

      if (options.clearExisting) {
        console.log('Clearing existing showcase demo records (painted jobs and mock audits)...');
        await client.query("DELETE FROM jobs WHERE id::text LIKE '00000000-%'");
        await client.query("DELETE FROM pricing_sync_audit WHERE id::text LIKE '00000000-%'");
        console.log('Cleared painted demo jobs and mock audit logs.');

        let dlqPurged = 0;
        if (queueClient) {
          try {
            dlqPurged = await purgeShowcaseDlq(queueClient);
            console.log(`Purged ${dlqPurged} painted showcase DLQ message(s).`);
          } catch (err) {
            console.warn('Could not purge showcase DLQ (queue unavailable):', err);
          }
        }

        const finopsRepo = new PostgresFinOpsPricingRepository(createDbAdapter(pool), false);
        const baselineCount = await finopsRepo.ensureHistoricalSnapshots();
        console.log(`Verified historical baseline snapshots: ${baselineCount} snapshots present.`);

        console.log('Synchronizing real live provider catalogs from active APIs...');
        const liveCatalog = new LiveProviderCatalogService(createDbAdapter(pool));
        const liveResult = await liveCatalog.syncAll();
        console.log(
          `Live sync complete: ${liveResult.gpuSnapshotsCount} GPU snapshots from [${liveResult.syncedProviders.join(', ')}].`
        );

        return {
          jobsCount: 0,
          snapshotsCount: liveResult.gpuSnapshotsCount,
          auditsCount: liveResult.auditRecordsCount,
          dlqCount: 0,
        };
      }

      // 1. Ensure required tenants exist
      const tenants = [
        'tenant-default',
        'tenant-demo',
        'tenant-dev',
        'tenant-acme',
        'tenant-finops',
        'tenant-enterprise',
      ];
      for (const t of tenants) {
        await client.query(
          `INSERT INTO tenants (id, name, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [t, `Enterprise ${t.replace('tenant-', '').toUpperCase()}`]
        );
      }

      // 2. Seed 7-day realistic market pricing snapshots
      console.log(
        `Seeding 7-day hourly pricing snapshots grounded in open datasets (${REAL_HISTORICAL_PRICING.provenance.dataset})...`
      );
      const finopsRepo = new PostgresFinOpsPricingRepository(createDbAdapter(pool), false);
      const snapshotCount = await finopsRepo.seedHistoricalBaseline();
      console.log(`Seeded ${snapshotCount} baseline snapshots.`);

      // 3. Seed Pricing Sync Audit logs
      console.log('Seeding pricing synchronization audit history...');
      const nowMs = Date.now();
      const auditProviders = [
        { name: 'vast_ai', interval: 60, cat: 'realtime_auction' },
        { name: 'runpod', interval: 120, cat: 'realtime_auction' },
        { name: 'hivenet', interval: 60, cat: 'realtime_auction' },
        { name: 'coreweave', interval: 300, cat: 'dynamic_shifts' },
        { name: 'bedrock', interval: 3600, cat: 'scheduled' },
        { name: 'baseten', interval: 86400, cat: 'scheduled' },
        { name: 'jarvislabs', interval: 43200, cat: 'scheduled' },
        { name: 'fal', interval: 300, cat: 'dynamic_shifts' },
        { name: 'wavespeed', interval: 300, cat: 'dynamic_shifts' },
      ];

      let auditCount = 0;
      for (const p of auditProviders) {
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

      // 4. Seed showcase jobs from explicit coverage matrix
      console.log(
        'Seeding tenant-demo showcase: statuses, engines, modalities, routing, priorities, duration-metered placements, local CPU/GPU, DLQ…'
      );
      const sampleJobs = buildShowcaseJobTemplates();
      const inserted: Array<{ jobId: string; template: SeedJobTemplate }> = [];

      let jobCount = 0;
      for (let i = 0; i < sampleJobs.length; i++) {
        const template = sampleJobs[i];
        const ageSec = (sampleJobs.length - i) * 420;
        const createdAt = new Date(nowMs - ageSec * 1000);
        const isTerminal =
          template.status === 'SUCCEEDED' ||
          template.status === 'FAILED' ||
          template.status === 'CANCELLED';
        const hasStarted =
          template.status === 'PROCESSING' || template.status === 'RETRYING' || isTerminal;
        const startedAt = hasStarted ? new Date(createdAt.getTime() + 100) : null;
        const completedAt = isTerminal
          ? new Date((startedAt ?? createdAt).getTime() + template.durMs)
          : null;
        const jobId = paintedJobId(i + 1);
        const outputPayload = buildOutputPayload(template);

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
            priority = EXCLUDED.priority,
            max_retries = EXCLUDED.max_retries,
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
            template.priority,
            template.maxRetries ?? 3,
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
        inserted.push({ jobId, template });
        jobCount++;
      }

      // 5. DLQ fixtures (ElasticMQ / in-memory)
      let dlqCount = 0;
      if (queueClient) {
        try {
          await purgeShowcaseDlq(queueClient);
          dlqCount = await seedShowcaseDlq(queueClient, inserted);
          console.log(`Seeded ${dlqCount} showcase DLQ message(s).`);
        } catch (err) {
          console.warn(
            'Could not seed showcase DLQ (queue unavailable — start ElasticMQ for local DLQ demos):',
            err
          );
        }
      } else {
        console.warn('No queue client available; skipping showcase DLQ fixtures.');
      }

      console.log(
        `Successfully seeded showcase dataset: ${jobCount} jobs, ${snapshotCount} pricing snapshots, ${auditCount} sync audits, ${dlqCount} DLQ.`
      );
      return {
        jobsCount: jobCount,
        snapshotsCount: snapshotCount,
        auditsCount: auditCount,
        dlqCount,
      };
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
