import { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { Navigation, type ActiveTab } from './components/Navigation';
import { JobsView } from './components/jobs/JobsView';
import { ProviderStatusView, computeProviderSyncMetrics } from './components/providers/ProviderStatusView';
import { FinOpsPricingView } from './components/finops/FinOpsPricingView';
import { DEFAULT_PROVIDER_FLEET } from './components/finops/ProviderFleetBar';
import { EconomicsView } from './components/economics/EconomicsView';
import { WorkloadPathView } from './components/flow/WorkloadPathView';
import { apiClient } from './api/client';
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
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [inferenceMode, setInferenceMode] = useState<'mock' | 'real'>('mock');
  const [stage, setStage] = useState<string>('LOCAL');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isProcessingWorker, setIsProcessingWorker] = useState<boolean>(false);
  const [workerFeedback, setWorkerFeedback] = useState<string | null>(null);
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

  // Auto-refresh interval (60s optimal for real-time spot auction and provider updates)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData();
    }, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

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
    await apiClient.reapExpiredJobs();
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
      setWorkerFeedback(`Inference mode updated to ${res.mode.toUpperCase()}.`);
    } catch (err: any) {
      console.error('Failed to update inference mode:', err);
      setWorkerFeedback(`Inference mode switch blocked: ${err?.message || 'Error'}`);
    } finally {
      setTimeout(() => setWorkerFeedback(null), 3500);
    }
  };

  const handleTriggerWorker = async () => {
    setIsProcessingWorker(true);
    setWorkerFeedback(null);
    try {
      const res = await apiClient.processNextJob(inferenceMode);
      await loadData();
      if (res.processed > 0) {
        setWorkerFeedback(`Processed ${res.processed} queued job via ${inferenceMode.toUpperCase()} inference.`);
      } else {
        setWorkerFeedback('Queue is empty (no pending jobs in SQS).');
      }
    } catch (err: any) {
      console.error('Failed to trigger worker process-next:', err);
      setWorkerFeedback(`Worker process-next failed: ${err?.message || 'Error'}`);
    } finally {
      setIsProcessingWorker(false);
      setTimeout(() => setWorkerFeedback(null), 4000);
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
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
        onManualRefresh={loadData}
        isRefreshing={isRefreshing}
        onPurgeTenantData={handlePurgeTenantData}
        isPurgingTenant={isPurgingTenant}
        onSeedShowcaseData={handleSeedShowcaseData}
        isSeedingShowcase={isSeedingShowcase}
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
            onInspectJobFromDlq={handleInspectJobFromDlq}
            onTriggerWorker={handleTriggerWorker}
            isProcessingWorker={isProcessingWorker}
            inferenceMode={inferenceMode}
            onToggleInferenceMode={handleToggleInferenceMode}
            workerFeedback={workerFeedback}
            viewingAllTenants={tenantId === 'ALL'}
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

