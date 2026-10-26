import { useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react';

interface ComponentDetail {
  id: string;
  title: string;
  category: 'Control Plane' | 'Queue & Admission' | 'Inference Worker' | 'Storage & Telemetry';
  description: string;
  protocols: string[];
  metrics: string[];
  failureModes: string[];
}

const COMPONENT_DETAILS: Record<string, ComponentDetail> = {
  client: {
    id: 'client',
    title: 'Client Application / SDK',
    category: 'Control Plane',
    description: 'Submits asynchronous inference requests with idempotency keys, tenant tokens, and correlation tracing headers.',
    protocols: ['HTTP/2 REST', 'W3C traceparent', 'Idempotency-Key: UUID'],
    metrics: ['job_submissions_total', 'client_request_duration_ms'],
    failureModes: ['400 RFC 7807 Problem Details (Validation)', '429 Rate Limited'],
  },
  auth: {
    id: 'auth',
    title: 'Fastify API & ABAC Gateway',
    category: 'Control Plane',
    description: 'Enforces tenant isolation, token-based rate limits, payload offloading (>256KB to S3), and W3C trace propagation.',
    protocols: ['TypeScript Fastify', 'Zod validation', 'AsyncLocalStorage'],
    metrics: ['http_requests_total', 'jwt_verifications_duration_ms'],
    failureModes: ['401/403 Tenant Authorization Failure', 'S3 Upload presign error'],
  },
  twoPath: {
    id: 'twoPath',
    title: 'Two-Path Workload Router',
    category: 'Control Plane',
    description: 'Dispatches single-hop interactive inference to Path A (SQS+KEDA) and complex multi-stage batch DAGs to Path B (Flyte+Kueue).',
    protocols: ['Path A: SQS low-latency', 'Path B: Flyte DAG pipeline'],
    metrics: ['workload_dispatches_total{path="A|B"}'],
    failureModes: ['Unknown workload modality', 'DAG validation error'],
  },
  sqs: {
    id: 'sqs',
    title: 'AWS SQS / ElasticMQ Queue',
    category: 'Queue & Admission',
    description: 'Buffered asynchronous task queue with visibility timeouts, bounded exponential backoff (2^k seconds), and Dead-Letter Queue (DLQ).',
    protocols: ['AWS SQS SDK v3', 'ElasticMQ', 'JSON Envelope'],
    metrics: ['ApproximateNumberOfMessagesVisible', 'ApproximateAgeOfOldestMessage'],
    failureModes: ['Visibility timeout exhaustion', 'Dead-Letter Queue routing (3 retries)'],
  },
  keda: {
    id: 'keda',
    title: 'KEDA Scaler & HPA',
    category: 'Queue & Admission',
    description: 'Scales GPU worker pods from 0 to N based on queue depth metrics with cooldown hold to prevent cold start thrashing.',
    protocols: ['KEDA ScaledObject', 'Kubernetes HPA v2', 'Custom Metrics API'],
    metrics: ['keda_scaler_metrics_value', 'worker_replicas_current'],
    failureModes: ['Scale from 0 cold latency spike', 'Node quota limit reached'],
  },
  kueue: {
    id: 'kueue',
    title: 'Kueue Batch Admission Controller',
    category: 'Queue & Admission',
    description: 'Governs discrete physical GPU resource quotas across tenants with cohort borrowing, priority preemption, and Kyverno security policies.',
    protocols: ['Kueue Workload CRD', 'ResourceFlavor: nvidia.com/gpu', 'Kyverno admission'],
    metrics: ['kueue_admitted_workloads_total', 'kueue_pending_workloads'],
    failureModes: ['GPU cluster quota exhaustion', 'Kyverno security policy rejection'],
  },
  router: {
    id: 'router',
    title: 'Deterministic Routing Engine',
    category: 'Inference Worker',
    description: 'Evaluates workload VRAM, local queue depth, latency SLOs, and FinOps margin constraints to select local or cloud compute.',
    protocols: ['Deterministic 5-stage policy ledger', 'FinOps gross margin check'],
    metrics: ['provider_routing_decisions_total', 'provider_health_status'],
    failureModes: ['Margin unacceptable (retain on queue)', 'Cloud provider API 5xx outage'],
  },
  localWorker: {
    id: 'localWorker',
    title: 'Local NVIDIA RTX Worker',
    category: 'Inference Worker',
    description: 'High-performance Python worker executing TorchScript and PyTorch models with GPU tensor cores at zero marginal cost.',
    protocols: ['PyTorch CUDA / TorchScript', 'uv Python environment', 'Shared memory IPC'],
    metrics: ['inference_duration_ms', 'gpu_vram_allocated_mb', 'gpu_utilization_pct'],
    failureModes: ['CUDA Out of Memory (OOM)', 'Dynamic shape re-compilation churn'],
  },
  cloudWorker: {
    id: 'cloudWorker',
    title: 'Cloud Spillover (RunPod / Bedrock / SageMaker)',
    category: 'Inference Worker',
    description: 'Dynamic cloud inference spillover for SLO protection, proprietary models (Claude 3 on Bedrock), or isolated private VPCs.',
    protocols: ['RunPod Serverless GraphQL', 'AWS Bedrock InvokeModel', 'SageMaker InvokeEndpoint'],
    metrics: ['cloud_provider_latency_ms', 'cloud_provider_cost_microcents'],
    failureModes: ['Provider rate limit (429)', 'Egress network latency spike'],
  },
  storage: {
    id: 'storage',
    title: 'AWS S3 & CloudFront CDN',
    category: 'Storage & Telemetry',
    description: 'Persists large request payloads (>256KB), generated image PNGs, video MP4s, and provides presigned expiring download URLs.',
    protocols: ['AWS S3 SDK v3', 'MinIO (local)', 'SigV4 presigned URLs'],
    metrics: ['s3_get_object_duration_ms', 's3_put_object_bytes_total'],
    failureModes: ['Presigned URL expired', 'Payload checksum mismatch'],
  },
  telemetry: {
    id: 'telemetry',
    title: 'OpenTelemetry & Prometheus FinOps',
    category: 'Storage & Telemetry',
    description: 'Propagates end-to-end W3C traceparents across API -> Queue -> Worker -> S3, collecting latency P50/P95/P99 quantiles and token revenue.',
    protocols: ['OTel TraceContext RFC', 'Prometheus exposition format', 'AsyncLocalStorage'],
    metrics: ['inference_jobs_duration_seconds', 'inference_token_cost_microcents_total'],
    failureModes: ['Trace parent header truncation', 'Sampling rate drop'],
  },
};

export function WorkloadPathView() {
  const [selectedComponentId, setSelectedComponentId] = useState<string>('router');
  const [filterPath, setFilterPath] = useState<'all' | 'pathA' | 'pathB'>('all');

  const selectedComponent = COMPONENT_DETAILS[selectedComponentId] || COMPONENT_DETAILS.router;

  // Flow nodes
  const nodes: Node[] = useMemo(() => {
    return [
      {
        id: 'client',
        position: { x: 280, y: 30 },
        data: { label: 'Client / SDK (POST /v1/jobs)' },
        style: {
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          border: selectedComponentId === 'client' ? '2px solid #6366f1' : '1px solid #475569',
          padding: '12px 18px',
          fontWeight: 600,
          fontSize: '13px',
          width: 260,
          textAlign: 'center',
        },
      },
      {
        id: 'auth',
        position: { x: 280, y: 130 },
        data: { label: 'Fastify API & ABAC Auth' },
        style: {
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          border: selectedComponentId === 'auth' ? '2px solid #6366f1' : '1px solid #475569',
          padding: '12px 18px',
          fontWeight: 600,
          fontSize: '13px',
          width: 260,
          textAlign: 'center',
        },
      },
      {
        id: 'twoPath',
        position: { x: 280, y: 230 },
        data: { label: 'Two-Path Workload Router' },
        style: {
          backgroundColor: '#312e81',
          color: '#c7d2fe',
          border: selectedComponentId === 'twoPath' ? '2px solid #818cf8' : '1px solid #4338ca',
          padding: '12px 18px',
          fontWeight: 700,
          fontSize: '13px',
          width: 260,
          textAlign: 'center',
        },
      },
      // Path A: Low Latency SQS
      {
        id: 'sqs',
        position: { x: 120, y: 340 },
        data: { label: 'Path A: SQS / ElasticMQ Task Queue' },
        style: {
          backgroundColor: filterPath === 'pathB' ? '#1e293b' : '#064e3b',
          color: filterPath === 'pathB' ? '#64748b' : '#6ee7b7',
          border: selectedComponentId === 'sqs' ? '2px solid #10b981' : '1px solid #047857',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
          opacity: filterPath === 'pathB' ? 0.35 : 1,
        },
      },
      {
        id: 'keda',
        position: { x: 120, y: 440 },
        data: { label: 'KEDA Scaler (0 -> N Replicas)' },
        style: {
          backgroundColor: filterPath === 'pathB' ? '#1e293b' : '#064e3b',
          color: filterPath === 'pathB' ? '#64748b' : '#6ee7b7',
          border: selectedComponentId === 'keda' ? '2px solid #10b981' : '1px solid #047857',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
          opacity: filterPath === 'pathB' ? 0.35 : 1,
        },
      },
      // Path B: Batch DAG Kueue
      {
        id: 'kueue',
        position: { x: 460, y: 340 },
        data: { label: 'Path B: Kueue Admission + Kyverno' },
        style: {
          backgroundColor: filterPath === 'pathA' ? '#1e293b' : '#581c87',
          color: filterPath === 'pathA' ? '#64748b' : '#e9d5ff',
          border: selectedComponentId === 'kueue' ? '2px solid #a855f7' : '1px solid #7e22ce',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
          opacity: filterPath === 'pathA' ? 0.35 : 1,
        },
      },
      // Central Routing Engine
      {
        id: 'router',
        position: { x: 280, y: 550 },
        data: { label: 'Deterministic Provider Router' },
        style: {
          backgroundColor: '#1e1b4b',
          color: '#a5b4fc',
          border: selectedComponentId === 'router' ? '2px solid #6366f1' : '1px solid #4338ca',
          padding: '14px 20px',
          fontWeight: 700,
          fontSize: '13px',
          width: 260,
          textAlign: 'center',
        },
      },
      // Workers
      {
        id: 'localWorker',
        position: { x: 120, y: 660 },
        data: { label: 'Local RTX 5070 Ti Worker ($0/tok)' },
        style: {
          backgroundColor: '#064e3b',
          color: '#6ee7b7',
          border: selectedComponentId === 'localWorker' ? '2px solid #10b981' : '1px solid #059669',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
        },
      },
      {
        id: 'cloudWorker',
        position: { x: 460, y: 660 },
        data: { label: 'Cloud Spillover (RunPod / Bedrock)' },
        style: {
          backgroundColor: '#701a75',
          color: '#f5d0fe',
          border: selectedComponentId === 'cloudWorker' ? '2px solid #d946ef' : '1px solid #a21caf',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
        },
      },
      // Storage & Telemetry
      {
        id: 'storage',
        position: { x: 120, y: 780 },
        data: { label: 'AWS S3 & CloudFront CDN (Artifacts)' },
        style: {
          backgroundColor: '#0f172a',
          color: '#38bdf8',
          border: selectedComponentId === 'storage' ? '2px solid #38bdf8' : '1px solid #0284c7',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
        },
      },
      {
        id: 'telemetry',
        position: { x: 460, y: 780 },
        data: { label: 'OTel Distributed Traces & Metrics' },
        style: {
          backgroundColor: '#0f172a',
          color: '#facc15',
          border: selectedComponentId === 'telemetry' ? '2px solid #facc15' : '1px solid #ca8a04',
          padding: '12px 16px',
          fontWeight: 600,
          fontSize: '12px',
          width: 240,
          textAlign: 'center',
        },
      },
    ];
  }, [selectedComponentId, filterPath]);

  // Edges
  const edges: Edge[] = useMemo(() => {
    return [
      { id: 'e-client-auth', source: 'client', target: 'auth', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-auth-twoPath', source: 'auth', target: 'twoPath', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-twoPath-sqs', source: 'twoPath', target: 'sqs', label: 'Single-hop (Path A)', animated: filterPath !== 'pathB', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-twoPath-kueue', source: 'twoPath', target: 'kueue', label: 'Batch DAG (Path B)', animated: filterPath !== 'pathA', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-sqs-keda', source: 'sqs', target: 'keda', animated: filterPath !== 'pathB', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-keda-router', source: 'keda', target: 'router', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-kueue-router', source: 'kueue', target: 'router', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-router-local', source: 'router', target: 'localWorker', label: 'SLO OK + Headroom', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-router-cloud', source: 'router', target: 'cloudWorker', label: 'SLO Risk / Proprietary', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-local-storage', source: 'localWorker', target: 'storage', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-cloud-storage', source: 'cloudWorker', target: 'storage', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-local-telemetry', source: 'localWorker', target: 'telemetry', markerEnd: { type: MarkerType.ArrowClosed } },
      { id: 'e-cloud-telemetry', source: 'cloudWorker', target: 'telemetry', markerEnd: { type: MarkerType.ArrowClosed } },
    ];
  }, [filterPath]);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Interactive Workload Lifecycle Path (React Flow)
          </h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Click any architecture component to inspect protocol boundaries, telemetry metrics, and fault-tolerance mechanics.
          </p>
        </div>

        {/* Path Filter Toggles */}
        <div style={{ display: 'flex', gap: '6px', backgroundColor: '#0f172a', padding: '4px', borderRadius: '8px', border: '1px solid #1e293b' }}>
          <button
            onClick={() => setFilterPath('all')}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: filterPath === 'all' ? '#6366f1' : 'transparent',
              color: filterPath === 'all' ? '#ffffff' : '#94a3b8',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            All Workload Paths
          </button>
          <button
            onClick={() => setFilterPath('pathA')}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: filterPath === 'pathA' ? '#10b981' : 'transparent',
              color: filterPath === 'pathA' ? '#ffffff' : '#94a3b8',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Path A: SQS + KEDA
          </button>
          <button
            onClick={() => setFilterPath('pathB')}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: filterPath === 'pathB' ? '#a855f7' : 'transparent',
              color: filterPath === 'pathB' ? '#ffffff' : '#94a3b8',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Path B: Flyte + Kueue
          </button>
        </div>
      </div>

      {/* Main Flow Canvas and Inspector Split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px' }}>
        {/* Canvas */}
        <div
          style={{
            height: '680px',
            backgroundColor: '#090d16',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={(_event, node) => setSelectedComponentId(node.id)}
            fitView
          >
            <Background color="#1e293b" gap={16} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                if (n.id.includes('local')) return '#10b981';
                if (n.id.includes('cloud')) return '#d946ef';
                if (n.id.includes('router') || n.id.includes('twoPath')) return '#6366f1';
                return '#334155';
              }}
              style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
            />
          </ReactFlow>
        </div>

        {/* Inspector Side Panel */}
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            overflowY: 'auto',
            maxHeight: '680px',
          }}
        >
          <div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#818cf8',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                padding: '2px 8px',
                borderRadius: '6px',
              }}
            >
              {selectedComponent.category}
            </span>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: '8px 0 0 0' }}>
              {selectedComponent.title}
            </h3>
          </div>

          <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, margin: 0 }}>
            {selectedComponent.description}
          </p>

          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', marginBottom: '8px' }}>
              Standard Protocols:
            </h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {selectedComponent.protocols.map((proto) => (
                <span
                  key={proto}
                  style={{
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    padding: '3px 8px',
                    backgroundColor: '#1e293b',
                    color: '#e2e8f0',
                    borderRadius: '6px',
                    border: '1px solid #334155',
                  }}
                >
                  {proto}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', marginBottom: '8px' }}>
              Telemetry Metrics:
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {selectedComponent.metrics.map((m) => (
                <div
                  key={m}
                  style={{
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#34d399',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {m}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', marginBottom: '8px' }}>
              Monitored Failure Modes:
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {selectedComponent.failureModes.map((f) => (
                <div
                  key={f}
                  style={{
                    fontSize: '11px',
                    color: '#f87171',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                  }}
                >
                  ✕ {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

