import { useState, useMemo } from 'react';
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
    input: { prompt: string };
  }) => Promise<void>;
  onCancelJob: (jobId: string) => Promise<void>;
  onRetryJob?: (jobId: string) => Promise<void>;
  onReapExpired?: () => Promise<void>;
  onTriggerWorker: () => Promise<void>;
  isProcessingWorker: boolean;
}

export const ALL_PLATFORM_PROVIDERS = [
  { id: 'local_pytorch', name: 'Local PyTorch' },
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

export function getJobExecutionMode(j: JobItem): string {
  if (j.execution_mode) return j.execution_mode;
  if (j.routing_preference.includes('local') || j.provider === 'local_pytorch') return 'local';
  if (j.provider === 'jarvislabs') return 'token_factory';
  if (j.provider === 'baseten' || j.provider === 'wavespeed') return 'serverless';
  if (j.provider === 'runware' || j.provider === 'fal') return 'pay_per_call';
  if (j.provider === 'runpod' || j.provider === 'vast_ai' || j.provider === 'coreweave' || j.provider === 'hivenet') return 'spot';
  return 'on_demand';
}

export function formatHardwareName(hw: string): string {
  if (!hw) return '';
  return hw
    .replace(/^NVIDIA\s+(GeForce\s+)?/i, '')
    .replace(/\s*\(\d+GB[^\)]*\)/gi, '')
    .replace(/Token Factory MaaS.*/i, 'Token Factory')
    .replace(/Distributed Tensor Core Pipeline.*/i, 'Tensor Core Pipeline')
    .replace(/AWS Bedrock Managed Neural Cluster/i, 'AWS Bedrock')
    .replace(/AWS Inferentia2 \/ G5 Tensor Cluster/i, 'Inferentia2 / G5')
    .replace(/CPU Xeon\/EPYC Fallback/i, 'CPU Fallback')
    .trim();
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
    return { label: j.provider.toUpperCase(), isAuto: false };
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
  let hw = '';
  if ((j.result as any)?.hardware) hw = (j.result as any).hardware;
  else if ((j.result as any)?.device) hw = (j.result as any).device;
  else if (j.hardware) hw = j.hardware;
  else if (j.routing_preference.includes('cpu')) hw = 'CPU Fallback';
  else if (j.routing_preference.includes('local') || j.provider === 'local_pytorch') {
    hw = 'RTX 5070 Ti';
  } else if (j.provider === 'runpod') {
    if (j.model_id.includes('70B') || j.model_id.includes('DeepSeek')) {
      hw = 'H100 SXM5';
    } else {
      hw = 'RTX 4090';
    }
  } else if (j.provider === 'vast_ai') {
    hw = 'RTX 5090 Blackwell';
  } else if (j.provider === 'baseten') {
    hw = 'L4 Tensor Core';
  } else if (j.provider === 'nebius') {
    hw = 'H200 SXM';
  } else if (j.provider === 'jarvislabs') {
    hw = 'Token Factory';
  } else if (j.provider === 'fal' || j.provider === 'runware') {
    hw = 'Tensor Core Pipeline';
  } else if (j.provider === 'bedrock') {
    hw = 'AWS Bedrock';
  } else if (j.provider === 'sagemaker') {
    hw = 'Inferentia2 / G5';
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
  onTriggerWorker,
  isProcessingWorker,
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
  const [breakdownTab, setBreakdownTab] = useState<'model' | 'tenant' | 'provider' | 'gpu'>('model');
  const [showModelStats, setShowModelStats] = useState<boolean>(true);
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());

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
      const prov =
        j.provider ||
        (j.routing_preference.includes('local')
          ? 'local_pytorch'
          : j.routing_preference.includes('runpod')
            ? 'runpod'
            : j.routing_preference.includes('bedrock')
              ? 'bedrock'
              : j.routing_preference.includes('sagemaker')
                ? 'sagemaker'
                : 'local_pytorch');

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
      if (modelFilter !== 'ALL' && job.model_id !== modelFilter) {
        return false;
      }
      if (tenantFilter !== 'ALL' && (job.tenant_id || 'tenant-default') !== tenantFilter) {
        return false;
      }
      if (providerFilter !== 'ALL') {
        const prov =
          job.provider ||
          (job.routing_preference.includes('local')
            ? 'local_pytorch'
            : job.routing_preference.includes('runpod')
              ? 'runpod'
              : job.routing_preference.includes('bedrock')
                ? 'bedrock'
                : job.routing_preference.includes('sagemaker')
                  ? 'sagemaker'
                  : 'local_pytorch');
        if (prov !== providerFilter) return false;
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
  }, [jobs, statusFilter, modeFilter, modelFilter, tenantFilter, providerFilter, searchQuery]);

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
        col === 'job_id' || col === 'model_id' || col === 'status' || col === 'provider' || col === 'mode'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const sortedJobs = useMemo(() => {
    return genericSort(filteredJobs, jobSortKey, jobSortDir, (item, key) => {
      if (key === 'mode') return getJobExecutionMode(item);
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
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModelStats.map((m) => {
                    const isSelected = modelFilter === m.modelId;
                    return (
                      <tr key={m.modelId} style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}>
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
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => setModelFilter(isSelected ? 'ALL' : m.modelId)}
                            style={{
                              backgroundColor: isSelected ? '#6366f1' : '#1e293b',
                              color: isSelected ? '#ffffff' : '#94a3b8',
                              border: `1px solid ${isSelected ? '#6366f1' : '#334155'}`,
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isSelected ? '✓ Filtered' : 'Filter'}
                          </button>
                        </td>
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
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantStats.map((t) => {
                    const isSelected = tenantFilter === t.tenantId;
                    return (
                      <tr key={t.tenantId} style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(16, 185, 129, 0.1)' : 'transparent' }}>
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
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => setTenantFilter(isSelected ? 'ALL' : t.tenantId)}
                            style={{
                              backgroundColor: isSelected ? '#10b981' : '#1e293b',
                              color: isSelected ? '#ffffff' : '#94a3b8',
                              border: `1px solid ${isSelected ? '#10b981' : '#334155'}`,
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isSelected ? '✓ Filtered' : 'Filter'}
                          </button>
                        </td>
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
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {providerStats.map((p) => {
                    const isSelected = providerFilter === p.provider;
                    return (
                      <tr key={p.provider} style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.1)' : 'transparent' }}>
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
                        <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => setProviderFilter(isSelected ? 'ALL' : p.provider)}
                            style={{
                              backgroundColor: isSelected ? '#a855f7' : '#1e293b',
                              color: isSelected ? '#ffffff' : '#94a3b8',
                              border: `1px solid ${isSelected ? '#a855f7' : '#334155'}`,
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isSelected ? '✓ Filtered' : 'Filter'}
                          </button>
                        </td>
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

      {/* Action Bar & Controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          backgroundColor: '#0f172a',
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flex: 1 }}>
          <input
            type="text"
            placeholder="Search by Job ID, Model, or Provider..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              minWidth: '240px',
              outline: 'none',
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="ALL">All Statuses ({stats.total})</option>
            <option value="FAILED">Failed ({stats.failed})</option>
            <option value="QUEUED">Queued ({stats.queued})</option>
            <option value="IN_FLIGHT">In Flight ({stats.processing + stats.retrying})</option>
            <option value="SUCCEEDED">Succeeded ({stats.succeeded})</option>
            <option value="PROCESSING">Processing ({stats.processing})</option>
            <option value="RETRYING">Retrying ({stats.retrying})</option>
            <option value="CANCELLED">Cancelled ({stats.cancelled})</option>
          </select>

          {modelStats.length > 0 && (
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '220px',
              }}
            >
              <option value="ALL">All Models ({modelStats.length})</option>
              {modelStats.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.modelId.split('/').pop() || m.modelId} ({m.total})
                </option>
              ))}
            </select>
          )}

          {tenantStats.length > 1 && (
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '180px',
              }}
            >
              <option value="ALL">All Tenants ({tenantStats.length})</option>
              {tenantStats.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantId} ({t.total})
                </option>
              ))}
            </select>
          )}

          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer',
              maxWidth: '180px',
            }}
          >
            <option value="ALL">All Modes</option>
            <option value="spot">Spot / Preemptible</option>
            <option value="on_demand">On-Demand</option>
            <option value="serverless">Serverless</option>
            <option value="token_factory">Token Factory</option>
            <option value="pay_per_call">Pay-Per-Call</option>
            <option value="local">Local Dedicated</option>
          </select>

          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              outline: 'none',
              cursor: 'pointer',
              maxWidth: '180px',
            }}
          >
            <option value="ALL">All Providers</option>
            {ALL_PLATFORM_PROVIDERS.map((p) => {
              const count = jobs.filter(
                (j) =>
                  (j.provider || (j.routing_preference.includes('local') ? 'local_pytorch' : 'runpod')) ===
                  p.id
              ).length;
              return (
                <option key={p.id} value={p.id}>
                  {p.name} {count > 0 ? `(${count})` : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            onClick={onTriggerWorker}
            disabled={isProcessingWorker}
            style={{
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isProcessingWorker ? 'wait' : 'pointer',
            }}
            title="Triggers background worker to poll and process next queued job from SQS"
          >
            {isProcessingWorker ? 'Executing Job...' : '⚡ Trigger Worker'}
          </button>

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
            }}
          >
            + Submit Job
          </button>
        </div>
      </div>

      {/* Jobs Table */}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="status"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Status
                </SortableHeader>
                <SortableHeader
                  column="job_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Job ID
                </SortableHeader>
                <SortableHeader
                  column="model_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Model
                </SortableHeader>
                <SortableHeader
                  column="provider"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Provider &amp; Hardware
                </SortableHeader>
                <SortableHeader
                  column="mode"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Mode
                </SortableHeader>
                <SortableHeader
                  column="progress"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Progress
                </SortableHeader>
                <SortableHeader
                  column="latency"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Duration
                </SortableHeader>
                <SortableHeader
                  column="cost"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Tokens &amp; Cost
                </SortableHeader>
                <SortableHeader
                  column="created_at"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '10px 10px' }}
                >
                  Submitted
                </SortableHeader>
                <th style={{ padding: '10px 10px', textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && jobs.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
                    Loading inference jobs...
                  </td>
                </tr>
              ) : sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
                    No inference jobs match the current filters. Click "+ Submit Job" to enqueue one.
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
                  const hardware = getJobHardware(job);
                  const { label: providerBadge, isAuto } = getProviderBadgeLabel(job);
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
                      <td style={{ padding: '10px 10px' }}>
                        <StatusBadge status={job.status} size="sm" />
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'monospace', fontSize: '12px' }}>
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
                        style={{ padding: '10px 10px', fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap' }}
                        title={job.model_id}
                      >
                        {formatModelName(job.model_id)}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              backgroundColor: isAuto ? 'rgba(99, 102, 241, 0.15)' : 'rgba(56, 189, 248, 0.1)',
                              color: isAuto ? '#818cf8' : '#38bdf8',
                              fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {providerBadge}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '3px', whiteSpace: 'nowrap' }}>
                          {hardware}
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px' }}>
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
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '40px', height: '5px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${progressPct}%`,
                                height: '100%',
                                backgroundColor: job.status === 'FAILED' ? '#ef4444' : '#6366f1',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{progressPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#e2e8f0', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {job.duration_ms !== null ? `${job.duration_ms} ms` : '—'}
                      </td>
                      <td style={{ padding: '10px 10px', fontSize: '12px' }}>
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
                        style={{ padding: '10px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                        title={new Date(job.created_at).toLocaleString()}
                      >
                        <div style={{ color: '#e2e8f0', fontWeight: 500 }}>{formatTimeAgo(job.created_at)}</div>
                        <div style={{ fontSize: '10px', color: '#64748b' }}>{new Date(job.created_at).toLocaleTimeString()}</div>
                      </td>
                      <td
                        style={{ padding: '10px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {job.status === 'FAILED' && onRetryJob ? (
                          <button
                            onClick={async () => {
                              await onRetryJob(job.job_id);
                              onRefresh();
                            }}
                            style={{
                              backgroundColor: '#4f46e5',
                              color: '#ffffff',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Re-enqueue and retry this failed job"
                          >
                            ⚡ Retry
                          </button>
                        ) : (job.status === 'QUEUED' || job.status === 'PROCESSING') ? (
                          <button
                            onClick={async () => {
                              await onCancelJob(job.job_id);
                              onRefresh();
                            }}
                            style={{
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#f87171',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        ) : (
                          <span style={{ color: '#475569', fontSize: '11px' }}>—</span>
                        )}
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
      />
    </div>
  );
}
