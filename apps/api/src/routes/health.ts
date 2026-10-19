import type { FastifyPluginAsync } from 'fastify';
import type { DatabasePool } from '../infrastructure/db/pool.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';

export interface HealthRouteOptions {
  db: { isHealthy: () => Promise<boolean> };
  storage: IStorageClient;
  queue: IQueueClient;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  fastify.get(
    '/healthz',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness Probe',
        description: 'Returns HTTP 200 if the Fastify API process is running and able to accept incoming connections.',
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    }
  );

  fastify.get(
    '/readyz',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness Probe',
        description: 'Verifies active connectivity to backing dependencies: PostgreSQL, MinIO (S3), and ElasticMQ (SQS).',
      },
    },
    async (_req, reply) => {
      const [dbOk, storageOk, queueOk] = await Promise.all([
        options.db.isHealthy(),
        options.storage.isHealthy(),
        options.queue.isHealthy(),
      ]);

      const isReady = dbOk && storageOk && queueOk;
      const statusCode = isReady ? 200 : 503;

      return reply.status(statusCode).send({
        status: isReady ? 'ready' : 'unhealthy',
        timestamp: new Date().toISOString(),
        components: {
          database: dbOk ? 'healthy' : 'unhealthy',
          storage: storageOk ? 'healthy' : 'unhealthy',
          queue: queueOk ? 'healthy' : 'unhealthy',
        },
      });
    }
  );
};

