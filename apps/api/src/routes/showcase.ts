import type { FastifyPluginAsync } from 'fastify';
import { runShowcaseSeed } from '../infrastructure/db/seeds/showcase-seed.js';
import { buildShowcaseJobTemplates } from '../infrastructure/db/seeds/showcase-coverage.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import type { IJobRepository } from '../infrastructure/db/job-repository.js';
import {
  deleteJobArtifactPrefixes,
  findOrphanOutputPrefixes,
  purgeOrphanOutputPrefixes,
} from '../application/artifact-hygiene.js';
import { ValidationError } from '../domain/errors.js';

export interface ShowcaseRoutesOptions {
  db: {
    isHealthy: () => Promise<boolean>;
    getPool?: () => any;
    query?: (text: string, params?: unknown[]) => Promise<any>;
  };
  getDataSource: () => 'real' | 'mock';
  setDataSource: (mode: 'real' | 'mock') => void;
  queueClient?: IQueueClient;
  storageClient?: IStorageClient;
  jobRepo?: IJobRepository;
}

function hasScopedFilter(body: {
  tenant_id?: string;
  provider?: string;
  status?: string;
  model_id?: string;
  search?: string;
}): boolean {
  const concreteTenant =
    body.tenant_id && body.tenant_id !== 'ALL' && body.tenant_id !== 'all' && body.tenant_id !== '*';
  return Boolean(
    concreteTenant ||
      (body.provider && body.provider !== 'ALL') ||
      (body.status && body.status !== 'ALL') ||
      (body.model_id && body.model_id !== 'ALL') ||
      body.search?.trim()
  );
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
        description:
          'Deletes all jobs for the specified tenant and cascades S3 output prefixes under tenants/{tenantId}/outputs/.',
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
      if (tenantId === 'ALL' || tenantId === 'all' || tenantId === '*') {
        throw new ValidationError('Purge requires a concrete tenant id (not ALL).');
      }

      let deletedCount = 0;
      let deletedObjects = 0;
      const jobs = options.jobRepo ? await options.jobRepo.findMatching({ tenantId }) : [];

      if (options.jobRepo) {
        deletedCount = await options.jobRepo.deleteByIds(jobs.map((j) => j.id));
      } else if (typeof options.db.query === 'function') {
        try {
          const res = await options.db.query('DELETE FROM jobs WHERE tenant_id = $1 RETURNING id', [tenantId]);
          deletedCount = res.rowCount ?? (Array.isArray(res.rows) ? res.rows.length : 0);
        } catch (err) {
          fastify.log.error(err, `Failed to delete jobs for tenant ${tenantId}`);
        }
      }

      if (options.storageClient) {
        if (jobs.length > 0) {
          deletedObjects += await deleteJobArtifactPrefixes(options.storageClient, jobs);
        }
        // Clear any remaining output folders for the tenant (orphans included).
        deletedObjects += await options.storageClient.deleteByPrefix(`tenants/${tenantId}/outputs/`);
      }

      return reply.status(200).send({
        ok: true,
        tenantId,
        deletedCount,
        deletedObjects,
        message: `Purged all data for tenant ${tenantId}.`,
      });
    }
  );

  fastify.post<{
    Body: {
      tenant_id?: string;
      provider?: string;
      status?: string;
      model_id?: string;
      search?: string;
      job_ids?: string[];
      confirm_cross_tenant?: boolean;
    };
  }>(
    '/v1/admin/jobs/delete-matching',
    {
      schema: {
        tags: ['Health'],
        summary: 'Delete Jobs Matching Filters (Local/Dev)',
        description:
          'Hard-deletes jobs matching tenant/provider/status/model/search filters (or an explicit job_ids list from the dashboard filtered view) and cascades related S3 output prefixes. Requires at least one concrete filter, job_ids, or confirm_cross_tenant for ALL.',
        body: {
          type: 'object',
          properties: {
            tenant_id: { type: 'string' },
            provider: { type: 'string' },
            status: { type: 'string' },
            model_id: { type: 'string' },
            search: { type: 'string' },
            job_ids: { type: 'array', items: { type: 'string' } },
            confirm_cross_tenant: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!options.jobRepo) {
        throw new ValidationError('Job repository unavailable for delete-matching.');
      }
      const body = req.body ?? {};
      const explicitIds = Array.isArray(body.job_ids)
        ? body.job_ids.filter((id) => typeof id === 'string' && id.length > 0)
        : [];
      const scoped = hasScopedFilter(body) || explicitIds.length > 0;
      if (!scoped && !body.confirm_cross_tenant) {
        throw new ValidationError(
          'Refusing unscoped delete. Pass a concrete tenant_id / provider / status / model_id / search / job_ids, or confirm_cross_tenant=true.'
        );
      }

      let matches =
        explicitIds.length > 0
          ? (await options.jobRepo.findMatching({ tenantId: body.tenant_id ?? 'ALL' })).filter((j) =>
              explicitIds.includes(j.id)
            )
          : await options.jobRepo.findMatching({
              tenantId: body.tenant_id,
              provider: body.provider,
              status: body.status,
              modelId: body.model_id,
              search: body.search,
            });

      // When job_ids are provided with a concrete tenant, enforce tenant boundary.
      if (
        explicitIds.length > 0 &&
        body.tenant_id &&
        body.tenant_id !== 'ALL' &&
        body.tenant_id !== 'all' &&
        body.tenant_id !== '*'
      ) {
        matches = matches.filter((j) => j.tenantId === body.tenant_id);
      }

      const deletedJobs = await options.jobRepo.deleteByIds(matches.map((j) => j.id));
      let deletedObjects = 0;
      if (options.storageClient && matches.length > 0) {
        deletedObjects = await deleteJobArtifactPrefixes(options.storageClient, matches);
      }

      return reply.status(200).send({
        ok: true,
        deleted_jobs: deletedJobs,
        deleted_objects: deletedObjects,
        filters: {
          tenant_id: body.tenant_id ?? null,
          provider: body.provider ?? null,
          status: body.status ?? null,
          model_id: body.model_id ?? null,
          search: body.search ?? null,
          job_ids_count: explicitIds.length > 0 ? String(explicitIds.length) : null,
        },
        message: `Deleted ${deletedJobs} job(s) and ${deletedObjects} artifact object(s).`,
      });
    }
  );

  fastify.get<{ Params: { tenantId: string } }>(
    '/v1/admin/tenants/:tenantId/artifacts/orphans',
    {
      schema: {
        tags: ['Health'],
        summary: 'List Orphan Artifact Prefixes (Local/Dev)',
        description:
          'Lists tenants/{tenantId}/outputs/{jobId}/ prefixes whose job id is not present in the jobs table.',
        params: {
          type: 'object',
          properties: { tenantId: { type: 'string' } },
          required: ['tenantId'],
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.params;
      if (tenantId === 'ALL' || tenantId === 'all' || tenantId === '*') {
        throw new ValidationError('Orphan scan requires a concrete tenant id (not ALL).');
      }
      if (!options.storageClient) {
        return reply.status(200).send({ ok: true, tenantId, orphans: [], count: 0 });
      }

      const knownIds = options.jobRepo ? await options.jobRepo.listJobIds(tenantId) : [];
      const orphans = await findOrphanOutputPrefixes(options.storageClient, tenantId, knownIds);
      return reply.status(200).send({
        ok: true,
        tenantId,
        orphans,
        count: orphans.length,
      });
    }
  );

  fastify.post<{ Params: { tenantId: string } }>(
    '/v1/admin/tenants/:tenantId/artifacts/orphans/purge',
    {
      schema: {
        tags: ['Health'],
        summary: 'Purge Orphan Artifact Prefixes (Local/Dev)',
        description: 'Deletes S3 output prefixes that no longer have a matching job row.',
        params: {
          type: 'object',
          properties: { tenantId: { type: 'string' } },
          required: ['tenantId'],
        },
      },
    },
    async (req, reply) => {
      const { tenantId } = req.params;
      if (tenantId === 'ALL' || tenantId === 'all' || tenantId === '*') {
        throw new ValidationError('Orphan purge requires a concrete tenant id (not ALL).');
      }
      if (!options.storageClient) {
        return reply.status(200).send({ ok: true, tenantId, deleted_objects: 0, purged_prefixes: 0 });
      }

      const knownIds = options.jobRepo ? await options.jobRepo.listJobIds(tenantId) : [];
      const orphans = await findOrphanOutputPrefixes(options.storageClient, tenantId, knownIds);
      const deletedObjects = await purgeOrphanOutputPrefixes(options.storageClient, orphans);
      return reply.status(200).send({
        ok: true,
        tenantId,
        purged_prefixes: orphans.length,
        deleted_objects: deletedObjects,
        orphans,
        message: `Purged ${orphans.length} orphan prefix(es), ${deletedObjects} object(s).`,
      });
    }
  );
};
