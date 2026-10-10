import { loadConfig } from './config/env.js';
import { DatabasePool } from './infrastructure/db/pool.js';
import { runMigrations } from './infrastructure/db/migrator.js';
import { PostgresJobRepository } from './infrastructure/db/job-repository.js';
import { S3StorageClient } from './infrastructure/storage/s3-storage.js';
import { SqsQueueClient } from './infrastructure/queue/sqs-queue.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();

  // Initialize DB Pool
  const db = new DatabasePool(config);

  // Run DB Migrations with startup retry
  let retries = 5;
  while (retries > 0) {
    try {
      const applied = await runMigrations(db);
      if (applied.length > 0) {
        console.log(`Successfully applied ${applied.length} migration(s): ${applied.join(', ')}`);
      } else {
        console.log('Database schema is up to date.');
      }
      break;
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error('Failed to run database migrations after retries:', err);
        process.exit(1);
      }
      console.log('Waiting for database to finish starting, retrying in 2s...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Initialize Storage (MinIO / S3)
  const storageClient = new S3StorageClient({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  });

  try {
    await storageClient.ensureBucket();
    console.log(`Ensured object storage bucket '${config.S3_BUCKET}' exists.`);
  } catch (err) {
    console.warn(`Warning: Could not verify storage bucket '${config.S3_BUCKET}':`, err);
  }

  // Initialize Queue (ElasticMQ / SQS)
  const queueClient = new SqsQueueClient({
    queueUrl: config.SQS_QUEUE_URL,
    region: config.SQS_REGION,
    endpoint: config.SQS_ENDPOINT,
  });

  // Initialize Job Repository
  const jobRepo = new PostgresJobRepository(db);

  // Build Fastify App
  const app = buildApp({
    config,
    db,
    jobRepo,
    storageClient,
    queueClient,
  });

  // Graceful Shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, async () => {
      console.log(`Received ${sig}, closing server...`);
      try {
        await app.close();
        await db.close();
        console.log('Server and database pool cleanly closed.');
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    });
  }

  // Start HTTP Server
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Fastify Control Plane running on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
