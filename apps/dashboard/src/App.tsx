import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Navigation, type ActiveTab } from './components/Navigation';
import { JobsView } from './components/jobs/JobsView';
import { ProvidersView } from './components/providers/ProvidersView';
import { RoutingView } from './components/routing/RoutingView';
import { EconomicsView } from './components/economics/EconomicsView';
import { WorkloadPathView } from './components/flow/WorkloadPathView';
import { apiClient } from './api/client';
import type {
  DlqMessage,
  EconomicsResponse,
  JobItem,
  ProviderProfile,
  RoutingPreference,
} from './types';

export function App() {
  const [tenantId, setTenantId] = useState<string>('tenant-default');
  const [activeTab, setActiveTab] = useState<ActiveTab>('jobs');
  const [apiHealthy, setApiHealthy] = useState<boolean>(true);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isProcessingWorker, setIsProcessingWorker] = useState<boolean>(false);

  // Core Data
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [dlqMessages, setDlqMessages] = useState<DlqMessage[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderProfile>>({});
  const [economics, setEconomics] = useState<EconomicsResponse | null>(null);

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

      // 2. Jobs & DLQ
      const [jobsRes, dlqRes, provRes, econRes] = await Promise.allSettled([
        apiClient.getJobs(tenantId, { limit: 50 }),
        apiClient.getDlqMessages(tenantId),
        apiClient.getProviders(),
        apiClient.getEconomics(tenantId),
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
      if (econRes.status === 'fulfilled') {
        setEconomics(econRes.value);
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

  // Auto-refresh interval (5s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData();
    }, 5000);
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        tenantId={tenantId}
        onTenantChange={setTenantId}
        apiHealthy={apiHealthy}
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
        onManualRefresh={loadData}
        isRefreshing={isRefreshing}
      />

      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        jobCount={jobs.length}
        inFlightCount={inFlightCount}
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

        {activeTab === 'providers' && (
          <ProvidersView
            providers={providers}
            jobs={jobs}
            isLoading={isRefreshing}
            onToggleHealth={handleToggleProviderHealth}
          />
        )}

        {activeTab === 'routing' && <RoutingView />}

        {activeTab === 'economics' && (
          <EconomicsView
            economics={economics}
            isLoading={isRefreshing}
            onRefresh={loadData}
          />
        )}

        {activeTab === 'workload-path' && <WorkloadPathView />}
      </main>
    </div>
  );
}

