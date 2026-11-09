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
  const [dataSource, setDataSource] = useState<'real' | 'mock'>('real');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isProcessingWorker, setIsProcessingWorker] = useState<boolean>(false);
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
      if (health.dataSource) {
        setDataSource(health.dataSource);
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
  const handleSubmitJob = async (payload: {
    model_id: string;
    routing_preference: RoutingPreference;
    priority: number;
    max_retries: number;
    input: { prompt: string };
  }) => {
    await apiClient.submitJob(tenantId, payload);
    await loadData();
  };

  const handleCancelJob = async (jobId: string) => {
    await apiClient.cancelJob(tenantId, jobId);
    await loadData();
  };

  const handleTriggerWorker = async () => {
    setIsProcessingWorker(true);
    try {
      await apiClient.processNextJob();
      await loadData();
    } finally {
      setIsProcessingWorker(false);
    }
  };

  const handleToggleProviderHealth = async (provider: string, healthy: boolean) => {
    await apiClient.setProviderHealth(provider, healthy);
    await loadData();
  };

  const [isTogglingShowcase, setIsTogglingShowcase] = useState(false);

  const handleToggleShowcase = async (action: 'seed' | 'purge') => {
    setIsTogglingShowcase(true);
    try {
      if (action === 'seed') {
        const res = await apiClient.seedShowcaseData();
        setDataSource(res.dataSource);
      } else {
        const res = await apiClient.purgeShowcaseData();
        setDataSource(res.dataSource);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to toggle showcase data mode:', err);
    } finally {
      setIsTogglingShowcase(false);
    }
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        tenantId={tenantId}
        onTenantChange={setTenantId}
        apiHealthy={apiHealthy}
        dataSource={dataSource}
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
        onManualRefresh={loadData}
        isRefreshing={isRefreshing}
        onToggleShowcase={handleToggleShowcase}
        isTogglingShowcase={isTogglingShowcase}
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
            onTriggerWorker={handleTriggerWorker}
            isProcessingWorker={isProcessingWorker}
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

