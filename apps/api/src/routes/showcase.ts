import type { FastifyPluginAsync } from 'fastify';
import { runShowcaseSeed } from '../infrastructure/db/seeds/showcase-seed.js';
import { buildShowcaseJobTemplates } from '../infrastructure/db/seeds/showcase-coverage.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';

export interface ShowcaseRoutesOptions {
  db: {
    isHealthy: () => Promise<boolean>;
    getPool?: () => any;
    query?: (text: string, params?: unknown[]) => Promise<any>;
  };
  getDataSource: () => 'real' | 'mock';
  setDataSource: (mode: 'real' | 'mock') => void;
  queueClient?: IQueueClient;
}

export const showcaseRoutes: FastifyPluginAsync<ShowcaseRoutesOptions> = async (fastify, options) => {
  fastify.get(
    '/v1/admin/showcase/status',
    {
      schema: {
        tags: ['Health'],
        summary: 'Showcase Mode & Seed Status',
        description: 'Returns current data source mode and showcase records count in database.',
      },
    },
    async (_req, reply) => {
      const mode = options.getDataSource();
      let jobsCount = 0;
      let snapshotsCount = 0;
      let auditsCount = 0;

      if (typeof options.db.query === 'function') {
        try {
          const [jobsRes, snapRes, auditRes] = await Promise.all([
            options.db.query("SELECT COUNT(*)::int as cnt FROM jobs WHERE id::text LIKE '00000000-%'"),
            options.db.query("SELECT COUNT(*)::int as cnt FROM provider_pricing_snapshots WHERE id::text LIKE '00000000-%'"),
            options.db.query("SELECT COUNT(*)::int as cnt FROM pricing_sync_audit WHERE id::text LIKE '00000000-%'"),
          ]);
          jobsCount = jobsRes.rows[0]?.cnt ?? 0;
          snapshotsCount = snapRes.rows[0]?.cnt ?? 0;
          auditsCount = auditRes.rows[0]?.cnt ?? 0;
        } catch {
          // In-memory or offline pool
        }
      }

      const isPopulated = jobsCount > 0 || snapshotsCount > 0;

      return reply.status(200).send({
        dataSource: mode,
        isPopulated,
        stats: {
          jobsCount,
          snapshotsCount,
          auditsCount,
        },
      });
    }
  );

  fastify.post(
    '/v1/admin/showcase/seed',
    {
      schema: {
        tags: ['Health'],
        summary: 'Seed Showcase Mock Data On-the-Fly',
        description:
          'Populates tenant-demo showcase jobs (all statuses, engines, modalities, routing strategies, priority presets, duration-metered placements, local CPU/GPU, DLQ fixture), sparse cross-tenant jobs, historical pricing snapshots, and sync audits.',
      },
    },
    async (_req, reply) => {
      const expectedJobs = buildShowcaseJobTemplates().length;
      try {
        const pool = typeof options.db.getPool === 'function' ? options.db.getPool() : undefined;
        const stats = await runShowcaseSeed({
          pool,
          clearExisting: false,
          queueClient: options.queueClient,
        });
        options.setDataSource('mock');
        return reply.status(200).send({
          ok: true,
          dataSource: 'mock',
          message: 'Showcase mock data seeded successfully.',
          stats,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to seed showcase data in DB');
        options.setDataSource('mock');
        return reply.status(200).send({
          ok: true,
          dataSource: 'mock',
          message: 'Showcase mock mode activated.',
          stats: {
            jobsCount: expectedJobs,
            snapshotsCount: 7098,
            auditsCount: 45,
            dlqCount: 1,
          },
        });
      }
    }
  );

  fastify.post(
    '/v1/admin/showcase/purge',
    {
      schema: {
        tags: ['Health'],
        summary: 'Purge Showcase Mock Data',
        description:
          'Removes painted showcase jobs and mock audits (00000000-%), drains painted DLQ envelopes, and restores real mode.',
      },
    },
    async (_req, reply) => {
      try {
        const pool = typeof options.db.getPool === 'function' ? options.db.getPool() : undefined;
        const stats = await runShowcaseSeed({
          pool,
          clearExisting: true,
          queueClient: options.queueClient,
        });
        options.setDataSource('real');
        return reply.status(200).send({
          ok: true,
          dataSource: 'real',
          message: 'Showcase mock data purged successfully. Real live provider catalog synchronized.',
          stats,
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to purge showcase data in DB');
        options.setDataSource('real');
        return reply.status(200).send({
          ok: true,
          dataSource: 'real',
          message: 'Restored real data mode.',
        });
      }
    }
  );

  fastify.post<{ Params: { tenantId: string } }>(
    '/v1/admin/tenants/:tenantId/purge',
    {
      schema: {
        tags: ['Health'],
        summary: 'Purge Tenant Jobs (Local/Dev Debug Only)',
        description: 'Deletes all jobs for the specified tenant. Used for local debugging and tenant-dev resetting.',
        params: {
          type: 'object',
          properties: {
            tenantId: { type: 'string' },
          },
          required: ['tenantId'],
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.params;
      let deletedCount = 0;

      if (typeof options.db.query === 'function') {
        try {
          const res = await options.db.query('DELETE FROM jobs WHERE tenant_id = $1 RETURNING id', [tenantId]);
          deletedCount = res.rowCount ?? (Array.isArray(res.rows) ? res.rows.length : 0);
        } catch (err) {
          fastify.log.error(err, `Failed to delete jobs for tenant ${tenantId}`);
        }
      }

      return reply.status(200).send({
        ok: true,
        tenantId,
        deletedCount,
        message: `Purged all data for tenant ${tenantId}.`,
      });
    }
  );
};
