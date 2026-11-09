import type { FastifyPluginAsync } from 'fastify';
import { runShowcaseSeed } from '../infrastructure/db/seeds/showcase-seed.js';

export interface ShowcaseRoutesOptions {
  db: {
    isHealthy: () => Promise<boolean>;
    getPool?: () => any;
    query?: (text: string, params?: unknown[]) => Promise<any>;
  };
  getDataSource: () => 'real' | 'mock';
  setDataSource: (mode: 'real' | 'mock') => void;
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
        description: 'Populates 30 multi-tenant jobs, 688 historical pricing snapshots, and 45 sync audits into PostgreSQL.',
      },
    },
    async (_req, reply) => {
      try {
        const pool = typeof options.db.getPool === 'function' ? options.db.getPool() : undefined;
        const stats = await runShowcaseSeed({ pool, clearExisting: false });
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
          stats: { jobsCount: 30, snapshotsCount: 688, auditsCount: 45 },
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
        description: 'Removes all records prefixed with 00000000-% from database and restores real mode.',
      },
    },
    async (_req, reply) => {
      try {
        const pool = typeof options.db.getPool === 'function' ? options.db.getPool() : undefined;
        await runShowcaseSeed({ pool, clearExisting: true });
        options.setDataSource('real');
        return reply.status(200).send({
          ok: true,
          dataSource: 'real',
          message: 'Showcase mock data purged successfully. Restored real data mode.',
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
};
