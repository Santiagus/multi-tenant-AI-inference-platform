import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../domain/errors.js';
import {
  DEFAULT_KEDA_CONFIG,
  evaluateKedaScaling,
  type KueueAdmissionController,
} from '../domain/kubernetes-scheduler.js';
import type { IQueueClient } from '../infrastructure/queue/queue-client.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';

export interface KubernetesRoutesOptions {
  queueClient: IQueueClient;
  metrics: MetricsRegistry;
  kueueController: KueueAdmissionController;
}

const AutoscalingQuerySchema = z.object({
  queue_depth: z.coerce.number().int().nonnegative().optional(),
  in_flight_jobs: z.coerce.number().int().nonnegative().default(0),
  current_replicas: z.coerce.number().int().nonnegative().default(0),
  seconds_since_last_active: z.coerce.number().int().nonnegative().default(60),
});

const SubmitKueueWorkloadSchema = z.object({
  workload_id: z.string().min(1),
  local_queue_name: z.string().default('tenant-default-gpu-queue'),
  priority_class: z
    .enum([
      'inference-realtime-high',
      'inference-batch-standard',
      'inference-batch-backfill',
    ])
    .default('inference-batch-standard'),
  gpu_count: z.number().int().nonnegative().default(1),
  cpu_millicores: z.number().int().default(1000),
  memory_mb: z.number().int().default(4096),
  allow_cohort_borrowing: z.boolean().default(false),
  security_context: z
    .object({
      run_as_non_root: z.boolean().default(true),
      allow_privilege_escalation: z.boolean().default(false),
      dropped_capabilities: z.array(z.string()).default(['ALL']),
    })
    .optional(),
});

export const kubernetesRoutes: FastifyPluginAsync<KubernetesRoutesOptions> = async (
  fastify,
  options
) => {
  const { queueClient, metrics, kueueController } = options;

  // GET /v1/k8s/autoscaling/status - Evaluate KEDA queue-depth scaling and Kueue quota state
  fastify.get('/v1/k8s/autoscaling/status', async (req, reply) => {
    const parsed = AutoscalingQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid autoscaling query parameters', parsed.error.flatten());
    }

    const liveQueueDepth = await queueClient.getQueueDepth!();
    const queueDepth = parsed.data.queue_depth ?? liveQueueDepth;
    const kedaDecision = evaluateKedaScaling(
      {
        queueDepth,
        inFlightJobs: parsed.data.in_flight_jobs,
        currentReplicas: parsed.data.current_replicas,
        secondsSinceLastActive: parsed.data.seconds_since_last_active,
      },
      DEFAULT_KEDA_CONFIG
    );

    const kueueStatus = kueueController.getClusterStatus();

    metrics.setGauge(
      'keda_scaler_desired_replicas',
      { scaled_object: kedaDecision.scaledObjectName },
      kedaDecision.desiredReplicas
    );
    metrics.setGauge(
      'keda_scaler_active_replicas',
      { scaled_object: kedaDecision.scaledObjectName },
      kedaDecision.currentReplicas
    );
    metrics.setGauge(
      'kueue_cluster_queue_gpu_quota_used',
      { cluster_queue: kueueStatus.clusterQueueName },
      kueueStatus.usedGpuQuota
    );
    metrics.setGauge(
      'kueue_cluster_queue_gpu_quota_nominal',
      { cluster_queue: kueueStatus.clusterQueueName },
      kueueStatus.nominalGpuQuota
    );
    metrics.setGauge(
      'kueue_pending_workloads',
      { cluster_queue: kueueStatus.clusterQueueName },
      kueueStatus.pendingCount
    );

    return reply.status(200).send({
      keda: kedaDecision,
      kueue: kueueStatus,
    });
  });

  // POST /v1/k8s/kueue/workloads - Validate via Kyverno policies and submit GPU/batch workload to Kueue
  fastify.post('/v1/k8s/kueue/workloads', async (req, reply) => {
    const parsed = SubmitKueueWorkloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid Kueue workload submission payload', parsed.error.flatten());
    }

    const tenantId = (req as unknown as { tenantId: string }).tenantId;
    const body = parsed.data;

    try {
      const { workload, kyvernoResult } = kueueController.submitWorkload({
        workloadId: body.workload_id,
        tenantId,
        localQueueName: body.local_queue_name,
        priorityClass: body.priority_class,
        gpuCount: body.gpu_count,
        cpuMillicores: body.cpu_millicores,
        memoryMb: body.memory_mb,
        allowCohortBorrowing: body.allow_cohort_borrowing,
        securityContext: body.security_context
          ? {
              runAsNonRoot: body.security_context.run_as_non_root,
              allowPrivilegeEscalation: body.security_context.allow_privilege_escalation,
              droppedCapabilities: body.security_context.dropped_capabilities,
            }
          : undefined,
      });

      metrics.incCounter('kyverno_policy_evaluations_total', { result: 'pass' });
      if (workload.status === 'ADMITTED') {
        metrics.incCounter('kueue_admitted_workloads_total', {
          cluster_queue: workload.clusterQueueName,
          priority_class: workload.priorityClass,
          tenant_id: workload.tenantId,
        });
      }

      const clusterStatus = kueueController.getClusterStatus();
      metrics.setGauge(
        'kueue_cluster_queue_gpu_quota_used',
        { cluster_queue: clusterStatus.clusterQueueName },
        clusterStatus.usedGpuQuota
      );
      metrics.setGauge(
        'kueue_pending_workloads',
        { cluster_queue: clusterStatus.clusterQueueName },
        clusterStatus.pendingCount
      );

      return reply.status(201).send({
        workload,
        kyverno: kyvernoResult,
        cluster_queue: clusterStatus,
      });
    } catch (err) {
      if (err instanceof ValidationError && err.code === 'KYVERNO_POLICY_VIOLATION') {
        metrics.incCounter('kyverno_policy_evaluations_total', { result: 'fail' });
      }
      throw err;
    }
  });

  // POST /v1/k8s/kueue/workloads/:id/release - Complete/release GPU workload and admit queued workloads
  fastify.post<{ Params: { id: string } }>('/v1/k8s/kueue/workloads/:id/release', async (req, reply) => {
    const { released, newlyAdmitted } = kueueController.releaseWorkload(req.params.id);
    for (const admitted of newlyAdmitted) {
      metrics.incCounter('kueue_admitted_workloads_total', {
        cluster_queue: admitted.clusterQueueName,
        priority_class: admitted.priorityClass,
        tenant_id: admitted.tenantId,
      });
    }

    const clusterStatus = kueueController.getClusterStatus();
    metrics.setGauge(
      'kueue_cluster_queue_gpu_quota_used',
      { cluster_queue: clusterStatus.clusterQueueName },
      clusterStatus.usedGpuQuota
    );
    metrics.setGauge(
      'kueue_pending_workloads',
      { cluster_queue: clusterStatus.clusterQueueName },
      clusterStatus.pendingCount
    );

    return reply.status(200).send({
      released,
      newly_admitted: newlyAdmitted,
      cluster_queue: clusterStatus,
    });
  });
};
