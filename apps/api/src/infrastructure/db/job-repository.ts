import { randomUUID } from 'node:crypto';
import type { DatabasePool } from './pool.js';
import {
  type Job,
  type JobProgress,
  type JobStatusType,
  type NewJobInput,
  type RoutingPreferenceType,
  JobStatus,
  RoutingPreference,
} from '../../domain/job.js';

export interface UpdateJobOptions {
  status?: JobStatusType;
  expectedCurrentStatuses?: JobStatusType[];
  progress?: JobProgress | null;
  progressPct?: number | null;
  inputPayload?: Record<string, unknown> | null;
  outputPayload?: Record<string, unknown> | null;
  outputUri?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costMicrocents?: number | null;
  retryCount?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
}

export interface JobDeleteMatchFilters {
  tenantId?: string;
  provider?: string;
  status?: JobStatusType | string;
  modelId?: string;
  search?: string;
}

export interface IJobRepository {
  create(input: NewJobInput): Promise<Job>;
  findById(tenantId: string, id: string): Promise<Job | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Job | null>;
  update(tenantId: string, id: string, updates: UpdateJobOptions): Promise<Job | null>;
  list(tenantId: string, options?: { limit?: number; offset?: number; status?: JobStatusType }): Promise<Job[]>;
  expireStaleJobs(options?: { defaultExpirationSeconds?: number }): Promise<Job[]>;
  /**
   * PROCESSING jobs whose worker lease is missing or expired (excludes showcase seed ids).
   * Does not mutate rows — caller decides retry vs fail.
   */
  findOrphanedProcessingJobs(): Promise<Job[]>;
  /** List job ids for a tenant (or all tenants when tenantId is ALL/*). */
  listJobIds(tenantId: string): Promise<string[]>;
  /** Find jobs matching admin purge filters (no pagination cap). */
  findMatching(filters: JobDeleteMatchFilters): Promise<Job[]>;
  /** Hard-delete jobs by id. Returns number of deleted rows. */
  deleteByIds(ids: string[]): Promise<number>;
}

interface JobRow {
  id: string;
  tenant_id: string;
  idempotency_key: string | null;
  request_hash?: string | null;
  correlation_id?: string | null;
  traceparent?: string | null;
  model_id: string;
  routing_preference: string;
  priority: number;
  status: string;
  progress?: JobProgress | null;
  progress_pct?: number | null;
  input_payload: Record<string, unknown> | null;
  input_uri: string | null;
  output_payload: Record<string, unknown> | null;
  output_uri: string | null;
  error_code: string | null;
  error_message: string | null;
  provider: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_microcents: string | number | null;
  retry_count: number;
  max_retries?: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at?: Date | null;
  lease_owner?: string | null;
  lease_expires_at?: Date | null;
  updated_at: Date;
}

function mapRowToJob(row: JobRow): Job {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash ?? null,
    correlationId: row.correlation_id ?? null,
    traceparent: row.traceparent ?? null,
    modelId: row.model_id,
    routingPreference: (row.routing_preference as RoutingPreferenceType) || RoutingPreference.AUTO,
    priority: row.priority,
    status: (row.status as JobStatusType) || JobStatus.QUEUED,
    progress: (row.progress as JobProgress) ?? null,
    progressPct: row.progress_pct !== undefined && row.progress_pct !== null ? Number(row.progress_pct) : null,
    inputPayload: row.input_payload,
    inputUri: row.input_uri,
    outputPayload: row.output_payload,
    outputUri: row.output_uri,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    provider: row.provider,
    durationMs: row.duration_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costMicrocents: row.cost_microcents !== null ? Number(row.cost_microcents) : null,
    retryCount: row.retry_count,
    maxRetries: row.max_retries ?? 3,
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    updatedAt: new Date(row.updated_at),
  };
}

export class PostgresJobRepository implements IJobRepository {
  constructor(private db: DatabasePool) {}

  async create(input: NewJobInput): Promise<Job> {
    const id = randomUUID();
    const routingPreference = input.routingPreference ?? RoutingPreference.AUTO;
    const priority = input.priority ?? 5;
    const idempotencyKey = input.idempotencyKey ?? null;
    const requestHash = input.requestHash ?? null;
    const correlationId = input.correlationId ?? null;
    const traceparent = input.traceparent ?? null;
    const inputPayload = input.inputPayload ? JSON.stringify(input.inputPayload) : null;
    const inputUri = input.inputUri ?? null;
    const maxRetries = input.maxRetries ?? 3;
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : input.expiresInSeconds
          ? new Date(Date.now() + input.expiresInSeconds * 1000)
          : null;

    const query = `
      INSERT INTO jobs (
        id, tenant_id, idempotency_key, request_hash, correlation_id, traceparent,
        model_id, routing_preference, priority, status, input_payload, input_uri, max_retries, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;

    const res = await this.db.query<JobRow>(query, [
      id,
      input.tenantId,
      idempotencyKey,
      requestHash,
      correlationId,
      traceparent,
      input.modelId,
      routingPreference,
      priority,
      JobStatus.QUEUED,
      inputPayload,
      inputUri,
      maxRetries,
      expiresAt,
    ]);

    return mapRowToJob(res.rows[0]);
  }

  async findById(tenantId: string, id: string): Promise<Job | null> {
    const res = await this.db.query<JobRow>(
      'SELECT * FROM jobs WHERE tenant_id = $1 AND id = $2;',
      [tenantId, id]
    );
    if (res.rows.length === 0) return null;
    return mapRowToJob(res.rows[0]);
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Job | null> {
    const res = await this.db.query<JobRow>(
      'SELECT * FROM jobs WHERE tenant_id = $1 AND idempotency_key = $2;',
      [tenantId, idempotencyKey]
    );
    if (res.rows.length === 0) return null;
    return mapRowToJob(res.rows[0]);
  }

  async update(tenantId: string, id: string, updates: UpdateJobOptions): Promise<Job | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [tenantId, id];
    let paramIndex = 3;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.progress !== undefined) {
      setClauses.push(`progress = $${paramIndex++}`);
      values.push(updates.progress ? JSON.stringify(updates.progress) : null);
    }
    if (updates.progressPct !== undefined) {
      setClauses.push(`progress_pct = $${paramIndex++}`);
      values.push(updates.progressPct);
    }
    if (updates.inputPayload !== undefined) {
      setClauses.push(`input_payload = $${paramIndex++}`);
      values.push(updates.inputPayload ? JSON.stringify(updates.inputPayload) : null);
    }
    if (updates.outputPayload !== undefined) {
      setClauses.push(`output_payload = $${paramIndex++}`);
      values.push(updates.outputPayload ? JSON.stringify(updates.outputPayload) : null);
    }
    if (updates.outputUri !== undefined) {
      setClauses.push(`output_uri = $${paramIndex++}`);
      values.push(updates.outputUri);
    }
    if (updates.errorCode !== undefined) {
      setClauses.push(`error_code = $${paramIndex++}`);
      values.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramIndex++}`);
      values.push(updates.errorMessage);
    }
    if (updates.provider !== undefined) {
      setClauses.push(`provider = $${paramIndex++}`);
      values.push(updates.provider);
    }
    if (updates.durationMs !== undefined) {
      setClauses.push(`duration_ms = $${paramIndex++}`);
      values.push(updates.durationMs);
    }
    if (updates.tokensIn !== undefined) {
      setClauses.push(`tokens_in = $${paramIndex++}`);
      values.push(updates.tokensIn);
    }
    if (updates.tokensOut !== undefined) {
      setClauses.push(`tokens_out = $${paramIndex++}`);
      values.push(updates.tokensOut);
    }
    if (updates.costMicrocents !== undefined) {
      setClauses.push(`cost_microcents = $${paramIndex++}`);
      values.push(updates.costMicrocents);
    }
    if (updates.retryCount !== undefined) {
      setClauses.push(`retry_count = $${paramIndex++}`);
      values.push(updates.retryCount);
    }
    if (updates.startedAt !== undefined) {
      setClauses.push(`started_at = $${paramIndex++}`);
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }
    if (updates.expiresAt !== undefined) {
      setClauses.push(`expires_at = $${paramIndex++}`);
      values.push(updates.expiresAt);
    }
    if (updates.leaseOwner !== undefined) {
      setClauses.push(`lease_owner = $${paramIndex++}`);
      values.push(updates.leaseOwner);
    }
    if (updates.leaseExpiresAt !== undefined) {
      setClauses.push(`lease_expires_at = $${paramIndex++}`);
      values.push(updates.leaseExpiresAt);
    }

    let whereClause = 'WHERE tenant_id = $1 AND id = $2';
    if (updates.expectedCurrentStatuses && updates.expectedCurrentStatuses.length > 0) {
      whereClause += ` AND status = ANY($${paramIndex++})`;
      values.push(updates.expectedCurrentStatuses);
    }

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      ${whereClause}
      RETURNING *;
    `;

    const res = await this.db.query<JobRow>(sql, values);
    if (res.rows.length === 0) return null;
    return mapRowToJob(res.rows[0]);
  }

  async expireStaleJobs(options: { defaultExpirationSeconds?: number } = {}): Promise<Job[]> {
    const defaultExpSec = options.defaultExpirationSeconds ?? 86400;
    const sql = `
      UPDATE jobs
      SET
        status = 'FAILED',
        error_code = CASE
          WHEN retry_count >= max_retries AND max_retries > 0 THEN 'MAX_RETRIES_EXCEEDED'
          ELSE 'JOB_EXPIRED'
        END,
        error_message = CASE
          WHEN retry_count >= max_retries AND max_retries > 0 THEN 'Job failed: maximum retry attempts exhausted'
          ELSE 'Job expired: exceeded queue expiration timeout'
        END,
        completed_at = NOW(),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = NOW()
      WHERE status IN ('QUEUED', 'PROCESSING', 'RETRYING')
        AND (
          (expires_at IS NOT NULL AND expires_at <= NOW())
          OR (expires_at IS NULL AND created_at < NOW() - ($1 || ' seconds')::INTERVAL)
          OR (retry_count >= max_retries AND max_retries > 0)
        )
      RETURNING *;
    `;
    const res = await this.db.query<JobRow>(sql, [defaultExpSec]);
    return res.rows.map(mapRowToJob);
  }

  async findOrphanedProcessingJobs(): Promise<Job[]> {
    const sql = `
      SELECT *
      FROM jobs
      WHERE status = 'PROCESSING'
        AND id::text NOT LIKE '00000000-0000-4000-a000-%'
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
      ORDER BY started_at ASC NULLS FIRST, created_at ASC
    `;
    const res = await this.db.query<JobRow>(sql);
    return res.rows.map(mapRowToJob);
  }

  async list(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: JobStatusType } = {}
  ): Promise<Job[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    let sql = isAllTenants ? 'SELECT * FROM jobs WHERE 1=1' : 'SELECT * FROM jobs WHERE tenant_id = $1';
    const params: unknown[] = isAllTenants ? [] : [tenantId];

    if (options.status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(options.status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await this.db.query<JobRow>(sql, params);
    return res.rows.map(mapRowToJob);
  }

  async listJobIds(tenantId: string): Promise<string[]> {
    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    const sql = isAllTenants ? 'SELECT id FROM jobs' : 'SELECT id FROM jobs WHERE tenant_id = $1';
    const res = await this.db.query<{ id: string }>(sql, isAllTenants ? [] : [tenantId]);
    return res.rows.map((r) => r.id);
  }

  async findMatching(filters: JobDeleteMatchFilters): Promise<Job[]> {
    const isAllTenants =
      !filters.tenantId ||
      filters.tenantId === 'ALL' ||
      filters.tenantId === 'all' ||
      filters.tenantId === '*';
    let sql = isAllTenants ? 'SELECT * FROM jobs WHERE 1=1' : 'SELECT * FROM jobs WHERE tenant_id = $1';
    const params: unknown[] = isAllTenants ? [] : [filters.tenantId];

    if (filters.status && filters.status !== 'ALL') {
      if (filters.status === 'IN_FLIGHT') {
        sql += ` AND status = ANY($${params.length + 1}::text[])`;
        params.push(['PROCESSING', 'RETRYING']);
      } else if (filters.status === 'QUEUED') {
        sql += ` AND status = ANY($${params.length + 1}::text[])`;
        params.push(['QUEUED', 'SUBMITTED']);
      } else {
        sql += ` AND status = $${params.length + 1}`;
        params.push(filters.status);
      }
    }
    if (filters.provider && filters.provider !== 'ALL') {
      sql += ` AND lower(coalesce(provider, '')) = lower($${params.length + 1})`;
      params.push(filters.provider);
    }
    if (filters.modelId && filters.modelId !== 'ALL') {
      sql += ` AND model_id = $${params.length + 1}`;
      params.push(filters.modelId);
    }
    if (filters.search?.trim()) {
      const q = `%${filters.search.trim().toLowerCase()}%`;
      sql += ` AND (
        lower(id::text) LIKE $${params.length + 1}
        OR lower(model_id) LIKE $${params.length + 1}
        OR lower(coalesce(provider, '')) LIKE $${params.length + 1}
        OR lower(tenant_id) LIKE $${params.length + 1}
      )`;
      params.push(q);
    }

    sql += ' ORDER BY created_at DESC';
    const res = await this.db.query<JobRow>(sql, params);
    return res.rows.map(mapRowToJob);
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.db.query('DELETE FROM jobs WHERE id = ANY($1::uuid[]) RETURNING id', [ids]);
    return res.rowCount ?? (Array.isArray(res.rows) ? res.rows.length : 0);
  }
}

export class InMemoryJobRepository implements IJobRepository {
  private jobs = new Map<string, Job>();

  async create(input: NewJobInput): Promise<Job> {
    const now = new Date();
    const expiresAt =
      input.expiresAt !== undefined
        ? input.expiresAt
        : input.expiresInSeconds
          ? new Date(now.getTime() + input.expiresInSeconds * 1000)
          : null;

    const job: Job = {
      id: randomUUID(),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey ?? null,
      requestHash: input.requestHash ?? null,
      correlationId: input.correlationId ?? null,
      traceparent: input.traceparent ?? null,
      modelId: input.modelId,
      routingPreference: input.routingPreference ?? RoutingPreference.AUTO,
      priority: input.priority ?? 5,
      status: JobStatus.QUEUED,
      progress: null,
      progressPct: 0,
      inputPayload: input.inputPayload ?? null,
      inputUri: input.inputUri ?? null,
      outputPayload: null,
      outputUri: null,
      errorCode: null,
      errorMessage: null,
      provider: null,
      durationMs: null,
      tokensIn: null,
      tokensOut: null,
      costMicrocents: null,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async findById(tenantId: string, id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.tenantId !== tenantId) return null;
    return { ...job };
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Job | null> {
    for (const job of this.jobs.values()) {
      if (job.tenantId === tenantId && job.idempotencyKey === idempotencyKey) {
        return { ...job };
      }
    }
    return null;
  }

  async update(tenantId: string, id: string, updates: UpdateJobOptions): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job || job.tenantId !== tenantId) return null;

    if (
      updates.expectedCurrentStatuses &&
      updates.expectedCurrentStatuses.length > 0 &&
      !updates.expectedCurrentStatuses.includes(job.status)
    ) {
      return null;
    }

    if (updates.status !== undefined) job.status = updates.status;
    if (updates.progress !== undefined) job.progress = updates.progress;
    if (updates.progressPct !== undefined) job.progressPct = updates.progressPct;
    if (updates.inputPayload !== undefined) job.inputPayload = updates.inputPayload;
    if (updates.outputPayload !== undefined) job.outputPayload = updates.outputPayload;
    if (updates.outputUri !== undefined) job.outputUri = updates.outputUri;
    if (updates.errorCode !== undefined) job.errorCode = updates.errorCode;
    if (updates.errorMessage !== undefined) job.errorMessage = updates.errorMessage;
    if (updates.provider !== undefined) job.provider = updates.provider;
    if (updates.durationMs !== undefined) job.durationMs = updates.durationMs;
    if (updates.tokensIn !== undefined) job.tokensIn = updates.tokensIn;
    if (updates.tokensOut !== undefined) job.tokensOut = updates.tokensOut;
    if (updates.costMicrocents !== undefined) job.costMicrocents = updates.costMicrocents;
    if (updates.retryCount !== undefined) job.retryCount = updates.retryCount;
    if (updates.startedAt !== undefined) job.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) job.completedAt = updates.completedAt;
    if (updates.expiresAt !== undefined) job.expiresAt = updates.expiresAt;
    if (updates.leaseOwner !== undefined) job.leaseOwner = updates.leaseOwner;
    if (updates.leaseExpiresAt !== undefined) job.leaseExpiresAt = updates.leaseExpiresAt;
    job.updatedAt = new Date();

    this.jobs.set(id, job);
    return { ...job };
  }

  async expireStaleJobs(options: { defaultExpirationSeconds?: number } = {}): Promise<Job[]> {
    const now = new Date();
    const defaultExpMs = (options.defaultExpirationSeconds ?? 86400) * 1000;
    const reaped: Job[] = [];

    for (const job of this.jobs.values()) {
      if (
        job.status === JobStatus.QUEUED ||
        job.status === JobStatus.PROCESSING ||
        job.status === JobStatus.RETRYING
      ) {
        const isExpiredByDate = job.expiresAt
          ? job.expiresAt <= now
          : now.getTime() - job.createdAt.getTime() >= defaultExpMs;
        const isRetriesExceeded = job.maxRetries > 0 && job.retryCount >= job.maxRetries;

        if (isExpiredByDate || isRetriesExceeded) {
          const errorCode = isRetriesExceeded ? 'MAX_RETRIES_EXCEEDED' : 'JOB_EXPIRED';
          const errorMessage = isRetriesExceeded
            ? `Job failed: maximum retry attempts (${job.maxRetries}) exhausted`
            : 'Job expired: exceeded queue expiration timeout';

          job.status = JobStatus.FAILED;
          job.errorCode = errorCode;
          job.errorMessage = errorMessage;
          job.completedAt = now;
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          job.updatedAt = now;
          job.progress = {
            phase: 'failed',
            percent: job.progressPct ?? 0,
            message: errorMessage,
          };
          reaped.push({ ...job });
        }
      }
    }
    return reaped;
  }

  async findOrphanedProcessingJobs(): Promise<Job[]> {
    const now = new Date();
    return Array.from(this.jobs.values())
      .filter((job) => {
        if (job.status !== JobStatus.PROCESSING) return false;
        if (job.id.startsWith('00000000-0000-4000-a000-')) return false;
        if (!job.leaseExpiresAt) return true;
        return job.leaseExpiresAt.getTime() < now.getTime();
      })
      .sort((a, b) => {
        const as = a.startedAt?.getTime() ?? a.createdAt.getTime();
        const bs = b.startedAt?.getTime() ?? b.createdAt.getTime();
        return as - bs;
      })
      .map((j) => ({ ...j }));
  }

  async list(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: JobStatusType } = {}
  ): Promise<Job[]> {
    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    const list = Array.from(this.jobs.values())
      .filter((j) => (isAllTenants || j.tenantId === tenantId) && (!options.status || j.status === options.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    return list.slice(offset, offset + limit).map((j) => ({ ...j }));
  }

  async listJobIds(tenantId: string): Promise<string[]> {
    const isAllTenants = tenantId === 'ALL' || tenantId === 'all' || tenantId === '*';
    return Array.from(this.jobs.values())
      .filter((j) => isAllTenants || j.tenantId === tenantId)
      .map((j) => j.id);
  }

  async findMatching(filters: JobDeleteMatchFilters): Promise<Job[]> {
    const isAllTenants =
      !filters.tenantId ||
      filters.tenantId === 'ALL' ||
      filters.tenantId === 'all' ||
      filters.tenantId === '*';
    const search = filters.search?.trim().toLowerCase() ?? '';
    const providerWanted = filters.provider && filters.provider !== 'ALL' ? filters.provider.toLowerCase() : null;
    const modelWanted = filters.modelId && filters.modelId !== 'ALL' ? filters.modelId : null;
    const statusWanted = filters.status && filters.status !== 'ALL' ? filters.status : null;

    return Array.from(this.jobs.values())
      .filter((j) => {
        if (!isAllTenants && j.tenantId !== filters.tenantId) return false;
        if (statusWanted === 'IN_FLIGHT') {
          if (!['PROCESSING', 'RETRYING'].includes(j.status)) return false;
        } else if (statusWanted === 'QUEUED') {
          if (!['QUEUED', 'SUBMITTED'].includes(j.status)) return false;
        } else if (statusWanted && j.status !== statusWanted) {
          return false;
        }
        if (providerWanted && (j.provider ?? '').toLowerCase() !== providerWanted) return false;
        if (modelWanted && j.modelId !== modelWanted) return false;
        if (search) {
          const hay = `${j.id} ${j.modelId} ${j.provider ?? ''} ${j.tenantId}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((j) => ({ ...j }));
  }

  async deleteByIds(ids: string[]): Promise<number> {
    let deleted = 0;
    for (const id of ids) {
      if (this.jobs.delete(id)) deleted += 1;
    }
    return deleted;
  }

  clear(): void {
    this.jobs.clear();
  }
}


