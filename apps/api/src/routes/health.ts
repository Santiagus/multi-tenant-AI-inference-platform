import type { FastifyPluginAsync } from 'fastify';
import type { DatabasePool } from '../infrastructure/db/pool.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';

export interface HealthRouteOptions {
  db: { isHealthy: () => Promise<boolean> };
  storage: IStorageClient;
  queue: IQueueClient;
  dataSource?: 'real' | 'mock';
  getDataSource?: () => 'real' | 'mock';
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, options) => {
  const getDataSource = (): 'real' | 'mock' => {
    if (options.getDataSource) return options.getDataSource();
    if (options.dataSource) return options.dataSource;
    if (process.env.SHOWCASE_MODE === 'true' || process.env.SHOWCASE_MODE === '1' || process.env.MOCK_PROVIDERS === '1') {
      return 'mock';
    }
    return 'real';
  };

  fastify.get(
    '/healthz',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness Probe',
        description: 'Returns HTTP 200 if the Fastify API process is running and indicates whether the platform is serving real or mock/showcase data.',
      },
    },
    async (_req, reply) => {
      const dataSource = getDataSource();
      return reply.status(200).send({
        status: 'ok',
        dataSource,
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
      const dataSource = getDataSource();

      return reply.status(statusCode).send({
        status: isReady ? 'ready' : 'unhealthy',
        dataSource,
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

