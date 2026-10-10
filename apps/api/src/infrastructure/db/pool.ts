import pg from 'pg';
import type { EnvConfig } from '../../config/env.js';

const { Pool } = pg;

export class DatabasePool {
  private pool: pg.Pool;

  constructor(config: EnvConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      min: config.DATABASE_POOL_MIN,
      max: config.DATABASE_POOL_MAX,
    });
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as healthy');
      return res.rows.length === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

