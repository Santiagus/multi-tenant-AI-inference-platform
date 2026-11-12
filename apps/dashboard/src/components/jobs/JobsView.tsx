import { useEffect, useState, useMemo, type CSSProperties } from 'react';
import { StatCard } from '../common/StatCard';
import { StatusBadge } from '../common/Badge';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import { SubmitJobModal } from './SubmitJobModal';
import { JobDetailModal } from './JobDetailModal';
import { DlqModal } from './DlqModal';
import type { DlqMessage, JobItem, RoutingPreference } from '../../types';

interface JobsViewProps {
  jobs: JobItem[];
  dlqMessages: DlqMessage[];
  isLoading: boolean;
  onRefresh: () => void;
  onSubmitJob: (payload: {
    model_id: string;
    routing_preference: RoutingPreference;
    priority: number;
    max_retries: number;
    input: { prompt: string; parameters?: Record<string, unknown> };
  }) => Promise<void>;
  onCancelJob: (jobId: string) => Promise<void>;
  onRetryJob?: (jobId: string) => Promise<void>;
  onReapExpired?: () => Promise<void>;
  onDiscardDlqMessage?: (messageId: string, tenantId: string) => Promise<void>;
  onInspectJobFromDlq?: (jobId: string, tenantId: string) => Promise<JobItem | null>;
  onTriggerWorker: () => Promise<void>;
  isProcessingWorker: boolean;
  inferenceMode?: 'mock' | 'real';
  onToggleInferenceMode?: (mode: 'mock' | 'real') => Promise<void>;
  workerFeedback?: string | null;
  /** True when the header tenant filter is All Tenants. Per-tenant aggregation is only meaningful then. */
  viewingAllTenants?: boolean;
}

export const ALL_PLATFORM_PROVIDERS = [
  { id: 'local', name: 'Local' },
  { id: 'runpod', name: 'RunPod' },
  { id: 'vast_ai', name: 'Vast.ai' },
  { id: 'baseten', name: 'Baseten' },
  { id: 'nebius', name: 'Nebius' },
  { id: 'jarvislabs', name: 'JarvisLabs' },
  { id: 'coreweave', name: 'CoreWeave Forge' },
  { id: 'fal', name: 'fal.ai' },
  { id: 'runware', name: 'Runware' },
  { id: 'hivenet', name: 'Hivenet' },
  { id: 'wavespeed', name: 'WaveSpeed' },
  { id: 'neocloudz', name: 'NeoCloudz' },
  { id: 'bedrock', name: 'AWS Bedrock' },
  { id: 'sagemaker', name: 'AWS SageMaker' },
];

/** Collapse legacy local adapter ids (local_pytorch / local_cpu_worker) into `local`. */
export function normalizeProviderId(provider: string | null | undefined, routing = ''): string {
  const p = (provider || '').toLowerCase();
  if (!p || p === 'local_pytorch' || p === 'local_cpu_worker' || p === 'local') return 'local';
  if (routing.includes('local') && !p) return 'local';
  return p;
}

const PLACEMENT_EXECUTION_MODES = new Set([
  'on_demand',
  'spot',
  'serverless',
  'token_factory',
  'local',
  'pay_per_call',
]);

export function getJobExecutionMode(j: JobItem): string {
  // Placement economics only — ignore inference mock/live labels if present on execution_mode.
  if (j.execution_mode && PLACEMENT_EXECUTION_MODES.has(j.execution_mode)) {
    return j.execution_mode;
  }
  if (
    j.routing_preference.includes('local') ||
    j.provider === 'local_pytorch' ||
    j.provider === 'local' ||
    j.provider === 'local_cpu_worker'
  ) {
    return 'local';
  }
  if (j.provider === 'jarvislabs' || j.provider === 'bedrock') return 'token_factory';
  if (j.provider === 'baseten' || j.provider === 'wavespeed') return 'serverless';
  if (j.provider === 'runware' || j.provider === 'fal') return 'pay_per_call';
  if (j.provider === 'runpod' || j.provider === 'vast_ai' || j.provider === 'coreweave' || j.provider === 'hivenet') return 'spot';
  return 'on_demand';
}

function getJobResultMetadata(j: JobItem): Record<string, unknown> {
  const result = (j.result ?? {}) as Record<string, unknown>;
  const nested = (result.metadata as Record<string, unknown> | undefined) ?? {};
  // Showcase / worker payloads often put hardware + engine on the result root and again under metadata.
  return { ...result, ...nested } as Record<string, unknown>;
}

/**
 * Normalize worker engine ids into short UI labels.
 * When the worker stored `auto`, derive the concrete engine from the telemetry backend name.
 */
export function formatEngineLabel(
  engineExecuted: string,
  backend = '',
  engineRequested = ''
): string {
  const executed = engineExecuted.toLowerCase().trim();
  const requested = engineRequested.toLowerCase().trim();
  const b = backend.toLowerCase().trim();

  const mapConcrete = (value: string): string | null => {
    if (!value || value === 'auto') return null;
    if (value === 'torch-compile' || value === 'torch_compile' || value === 'compile') return 'Pytorch 2.x';
    if (value === 'torchscript' || value === 'torch_script') return 'torchscript';
    if (value === 'torchscript_auto' || value === 'torchscript-auto') return 'TorchScript_auto';
    if (value === 'eager') return 'eager';
    if (value === 'numpy' || value === 'numpy_fallback') return 'numpy';
    return value;
  };

  const concrete = mapConcrete(executed);
  if (concrete) return concrete;

  if (b.includes('numpy')) return 'numpy';
  if (b.includes('torch_compile') || b.includes('torch-compile') || /compile/.test(b)) {
    return 'Pytorch 2.x';
  }
  if (b.includes('torchscript')) {
    return requested === 'auto' || executed === 'auto' ? 'TorchScript_auto' : 'torchscript';
  }
  if (b.startsWith('pytorch') || b === 'local_cpu_worker' || b.endsWith('_cpu') || b.endsWith('_cuda')) {
    // AUTO/EAGER backends are named pytorch_{quant_}{cpu|cuda} — treat as eager.
    return 'eager';
  }

  const fromRequested = mapConcrete(requested);
  if (fromRequested) return fromRequested;

  return 'eager';
}

/**
 * Resolves whether a job ran (or was requested as) mock vs real inference.
 * Prefers worker-persisted metadata over routing preference; returns null when unknown.
 */
export function getJobInferenceMode(j: JobItem): 'mock' | 'real' | null {
  if (j.inference_mode === 'mock' || j.inference_mode === 'real') return j.inference_mode;
  if (typeof j.is_mocked === 'boolean') return j.is_mocked ? 'mock' : 'real';

  const metadata = getJobResultMetadata(j);

  if (typeof metadata.is_mocked === 'boolean') {
    return metadata.is_mocked ? 'mock' : 'real';
  }

  const execMode = String(metadata.execution_mode ?? '').toLowerCase();
  if (execMode === 'mock') return 'mock';
  if (execMode === 'live' || execMode === 'real') return 'real';

  if (j.routing_preference === 'mock') return 'mock';

  // Painted showcase jobs are simulated fixtures (mock economics / no live worker pass).
  if (j.job_id.startsWith('00000000-') || metadata.showcase === true) return 'mock';

  if (metadata.production_weights === true || metadata.weights === 'production') return 'real';

  const telemetry = (metadata.telemetry as Record<string, unknown> | undefined) ?? {};
  const vramPeak = Number(telemetry.vram_peak_mb ?? metadata.vram_peak_mb ?? 0);
  if (vramPeak > 64 && (j.duration_ms ?? 0) > 100) return 'real';

  // Legacy local_cpu_worker / ultra-short local passes without explicit flags were mock paths.
  if (
    (j.provider === 'local_cpu_worker' || j.provider === 'local_pytorch' || j.provider === 'local') &&
    (j.duration_ms ?? 0) > 0 &&
    (j.duration_ms ?? 0) <= 50
  ) {
    return 'mock';
  }

  // Terminal jobs that never wrote worker metadata: treat ultra-short / never-started as mock demos.
  if (
    (j.status === 'FAILED' || j.status === 'CANCELLED') &&
    (j.duration_ms ?? 0) > 0 &&
    (j.duration_ms ?? 0) <= 50
  ) {
    return 'mock';
  }

  return null;
}

const HARDWARE_VRAM_GB: Record<string, number> = {
  'RTX 5070 Ti': 16,
  'RTX 4090': 24,
  'RTX 5090 Blackwell': 32,
  'RTX 5090': 32,
  'L4 Tensor Core': 24,
  L4: 24,
  'H200 SXM': 141,
  H200: 141,
  'H100 SXM5': 80,
  H100: 80,
  'A100 80GB': 80,
  A100: 80,
  L40S: 48,
  A6000: 48,
  'Inferentia2 / G5': 24,
};

export function formatHardwareName(hw: string): string {
  if (!hw) return '';
  let cleaned = hw
    .replace(/^NVIDIA\s+(GeForce\s+)?/i, '')
    .replace(/Token Factory MaaS.*/i, 'Token Factory')
    .replace(/Distributed Tensor Core Pipeline.*/i, 'Tensor Core Pipeline')
    .replace(/AWS Bedrock Managed Neural Cluster/i, 'AWS Bedrock')
    .replace(/AWS Inferentia2 \/ G5 Tensor Cluster/i, 'Inferentia2 / G5')
    .replace(/CPU Xeon\/EPYC Fallback/i, 'CPU Fallback')
    .replace(/^Intel\/AMD\s*CPU$/i, 'CPU')
    .trim();

  // Normalize "24GB" / "(24GB VRAM)" → keep bare name, then re-attach canonical VRAM.
  const existingGb = cleaned.match(/(\d+)\s*GB/i)?.[1];
  cleaned = cleaned
    .replace(/\s*\(\s*\d+\s*GB[^\)]*\)/gi, '')
    .replace(/\s+\d+\s*GB\b/gi, '')
    .trim();

  // Short CPU SKUs: "AMD Ryzen 9 7900 12-Core Processor" → "Ryzen 9 7900"
  if (/ryzen|epyc|xeon|core\s*i\d|intel\/amd|\bcpu\b|fallback/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/\(R\)|\(TM\)/gi, '')
      .replace(/\b\d+-Core Processor\b/i, '')
      .replace(/\bProcessor\b/i, '')
      .replace(/^AMD\s+/i, '')
      .replace(/^Intel\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned || /^cpu$/i.test(cleaned)) return cleaned || 'CPU';
    return cleaned;
  }

  if (/token factory/i.test(cleaned) || /bedrock/i.test(cleaned)) {
    return cleaned;
  }

  let vram = existingGb ? Number(existingGb) : undefined;
  if (!vram) {
    for (const [name, gb] of Object.entries(HARDWARE_VRAM_GB)) {
      if (cleaned === name || cleaned.startsWith(name) || name.startsWith(cleaned)) {
        vram = gb;
        break;
      }
    }
  }

  return vram ? `${cleaned} (${vram} GB)` : cleaned;
}

/** Device class + engine, e.g. GPU/torchscript or CPU/eager — never the provider id. */
export function getJobComputeLabel(j: JobItem): string {
  const metadata = getJobResultMetadata(j);
  const telemetry = (metadata.telemetry as Record<string, unknown> | undefined) ?? {};
  const rawExecuted = String(metadata.engine_executed ?? metadata.engine ?? '');
  const rawRequested = String(metadata.engine_requested ?? '');
  const backend = String(telemetry.backend ?? metadata.backend ?? '');
  const engine = formatEngineLabel(rawExecuted, backend, rawRequested);

  const deviceType = String(telemetry.device_type ?? metadata.device ?? '').toLowerCase();
  const hw = getJobHardware(j);
  const isCpu =
    j.routing_preference.includes('cpu') ||
    j.provider === 'local_cpu_worker' ||
    deviceType === 'cpu' ||
    /cpu|ryzen|epyc|xeon|core\s*i\d/i.test(hw) ||
    /_cpu\b|cpu_worker/i.test(backend) ||
    /cpu/i.test(rawExecuted);

  return `${isCpu ? 'CPU' : 'GPU'}/${engine}`;
}

export function formatModelName(modelId: string): string {
  if (!modelId) return '';
  const afterSlash = modelId.split('/').pop() || modelId;
  return afterSlash.replace(/^(anthropic|meta|amazon|mistral)\./i, '');
}

export function formatTimeAgo(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  if (isNaN(diffMs)) return '—';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function getProviderBadgeLabel(j: JobItem): { label: string; isAuto: boolean } {
  const isAuto = !j.provider || j.routing_preference?.toLowerCase() === 'auto';
  if (!isAuto && j.provider) {
    const normalized = normalizeProviderId(j.provider, j.routing_preference);
    return { label: normalized.toUpperCase(), isAuto: false };
  }

  const prov = j.provider;
  const metadata = ((j.result as any)?.metadata || (j.result as any) || {}) as Record<string, unknown>;
  const engine = (metadata.engine_executed || metadata.engine || 'torchscript') as string;
  const hw = getJobHardware(j);
  const isCpu =
    j.routing_preference.includes('cpu') ||
    prov === 'local_cpu_worker' ||
    metadata.device === 'cpu' ||
    hw.toLowerCase().includes('cpu');

  if (!prov && (j.status === 'QUEUED' || j.status === 'SUBMITTED')) {
    if (j.model_id.includes('claude') || j.model_id.startsWith('anthropic.')) {
      return { label: 'AUTO (bedrock)', isAuto: true };
    }
    if (j.model_id.includes('70B') || j.model_id.includes('DeepSeek')) {
      return { label: 'AUTO (runpod)', isAuto: true };
    }
    return { label: isCpu ? `AUTO (local/CPU/${engine})` : 'AUTO (local/GPU)', isAuto: true };
  }

  if (prov === 'local_pytorch' || prov === 'local_cpu_worker' || prov === 'local' || !prov) {
    if (isCpu) {
      return { label: `AUTO (local/CPU/${engine})`, isAuto: true };
    }
    return { label: 'AUTO (local/GPU)', isAuto: true };
  }

  return { label: `AUTO (${prov})`, isAuto: true };
}

export function getJobHardware(j: JobItem): string {
  const metadata = getJobResultMetadata(j);
  const telemetry = (metadata.telemetry as Record<string, unknown> | undefined) ?? {};
  let hw = '';
  if (typeof metadata.hardware === 'string' && metadata.hardware) hw = metadata.hardware;
  else if (typeof telemetry.device_name === 'string' && telemetry.device_name) hw = telemetry.device_name;
  else if ((j.result as any)?.device) hw = String((j.result as any).device);
  else if (j.hardware) hw = j.hardware;
  else if (j.routing_preference.includes('cpu')) hw = 'CPU Fallback';
  else if (
    j.routing_preference.includes('local') ||
    j.provider === 'local_pytorch' ||
    j.provider === 'local' ||
    j.provider === 'local_cpu_worker'
  ) {
    hw = j.routing_preference.includes('cpu') || j.provider === 'local_cpu_worker' ? 'CPU Fallback' : 'RTX 5070 Ti';
  } else if (j.provider === 'runpod' || (!j.provider && j.routing_preference.includes('runpod'))) {
    if (j.model_id.includes('70B') || j.model_id.includes('DeepSeek') || j.model_id.includes('deepseek')) {
      hw = 'H100 SXM5';
    } else {
      hw = 'RTX 4090';
    }
  } else if (j.provider === 'vast_ai' || (!j.provider && j.routing_preference.includes('vast'))) {
    hw = 'RTX 5090 Blackwell';
  } else if (j.provider === 'baseten') {
    hw = 'L4 Tensor Core';
  } else if (j.provider === 'nebius') {
    hw = 'H200 SXM';
  } else if (j.provider === 'jarvislabs') {
    hw = 'Token Factory';
  } else if (j.provider === 'fal' || j.provider === 'runware') {
    hw = 'Tensor Core Pipeline';
  } else if (j.provider === 'bedrock' || (!j.provider && j.routing_preference.includes('bedrock'))) {
    hw = 'AWS Bedrock';
  } else if (j.provider === 'sagemaker' || (!j.provider && j.routing_preference.includes('sagemaker'))) {
    hw = 'Inferentia2 / G5';
  } else if (j.provider === 'coreweave' || j.provider === 'hivenet' || j.provider === 'wavespeed') {
    hw = 'H100 SXM5';
  } else if (!j.provider) {
    // Failed/cancelled before provider claim — still show a planned SKU from routing/model.
    if (j.routing_preference.includes('gpu') || j.routing_preference.includes('local')) {
      hw = 'RTX 5070 Ti';
    } else if (j.model_id.includes('70B') || j.model_id.includes('DeepSeek') || j.model_id.includes('deepseek')) {
      hw = 'H100 SXM5';
    } else if (j.status === 'FAILED' || j.status === 'CANCELLED') {
      hw = 'RTX 4090';
    } else {
      hw = '';
    }
  } else {
    hw = 'H100 SXM5';
  }
  return formatHardwareName(hw);
}

export function JobsView({
  jobs,
  dlqMessages,
  isLoading,
  onRefresh,
  onSubmitJob,
  onCancelJob,
  onRetryJob,
  onReapExpired,
  onDiscardDlqMessage,
  onInspectJobFromDlq,
  onTriggerWorker,
  isProcessingWorker,
  workerFeedback = null,
  viewingAllTenants = false,
}: JobsViewProps) {
  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isDlqModalOpen, setIsDlqModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modelFilter, setModelFilter] = useState<string>('ALL');
  const [tenantFilter, setTenantFilter] = useState<string>('ALL');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [modeFilter, setModeFilter] = useState<string>('ALL');
  const [inferenceFilter, setInferenceFilter] = useState<string>('ALL');
  const [computeFilter, setComputeFilter] = useState<string>('ALL');
  const [breakdownTab, setBreakdownTab] = useState<'model' | 'tenant' | 'provider' | 'gpu'>('model');
  const [showModelStats, setShowModelStats] = useState<boolean>(true);
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (viewingAllTenants) return;
    setTenantFilter('ALL');
    setBreakdownTab((tab) => (tab === 'tenant' ? 'model' : tab));
  }, [viewingAllTenants]);

  const toggleExpandJobId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Global & Lifecycle Stats
  const stats = useMemo(() => {
    let queued = 0;
    let processing = 0;
    let retrying = 0;
    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    let totalTokens = 0;
    let totalCostMicrocents = 0;

    for (const j of jobs) {
      if (j.status === 'SUCCEEDED') succeeded++;
      else if (j.status === 'FAILED') failed++;
      else if (j.status === 'CANCELLED') cancelled++;
      else if (j.status === 'PROCESSING') processing++;
      else if (j.status === 'RETRYING') retrying++;
      else if (j.status === 'QUEUED' || j.status === 'SUBMITTED') queued++;

      totalTokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0);
      totalCostMicrocents += j.usage?.cost_microcents ?? 0;
    }

    const inFlight = queued + processing + retrying;

    return {
      total: jobs.length,
      queued,
      processing,
      retrying,
      succeeded,
      failed,
      cancelled,
      inFlight,
      dlqCount: dlqMessages.length,
      totalTokens,
      costUsd: (totalCostMicrocents / 100_000_000).toFixed(4),
    };
  }, [jobs, dlqMessages]);

  // Model Stats Breakdown
  const modelStats = useMemo(() => {
    const map: Record<
      string,
      {
        modelId: string;
        total: number;
        queued: number;
        processing: number;
        retrying: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        totalTokens: number;
        totalCostMicrocents: number;
        durations: number[];
      }
    > = {};

    for (const j of jobs) {
      if (!map[j.model_id]) {
        map[j.model_id] = {
          modelId: j.model_id,
          total: 0,
          queued: 0,
          processing: 0,
          retrying: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
          totalTokens: 0,
          totalCostMicrocents: 0,
          durations: [],
        };
      }
      const entry = map[j.model_id];
      entry.total++;
      if (j.status === 'SUCCEEDED') entry.succeeded++;
      else if (j.status === 'FAILED') entry.failed++;
      else if (j.status === 'CANCELLED') entry.cancelled++;
      else if (j.status === 'PROCESSING') entry.processing++;
      else if (j.status === 'RETRYING') entry.retrying++;
      else if (j.status === 'QUEUED' || j.status === 'SUBMITTED') entry.queued++;

      entry.totalTokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0);
      entry.totalCostMicrocents += j.usage?.cost_microcents ?? 0;
      if (j.duration_ms && j.duration_ms > 0) {
        entry.durations.push(j.duration_ms);
      }
    }

    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .map((entry) => {
        const avgDuration =
          entry.durations.length > 0
            ? Math.round(entry.durations.reduce((acc, v) => acc + v, 0) / entry.durations.length)
            : 0;
        const successRate = entry.total > 0 ? ((entry.succeeded / entry.total) * 100).toFixed(1) : '0.0';
        const costUsd = (entry.totalCostMicrocents / 100_000_000).toFixed(4);
        return {
          ...entry,
          avgDuration,
          successRate,
          costUsd,
        };
      });
  }, [jobs]);

  // Tenant Stats Breakdown
  const tenantStats = useMemo(() => {
    const map: Record<
      string,
      {
        tenantId: string;
        total: number;
        queued: number;
        processing: number;
        retrying: number;
        succeeded: number;
        failed: number;
        cancelled: number;
        totalTokens: number;
        totalCostMicrocents: number;
        durations: number[];
      }
    > = {};

    for (const j of jobs) {
      const tid = j.tenant_id || 'tenant-default';
      if (!map[tid]) {
        map[tid] = {
          tenantId: tid,
          total: 0,
          queued: 0,
          processing: 0,
          retrying: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
          totalTokens: 0,
          totalCostMicrocents: 0,
          durations: [],
        };
      }
      const entry = map[tid];
      entry.total++;
      if (j.status === 'SUCCEEDED') entry.succeeded++;
      else if (j.status === 'FAILED') entry.failed++;
      else if (j.status === 'CANCELLED') entry.cancelled++;
      else if (j.status === 'PROCESSING') entry.processing++;
      else if (j.status === 'RETRYING') entry.retrying++;
      else if (j.status === 'QUEUED' || j.status === 'SUBMITTED') entry.queued++;

      entry.totalTokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0);
      entry.totalCostMicrocents += j.usage?.cost_microcents ?? 0;
      if (j.duration_ms && j.duration_ms > 0) entry.durations.push(j.duration_ms);
    }

    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .map((entry) => ({
        ...entry,
        avgDuration:
          entry.durations.length > 0
            ? Math.round(entry.durations.reduce((a, b) => a + b, 0) / entry.durations.length)
            : 0,
        successRate: entry.total > 0 ? ((entry.succeeded / entry.total) * 100).toFixed(1) : '0.0',
        costUsd: (entry.totalCostMicrocents / 100_000_000).toFixed(4),
      }));
  }, [jobs]);

  // Provider Stats Breakdown
  const providerStats = useMemo(() => {
    const map: Record<
      string,
      {
        provider: string;
        total: number;
        succeeded: number;
        failed: number;
        inFlight: number;
        totalTokens: number;
        totalCostMicrocents: number;
        durations: number[];
      }
    > = {};

    for (const j of jobs) {
      const prov = normalizeProviderId(j.provider, j.routing_preference);

      if (!map[prov]) {
        map[prov] = {
          provider: prov,
          total: 0,
          succeeded: 0,
          failed: 0,
          inFlight: 0,
          totalTokens: 0,
          totalCostMicrocents: 0,
          durations: [],
        };
      }
      const entry = map[prov];
      entry.total++;
      if (j.status === 'SUCCEEDED') entry.succeeded++;
      else if (j.status === 'FAILED') entry.failed++;
      else if (['QUEUED', 'PROCESSING', 'RETRYING', 'SUBMITTED'].includes(j.status)) entry.inFlight++;

      entry.totalTokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0);
      entry.totalCostMicrocents += j.usage?.cost_microcents ?? 0;
      if (j.duration_ms && j.duration_ms > 0) entry.durations.push(j.duration_ms);
    }

    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .map((entry) => ({
        ...entry,
        avgDuration:
          entry.durations.length > 0
            ? Math.round(entry.durations.reduce((a, b) => a + b, 0) / entry.durations.length)
            : 0,
        successRate: entry.total > 0 ? ((entry.succeeded / entry.total) * 100).toFixed(1) : '0.0',
        costUsd: (entry.totalCostMicrocents / 100_000_000).toFixed(4),
      }));
  }, [jobs]);

  // GPU Hardware Stats Breakdown
  const gpuStats = useMemo(() => {
    const map: Record<
      string,
      {
        hardware: string;
        total: number;
        succeeded: number;
        failed: number;
        totalTokens: number;
        totalCostMicrocents: number;
        durations: number[];
      }
    > = {};

    for (const j of jobs) {
      const hw = getJobHardware(j);

      if (!map[hw]) {
        map[hw] = {
          hardware: hw,
          total: 0,
          succeeded: 0,
          failed: 0,
          totalTokens: 0,
          totalCostMicrocents: 0,
          durations: [],
        };
      }
      const entry = map[hw];
      entry.total++;
      if (j.status === 'SUCCEEDED') entry.succeeded++;
      else if (j.status === 'FAILED') entry.failed++;

      entry.totalTokens += (j.usage?.prompt_tokens ?? 0) + (j.usage?.completion_tokens ?? 0);
      entry.totalCostMicrocents += j.usage?.cost_microcents ?? 0;
      if (j.duration_ms && j.duration_ms > 0) entry.durations.push(j.duration_ms);
    }

    return Object.values(map)
      .sort((a, b) => b.total - a.total)
      .map((entry) => ({
        ...entry,
        avgDuration:
          entry.durations.length > 0
            ? Math.round(entry.durations.reduce((a, b) => a + b, 0) / entry.durations.length)
            : 0,
        successRate: entry.total > 0 ? ((entry.succeeded / entry.total) * 100).toFixed(1) : '0.0',
        costUsd: (entry.totalCostMicrocents / 100_000_000).toFixed(4),
      }));
  }, [jobs]);

  // Filtered jobs list
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'IN_FLIGHT') {
          if (!['PROCESSING', 'RETRYING'].includes(job.status)) {
            return false;
          }
        } else if (statusFilter === 'QUEUED') {
          if (!['QUEUED', 'SUBMITTED'].includes(job.status)) {
            return false;
          }
        } else if (job.status !== statusFilter) {
          return false;
        }
      }
      if (modeFilter !== 'ALL') {
        const mode = getJobExecutionMode(job);
        if (mode !== modeFilter) {
          return false;
        }
      }
      if (inferenceFilter !== 'ALL') {
        const inference = getJobInferenceMode(job);
        if (inference !== inferenceFilter) {
          return false;
        }
      }
      if (computeFilter !== 'ALL') {
        if (getJobComputeLabel(job) !== computeFilter) {
          return false;
        }
      }
      if (modelFilter !== 'ALL' && job.model_id !== modelFilter) {
        return false;
      }
      if (tenantFilter !== 'ALL' && (job.tenant_id || 'tenant-default') !== tenantFilter) {
        return false;
      }
      if (providerFilter !== 'ALL') {
        const prov = normalizeProviderId(job.provider, job.routing_preference);
        const wanted = normalizeProviderId(providerFilter);
        if (prov !== wanted) return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesId = job.job_id.toLowerCase().includes(query);
        const matchesModel = job.model_id.toLowerCase().includes(query);
        const matchesProvider = (job.provider || '').toLowerCase().includes(query);
        const matchesTenant = (job.tenant_id || '').toLowerCase().includes(query);
        return matchesId || matchesModel || matchesProvider || matchesTenant;
      }
      return true;
    });
  }, [
    jobs,
    statusFilter,
    modeFilter,
    inferenceFilter,
    computeFilter,
    modelFilter,
    tenantFilter,
    providerFilter,
    searchQuery,
  ]);

  const computeFilterOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const job of jobs) {
      labels.add(getJobComputeLabel(job));
    }
    return Array.from(labels).sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  // Model table sort
  const [modelSortKey, setModelSortKey] = useState<string>('total');
  const [modelSortDir, setModelSortDir] = useState<SortDirection>('desc');

  const handleModelSort = (col: string) => {
    if (modelSortKey === col) {
      setModelSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setModelSortKey(col);
      setModelSortDir(col === 'modelId' ? 'asc' : 'desc');
    }
  };

  const sortedModelStats = useMemo(() => {
    return genericSort(modelStats, modelSortKey, modelSortDir, (item, key) => {
      if (key === 'inFlight') return item.queued + item.processing + item.retrying;
      if (key === 'successRate') return parseFloat(item.successRate);
      if (key === 'costUsd') return parseFloat(item.costUsd);
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [modelStats, modelSortKey, modelSortDir]);

  // Jobs table sort
  const [jobSortKey, setJobSortKey] = useState<string>('created_at');
  const [jobSortDir, setJobSortDir] = useState<SortDirection>('desc');

  const handleJobSort = (col: string) => {
    if (jobSortKey === col) {
      setJobSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setJobSortKey(col);
      setJobSortDir(
        col === 'job_id' ||
        col === 'model_id' ||
        col === 'status' ||
        col === 'hardware' ||
        col === 'mode' ||
        col === 'inference' ||
        col === 'tenant_id'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const sortedJobs = useMemo(() => {
    return genericSort(filteredJobs, jobSortKey, jobSortDir, (item, key) => {
      if (key === 'mode') return getJobExecutionMode(item);
      if (key === 'hardware') return `${getJobComputeLabel(item)} ${getJobHardware(item)}`;
      if (key === 'inference') return getJobInferenceMode(item) ?? '';
      if (key === 'progress') return item.progress_pct ?? (item.status === 'SUCCEEDED' ? 100 : 0);
      if (key === 'tokens') {
        const inTok = item.usage?.prompt_tokens ?? 0;
        const outTok = item.usage?.completion_tokens ?? 0;
        return item.usage?.total_tokens ?? (inTok + outTok);
      }
      if (key === 'cost') return item.usage?.cost_microcents ?? 0;
      if (key === 'latency') return item.duration_ms ?? 0;
      return (item as unknown as Record<string, unknown>)[key];
    });
  }, [filteredJobs, jobSortKey, jobSortDir]);

  const headerFilterStyle: CSSProperties = {
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    border: '1px solid #334155',
    padding: '3px 4px',
    borderRadius: '4px',
    fontSize: '10px',
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Stat Cards - 1-row layout for 1200x1920 portrait & single-row view */}
      <div
        className="jobs-status-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: '12px',
        }}
      >
        <StatCard
          label="Failed"
          value={stats.failed}
          accentColor="#ef4444"
          active={statusFilter === 'FAILED'}
          onClick={() => setStatusFilter(statusFilter === 'FAILED' ? 'ALL' : 'FAILED')}
        />
        <StatCard
          label="Queued"
          value={stats.queued}
          accentColor="#f59e0b"
          active={statusFilter === 'QUEUED'}
          onClick={() => setStatusFilter(statusFilter === 'QUEUED' ? 'ALL' : 'QUEUED')}
        />
        <StatCard
          label="In Flight"
          value={stats.processing + stats.retrying}
          accentColor="#38bdf8"
          active={statusFilter === 'IN_FLIGHT'}
          onClick={() => setStatusFilter(statusFilter === 'IN_FLIGHT' ? 'ALL' : 'IN_FLIGHT')}
        />
        <StatCard
          label="Succeeded"
          value={stats.succeeded}
          accentColor="#10b981"
          active={statusFilter === 'SUCCEEDED'}
          onClick={() => setStatusFilter(statusFilter === 'SUCCEEDED' ? 'ALL' : 'SUCCEEDED')}
        />
        <StatCard
          label="Total"
          value={stats.total}
          accentColor="#6366f1"
          active={statusFilter === 'ALL'}
          onClick={() => {
            setStatusFilter('ALL');
            setModelFilter('ALL');
          }}
        />
      </div>

      {/* Multi-Dimensional Job Intelligence Breakdown Section */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#131d35',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', marginRight: '6px' }}>
              📊 Aggregations:
            </span>
            <button
              onClick={() => setBreakdownTab('model')}
              style={{
                backgroundColor: breakdownTab === 'model' ? '#3b82f6' : '#1e293b',
                color: breakdownTab === 'model' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Models ({modelStats.length})
            </button>
            {viewingAllTenants && (
              <button
                onClick={() => setBreakdownTab('tenant')}
                style={{
                  backgroundColor: breakdownTab === 'tenant' ? '#3b82f6' : '#1e293b',
                  color: breakdownTab === 'tenant' ? '#ffffff' : '#94a3b8',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Tenants ({tenantStats.length})
              </button>
            )}
            <button
              onClick={() => setBreakdownTab('provider')}
              style={{
                backgroundColor: breakdownTab === 'provider' ? '#3b82f6' : '#1e293b',
                color: breakdownTab === 'provider' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Providers ({providerStats.length})
            </button>
            <button
              onClick={() => setBreakdownTab('gpu')}
              style={{
                backgroundColor: breakdownTab === 'gpu' ? '#3b82f6' : '#1e293b',
                color: breakdownTab === 'gpu' ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              GPU Hardware ({gpuStats.length})
            </button>

            {modelFilter !== 'ALL' && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(56, 189, 248, 0.2)',
                  color: '#38bdf8',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Model: {modelFilter.split('/').pop()}
                <button
                  onClick={() => setModelFilter('ALL')}
                  style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            )}

            {tenantFilter !== 'ALL' && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(16, 185, 129, 0.2)',
                  color: '#10b981',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Tenant: {tenantFilter}
                <button
                  onClick={() => setTenantFilter('ALL')}
                  style={{ background: 'none', border: 'none', color: '#10b981', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            )}

            {providerFilter !== 'ALL' && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(168, 85, 247, 0.2)',
                  color: '#c084fc',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Provider: {providerFilter}
                <button
                  onClick={() => setProviderFilter('ALL')}
                  style={{ background: 'none', border: 'none', color: '#c084fc', cursor: 'pointer', fontWeight: 700, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <button
            onClick={() => setShowModelStats(!showModelStats)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {showModelStats ? '▲ Hide Details' : '▼ Show Details'}
          </button>
        </div>

        {showModelStats && (
          <div style={{ overflowX: 'auto' }}>
            <style>{`
              tr.agg-row { cursor: pointer; }
              tr.agg-row:hover { background-color: rgba(148, 163, 184, 0.08); }
            `}</style>
            {breakdownTab === 'model' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <SortableHeader column="modelId" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Model ID
                    </SortableHeader>
                    <SortableHeader column="total" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Total Jobs
                    </SortableHeader>
                    <SortableHeader column="inFlight" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      In Flight
                    </SortableHeader>
                    <SortableHeader column="successRate" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Success / Fail
                    </SortableHeader>
                    <SortableHeader column="avgDuration" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Avg Latency
                    </SortableHeader>
                    <SortableHeader column="totalTokens" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Total Tokens
                    </SortableHeader>
                    <SortableHeader column="costUsd" currentSortKey={modelSortKey} currentSortDir={modelSortDir} onSort={handleModelSort} style={{ padding: '10px 16px' }}>
                      Compute Cost ($)
                    </SortableHeader>
                  </tr>
                </thead>
                <tbody>
                  {sortedModelStats.map((m) => {
                    const isSelected = modelFilter === m.modelId;
                    return (
                      <tr
                        key={m.modelId}
                        className="agg-row"
                        title={isSelected ? 'Click to clear the model filter' : 'Click to filter jobs by this model'}
                        onClick={() => setModelFilter(isSelected ? 'ALL' : m.modelId)}
                        style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : undefined }}
                      >
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: '#f8fafc', fontFamily: 'monospace' }}>{m.modelId}</td>
                        <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>{m.total}</td>
                        <td style={{ padding: '10px 16px', color: '#fbbf24' }}>{m.queued + m.processing + m.retrying}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ color: '#34d399', fontWeight: 600 }}>{m.succeeded} ok</span>
                          {m.failed > 0 && <span style={{ color: '#f87171', marginLeft: '6px', fontWeight: 600 }}>/ {m.failed} fail</span>}
                          <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11px' }}>({m.successRate}%)</span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#94a3b8' }}>{m.avgDuration > 0 ? `${m.avgDuration} ms` : '—'}</td>
                        <td style={{ padding: '10px 16px', color: '#38bdf8', fontWeight: 500 }}>{m.totalTokens.toLocaleString()}</td>
                        <td style={{ padding: '10px 16px', color: '#f87171', fontWeight: 600 }}>${m.costUsd}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {breakdownTab === 'tenant' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Tenant ID</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Jobs</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>In Flight</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Success / Fail</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Avg Latency</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Tokens</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Compute Spend ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantStats.map((t) => {
                    const isSelected = tenantFilter === t.tenantId;
                    return (
                      <tr
                        key={t.tenantId}
                        className="agg-row"
                        title={isSelected ? 'Click to clear the tenant filter' : 'Click to filter jobs by this tenant'}
                        onClick={() => setTenantFilter(isSelected ? 'ALL' : t.tenantId)}
                        style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.1)' : undefined }}
                      >
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: '#10b981', fontFamily: 'monospace' }}>{t.tenantId}</td>
                        <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>{t.total}</td>
                        <td style={{ padding: '10px 16px', color: '#fbbf24' }}>{t.queued + t.processing + t.retrying}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ color: '#34d399', fontWeight: 600 }}>{t.succeeded} ok</span>
                          {t.failed > 0 && <span style={{ color: '#f87171', marginLeft: '6px', fontWeight: 600 }}>/ {t.failed} fail</span>}
                          <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11px' }}>({t.successRate}%)</span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#94a3b8' }}>{t.avgDuration > 0 ? `${t.avgDuration} ms` : '—'}</td>
                        <td style={{ padding: '10px 16px', color: '#38bdf8', fontWeight: 500 }}>{t.totalTokens.toLocaleString()}</td>
                        <td style={{ padding: '10px 16px', color: '#f87171', fontWeight: 600 }}>${t.costUsd}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {breakdownTab === 'provider' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Provider Name</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Jobs</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>In Flight</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Success / Fail</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Avg Latency</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Tokens</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Cost ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {providerStats.map((p) => {
                    const isSelected = providerFilter === p.provider;
                    return (
                      <tr
                        key={p.provider}
                        className="agg-row"
                        title={isSelected ? 'Click to clear the provider filter' : 'Click to filter jobs by this provider'}
                        onClick={() => setProviderFilter(isSelected ? 'ALL' : p.provider)}
                        style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.1)' : undefined }}
                      >
                        <td style={{ padding: '10px 16px', fontWeight: 700, color: '#c084fc' }}>{p.provider.toUpperCase()}</td>
                        <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>{p.total}</td>
                        <td style={{ padding: '10px 16px', color: '#fbbf24' }}>{p.inFlight}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ color: '#34d399', fontWeight: 600 }}>{p.succeeded} ok</span>
                          {p.failed > 0 && <span style={{ color: '#f87171', marginLeft: '6px', fontWeight: 600 }}>/ {p.failed} fail</span>}
                          <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11px' }}>({p.successRate}%)</span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#94a3b8' }}>{p.avgDuration > 0 ? `${p.avgDuration} ms` : '—'}</td>
                        <td style={{ padding: '10px 16px', color: '#38bdf8', fontWeight: 500 }}>{p.totalTokens.toLocaleString()}</td>
                        <td style={{ padding: '10px 16px', color: '#f87171', fontWeight: 600 }}>${p.costUsd}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {breakdownTab === 'gpu' && (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Hardware / GPU Type</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Workload Count</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Success / Fail</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Avg Latency</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Tokens</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Total Cost ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {gpuStats.map((g) => (
                    <tr key={g.hardware} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '10px 16px', fontWeight: 600, color: '#38bdf8' }}>{g.hardware}</td>
                      <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>{g.total}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>{g.succeeded} ok</span>
                        {g.failed > 0 && <span style={{ color: '#f87171', marginLeft: '6px', fontWeight: 600 }}>/ {g.failed} fail</span>}
                      </td>
                      <td style={{ padding: '10px 16px', color: '#94a3b8' }}>{g.avgDuration > 0 ? `${g.avgDuration} ms` : '—'}</td>
                      <td style={{ padding: '10px 16px', color: '#38bdf8', fontWeight: 500 }}>{g.totalTokens.toLocaleString()}</td>
                      <td style={{ padding: '10px 16px', color: '#f87171', fontWeight: 600 }}>${g.costUsd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Worker / enqueue controls (row actions live in the job detail modal) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          backgroundColor: '#0f172a',
          padding: '12px 16px',
          borderRadius: '12px',
          border: '1px solid #1e293b',
        }}
      >
          <button
            onClick={() => setIsDlqModalOpen(true)}
            style={{
              backgroundColor: '#1e293b',
              color: stats.dlqCount > 0 ? '#f43f5e' : '#94a3b8',
              border: `1px solid ${stats.dlqCount > 0 ? 'rgba(244, 63, 94, 0.4)' : '#334155'}`,
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            DLQ Messages ({stats.dlqCount})
          </button>

          {onReapExpired && (
            <button
              onClick={onReapExpired}
              style={{
                backgroundColor: '#1e293b',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Scans for queued jobs exceeding expiration TTL or retries and marks them FAILED"
            >
              ⏳ Reap Stale
            </button>
          )}

          <button
            data-testid="jobs-process-next-button"
            onClick={onTriggerWorker}
            disabled={isProcessingWorker}
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.45)',
              padding: '8px 15px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: isProcessingWorker ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            title="POST /v1/worker/process-next - Triggers background worker to poll and process next queued job from SQS"
          >
            <span>{isProcessingWorker ? '⏳' : '▶'}</span>
            <span>{isProcessingWorker ? 'Processing...' : 'Process Next (Worker)'}</span>
            {stats.queued > 0 && (
              <span
                style={{
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: '10px',
                }}
              >
                {stats.queued}
              </span>
            )}
          </button>

          {workerFeedback && (
            <span
              style={{
                fontSize: '12px',
                color: workerFeedback.includes('failed') ? '#f87171' : '#38bdf8',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid #334155',
                padding: '6px 12px',
                borderRadius: '6px',
              }}
            >
              {workerFeedback}
            </span>
          )}

          <button
            onClick={() => setIsSubmitModalOpen(true)}
            style={{
              backgroundColor: '#6366f1',
              color: '#ffffff',
              border: 'none',
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginLeft: 'auto',
            }}
          >
            + Submit Job
          </button>
          {viewingAllTenants && (
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Submits as tenant-default</span>
          )}
      </div>

      {/* Jobs Table — filters live in column headers for 1200×1900 fit */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="status"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '9%' }}
                  filter={
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by status"
                    >
                      <option value="ALL">All</option>
                      <option value="FAILED">Failed</option>
                      <option value="QUEUED">Queued</option>
                      <option value="IN_FLIGHT">In Flight</option>
                      <option value="SUCCEEDED">Succeeded</option>
                      <option value="PROCESSING">Processing</option>
                      <option value="RETRYING">Retrying</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  }
                >
                  Status
                </SortableHeader>
                <SortableHeader
                  column="job_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '6.5rem' }}
                  filter={
                    <input
                      type="text"
                      placeholder="00000000"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        ...headerFilterStyle,
                        cursor: 'text',
                        width: '8.5ch',
                        minWidth: '8.5ch',
                        maxWidth: '8.5ch',
                        fontFamily: 'monospace',
                        fontSize: '11px',
                      }}
                      aria-label="Search by job id prefix"
                      title="Filter by job id (prefix)"
                    />
                  }
                >
                  Job ID
                </SortableHeader>
                <SortableHeader
                  column="model_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: viewingAllTenants ? '14%' : '16%' }}
                  filter={
                    <select
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by model"
                    >
                      <option value="ALL">All</option>
                      {modelStats.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.modelId.split('/').pop() || m.modelId}
                        </option>
                      ))}
                    </select>
                  }
                >
                  Model
                </SortableHeader>
                {viewingAllTenants && (
                  <SortableHeader
                    column="tenant_id"
                    currentSortKey={jobSortKey}
                    currentSortDir={jobSortDir}
                    onSort={handleJobSort}
                    style={{ padding: '8px 6px', width: '10%' }}
                    filter={
                      <select
                        value={tenantFilter}
                        onChange={(e) => setTenantFilter(e.target.value)}
                        style={headerFilterStyle}
                        aria-label="Filter by tenant"
                      >
                        <option value="ALL">All</option>
                        {tenantStats.map((t) => (
                          <option key={t.tenantId} value={t.tenantId}>
                            {t.tenantId}
                          </option>
                        ))}
                      </select>
                    }
                  >
                    Tenant
                  </SortableHeader>
                )}
                <SortableHeader
                  column="hardware"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '14%' }}
                  filter={
                    <select
                      value={computeFilter}
                      onChange={(e) => setComputeFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by compute engine"
                    >
                      <option value="ALL">All</option>
                      {computeFilterOptions.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                  }
                >
                  Compute / HW
                </SortableHeader>
                <SortableHeader
                  column="mode"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '10%' }}
                  filter={
                    <select
                      value={modeFilter}
                      onChange={(e) => setModeFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by placement mode"
                    >
                      <option value="ALL">All</option>
                      <option value="spot">Spot</option>
                      <option value="on_demand">On-Demand</option>
                      <option value="serverless">Serverless</option>
                      <option value="token_factory">Token Factory</option>
                      <option value="pay_per_call">Pay-Per-Call</option>
                      <option value="local">Local</option>
                    </select>
                  }
                >
                  Placement
                </SortableHeader>
                <SortableHeader
                  column="inference"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '8%' }}
                  filter={
                    <select
                      value={inferenceFilter}
                      onChange={(e) => setInferenceFilter(e.target.value)}
                      style={headerFilterStyle}
                      aria-label="Filter by inference mode"
                    >
                      <option value="ALL">All</option>
                      <option value="mock">Mock</option>
                      <option value="real">Real</option>
                    </select>
                  }
                >
                  Inference
                </SortableHeader>
                <SortableHeader
                  column="progress"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '8%' }}
                >
                  Progress
                </SortableHeader>
                <SortableHeader
                  column="latency"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '8%' }}
                >
                  Duration
                </SortableHeader>
                <SortableHeader
                  column="cost"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '9%' }}
                >
                  Tokens
                </SortableHeader>
                <SortableHeader
                  column="created_at"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '8px 6px', width: '9%' }}
                >
                  Submitted
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {isLoading && jobs.length === 0 ? (
                <tr>
                  <td colSpan={viewingAllTenants ? 11 : 10} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
                    Loading inference jobs...
                  </td>
                </tr>
              ) : sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={viewingAllTenants ? 11 : 10} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
                    No inference jobs match the current filters. Click a row for job actions, or "+ Submit Job" to enqueue one.
                  </td>
                </tr>
              ) : (
                sortedJobs.map((job) => {
                  const inTok = job.usage?.prompt_tokens ?? 0;
                  const outTok = job.usage?.completion_tokens ?? 0;
                  const totalTok = (job.usage?.total_tokens ?? (inTok + outTok));
                  const costUsd = ((job.usage?.cost_microcents ?? 0) / 100_000_000).toFixed(5);
                  const progressPct = job.progress_pct ?? (job.status === 'SUCCEEDED' ? 100 : 0);
                  const mode = getJobExecutionMode(job);
                  const inference = getJobInferenceMode(job);
                  const hardware = getJobHardware(job);
                  const computeLabel = getJobComputeLabel(job);
                  const isIdExpanded = expandedJobIds.has(job.job_id);

                  return (
                    <tr
                      key={job.job_id}
                      onClick={() => setSelectedJob(job)}
                      style={{
                        borderBottom: '1px solid #1e293b',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e293b')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' }}>
                          <StatusBadge status={job.status} size="sm" />
                          {job.status === 'RETRYING' && (
                            <span
                              style={{
                                fontSize: '10px',
                                color: '#fbbf24',
                                fontWeight: 700,
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                whiteSpace: 'nowrap',
                              }}
                              title={`${job.retry_count} of ${job.max_retries ?? 3} retries used`}
                            >
                              {Math.max(0, (job.max_retries ?? 3) - job.retry_count)} left
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: '12px' }}>
                        <button
                          type="button"
                          onClick={(e) => toggleExpandJobId(job.job_id, e)}
                          title={isIdExpanded ? 'Click to collapse' : 'Click to view full ID'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            margin: 0,
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            color: '#818cf8',
                            cursor: 'pointer',
                            textAlign: 'left',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            textUnderlineOffset: '2px',
                          }}
                        >
                          {isIdExpanded ? job.job_id : job.job_id.slice(0, 8)}
                        </button>
                      </td>
                      <td
                        style={{ padding: '8px 6px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap' }}
                        title={job.model_id}
                      >
                        {formatModelName(job.model_id)}
                      </td>
                      {viewingAllTenants && (
                        <td style={{ padding: '8px 6px', fontFamily: 'monospace', color: '#10b981', whiteSpace: 'nowrap' }}>
                          {job.tenant_id || 'tenant-default'}
                        </td>
                      )}
                      <td style={{ padding: '8px 6px' }}>
                        <div
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: computeLabel.startsWith('CPU')
                              ? 'rgba(148, 163, 184, 0.15)'
                              : 'rgba(56, 189, 248, 0.12)',
                            color: computeLabel.startsWith('CPU') ? '#cbd5e1' : '#38bdf8',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            display: 'inline-block',
                          }}
                          title="Device class / execution engine"
                        >
                          {computeLabel}
                        </div>
                        <div
                          style={{ color: '#94a3b8', fontSize: '10px', marginTop: '3px', whiteSpace: 'nowrap' }}
                          title={hardware}
                        >
                          {hardware || '—'}
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            backgroundColor:
                              mode === 'spot'
                                ? 'rgba(16, 185, 129, 0.15)'
                                : mode === 'serverless'
                                  ? 'rgba(6, 182, 212, 0.15)'
                                  : mode === 'token_factory'
                                    ? 'rgba(139, 92, 246, 0.15)'
                                    : mode === 'local'
                                      ? 'rgba(148, 163, 184, 0.15)'
                                      : 'rgba(59, 130, 246, 0.15)',
                            color:
                              mode === 'spot'
                                ? '#34d399'
                                : mode === 'serverless'
                                  ? '#22d3ee'
                                  : mode === 'token_factory'
                                    ? '#c084fc'
                                    : mode === 'local'
                                      ? '#cbd5e1'
                                      : '#60a5fa',
                          }}
                        >
                          {mode.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        {inference ? (
                          <span
                            title={
                              inference === 'mock'
                                ? 'Executed with mock inference (instant / zero VRAM)'
                                : 'Executed with real inference (PyTorch / cloud provider)'
                            }
                            style={{
                              fontSize: '11px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                              backgroundColor:
                                inference === 'mock' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: inference === 'mock' ? '#fbbf24' : '#34d399',
                              border: `1px solid ${
                                inference === 'mock' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'
                              }`,
                            }}
                          >
                            {inference === 'mock' ? 'MOCK' : 'REAL'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#64748b' }} title="Inference mode not recorded yet">
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <div style={{ width: '28px', height: '4px', backgroundColor: '#334155', borderRadius: '2px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${progressPct}%`,
                                height: '100%',
                                backgroundColor: job.status === 'FAILED' ? '#ef4444' : '#6366f1',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '10px', color: '#94a3b8' }}>{progressPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 6px', color: '#e2e8f0', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {job.duration_ms !== null ? `${job.duration_ms} ms` : '—'}
                      </td>
                      <td style={{ padding: '8px 6px', fontSize: '12px' }}>
                        {totalTok > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{totalTok.toLocaleString()} tok</span>
                            <span style={{ color: '#94a3b8', fontSize: '11px' }}>(${costUsd})</span>
                          </div>
                        ) : (
                          <span style={{ color: '#64748b' }}>—</span>
                        )}
                      </td>
                      <td
                        style={{ padding: '8px 6px', fontSize: '12px', whiteSpace: 'nowrap' }}
                        title={new Date(job.created_at).toLocaleString()}
                      >
                        <div style={{ color: '#e2e8f0', fontWeight: 500 }}>{formatTimeAgo(job.created_at)}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>{new Date(job.created_at).toLocaleTimeString()}</div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      <SubmitJobModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onSubmit={async (payload) => {
          await onSubmitJob(payload);
          onRefresh();
        }}
      />

      <JobDetailModal
        job={selectedJob}
        isOpen={selectedJob !== null}
        onClose={() => setSelectedJob(null)}
        onCancelJob={async (id) => {
          await onCancelJob(id);
          setSelectedJob(null);
          onRefresh();
        }}
        onRetryJob={async (id) => {
          if (onRetryJob) {
            await onRetryJob(id);
            setSelectedJob(null);
            onRefresh();
          }
        }}
      />

      <DlqModal
        isOpen={isDlqModalOpen}
        onClose={() => setIsDlqModalOpen(false)}
        messages={dlqMessages}
        isLoading={isLoading}
        onRefresh={onRefresh}
        onDiscardMessage={onDiscardDlqMessage}
        onInspectJob={async (jobId, tenantId) => {
          const fromList = jobs.find((j) => j.job_id === jobId) ?? null;
          const job = fromList ?? (onInspectJobFromDlq ? await onInspectJobFromDlq(jobId, tenantId) : null);
          if (job) {
            setIsDlqModalOpen(false);
            setSelectedJob(job);
          }
        }}
      />
    </div>
  );
}
