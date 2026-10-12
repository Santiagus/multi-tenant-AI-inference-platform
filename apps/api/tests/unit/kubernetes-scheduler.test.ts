import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEDA_CONFIG,
  DEFAULT_KUEUE_QUOTA,
  evaluateKedaScaling,
  evaluateKyvernoPolicies,
  KueueAdmissionController,
} from '../../src/domain/kubernetes-scheduler.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.js';

describe('Kubernetes Scheduling Domain: KEDA, Kueue & Kyverno (M06)', () => {
  test('evaluateKedaScaling scales from 0 -> N -> cooldown_hold -> 0 based on queue depth', () => {
    // 1. Idle queue at 0 replicas -> steady at 0
    const idle = evaluateKedaScaling({
      queueDepth: 0,
      inFlightJobs: 0,
      currentReplicas: 0,
      secondsSinceLastActive: 120,
    });
    assert.equal(idle.desiredReplicas, 0);
    assert.equal(idle.scaleAction, 'steady');

    // 2. Small backlog (3 messages, target 5/replica) -> scales up from 0 to 1
    const scaleFromZero = evaluateKedaScaling({
      queueDepth: 3,
      inFlightJobs: 0,
      currentReplicas: 0,
      secondsSinceLastActive: 0,
    });
    assert.equal(scaleFromZero.desiredReplicas, 1);
    assert.equal(scaleFromZero.scaleAction, 'scale_up');

    // 3. Burst backlog (18 messages + 2 in-flight = 20, target 5/replica) -> scales up to 4
    const burst = evaluateKedaScaling({
      queueDepth: 18,
      inFlightJobs: 2,
      currentReplicas: 1,
      secondsSinceLastActive: 0,
    });
    assert.equal(burst.desiredReplicas, 4);
    assert.equal(burst.scaleAction, 'scale_up');

    // 4. Steady at 4 replicas when backlog remains 20
    const steadyActive = evaluateKedaScaling({
      queueDepth: 20,
      inFlightJobs: 0,
      currentReplicas: 4,
      secondsSinceLastActive: 0,
    });
    assert.equal(steadyActive.desiredReplicas, 4);
    assert.equal(steadyActive.scaleAction, 'steady');

    // 5. Partial drain (backlog drops to 6 -> desired 2 < current 4) -> scale_down
    const scaleDown = evaluateKedaScaling({
      queueDepth: 6,
      inFlightJobs: 0,
      currentReplicas: 4,
      secondsSinceLastActive: 0,
    });
    assert.equal(scaleDown.desiredReplicas, 2);
    assert.equal(scaleDown.scaleAction, 'scale_down');

    // 6. Cap at maxReplicaCount (100 messages -> capped at 8)
    const capped = evaluateKedaScaling(
      {
        queueDepth: 100,
        inFlightJobs: 0,
        currentReplicas: 2,
        secondsSinceLastActive: 0,
      },
      DEFAULT_KEDA_CONFIG
    );
    assert.equal(capped.desiredReplicas, 8);
    assert.equal(capped.scaleAction, 'scale_up');

    // 7. Queue empty within cooldown window -> cooldown_hold
    const cooldownHold = evaluateKedaScaling({
      queueDepth: 0,
      inFlightJobs: 0,
      currentReplicas: 2,
      secondsSinceLastActive: 10,
    });
    assert.equal(cooldownHold.desiredReplicas, 2);
    assert.equal(cooldownHold.scaleAction, 'cooldown_hold');

    // 8. Queue empty after cooldown window -> scale_to_zero
    const scaleToZero = evaluateKedaScaling({
      queueDepth: 0,
      inFlightJobs: 0,
      currentReplicas: 2,
      secondsSinceLastActive: 45,
    });
    assert.equal(scaleToZero.desiredReplicas, 0);
    assert.equal(scaleToZero.scaleAction, 'scale_to_zero');
  });

  test('evaluateKyvernoPolicies enforces non-root, resource bounds, Kueue queue labels, and tenant labels', () => {
    const compliant = evaluateKyvernoPolicies({
      name: 'worker-pod-1',
      namespace: 'inference-workers',
      kind: 'Job',
      tenantId: 'tenant-alpha',
      partOfLabel: 'multi-tenant-ai-inference-platform',
      runAsNonRoot: true,
      allowPrivilegeEscalation: false,
      droppedCapabilities: ['ALL'],
      cpuRequestMillicores: 1000,
      memoryRequestMb: 4096,
      cpuLimitMillicores: 2000,
      memoryLimitMb: 8192,
      gpuCount: 1,
      kueueQueueName: 'tenant-alpha-gpu-queue',
      suspendOnCreate: true,
    });
    assert.equal(compliant.allowed, true);
    assert.equal(compliant.violations.length, 0);

    // Non-compliant Deployment (CPU pod without GPU, but root + invalid resource limits + missing tenant)
    const nonCompliant = evaluateKyvernoPolicies({
      name: 'bad-deployment',
      namespace: 'inference-platform',
      kind: 'Deployment',
      tenantId: '',
      partOfLabel: 'wrong-label',
      runAsNonRoot: false,
      allowPrivilegeEscalation: true,
      droppedCapabilities: ['NET_RAW'],
      cpuRequestMillicores: 2000,
      memoryRequestMb: 4096,
      cpuLimitMillicores: 1000,
      memoryLimitMb: 2048,
      gpuCount: 0,
    });
    assert.equal(nonCompliant.allowed, false);
    assert.equal(nonCompliant.violations.length, 3);

    // Non-compliant GPU Job missing kueueQueueName and suspendOnCreate=false
    const unqueuedGpuJob = evaluateKyvernoPolicies({
      name: 'unqueued-gpu-job',
      namespace: 'inference-workers',
      kind: 'Job',
      tenantId: 'tenant-alpha',
      partOfLabel: 'multi-tenant-ai-inference-platform',
      runAsNonRoot: true,
      allowPrivilegeEscalation: false,
      droppedCapabilities: ['ALL'],
      cpuRequestMillicores: 1000,
      memoryRequestMb: 4096,
      cpuLimitMillicores: 2000,
      memoryLimitMb: 8192,
      gpuCount: 1,
      kueueQueueName: '',
      suspendOnCreate: false,
    });
    assert.equal(unqueuedGpuJob.allowed, false);
    assert.equal(
      unqueuedGpuJob.violations[0].rule,
      'require-kueue-queue-label-for-batch-gpu-jobs'
    );
  });

  test('KueueAdmissionController governs GPU quota, cohort borrowing, priority ordering, and release wakeup', () => {
    const controller = new KueueAdmissionController({
      ...DEFAULT_KUEUE_QUOTA,
      nominalGpuQuota: 2,
      borrowingLimitGpu: 1,
    });
    assert.equal(controller.getQuotaConfig().nominalGpuQuota, 2);

    // 1. Admit first two 1-GPU jobs filling nominal quota (2 GPUs)
    const first = controller.submitWorkload({
      workloadId: 'gpu-job-1',
      tenantId: 'tenant-a',
      localQueueName: 'tenant-a-queue',
      priorityClass: 'inference-batch-standard',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
    });
    assert.equal(first.workload.status, 'ADMITTED');
    assert.equal(first.workload.suspended, false);
    assert.equal(first.workload.borrowedGpuCount, 0);

    const second = controller.submitWorkload({
      workloadId: 'gpu-job-2',
      tenantId: 'tenant-a',
      localQueueName: 'tenant-a-queue',
      priorityClass: 'inference-batch-standard',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
    });
    assert.equal(second.workload.status, 'ADMITTED');

    // 2. Submit a 3rd job without cohort borrowing -> queued (suspended=true)
    const queuedStandard = controller.submitWorkload({
      workloadId: 'gpu-job-3-standard',
      tenantId: 'tenant-b',
      localQueueName: 'tenant-b-queue',
      priorityClass: 'inference-batch-standard',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
      allowCohortBorrowing: false,
    });
    assert.equal(queuedStandard.workload.status, 'QUEUED');
    assert.equal(queuedStandard.workload.suspended, true);

    // 3. Submit a second standard priority job to verify FIFO tie-breaking among equal priority
    const queuedStandardSecond = controller.submitWorkload({
      workloadId: 'gpu-job-4-standard-fifo',
      tenantId: 'tenant-b',
      localQueueName: 'tenant-b-queue',
      priorityClass: 'inference-batch-standard',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
    });
    assert.equal(queuedStandardSecond.workload.status, 'QUEUED');

    // 4. Submit a high-priority job with cohort borrowing -> admitted immediately using borrowed GPU!
    const borrowedHigh = controller.submitWorkload({
      workloadId: 'gpu-job-5-high-borrowed',
      tenantId: 'tenant-a',
      localQueueName: 'tenant-a-queue',
      priorityClass: 'inference-realtime-high',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
      allowCohortBorrowing: true,
    });
    assert.equal(borrowedHigh.workload.status, 'ADMITTED');
    assert.equal(borrowedHigh.workload.borrowedGpuCount, 1);

    // 5. Submit another high-priority job now that nominal + borrowed (3 GPUs) are full -> queued at head of queue
    const queuedHigh = controller.submitWorkload({
      workloadId: 'gpu-job-6-high-queued',
      tenantId: 'tenant-a',
      localQueueName: 'tenant-a-queue',
      priorityClass: 'inference-realtime-high',
      gpuCount: 1,
      cpuMillicores: 1000,
      memoryMb: 4096,
      allowCohortBorrowing: true,
    });
    assert.equal(queuedHigh.workload.status, 'QUEUED');

    const statusBeforeRelease = controller.getClusterStatus();
    assert.equal(statusBeforeRelease.usedGpuQuota, 3);
    assert.equal(statusBeforeRelease.pendingCount, 3);
    assert.equal(statusBeforeRelease.pendingWorkloads[0].workloadId, 'gpu-job-6-high-queued');

    // 6. Release gpu-job-1 -> frees 1 GPU -> gpu-job-6-high-queued is admitted ahead of standard jobs!
    const releaseRes = controller.releaseWorkload('gpu-job-1');
    assert.equal(releaseRes.released.status, 'FINISHED');
    assert.equal(releaseRes.newlyAdmitted.length, 1);
    assert.equal(releaseRes.newlyAdmitted[0].workloadId, 'gpu-job-6-high-queued');

    // 7. Release gpu-job-2 and gpu-job-5-high-borrowed -> frees 2 GPUs -> admits gpu-job-3-standard (FIFO first)
    controller.releaseWorkload('gpu-job-2');
    const releaseBorrowed = controller.releaseWorkload('gpu-job-5-high-borrowed');
    assert.equal(releaseBorrowed.newlyAdmitted.length, 1);
    assert.equal(releaseBorrowed.newlyAdmitted[0].workloadId, 'gpu-job-3-standard');

    // 8. Error paths: duplicate ID (409), quota exceeded (400), Kyverno violation (400), unknown release (404)
    assert.throws(
      () =>
        controller.submitWorkload({
          workloadId: 'gpu-job-1',
          tenantId: 'tenant-a',
          localQueueName: 'tenant-a-queue',
          priorityClass: 'inference-batch-standard',
          gpuCount: 1,
          cpuMillicores: 1000,
          memoryMb: 4096,
        }),
      ConflictError
    );

    assert.throws(
      () =>
        controller.submitWorkload({
          workloadId: 'gpu-job-oversized',
          tenantId: 'tenant-a',
          localQueueName: 'tenant-a-queue',
          priorityClass: 'inference-batch-standard',
          gpuCount: 99,
          cpuMillicores: 1000,
          memoryMb: 4096,
        }),
      ValidationError
    );

    assert.throws(
      () =>
        controller.submitWorkload({
          workloadId: 'gpu-job-privileged',
          tenantId: 'tenant-a',
          localQueueName: 'tenant-a-queue',
          priorityClass: 'inference-batch-standard',
          gpuCount: 1,
          cpuMillicores: 1000,
          memoryMb: 4096,
          securityContext: {
            runAsNonRoot: false,
            allowPrivilegeEscalation: true,
            droppedCapabilities: [],
          },
        }),
      ValidationError
    );

    assert.throws(() => controller.releaseWorkload('non-existent-workload'), NotFoundError);
  });
});

