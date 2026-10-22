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
  onTriggerWorker: () => Promise<void>;
  isProcessingWorker: boolean;
}

export function JobsView({
  jobs,
  dlqMessages,
  isLoading,
  onRefresh,
  onSubmitJob,
  onCancelJob,
  onTriggerWorker,
  isProcessingWorker,
}: JobsViewProps) {
  const [selectedJob, setSelectedJob] = useState<JobItem | null>(null);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isDlqModalOpen, setIsDlqModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modelFilter, setModelFilter] = useState<string>('ALL');
  const [showModelStats, setShowModelStats] = useState<boolean>(true);

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

  // Filtered jobs list
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'IN_FLIGHT') {
          if (!['QUEUED', 'PROCESSING', 'RETRYING', 'SUBMITTED'].includes(job.status)) {
            return false;
          }
        } else if (job.status !== statusFilter) {
          return false;
        }
      }
      if (modelFilter !== 'ALL' && job.model_id !== modelFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesId = job.job_id.toLowerCase().includes(query);
        const matchesModel = job.model_id.toLowerCase().includes(query);
        const matchesProvider = (job.provider || '').toLowerCase().includes(query);
        return matchesId || matchesModel || matchesProvider;
      }
      return true;
    });
  }, [jobs, statusFilter, modelFilter, searchQuery]);

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
      setJobSortDir(col === 'job_id' || col === 'model_id' || col === 'status' || col === 'provider' ? 'asc' : 'desc');
    }
  };

  const sortedJobs = useMemo(() => {
    return genericSort(filteredJobs, jobSortKey, jobSortDir, (item, key) => {
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
      {/* Top Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        <StatCard
          label="Total Jobs"
          value={stats.total}
          subtext="Tenant lifecycle volume"
          accentColor="#6366f1"
          onClick={() => {
            setStatusFilter('ALL');
            setModelFilter('ALL');
          }}
        />
        <StatCard
          label="Queued"
          value={stats.queued}
          subtext={`${stats.inFlight} total in flight`}
          accentColor="#f59e0b"
          onClick={() => setStatusFilter('QUEUED')}
        />
        <StatCard
          label="In Flight / Active"
          value={stats.processing + stats.retrying}
          subtext={`${stats.processing} processing · ${stats.retrying} retrying`}
          accentColor="#818cf8"
          onClick={() => setStatusFilter('IN_FLIGHT')}
        />
        <StatCard
          label="Succeeded"
          value={stats.succeeded}
          subtext={`${stats.totalTokens.toLocaleString()} tokens inferred`}
          accentColor="#10b981"
          onClick={() => setStatusFilter('SUCCEEDED')}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          subtext={`Infra cost: $${stats.costUsd}`}
          accentColor="#ef4444"
          onClick={() => setStatusFilter('FAILED')}
        />
        <StatCard
          label="Dead-Letter Queue"
          value={stats.dlqCount}
          subtext="Exhausted max retries"
          accentColor="#ec4899"
          onClick={() => setIsDlqModalOpen(true)}
        />
      </div>

      {/* Stats per Model Section */}
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
            padding: '14px 20px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#131d35',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
              📊 Stats per Model
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                fontWeight: 600,
              }}
            >
              {modelStats.length} models active
            </span>
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
                Filtered by: {modelFilter}
                <button
                  onClick={() => setModelFilter('ALL')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    fontWeight: 700,
                    padding: 0,
                    fontSize: '12px',
                  }}
                  title="Clear model filter"
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
            {modelStats.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No model traffic recorded yet. Enqueue inference jobs to populate real-time model telemetry.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                    <SortableHeader
                      column="modelId"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Model ID
                    </SortableHeader>
                    <SortableHeader
                      column="total"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Total Jobs
                    </SortableHeader>
                    <SortableHeader
                      column="inFlight"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      In Flight (Queued / Retrying)
                    </SortableHeader>
                    <SortableHeader
                      column="successRate"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Success / Failure Rate
                    </SortableHeader>
                    <SortableHeader
                      column="avgDuration"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Avg Latency
                    </SortableHeader>
                    <SortableHeader
                      column="totalTokens"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Total Tokens
                    </SortableHeader>
                    <SortableHeader
                      column="costUsd"
                      currentSortKey={modelSortKey}
                      currentSortDir={modelSortDir}
                      onSort={handleModelSort}
                      style={{ padding: '10px 16px' }}
                    >
                      Compute Cost ($)
                    </SortableHeader>
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Filter</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedModelStats.map((m) => {
                    const isSelected = modelFilter === m.modelId;
                    return (
                      <tr
                        key={m.modelId}
                        style={{
                          borderBottom: '1px solid #1e293b',
                          backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 16px', fontWeight: 600, color: '#f8fafc', fontFamily: 'monospace' }}>
                          {m.modelId}
                        </td>
                        <td style={{ padding: '10px 16px', color: '#e2e8f0', fontWeight: 600 }}>
                          {m.total}
                        </td>
                        <td style={{ padding: '10px 16px', color: '#fbbf24' }}>
                          {m.queued + m.processing + m.retrying > 0 ? (
                            <span>
                              {m.queued} queued · {m.processing} processing {m.retrying > 0 && `· ${m.retrying} retrying`}
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>0</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ color: '#34d399', fontWeight: 600 }}>{m.succeeded} ok</span>
                          {m.failed > 0 && (
                            <span style={{ color: '#f87171', marginLeft: '6px', fontWeight: 600 }}>
                              / {m.failed} fail
                            </span>
                          )}
                          <span style={{ color: '#94a3b8', marginLeft: '6px', fontSize: '11px' }}>
                            ({m.successRate}%)
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', color: '#94a3b8' }}>
                          {m.avgDuration > 0 ? `${m.avgDuration} ms` : '—'}
                        </td>
                        <td style={{ padding: '10px 16px', color: '#38bdf8', fontWeight: 500 }}>
                          {m.totalTokens.toLocaleString()}
                        </td>
                        <td style={{ padding: '10px 16px', color: '#f87171', fontWeight: 600 }}>
                          ${m.costUsd}
                        </td>
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
            <option value="IN_FLIGHT">In Flight &amp; Active ({stats.inFlight})</option>
            <option value="QUEUED">Queued ({stats.queued})</option>
            <option value="PROCESSING">Processing ({stats.processing})</option>
            <option value="RETRYING">Retrying ({stats.retrying})</option>
            <option value="SUCCEEDED">Succeeded ({stats.succeeded})</option>
            <option value="FAILED">Failed ({stats.failed})</option>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="status"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Status
                </SortableHeader>
                <SortableHeader
                  column="job_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Job ID
                </SortableHeader>
                <SortableHeader
                  column="model_id"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Model
                </SortableHeader>
                <SortableHeader
                  column="provider"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Provider Placement
                </SortableHeader>
                <SortableHeader
                  column="progress"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Progress
                </SortableHeader>
                <SortableHeader
                  column="latency"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Latency
                </SortableHeader>
                <SortableHeader
                  column="cost"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Tokens &amp; Cost
                </SortableHeader>
                <SortableHeader
                  column="created_at"
                  currentSortKey={jobSortKey}
                  currentSortDir={jobSortDir}
                  onSort={handleJobSort}
                  style={{ padding: '14px 16px' }}
                >
                  Submitted
                </SortableHeader>
                <th style={{ padding: '14px 16px', fontWeight: 600, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
                    Loading inference jobs...
                  </td>
                </tr>
              ) : sortedJobs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '48px 16px', textAlign: 'center', color: '#64748b' }}>
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
                      <td style={{ padding: '14px 16px' }}>
                        <StatusBadge status={job.status} size="sm" />
                      </td>
                      <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#818cf8', fontSize: '12px' }}>
                        {job.job_id.slice(0, 8)}...
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f8fafc' }}>
                        {job.model_id}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: job.provider ? 'rgba(56, 189, 248, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                            color: job.provider ? '#38bdf8' : '#64748b',
                            fontWeight: 600,
                          }}
                        >
                          {job.provider || 'auto'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', minWidth: '110px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{ flex: 1, height: '6px', backgroundColor: '#334155', borderRadius: '3px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${progressPct}%`,
                                height: '100%',
                                backgroundColor: job.status === 'FAILED' ? '#ef4444' : '#6366f1',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '11px', color: '#94a3b8', width: '28px' }}>{progressPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', color: '#e2e8f0', fontSize: '12px' }}>
                        {job.duration_ms !== null ? `${job.duration_ms} ms` : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '12px' }}>
                        {totalTok > 0 ? (
                          <div>
                            <span style={{ color: '#f8fafc', fontWeight: 600 }}>{totalTok} tok</span>
                            <span style={{ color: '#94a3b8', marginLeft: '6px' }}>(${costUsd})</span>
                          </div>
                        ) : (
                          <span style={{ color: '#64748b' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>
                        {new Date(job.created_at).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedJob(job);
                          }}
                          style={{
                            backgroundColor: '#334155',
                            color: '#f8fafc',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Inspect ↗
                        </button>
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
