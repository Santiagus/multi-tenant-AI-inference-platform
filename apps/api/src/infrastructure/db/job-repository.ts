import { randomUUID } from 'node:crypto';
import type { DatabasePool } from './pool.js';
import {
  type Job,
  type JobStatusType,
  type NewJobInput,
  type RoutingPreferenceType,
  JobStatus,
  RoutingPreference,
} from '../../domain/job.js';

export interface UpdateJobOptions {
  status?: JobStatusType;
  outputPayload?: Record<string, unknown> | null;
  outputUri?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  provider?: string | null;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costMicrocents?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface IJobRepository {
  create(input: NewJobInput): Promise<Job>;
  findById(tenantId: string, id: string): Promise<Job | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Job | null>;
  update(tenantId: string, id: string, updates: UpdateJobOptions): Promise<Job | null>;
  list(tenantId: string, options?: { limit?: number; offset?: number; status?: JobStatusType }): Promise<Job[]>;
}

interface JobRow {
  id: string;
  tenant_id: string;
  idempotency_key: string | null;
  model_id: string;
  routing_preference: string;
  priority: number;
  status: string;
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
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

function mapRowToJob(row: JobRow): Job {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    idempotencyKey: row.idempotency_key,
    modelId: row.model_id,
    routingPreference: (row.routing_preference as RoutingPreferenceType) || RoutingPreference.AUTO,
    priority: row.priority,
    status: (row.status as JobStatusType) || JobStatus.QUEUED,
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
    createdAt: new Date(row.created_at),
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
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
    const inputPayload = input.inputPayload ? JSON.stringify(input.inputPayload) : null;
    const inputUri = input.inputUri ?? null;

    const query = `
      INSERT INTO jobs (
        id, tenant_id, idempotency_key, model_id, routing_preference,
        priority, status, input_payload, input_uri
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const res = await this.db.query<JobRow>(query, [
      id,
      input.tenantId,
      idempotencyKey,
      input.modelId,
      routingPreference,
      priority,
      JobStatus.QUEUED,
      inputPayload,
      inputUri,
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
    if (updates.startedAt !== undefined) {
      setClauses.push(`started_at = $${paramIndex++}`);
      values.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push(`completed_at = $${paramIndex++}`);
      values.push(updates.completedAt);
    }

    const sql = `
      UPDATE jobs
      SET ${setClauses.join(', ')}
      WHERE tenant_id = $1 AND id = $2
      RETURNING *;
    `;

    const res = await this.db.query<JobRow>(sql, values);
    if (res.rows.length === 0) return null;
    return mapRowToJob(res.rows[0]);
  }

  async list(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: JobStatusType } = {}
  ): Promise<Job[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    let sql = 'SELECT * FROM jobs WHERE tenant_id = $1';
    const params: unknown[] = [tenantId];

    if (options.status) {
      sql += ' AND status = $2';
      params.push(options.status);
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const res = await this.db.query<JobRow>(sql, params);
    return res.rows.map(mapRowToJob);
  }
}

export class InMemoryJobRepository implements IJobRepository {
  private jobs = new Map<string, Job>();

  async create(input: NewJobInput): Promise<Job> {
    const now = new Date();
    const job: Job = {
      id: randomUUID(),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey ?? null,
      modelId: input.modelId,
      routingPreference: input.routingPreference ?? RoutingPreference.AUTO,
      priority: input.priority ?? 5,
      status: JobStatus.QUEUED,
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
      createdAt: now,
      startedAt: null,
      completedAt: null,
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

    if (updates.status !== undefined) job.status = updates.status;
    if (updates.outputPayload !== undefined) job.outputPayload = updates.outputPayload;
    if (updates.outputUri !== undefined) job.outputUri = updates.outputUri;
    if (updates.errorCode !== undefined) job.errorCode = updates.errorCode;
    if (updates.errorMessage !== undefined) job.errorMessage = updates.errorMessage;
    if (updates.provider !== undefined) job.provider = updates.provider;
    if (updates.durationMs !== undefined) job.durationMs = updates.durationMs;
    if (updates.tokensIn !== undefined) job.tokensIn = updates.tokensIn;
    if (updates.tokensOut !== undefined) job.tokensOut = updates.tokensOut;
    if (updates.costMicrocents !== undefined) job.costMicrocents = updates.costMicrocents;
    if (updates.startedAt !== undefined) job.startedAt = updates.startedAt;
    if (updates.completedAt !== undefined) job.completedAt = updates.completedAt;
    job.updatedAt = new Date();

    this.jobs.set(id, job);
    return { ...job };
  }

  async list(
    tenantId: string,
    options: { limit?: number; offset?: number; status?: JobStatusType } = {}
  ): Promise<Job[]> {
    const list = Array.from(this.jobs.values())
      .filter((j) => j.tenantId === tenantId && (!options.status || j.status === options.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    return list.slice(offset, offset + limit).map((j) => ({ ...j }));
  }

  clear(): void {
    this.jobs.clear();
  }
}

