import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('AWS Cloud Platform, Least-Privilege IAM & Ephemeral Lifecycle Routes (M07)', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createAwsTestApp() {
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

  test('GET /v1/cloud/aws/status returns Terraform module catalog and default ephemeral guardrails', async () => {
    const { app } = createAwsTestApp();

    const res = await app.inject({
      method: 'GET',
      url: '/v1/cloud/aws/status',
      headers: { 'x-tenant-id': 'tenant-aws' },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status.permanentGpuOrEksDependency, false);
    assert.equal(body.status.modules.length, 7);
    assert.equal(body.status.activeDeploymentsCount, 0);
    assert.equal(body.default_ephemeral_guardrails.passed, true);
    assert.equal(body.default_ephemeral_guardrails.costEstimation.hourlyFixedUsd, 0.0);

    await app.close();
  });

  test('POST /v1/cloud/aws/ephemeral/deploy and destroy manage ephemeral lifecycle and expose Prometheus metrics', async () => {
    const { app } = createAwsTestApp();

    // 1. Deploy ephemeral stack (default serverless S3 + CloudFront + SQS + ECS Fargate + IAM + Budgets)
    const deployRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/ephemeral/deploy',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        ephemeral_run_id: 'ephemeral-rest-01',
        environment: 'ephemeral',
        enable_eks: false,
        monthly_budget_limit_usd: 25.0,
        ephemeral_ttl_hours: 4,
      },
    });
    assert.equal(deployRes.statusCode, 201);
    const deployBody = JSON.parse(deployRes.body);
    assert.equal(deployBody.stack.status, 'DEPLOYED');
    assert.equal(deployBody.stack.resourcesCreated, 18);
    assert.equal(deployBody.guardrails.passed, true);

    // 2. Reject invalid schema payload (missing ephemeral_run_id)
    const badSchemaRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/ephemeral/deploy',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        ephemeral_run_id: '',
      },
    });
    assert.equal(badSchemaRes.statusCode, 400);

    // 3. Reject duplicate active stack (409 STACK_ALREADY_EXISTS)
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/ephemeral/deploy',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        ephemeral_run_id: 'ephemeral-rest-01',
      },
    });
    assert.equal(duplicateRes.statusCode, 409);
    assert.equal(JSON.parse(duplicateRes.body).code, 'STACK_ALREADY_EXISTS');

    // 4. Reject IAM wildcard / long-lived access keys guardrail violation (400 AWS_GUARDRAIL_VIOLATION)
    const violationRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/ephemeral/deploy',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        ephemeral_run_id: 'ephemeral-rejected-iam',
        use_long_lived_access_keys: true,
        iam_actions: ['s3:*'],
      },
    });
    assert.equal(violationRes.statusCode, 400);
    const violationBody = JSON.parse(violationRes.body);
    assert.equal(violationBody.code, 'AWS_GUARDRAIL_VIOLATION');

    // 5. Destroy ephemeral stack -> surviving_resources = 0, post_destroy_hourly_cost_usd = 0
    const destroyRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/ephemeral/ephemeral-rest-01/destroy',
      headers: { 'x-tenant-id': 'tenant-aws' },
    });
    assert.equal(destroyRes.statusCode, 200);
    const destroyBody = JSON.parse(destroyRes.body);
    assert.equal(destroyBody.destroyed.status, 'DESTROYED');
    assert.equal(destroyBody.surviving_resources, 0);
    assert.equal(destroyBody.post_destroy_hourly_cost_usd, 0.0);

    // 6. Execute Two-Path workflows via POST /v1/cloud/aws/workflows/execute (text_to_image, text_to_video, video_to_video)
    const pathARes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/workflows/execute',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        path: 'path_a_sqs_keda',
        modality: 'text_to_image',
        job_id: 'job-path-a-rest',
        prompt: 'Fast SQS + KEDA single-hop keyframe inference',
        use_torchscript: true,
      },
    });
    assert.equal(pathARes.statusCode, 200);
    const pathABody = JSON.parse(pathARes.body);
    assert.equal(pathABody.path, 'path_a_sqs_keda');
    assert.equal(pathABody.modality, 'text_to_image');
    assert.equal(pathABody.backend, 'pytorch_torchscript_cpu');
    assert.ok(pathABody.artifacts.cloudfrontMediaUrl.endsWith('/output.png'));
    assert.equal(pathABody.kueueKyvernoAdmission.enforced, false);

    const pathBRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/workflows/execute',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        path: 'path_b_flyte_dag',
        modality: 'video_to_video',
        job_id: 'job-path-b-rest',
        prompt: 'Multi-stage Flyte + Kueue + Kyverno video modification DAG',
        asset_uri: 's3://inference-ephemeral-artifacts/tenants/tenant-aws/inputs/clip.mp4',
        fps: 24,
        duration_seconds: 4,
        edit_operation: 'style_transfer',
        edit_strength: 0.8,
        use_torchscript: true,
        max_new_tokens: 32,
      },
    });
    assert.equal(pathBRes.statusCode, 200);
    const pathBBody = JSON.parse(pathBRes.body);
    assert.equal(pathBBody.path, 'path_b_flyte_dag');
    assert.equal(pathBBody.modality, 'video_to_video');
    assert.equal(pathBBody.kueueKyvernoAdmission.enforced, true);
    assert.ok(pathBBody.artifacts.cloudfrontMediaUrl.endsWith('/output.mp4'));
    assert.equal(pathBBody.usageAndBilling.framesGenerated, 96);
    assert.ok(pathBBody.usageAndBilling.estimatedCostUsd > 0);

    const badWorkflowRes = await app.inject({
      method: 'POST',
      url: '/v1/cloud/aws/workflows/execute',
      headers: { 'x-tenant-id': 'tenant-aws' },
      payload: {
        path: 'path_a_sqs_keda',
        job_id: '',
        prompt: '',
      },
    });
    assert.equal(badWorkflowRes.statusCode, 400);

    // 7. Scrape /metrics and verify M07 AWS platform and multimodal token/cost metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    assert.ok(metricsRes.body.includes('aws_ephemeral_active_deployments'));
    assert.ok(metricsRes.body.includes('aws_estimated_hourly_cost_usd'));
    assert.ok(metricsRes.body.includes('aws_ephemeral_deployments_total'));
    assert.ok(metricsRes.body.includes('aws_iam_policy_evaluations_total'));
    assert.ok(metricsRes.body.includes('inference_tokens_total'));
    assert.ok(metricsRes.body.includes('inference_estimated_cost_usd_total'));

    await app.close();
  });
});


