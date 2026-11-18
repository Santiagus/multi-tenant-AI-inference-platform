import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  cancelModelCacheEnsure,
  getModelDownloadStatus,
  listModelCache,
  listModelDownloadStatuses,
  startModelCacheEnsure,
} from '../application/model-cache.js';

const ListQuerySchema = z.object({
  models: z.string().optional(),
});

const EnsureBodySchema = z.object({
  model_id: z.string().min(1),
});

const CancelBodySchema = z.object({
  model_id: z.string().min(1),
});

/** Default catalog ids mirrored from the dashboard POPULAR_MODELS list. */
export const DEFAULT_CACHE_CATALOG_MODELS = [
  'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
  'Qwen/Qwen2.5-7B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.2',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
  'anthropic/claude-3-haiku',
  'stabilityai/sd-turbo',
  'black-forest-labs/FLUX.1-schnell',
  'openai/clip-vit-large-patch14',
  'openai/whisper-tiny',
  'openai/whisper-large-v3',
  'Lightricks/LTX-Video',
  'Wan-AI/Wan2.1-T2V-1.3B',
];

export const modelCacheRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/v1/models/cache',
    {
      schema: {
        tags: ['Models'],
        summary: 'List local Hugging Face cache status for catalog models',
        description:
          'Reports which popular/open-weight models are already present under HF_HOME / ~/.cache/huggingface.',
      },
    },
    async (req, reply) => {
      const parsed = ListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query. Optional models=id1,id2' });
      }
      const fromQuery = parsed.data.models
        ? parsed.data.models.split(',').map((m) => m.trim()).filter(Boolean)
        : [];
      const modelIds = fromQuery.length > 0 ? fromQuery : DEFAULT_CACHE_CATALOG_MODELS;
      try {
        const result = await listModelCache(modelIds);
        return reply.status(200).send(result);
      } catch (err: any) {
        return reply.status(500).send({
          error: err?.message || 'Failed to scan local model cache',
        });
      }
    }
  );

  fastify.get(
    '/v1/models/cache/status',
    {
      schema: {
        tags: ['Models'],
        summary: 'Get download/cache status for one model',
      },
    },
    async (req, reply) => {
      const modelId = typeof (req.query as { model_id?: string }).model_id === 'string'
        ? (req.query as { model_id: string }).model_id.trim()
        : '';
      if (!modelId) {
        return reply.status(400).send({ error: 'Query model_id is required' });
      }
      return reply.status(200).send(getModelDownloadStatus(modelId));
    }
  );

  fastify.get(
    '/v1/models/cache/downloads',
    {
      schema: {
        tags: ['Models'],
        summary: 'List in-memory model download statuses',
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({ downloads: listModelDownloadStatuses() });
    }
  );

  fastify.post(
    '/v1/models/cache/ensure',
    {
      schema: {
        tags: ['Models'],
        summary: 'Ensure a model is downloaded into the local Hugging Face cache',
        description:
          'Starts (or joins) a Hub snapshot download for open-weight models. Poll GET /v1/models/cache/:modelId/status for progress.',
      },
    },
    async (req, reply) => {
      const parsed = EnsureBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Expected { "model_id": "org/name" }' });
      }
      const modelId = parsed.data.model_id;
      try {
        const status = startModelCacheEnsure(modelId);
        return reply.status(202).send(status);
      } catch (err: any) {
        return reply.status(400).send({ error: err?.message || 'Failed to start model download' });
      }
    }
  );

  fastify.post(
    '/v1/models/cache/cancel',
    {
      schema: {
        tags: ['Models'],
        summary: 'Cancel an in-flight Hub model download',
        description:
          'Stops the snapshot_download child process and deletes incomplete Hugging Face blob files for that model.',
      },
    },
    async (req, reply) => {
      const parsed = CancelBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Expected { "model_id": "org/name" }' });
      }
      try {
        const status = cancelModelCacheEnsure(parsed.data.model_id);
        return reply.status(200).send(status);
      } catch (err: any) {
        return reply.status(400).send({ error: err?.message || 'Failed to cancel model download' });
      }
    }
  );
};
