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

    // Verify /v1/jobs has selectable examples dropdown for each routing_preference
    const postJobsExamples = postJobsOp.requestBody.content?.['application/json']?.examples;
    assert.ok(postJobsExamples, 'POST /v1/jobs must have examples map for Swagger UI dropdown');
    const expectedPreferences = ['auto', 'local', 'cloud', 'cost_optimized', 'low_latency'];
    for (const pref of expectedPreferences) {
      assert.ok(postJobsExamples[pref], `Expected example for routing_preference '${pref}'`);
      assert.ok(postJobsExamples[pref].summary, `Example for '${pref}' must have a summary`);
      assert.equal(
        postJobsExamples[pref].value?.routing_preference,
        pref,
        `Example '${pref}' value must set routing_preference to '${pref}'`
      );
      assert.ok(
        postJobsExamples[pref].value?.model_id,
        `Example '${pref}' must have model_id`
      );
      assert.ok(
        postJobsExamples[pref].value?.input?.prompt,
        `Example '${pref}' must have input prompt`
      );
    }

    // Verify image generation and image processing examples
    assert.ok(postJobsExamples['image_generation'], 'Expected example for image_generation');
    assert.equal(
      postJobsExamples['image_generation'].value?.model_id,
      'black-forest-labs/FLUX.1-schnell'
    );
    assert.ok(
      postJobsExamples['image_generation'].value?.input?.parameters?.width,
      'image_generation example must have width parameter'
    );

    assert.ok(postJobsExamples['image_processing'], 'Expected example for image_processing');
    assert.equal(
      postJobsExamples['image_processing'].value?.model_id,
      'Qwen/Qwen2.5-VL-7B-Instruct'
    );
    assert.ok(
      postJobsExamples['image_processing'].value?.input_uri,
      'image_processing example must have input_uri'
    );

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

