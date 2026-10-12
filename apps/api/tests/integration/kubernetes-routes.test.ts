import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Kubernetes Autoscaling, Kueue Admission & Kyverno Policy Routes (M06)', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createK8sTestApp() {
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
    return { app, queueClient };
  }

  test('GET /v1/k8s/autoscaling/status reflects live queue depth and scales worker replicas', async () => {
    const { app } = createK8sTestApp();

    // 1. Initially queue is empty -> desiredReplicas = 0
    const idleRes = await app.inject({
      method: 'GET',
      url: '/v1/k8s/autoscaling/status',
      headers: { 'x-tenant-id': 'tenant-k8s' },
    });
    assert.equal(idleRes.statusCode, 200);
    const idleBody = JSON.parse(idleRes.body);
    assert.equal(idleBody.keda.queueDepth, 0);
    assert.equal(idleBody.keda.desiredReplicas, 0);
    assert.equal(idleBody.keda.scaleAction, 'steady');

    // 2. Submit 6 jobs into the queue -> live queue depth becomes 6 -> desiredReplicas = ceil(6/5) = 2
    for (let i = 0; i < 6; i++) {
      const submitRes = await app.inject({
        method: 'POST',
        url: '/v1/jobs',
        headers: { 'x-tenant-id': 'tenant-k8s' },
        payload: {
          model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
          input: { prompt: `Batch item ${i}` },
        },
      });
      assert.equal(submitRes.statusCode, 202);
    }

    const activeRes = await app.inject({
      method: 'GET',
      url: '/v1/k8s/autoscaling/status',
      headers: { 'x-tenant-id': 'tenant-k8s' },
    });
    assert.equal(activeRes.statusCode, 200);
    const activeBody = JSON.parse(activeRes.body);
    assert.equal(activeBody.keda.queueDepth, 6);
    assert.equal(activeBody.keda.desiredReplicas, 2);
    assert.equal(activeBody.keda.scaleAction, 'scale_up');

    // 3. Invalid query parameter returns 400 RFC 7807 Problem Details
    const badQueryRes = await app.inject({
      method: 'GET',
      url: '/v1/k8s/autoscaling/status?queue_depth=-5',
      headers: { 'x-tenant-id': 'tenant-k8s' },
    });
    assert.equal(badQueryRes.statusCode, 400);

    await app.close();
  });

  test('POST /v1/k8s/kueue/workloads and release enforce Kyverno policies, GPU quotas, and priority wakeup', async () => {
    const { app } = createK8sTestApp();

    // 1. Admit two 1-GPU batch workloads (filling nominal 2-GPU ClusterQueue quota)
    const w1Res = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {
        workload_id: 'batch-gpu-job-01',
        priority_class: 'inference-batch-standard',
        gpu_count: 1,
        cpu_millicores: 2000,
        memory_mb: 8192,
      },
    });
    assert.equal(w1Res.statusCode, 201);
    assert.equal(JSON.parse(w1Res.body).workload.status, 'ADMITTED');

    const w2Res = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {
        workload_id: 'batch-gpu-job-02',
        priority_class: 'inference-batch-standard',
        gpu_count: 1,
        cpu_millicores: 2000,
        memory_mb: 8192,
      },
    });
    assert.equal(w2Res.statusCode, 201);
    assert.equal(JSON.parse(w2Res.body).workload.status, 'ADMITTED');

    // 2. Submit a 3rd standard workload and a 4th high-priority workload -> both queued as nominal GPU quota (2) is full
    const w3Res = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-2' },
      payload: {
        workload_id: 'batch-gpu-job-03-standard',
        priority_class: 'inference-batch-standard',
        gpu_count: 1,
      },
    });
    assert.equal(w3Res.statusCode, 201);
    assert.equal(JSON.parse(w3Res.body).workload.status, 'QUEUED');

    const w4Res = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {
        workload_id: 'batch-gpu-job-04-high',
        priority_class: 'inference-realtime-high',
        gpu_count: 1,
      },
    });
    assert.equal(w4Res.statusCode, 201);
    const w4Body = JSON.parse(w4Res.body);
    assert.equal(w4Body.workload.status, 'QUEUED');
    assert.equal(w4Body.cluster_queue.pendingCount, 2);
    assert.equal(w4Body.cluster_queue.pendingWorkloads[0].workload_id ?? w4Body.cluster_queue.pendingWorkloads[0].workloadId, 'batch-gpu-job-04-high');

    // 3. Release batch-gpu-job-01 -> high-priority batch-gpu-job-04-high is admitted first!
    const relRes = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads/batch-gpu-job-01/release',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
    });
    assert.equal(relRes.statusCode, 200);
    const relBody = JSON.parse(relRes.body);
    assert.equal(relBody.released.status, 'FINISHED');
    assert.equal(relBody.newly_admitted.length, 1);
    assert.equal(relBody.newly_admitted[0].workloadId, 'batch-gpu-job-04-high');

    // 4. Reject non-compliant privileged container workload via Kyverno policy
    const kyvernoRejectRes = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {
        workload_id: 'privileged-gpu-job-bad',
        gpu_count: 1,
        security_context: {
          run_as_non_root: false,
          allow_privilege_escalation: true,
          dropped_capabilities: [],
        },
      },
    });
    assert.equal(kyvernoRejectRes.statusCode, 400);
    const rejectBody = JSON.parse(kyvernoRejectRes.body);
    assert.equal(rejectBody.code, 'KYVERNO_POLICY_VIOLATION');

    // 5. Duplicate workload ID returns 409 Conflict
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {
        workload_id: 'batch-gpu-job-02',
        gpu_count: 1,
      },
    });
    assert.equal(duplicateRes.statusCode, 409);

    // 6. Explicit queue_depth query override on autoscaling status
    const overrideRes = await app.inject({
      method: 'GET',
      url: '/v1/k8s/autoscaling/status?queue_depth=15&current_replicas=1',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
    });
    assert.equal(overrideRes.statusCode, 200);
    assert.equal(JSON.parse(overrideRes.body).keda.desiredReplicas, 3);

    // 7. Invalid schema payload returns 400
    const invalidPayloadRes = await app.inject({
      method: 'POST',
      url: '/v1/k8s/kueue/workloads',
      headers: { 'x-tenant-id': 'tenant-gpu-1' },
      payload: {},
    });
    assert.equal(invalidPayloadRes.statusCode, 400);

    // 8. Verify Prometheus /metrics includes KEDA, Kueue, and Kyverno metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    assert.ok(metricsRes.body.includes('kueue_admitted_workloads_total'));
    assert.ok(metricsRes.body.includes('kueue_cluster_queue_gpu_quota_used'));
    assert.ok(metricsRes.body.includes('kyverno_policy_evaluations_total'));

    await app.close();
  });
});
