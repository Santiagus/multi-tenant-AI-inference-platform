import type { CSSProperties } from 'react';

interface HeaderProps {
  tenantId: string;
  onTenantChange: (tenant: string) => void;
  apiHealthy?: boolean;
  stage?: string;
  /** Dashboard list refresh cadence in seconds; 0 disables auto-refresh. */
  autoRefreshSeconds: number;
  onAutoRefreshSecondsChange: (seconds: number) => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  onPurgeTenantData?: () => Promise<void>;
  isPurgingTenant?: boolean;
  onSeedShowcaseData?: () => Promise<void>;
  isSeedingShowcase?: boolean;
  // Optional backwards compatibility props
  dataSource?: 'real' | 'mock';
  inferenceMode?: 'mock' | 'real';
  onToggleInferenceMode?: (mode: 'mock' | 'real') => Promise<void>;
  onProcessNext?: () => Promise<void>;
  isProcessingWorker?: boolean;
  inFlightCount?: number;
  workerFeedback?: string | null;
  onToggleShowcase?: (action: 'seed' | 'purge') => Promise<void>;
  isTogglingShowcase?: boolean;
  /** MOCK_PROVIDERS gate from /healthz (true = simulated providers/worker). */
  mockProviders?: boolean;
  onToggleMockProviders?: (enabled: boolean) => Promise<void>;
  isTogglingMockProviders?: boolean;
}

function getStageBadgeStyle(stage = 'LOCAL') {
  const s = stage.toUpperCase();
  if (s.includes('PROD')) {
    return {
      bg: 'rgba(239, 68, 68, 0.15)',
      color: '#f87171',
      border: '1px solid rgba(239, 68, 68, 0.4)',
      label: 'PRODUCTION',
      icon: '🚨',
    };
  }
  if (s.includes('STAGE') || s.includes('STAGING')) {
    return {
      bg: 'rgba(245, 158, 11, 0.15)',
      color: '#fbbf24',
      border: '1px solid rgba(245, 158, 11, 0.4)',
      label: 'STAGING',
      icon: '🔶',
    };
  }
  if (s.includes('TEST')) {
    return {
      bg: 'rgba(168, 85, 247, 0.15)',
      color: '#c084fc',
      border: '1px solid rgba(168, 85, 247, 0.4)',
      label: 'TEST',
      icon: '🧪',
    };
  }
  if (s.includes('DEV')) {
    return {
      bg: 'rgba(59, 130, 246, 0.15)',
      color: '#60a5fa',
      border: '1px solid rgba(59, 130, 246, 0.4)',
      label: 'DEV',
      icon: '🛠️',
    };
  }
  return {
    bg: 'rgba(6, 182, 212, 0.18)',
    color: '#22d3ee',
    border: '1px solid rgba(6, 182, 212, 0.5)',
    label: 'LOCAL',
    icon: '💻',
  };
}

function serviceLinkStyle(color: string, bg: string, border: string): CSSProperties {
  return {
    fontSize: '11px',
    color,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    padding: '3px 10px',
    borderRadius: '5px',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 600,
    transition: 'all 0.15s ease',
  };
}

/** Local-dev tenant catalog: value shown in the selector + purpose for UI tooltips. */
export const TENANT_OPTIONS = [
  {
    value: 'ALL',
    label: 'All Tenants',
    purpose:
      'Cross-tenant overview. Lists jobs from every tenant in one view — use when checking isolation or showcase coverage across tenants.',
  },
  {
    value: 'tenant-default',
    label: 'tenant-default',
    purpose:
      'Primary local-dev tenant. API and dashboard default (x-tenant-id). Use for everyday feature work and real job submissions.',
  },
  {
    value: 'tenant-demo',
    label: 'tenant-demo (Showcase / All Possibilities)',
    purpose:
      'Showcase / painted dataset tenant. Seed via “Seed Showcase Data” for all statuses, engines, modalities, and placements. Avoid mixing real jobs here.',
  },
  {
    value: 'tenant-dev',
    label: 'tenant-dev (Development / Sandbox)',
    purpose:
      'Throwaway sandbox. Experiment freely; local/dev purge clears jobs and test data for this tenant only.',
  },
  {
    value: 'tenant-acme',
    label: 'tenant-acme',
    purpose:
      'Sample multi-tenant peer (Acme). Sparse cross-tenant fixtures from showcase seed — use to verify isolation against tenant-default.',
  },
  {
    value: 'tenant-finops',
    label: 'tenant-finops',
    purpose:
      'FinOps / cost-attribution sample tenant. Sparse showcase rows for pricing, metering, and economics views.',
  },
  {
    value: 'tenant-enterprise',
    label: 'tenant-enterprise',
    purpose:
      'Enterprise-policy sample tenant. Sparse showcase rows for stricter ABAC / quota-style demos.',
  },
] as const;

export function getTenantPurpose(tenantId: string): string {
  return TENANT_OPTIONS.find((t) => t.value === tenantId)?.purpose ?? `Tenant scope: ${tenantId}`;
}

export function Header({
  tenantId,
  onTenantChange,
  stage = 'LOCAL',
  autoRefreshSeconds,
  onAutoRefreshSecondsChange,
  onManualRefresh,
  isRefreshing,
  onPurgeTenantData,
  isPurgingTenant = false,
  onSeedShowcaseData,
  isSeedingShowcase = false,
  mockProviders = true,
  onToggleMockProviders,
  isTogglingMockProviders = false,
}: HeaderProps) {
  const stageStyle = getStageBadgeStyle(stage);
  const isLocalOrDev = stage.toUpperCase().includes('LOCAL') || stage.toUpperCase().includes('DEV');
  const mockProvidersTip =
    'MOCK_PROVIDERS: when ON, the API simulates providers and local workers (no cloud spend, no PyTorch forward pass). When OFF, live local/cloud inference is allowed — the API image must already include Python/CUDA; this toggle only opens the gate.';

  return (
    <header
      style={{
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
      }}
    >
      {/* ROW 1: Brand (Left) | Stage Info (Right) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderBottom: '1px solid #1e293b',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        {/* Top Left: Logo & Title (no local badge, no enterprise control plane badge) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              color: '#fff',
              fontSize: '16px',
              boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
              flexShrink: 0,
            }}
          >
            AI
          </div>
          <div>
            <h1 style={{ fontSize: '17px', fontWeight: 700, color: '#f8fafc', margin: 0, whiteSpace: 'nowrap' }}>
              AI Inference Platform
            </h1>
            <p style={{ fontSize: '11px', color: '#64748b', margin: 0, whiteSpace: 'nowrap' }}>
              Two-Path Asynchronous Inference &amp; FinOps Ledger
            </p>
          </div>
        </div>

        {/* Top Right: MOCK_PROVIDERS toggle (left of stage) + Stage badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            data-testid="mock-providers-toggle"
            title={mockProvidersTip}
            aria-pressed={mockProviders}
            aria-label={mockProviders ? 'MOCK_PROVIDERS on' : 'MOCK_PROVIDERS off'}
            disabled={!onToggleMockProviders || isTogglingMockProviders}
            onClick={() => {
              void onToggleMockProviders?.(!mockProviders);
            }}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: mockProviders ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
              color: mockProviders ? '#fbbf24' : '#34d399',
              border: `1px solid ${mockProviders ? 'rgba(245, 158, 11, 0.45)' : 'rgba(16, 185, 129, 0.45)'}`,
              padding: '4px 10px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              letterSpacing: '0.04em',
              cursor: onToggleMockProviders && !isTogglingMockProviders ? 'pointer' : 'default',
              opacity: isTogglingMockProviders ? 0.7 : 1,
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: mockProviders ? '#fbbf24' : '#34d399',
                boxShadow: mockProviders
                  ? '0 0 0 2px rgba(245, 158, 11, 0.25)'
                  : '0 0 0 2px rgba(16, 185, 129, 0.25)',
              }}
            />
            <span>MOCK_PROVIDERS: {mockProviders ? 'ON' : 'OFF'}</span>
          </button>
          <div
            data-testid="stage-badge"
            title={`Active Deployment Stage: ${stageStyle.label}`}
            style={{
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: stageStyle.bg,
              color: stageStyle.color,
              border: stageStyle.border,
              padding: '4px 10px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
              letterSpacing: '0.04em',
            }}
          >
            <span>{stageStyle.icon}</span>
            <span>Stage: {stageStyle.label}</span>
          </div>
        </div>
      </div>

      {/* ROW 2: Tenant Selection & Refresh Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 24px',
          backgroundColor: '#0c1322',
          borderBottom: '1px solid #1e293b',
          gap: '14px',
          flexWrap: 'wrap',
        }}
      >
        {/* Left: Tenant Dropdown, Refresh Controls & Debug Purge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title={getTenantPurpose(tenantId)}
          >
            <span
              style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
              title={getTenantPurpose(tenantId)}
            >
              Tenant:
            </span>
            <select
              data-testid="tenant-select"
              value={tenantId}
              onChange={(e) => onTenantChange(e.target.value)}
              title={getTenantPurpose(tenantId)}
              aria-label={`Tenant: ${tenantId}. ${getTenantPurpose(tenantId)}`}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'help',
              }}
            >
              {TENANT_OPTIONS.map((tenant) => (
                <option key={tenant.value} value={tenant.value} title={tenant.purpose}>
                  {tenant.label}
                </option>
              ))}
            </select>
          </div>

          {/* Auto Refresh cadence & Force Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label
              title="Dashboard auto-refresh cadence. Use 5s/15s while developing; 60s suits spot auction polls."
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: autoRefreshSeconds > 0 ? 'rgba(99, 102, 241, 0.2)' : '#1e293b',
                color: autoRefreshSeconds > 0 ? '#a5b4fc' : '#94a3b8',
                border: `1px solid ${autoRefreshSeconds > 0 ? '#6366f1' : '#334155'}`,
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Auto
              <select
                data-testid="auto-refresh-seconds"
                value={autoRefreshSeconds}
                onChange={(e) => onAutoRefreshSecondsChange(Number(e.target.value))}
                style={{
                  backgroundColor: '#0f172a',
                  color: '#e2e8f0',
                  border: '1px solid #334155',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 4px',
                  cursor: 'pointer',
                }}
              >
                <option value={0}>OFF</option>
                <option value={5}>5s</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </label>
            <button
              onClick={onManualRefresh}
              disabled={isRefreshing}
              style={{
                backgroundColor: '#6366f1',
                color: '#ffffff',
                border: 'none',
                padding: '5px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isRefreshing ? 'wait' : 'pointer',
                opacity: isRefreshing ? 0.75 : 1,
                minWidth: '80px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {isRefreshing ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </div>

          {/* Showcase seed: populate tenant-demo with all statuses / providers / HW */}
          {isLocalOrDev && tenantId === 'tenant-demo' && onSeedShowcaseData && (
            <button
              data-testid="seed-showcase-data"
              onClick={onSeedShowcaseData}
              disabled={isSeedingShowcase}
              title="Seed tenant-demo jobs: all statuses, engines, modalities, routing strategies, priorities, duration-metered placements, local CPU/GPU, and DLQ"
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isSeedingShowcase ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{isSeedingShowcase ? 'Seeding showcase...' : 'Seed Showcase Data'}</span>
            </button>
          )}

          {/* Local/dev: wipe all jobs + cascaded S3 outputs for the selected concrete tenant */}
          {isLocalOrDev && tenantId !== 'ALL' && onPurgeTenantData && (
            <button
              data-testid="debug-purge-tenant-data"
              onClick={() => {
                const ok = window.confirm(
                  `Purge ALL jobs and output artifacts for ${tenantId}?\n\nThis cannot be undone. Showcase painted rows can be restored via Seed Showcase Data.`
                );
                if (ok) void onPurgeTenantData();
              }}
              disabled={isPurgingTenant}
              title={`Purge all jobs and S3 output artifacts for ${tenantId} (local/dev only). ${getTenantPurpose(tenantId)}`}
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isPurgingTenant ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
              }}
            >
              <span>🗑️</span>
              <span>{isPurgingTenant ? 'Purging…' : 'Purge Tenant Data'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ROW 3: Services Links (One word, no ports, no dots) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 24px',
          backgroundColor: '#090e1a',
          borderBottom: '1px solid #1e293b',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: '10px',
            fontWeight: 700,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginRight: '4px',
          }}
        >
          Services:
        </span>

        {/* 1. Swagger UI */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          title="OpenAPI 3.0 Interactive Swagger UI & Schema Reference"
          style={serviceLinkStyle('#38bdf8', 'rgba(56, 189, 248, 0.1)', 'rgba(56, 189, 248, 0.3)')}
        >
          Swagger
        </a>

        {/* 2. Adminer */}
        <a
          href="http://localhost:8080/?pgsql=postgres&username=postgres&db=platform"
          target="_blank"
          rel="noreferrer"
          title="Adminer PostgreSQL Database Panel (Port 8080) - Browse tables: jobs, tenants, provider_pricing_snapshots"
          style={serviceLinkStyle('#22d3ee', 'rgba(34, 211, 238, 0.1)', 'rgba(34, 211, 238, 0.3)')}
        >
          Adminer
        </a>

        {/* 3. MinIO */}
        <a
          href="http://localhost:9001"
          target="_blank"
          rel="noreferrer"
          title="MinIO Object Storage Web Console (Port 9001) - platform-artifacts bucket (minioadmin / minioadmin)"
          style={serviceLinkStyle('#34d399', 'rgba(52, 211, 153, 0.1)', 'rgba(52, 211, 153, 0.3)')}
        >
          MinIO
        </a>

        {/* 4. ElasticMQ */}
        <a
          href="http://localhost:9324/?Action=ListQueues"
          target="_blank"
          rel="noreferrer"
          title="ElasticMQ SQS & DLQ Message Broker (Port 9324) - AWS SQS API endpoint (ListQueues)"
          style={serviceLinkStyle('#c084fc', 'rgba(192, 132, 252, 0.1)', 'rgba(192, 132, 252, 0.3)')}
        >
          ElasticMQ
        </a>

        {/* 5. Prometheus */}
        <a
          href="http://localhost:9090/graph?g0.expr=sum+by+(route)+(rate(http_server_requests_total%5B1m%5D))&g0.tab=0&g0.range_input=1h"
          target="_blank"
          rel="noreferrer"
          title="Prometheus Metrics Engine & TSDB (Port 9090) - Visualizes HTTP route throughput graph & metrics filters"
          style={serviceLinkStyle('#fb923c', 'rgba(251, 146, 60, 0.1)', 'rgba(251, 146, 60, 0.3)')}
        >
          Prometheus
        </a>

        {/* 6. Alerts */}
        <a
          href="http://localhost:9090/alerts"
          target="_blank"
          rel="noreferrer"
          title="Prometheus Active Alerting Rules (Port 9090) - Inspect 7 active platform inference alert rules & firing states"
          style={serviceLinkStyle('#f97316', 'rgba(249, 115, 22, 0.1)', 'rgba(249, 115, 22, 0.3)')}
        >
          Alerts
        </a>

        {/* 7. Grafana */}
        <a
          href="http://localhost:3001/dashboards"
          target="_blank"
          rel="noreferrer"
          title="Grafana Operational Dashboards & SLO Monitoring (Port 3001) - View all dashboards"
          style={serviceLinkStyle('#fbbf24', 'rgba(245, 158, 11, 0.1)', 'rgba(245, 158, 11, 0.3)')}
        >
          Grafana
        </a>

        {/* 8. OTel */}
        <a
          href="http://localhost:8889/metrics"
          target="_blank"
          rel="noreferrer"
          title="OpenTelemetry Collector Prometheus Exporter (Port 8889) - Live OTel metrics stream"
          style={serviceLinkStyle('#f472b6', 'rgba(244, 114, 182, 0.1)', 'rgba(244, 114, 182, 0.3)')}
        >
          OTel
        </a>
      </div>
    </header>
  );
}
