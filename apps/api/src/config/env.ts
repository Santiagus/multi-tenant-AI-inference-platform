import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // PostgreSQL
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/platform'),
  DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // S3 / MinIO
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('platform-artifacts'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),

  // SQS / ElasticMQ
  SQS_ENDPOINT: z.string().optional(),
  SQS_REGION: z.string().default('us-east-1'),
  SQS_QUEUE_URL: z.string().default('http://localhost:9324/000000000000/inference-jobs'),

  // Tenancy & Auth Defaults
  DEFAULT_TENANT_ID: z.string().default('tenant-default'),
  API_KEY: z.string().default('dev-secret-key'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadConfig(overrides: Partial<Record<string, unknown>> = {}): EnvConfig {
  const merged = {
    ...process.env,
    ...overrides,
  };
  return EnvSchema.parse(merged);
}

