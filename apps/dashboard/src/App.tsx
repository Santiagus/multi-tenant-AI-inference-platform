import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { Navigation, type ActiveTab } from './components/Navigation';
import { JobsView } from './components/jobs/JobsView';
import { ProviderStatusView, computeProviderSyncMetrics } from './components/providers/ProviderStatusView';
import { FinOpsPricingView } from './components/finops/FinOpsPricingView';
import { DEFAULT_PROVIDER_FLEET } from './components/finops/ProviderFleetBar';
import { EconomicsView } from './components/economics/EconomicsView';
import { WorkloadPathView } from './components/flow/WorkloadPathView';
import { apiClient } from './api/client';
import type { SubmitJobPrefill } from './components/jobs/submitJobHelpers';
import type {
  DlqMessage,
  JobItem,
  PricingSyncAudit,
  ProviderBalanceStatus,
  ProviderProfile,
  RoutingPreference,
} from './types';

export function App() {
  const [tenantId, setTenantId] = useState<string>('tenant-default');
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobs');
  const [submitPrefill, setSubmitPrefill] = useState<SubmitJobPrefill | null>(null);
  const [forceOpenSubmit, setForceOpenSubmit] = useState(false);
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [inferenceMode, setInferenceMode] = useState<'mock' | 'real'>('mock');
  const [mockProviders, setMockProviders] = useState<boolean>(true);
  const [isTogglingMockProviders, setIsTogglingMockProviders] = useState(false);
  const [stage, setStage] = useState<string>('LOCAL');
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState<number>(() => {
    if (typeof window === 'undefined') return 60;
    const raw = window.localStorage.getItem('dashboard.autoRefreshSeconds');
    const parsed = raw === null ? 60 : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60;
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isProcessingWorker, setIsProcessingWorker] = useState<boolean>(false);
  const [workerFeedback, setWorkerFeedback] = useState<string | null>(null);
  const [workerFeedbackTone, setWorkerFeedbackTone] = useState<'info' | 'error'>('info');
  const workerFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWorkerFeedbackTimer = () => {
    if (workerFeedbackTimerRef.current) {
      clearTimeout(workerFeedbackTimerRef.current);
      workerFeedbackTimerRef.current = null;
    }
  };

  const publishWorkerFeedback = (message: string, tone: 'info' | 'error' = 'info') => {
    clearWorkerFeedbackTimer();
    setWorkerFeedbackTone(tone);
    setWorkerFeedback(message);
    // Errors stay until dismissed; success/info auto-clear after a readable delay.
    if (tone !== 'error') {
      workerFeedbackTimerRef.current = setTimeout(() => {
        setWorkerFeedback(null);
        workerFeedbackTimerRef.current = null;
      }, 10000);
    }
  };

  const dismissWorkerFeedback = () => {
    clearWorkerFeedbackTimer();
    setWorkerFeedback(null);
  };
  const [isSyncingPricing, setIsSyncingPricing] = useState<boolean>(false);

  // Core Data
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [dlqMessages, setDlqMessages] = useState<DlqMessage[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderProfile>>({});
  const [syncAudits, setSyncAudits] = useState<PricingSyncAudit[]>([]);
  const [providerBalances, setProviderBalances] = useState<Record<string, ProviderBalanceStatus>>({});

  // Real-time Provider Sync Status Metrics
  const syncMetrics = useMemo(() => {
    return computeProviderSyncMetrics(DEFAULT_PROVIDER_FLEET, syncAudits, providers);
  }, [syncAudits, providers]);

  // In flight count
  const inFlightCount = jobs.filter(
    (j) =>
      j.status === 'PROCESSING' ||
      j.status === 'QUEUED' ||
      j.status === 'SUBMITTED' ||
      j.status === 'RETRYING'
  ).length;

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 1. Health
      const health = await apiClient.getHealth();
      setApiHealthy(health.ok);
      if (health.inferenceMode) {
        setInferenceMode(health.inferenceMode);
      }
      setMockProviders(Boolean(health.mockProviders));
      if (health.environment) {
        setStage(health.environment);
      }

      // 2. Jobs, DLQ, Providers, Economics, Sync Audits & Balances
      const [jobsRes, dlqRes, provRes, histRes, balancesRes] = await Promise.allSettled([
        apiClient.getJobs(tenantId, { limit: 100 }),
        apiClient.getDlqMessages(tenantId),
        apiClient.getProviders(),
        apiClient.getPricingHistory(),
        apiClient.getProviderBalances().catch(() => ({ ok: false, balances: {} })),
      ]);

      if (jobsRes.status === 'fulfilled') {
        setJobs(jobsRes.value.jobs);
      }
      if (dlqRes.status === 'fulfilled') {
        setDlqMessages(dlqRes.value.messages);
      }
      if (provRes.status === 'fulfilled') {
        setProviders(provRes.value.providers);
      }
      if (histRes.status === 'fulfilled') {
        setSyncAudits(histRes.value.cadence_audits || []);
      }
      if (balancesRes.status === 'fulfilled' && (balancesRes.value as any)?.balances) {
        setProviderBalances((balancesRes.value as any).balances);
      } else if (histRes.status === 'fulfilled' && histRes.value.provider_balances) {
        setProviderBalances(histRes.value.provider_balances);
      }
    } catch (err) {
      console.error('Failed to refresh platform dashboard state:', err);
      setApiHealthy(false);
    } finally {
      setIsRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    return () => clearWorkerFeedbackTimer();
  }, []);

  // Auto-refresh cadence (selectable in header; 0 = off). Default 60s for spot auctions.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('dashboard.autoRefreshSeconds', String(autoRefreshSeconds));
    }
    if (autoRefreshSeconds <= 0) return;
    const interval = setInterval(() => {
      loadData();
    }, autoRefreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshSeconds, loadData]);

  // Handlers
  const writeTenantFor = (jobId?: string) => {
    if (tenantId !== 'ALL') return tenantId;
    if (!jobId) return 'tenant-default';
    return jobs.find((job) => job.job_id === jobId)?.tenant_id || 'tenant-default';
  };

  const handleSubmitJob = async (payload: {
    model_id: string;
    routing_preference: RoutingPreference;
    priority: number;
    max_retries: number;
    expires_in_seconds?: number;
    input_uri?: string;
    input: { prompt: string; parameters?: Record<string, unknown> };
  }) => {
    await apiClient.submitJob(writeTenantFor(), payload);
    await loadData();
  };

  const handleCancelJob = async (jobId: string) => {
    await apiClient.cancelJob(writeTenantFor(jobId), jobId);
    await loadData();
  };

  const handleRetryJob = async (jobId: string) => {
    await apiClient.retryJob(writeTenantFor(jobId), jobId);
    await loadData();
  };

  const handleReapExpiredJobs = async () => {
    const result = await apiClient.reapExpiredJobs();
    const expired = result.reaped_count ?? 0;
    const orphans = result.reclaimed_orphans ?? 0;
    if (expired + orphans > 0) {
      publishWorkerFeedback(
        `Reap: ${expired} expired · ${orphans} orphaned PROCESSING reclaimed (auto-retry or fail).`,
        'info'
      );
    } else {
      publishWorkerFeedback('Reap: no expired or orphaned jobs.', 'info');
    }
    await loadData();
  };

  const handleDiscardDlqMessage = async (messageId: string, messageTenantId: string) => {
    const tenantForWrite =
      tenantId === 'ALL' || tenantId === 'all' || tenantId === '*'
        ? messageTenantId
        : tenantId;
    await apiClient.discardDlqMessage(tenantForWrite, messageId);
    await loadData();
  };

  const handleInspectJob = async (job: JobItem): Promise<JobItem> => {
    const tenantForRead =
      tenantId === 'ALL' || tenantId === 'all' || tenantId === '*'
        ? job.tenant_id
        : tenantId;
    try {
      // Detail endpoint attaches signed artifact download URLs; list does not.
      return await apiClient.getJob(tenantForRead, job.job_id);
    } catch (err) {
      console.error('Failed to load job detail for inspection:', err);
      return job;
    }
  };

  const handleInspectJobFromDlq = async (jobId: string, messageTenantId: string) => {
    const tenantForRead =
      tenantId === 'ALL' || tenantId === 'all' || tenantId === '*'
        ? messageTenantId
        : tenantId;
    try {
      return await apiClient.getJob(tenantForRead, jobId);
    } catch (err) {
      console.error('Failed to load job for DLQ inspection:', err);
      return null;
    }
  };

  const handleToggleInferenceMode = async (mode: 'mock' | 'real') => {
    try {
      const res = await apiClient.setInferenceMode(mode);
      setInferenceMode(res.mode);
      if (typeof res.mockProviders === 'boolean') {
        setMockProviders(res.mockProviders);
      } else {
        // inference-mode now clears/sets MOCK_PROVIDERS in lockstep on the API.
        setMockProviders(res.mode === 'mock');
      }
      publishWorkerFeedback(
        res.mode === 'real'
          ? 'Inference REAL — MOCK_PROVIDERS off (live Python/GPU path).'
          : 'Inference MOCK — MOCK_PROVIDERS on (simulated).',
        'info'
      );
    } catch (err: any) {
      console.error('Failed to update inference mode:', err);
      publishWorkerFeedback(`Inference mode switch blocked: ${err?.message || 'Error'}`, 'error');
    }
  };

  const handleToggleMockProviders = async (enabled: boolean) => {
    setIsTogglingMockProviders(true);
    try {
      const res = await apiClient.setMockProviders(enabled);
      setMockProviders(res.enabled);
      setInferenceMode(res.inferenceMode);
      publishWorkerFeedback(
        res.enabled
          ? 'MOCK_PROVIDERS ON — providers/worker simulated.'
          : 'MOCK_PROVIDERS OFF — live inference gate open.',
        'info'
      );
    } catch (err: any) {
      console.error('Failed to update MOCK_PROVIDERS:', err);
      publishWorkerFeedback(`MOCK_PROVIDERS switch blocked: ${err?.message || 'Error'}`, 'error');
    } finally {
      setIsTogglingMockProviders(false);
    }
  };

  const handleTriggerWorker = async () => {
    setIsProcessingWorker(true);
    dismissWorkerFeedback();
    // Optimistic: show QUEUED → PROCESSING immediately while the worker request is in flight.
    setJobs((prev) => {
      const idx = prev.findIndex(
        (j) => j.status === 'QUEUED' || j.status === 'SUBMITTED' || j.status === 'RETRYING'
      );
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: 'PROCESSING' };
      return next;
    });
    // Poll while process-next runs so mid-flight status changes stay visible.
    const pollId = window.setInterval(() => {
      void loadData();
    }, 750);
    try {
      const res = await apiClient.processNextJob(inferenceMode);
      const refreshed = await apiClient.getJobs(tenantId, { limit: 100 });
      setJobs(refreshed.jobs);
      if (res.processed > 0) {
        publishWorkerFeedback(
          `Processed ${res.processed} queued job via ${inferenceMode.toUpperCase()} inference.`,
          'info'
        );
      } else {
        const orphanedQueued = refreshed.jobs.filter(
          (j) => j.status === 'QUEUED' || j.status === 'SUBMITTED' || j.status === 'RETRYING'
        ).length;
        publishWorkerFeedback(
          orphanedQueued > 0
            ? `SQS queue is empty, but ${orphanedQueued} job(s) are still QUEUED/RETRYING in the DB (common after ElasticMQ restart). Open Job Inspection → Retry to re-enqueue, then Process next again.`
            : 'Queue is empty (no pending jobs in SQS).',
          orphanedQueued > 0 ? 'error' : 'info'
        );
      }
      await loadData();
    } catch (err: any) {
      console.error('Failed to trigger worker process-next:', err);
      publishWorkerFeedback(`Worker process-next failed: ${err?.message || 'Error'}`, 'error');
      await loadData();
    } finally {
      window.clearInterval(pollId);
      setIsProcessingWorker(false);
    }
  };

  const handleToggleProviderHealth = async (provider: string, healthy: boolean) => {
    await apiClient.setProviderHealth(provider, healthy);
    await loadData();
  };

  const handleSyncPricing = async () => {
    setIsSyncingPricing(true);
    try {
      await apiClient.syncPricing();
      await loadData();
    } catch (err) {
      console.error('Failed to synchronize provider catalogs:', err);
    } finally {
      setIsSyncingPricing(false);
    }
  };

  const [isPurgingTenant, setIsPurgingTenant] = useState(false);
  const [isSeedingShowcase, setIsSeedingShowcase] = useState(false);

  const handlePurgeTenantData = async () => {
    setIsPurgingTenant(true);
    try {
      await apiClient.purgeTenantData(tenantId);
      await loadData();
    } catch (err) {
      console.error('Failed to purge tenant data:', err);
    } finally {
      setIsPurgingTenant(false);
    }
  };

  const handleSeedShowcaseData = async () => {
    setIsSeedingShowcase(true);
    try {
      await apiClient.seedShowcaseData();
      await loadData();
    } catch (err) {
      console.error('Failed to seed showcase data:', err);
    } finally {
      setIsSeedingShowcase(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        tenantId={tenantId}
        onTenantChange={setTenantId}
        apiHealthy={apiHealthy}
        stage={stage}
        autoRefreshSeconds={autoRefreshSeconds}
        onAutoRefreshSecondsChange={setAutoRefreshSeconds}
        onManualRefresh={loadData}
        isRefreshing={isRefreshing}
        onPurgeTenantData={handlePurgeTenantData}
        isPurgingTenant={isPurgingTenant}
        onSeedShowcaseData={handleSeedShowcaseData}
        isSeedingShowcase={isSeedingShowcase}
        mockProviders={mockProviders}
        onToggleMockProviders={handleToggleMockProviders}
        isTogglingMockProviders={isTogglingMockProviders}
        inferenceMode={inferenceMode}
        onToggleInferenceMode={handleToggleInferenceMode}
      />

      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        jobCount={jobs.length}
        inFlightCount={inFlightCount}
        syncedProvidersCount={syncMetrics.syncedCount}
        unsyncedProvidersCount={syncMetrics.unsyncedCount}
      />

      <main style={{ flex: 1 }}>
        {activeTab === 'jobs' && (
          <JobsView
            jobs={jobs}
            dlqMessages={dlqMessages}
            isLoading={isRefreshing && jobs.length === 0}
            onRefresh={loadData}
            onSubmitJob={handleSubmitJob}
            onCancelJob={handleCancelJob}
            onRetryJob={handleRetryJob}
            onReapExpired={handleReapExpiredJobs}
            onDiscardDlqMessage={handleDiscardDlqMessage}
            onInspectJob={handleInspectJob}
            onInspectJobFromDlq={handleInspectJobFromDlq}
            onTriggerWorker={handleTriggerWorker}
            isProcessingWorker={isProcessingWorker}
            inferenceMode={inferenceMode}
            onToggleInferenceMode={handleToggleInferenceMode}
            workerFeedback={workerFeedback}
            workerFeedbackTone={workerFeedbackTone}
            onDismissWorkerFeedback={dismissWorkerFeedback}
            viewingAllTenants={tenantId === 'ALL'}
            tenantId={tenantId}
            stage={stage}
            submitPrefill={submitPrefill}
            forceOpenSubmit={forceOpenSubmit}
            onSubmitPrefillConsumed={() => setSubmitPrefill(null)}
            onSubmitModalClosed={() => {
              setForceOpenSubmit(false);
              setSubmitPrefill(null);
            }}
          />
        )}

        {activeTab === 'provider-status' && (
          <ProviderStatusView
            syncAudits={syncAudits}
            providerBalances={providerBalances}
            providers={providers}
            onRefreshSync={handleSyncPricing}
            onToggleHealth={handleToggleProviderHealth}
            isSyncing={isSyncingPricing}
          />
        )}

        {activeTab === 'pricing' && (
          <FinOpsPricingView
            onNavigateToProviderStatus={() => setActiveTab('provider-status')}
            onRunWithOption={(prefill) => {
              setSubmitPrefill(prefill);
              setForceOpenSubmit(true);
              setActiveTab('jobs');
            }}
          />
        )}

        {activeTab === 'economics' && (
          <EconomicsView
            jobs={jobs}
            isLoading={isRefreshing}
            onRefresh={loadData}
          />
        )}

        {activeTab === 'workload-path' && <WorkloadPathView />}
      </main>
    </div>
  );
}

