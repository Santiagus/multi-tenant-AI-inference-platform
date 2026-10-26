import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('OpenAPI & Swagger Documentation Routes', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createTestApp() {
    const storageClient = new InMemoryStorageClient();
    const queueClient = new InMemoryQueueClient();
    const jobRepo = new InMemoryJobRepository();
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });
    return { app };
  }

  test('GET /docs serves interactive Swagger UI HTML', async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/docs/',
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['content-type']?.includes('text/html'));
    assert.ok(response.body.includes('swagger-ui'));
  });

  test('GET /docs/json serves machine-readable OpenAPI 3.0 specification', async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/docs/json',
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['content-type']?.includes('application/json'));
    const spec = JSON.parse(response.body);
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'Multi-Tenant AI Inference Platform API');
    assert.ok(spec.paths['/healthz']);
    assert.ok(spec.paths['/readyz']);
    assert.ok(spec.components?.securitySchemes?.tenantId);

    // Verify all operations are grouped under meaningful domain tags and NONE under 'default'
    const allowedTags = new Set([
      'Health',
      'Jobs',
      'Observability',
      'Provider Routing',
      'Kubernetes',
      'AWS Cloud',
      'Security',
      'GitOps',
    ]);

    let operationCount = 0;
    for (const [pathKey, methods] of Object.entries(spec.paths)) {
      for (const [methodKey, op] of Object.entries(methods as Record<string, any>)) {
        if (typeof op !== 'object' || !op || !('tags' in op)) continue;
        operationCount++;
        assert.ok(op.tags.length > 0, `Operation ${methodKey.toUpperCase()} ${pathKey} must have tags`);
        assert.equal(
          op.tags.includes('default'),
          false,
          `Operation ${methodKey.toUpperCase()} ${pathKey} must not be grouped under 'default'`
        );
        for (const tag of op.tags) {
          assert.ok(
            allowedTags.has(tag),
            `Operation ${methodKey.toUpperCase()} ${pathKey} tag '${tag}' must be in domain tags`
          );
        }
      }
    }
    assert.ok(operationCount >= 15, `Expected at least 15 documented endpoints, found ${operationCount}`);

    // Verify /v1/jobs has valid pre-populated default example payload in requestBody
    const postJobsOp = spec.paths['/v1/jobs']?.post;
    assert.ok(postJobsOp, 'POST /v1/jobs must exist in OpenAPI spec');
    assert.ok(postJobsOp.requestBody, 'POST /v1/jobs must have requestBody');
    const jobsJsonSchema = postJobsOp.requestBody.content?.['application/json']?.schema;
    assert.ok(jobsJsonSchema, 'POST /v1/jobs must have application/json schema');
    assert.ok(jobsJsonSchema.example, 'POST /v1/jobs must have default example payload');
    assert.equal(jobsJsonSchema.example.model_id, 'meta-llama/Llama-3-8B-Instruct');
    assert.equal(jobsJsonSchema.example.routing_preference, 'auto');
    assert.equal(jobsJsonSchema.example.priority, 5);
    assert.ok(jobsJsonSchema.example.input?.prompt);

    // Verify /v1/jobs has selectable examples dropdown
    const postJobsExamples = postJobsOp.requestBody.content?.['application/json']?.examples;
    assert.ok(postJobsExamples, 'POST /v1/jobs must have examples map for Swagger UI dropdown');

    // Verify mock inference example
    assert.ok(postJobsExamples['mock_inference'], 'Expected example for mock_inference');
    assert.equal(postJobsExamples['mock_inference'].value?.routing_preference, 'mock');

    // Verify Tier 1 Local CPU examples
    assert.ok(postJobsExamples['tier1_cpu_tinyllama'], 'Expected example for tier1_cpu_tinyllama');
    assert.equal(postJobsExamples['tier1_cpu_tinyllama'].value?.routing_preference, 'local/cpu');
    assert.equal(postJobsExamples['tier1_cpu_tinyllama'].value?.model_id, 'TinyLlama/TinyLlama-1.1B-Chat-v1.0');

    assert.ok(postJobsExamples['tier1_cpu_clip'], 'Expected example for tier1_cpu_clip');
    assert.equal(postJobsExamples['tier1_cpu_clip'].value?.routing_preference, 'local/cpu');
    assert.equal(postJobsExamples['tier1_cpu_clip'].value?.model_id, 'openai/clip-vit-large-patch14');

    // Verify Tier 2 Local GPU examples
    assert.ok(postJobsExamples['tier2_gpu_llama3'], 'Expected example for tier2_gpu_llama3');
    assert.equal(postJobsExamples['tier2_gpu_llama3'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_qwen25_7b'], 'Expected example for tier2_gpu_qwen25_7b');
    assert.equal(postJobsExamples['tier2_gpu_qwen25_7b'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_deepseek_r1'], 'Expected example for tier2_gpu_deepseek_r1');
    assert.equal(postJobsExamples['tier2_gpu_deepseek_r1'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_flux'], 'Expected example for tier2_gpu_flux');
    assert.equal(postJobsExamples['tier2_gpu_flux'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_sd35'], 'Expected example for tier2_gpu_sd35');
    assert.equal(postJobsExamples['tier2_gpu_sd35'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_qwen_vl'], 'Expected example for tier2_gpu_qwen_vl');
    assert.equal(postJobsExamples['tier2_gpu_qwen_vl'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_wan_video'], 'Expected example for tier2_gpu_wan_video');
    assert.equal(postJobsExamples['tier2_gpu_wan_video'].value?.routing_preference, 'local/gpu');

    assert.ok(postJobsExamples['tier2_gpu_cogvideox'], 'Expected example for tier2_gpu_cogvideox');
    assert.equal(postJobsExamples['tier2_gpu_cogvideox'].value?.routing_preference, 'local/gpu');

    // Verify cloud provider examples
    assert.ok(postJobsExamples['cloud_runpod_serverless'], 'Expected example for cloud_runpod_serverless');
    assert.equal(postJobsExamples['cloud_runpod_serverless'].value?.routing_preference, 'cloud/runpod');

    assert.ok(postJobsExamples['cloud_bedrock_managed'], 'Expected example for cloud_bedrock_managed');
    assert.equal(postJobsExamples['cloud_bedrock_managed'].value?.routing_preference, 'cloud/bedrock');

    assert.ok(postJobsExamples['cloud_sagemaker_vpc'], 'Expected example for cloud_sagemaker_vpc');
    assert.equal(postJobsExamples['cloud_sagemaker_vpc'].value?.routing_preference, 'cloud/sagemaker');

    // Verify duplicate cases already covered in tier 1 or 2 have been removed
    const removedDuplicates = [
      'image_generation',
      'image_processing',
      'auto',
      'local',
      'cloud',
      'cost_optimized',
      'low_latency',
    ];
    for (const dup of removedDuplicates) {
      assert.equal(postJobsExamples[dup], undefined, `Duplicate example '${dup}' must be removed`);
    }

    // Verify exactly 14 curated, non-duplicated examples exist in Swagger UI
    assert.equal(Object.keys(postJobsExamples).length, 14, 'Expected exactly 14 distinct curated examples in Swagger UI');

    // Verify x-tenant-id security scheme is configured in components
    const tenantScheme = spec.components?.securitySchemes?.tenantId;
    assert.ok(tenantScheme, 'tenantId securityScheme must be present in OpenAPI components');
    assert.equal(tenantScheme.name, 'x-tenant-id');
    assert.equal(tenantScheme.in, 'header');

    // Verify other key POST endpoints have valid example payloads
    const evaluateOp = spec.paths['/v1/routing/evaluate']?.post;
    assert.ok(evaluateOp?.requestBody?.content?.['application/json']?.schema?.example);

    const kueueOp = spec.paths['/v1/k8s/kueue/workloads']?.post;
    assert.ok(kueueOp?.requestBody?.content?.['application/json']?.schema?.example);

    const deployOp = spec.paths['/v1/cloud/aws/ephemeral/deploy']?.post;
    assert.ok(deployOp?.requestBody?.content?.['application/json']?.schema?.example);

    // Verify internal redirect convenience routes are hidden from OpenAPI specification
    assert.equal(spec.paths['/documentation'], undefined);
    assert.equal(spec.paths['/swagger'], undefined);
    assert.equal(spec.paths['/redoc'], undefined);
  });

  test('GET /documentation and /swagger redirect to /docs', async () => {
    const { app } = createTestApp();

    const docRes = await app.inject({
      method: 'GET',
      url: '/documentation',
    });
    assert.equal(docRes.statusCode, 302);
    assert.equal(docRes.headers.location, '/docs');

    const swaggerRes = await app.inject({
      method: 'GET',
      url: '/swagger',
    });
    assert.equal(swaggerRes.statusCode, 302);
    assert.equal(swaggerRes.headers.location, '/docs');
  });
});

