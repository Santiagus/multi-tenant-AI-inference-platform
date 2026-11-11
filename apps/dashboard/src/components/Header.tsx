import type { CSSProperties } from 'react';

interface HeaderProps {
  tenantId: string;
  onTenantChange: (tenant: string) => void;
  apiHealthy?: boolean;
  stage?: string;
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
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

export function Header({
  tenantId,
  onTenantChange,
  stage = 'LOCAL',
  autoRefresh,
  onAutoRefreshToggle,
  onManualRefresh,
  isRefreshing,
  onPurgeTenantData,
  isPurgingTenant = false,
  onSeedShowcaseData,
  isSeedingShowcase = false,
}: HeaderProps) {
  const stageStyle = getStageBadgeStyle(stage);
  const isLocalOrDev = stage.toUpperCase().includes('LOCAL') || stage.toUpperCase().includes('DEV');

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

        {/* Top Right: Stage info (just Stage: <STAGE>) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Tenant:
            </span>
            <select
              data-testid="tenant-select"
              value={tenantId}
              onChange={(e) => onTenantChange(e.target.value)}
              style={{
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">All Tenants</option>
              <option value="tenant-default">tenant-default</option>
              <option value="tenant-demo">tenant-demo (Showcase / All Possibilities)</option>
              <option value="tenant-dev">tenant-dev (Development / Sandbox)</option>
              <option value="tenant-acme">tenant-acme</option>
              <option value="tenant-finops">tenant-finops</option>
              <option value="tenant-enterprise">tenant-enterprise</option>
            </select>
          </div>

          {/* Auto Refresh & Force Refresh Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={onAutoRefreshToggle}
              title="Auto-refresh interval set to 60s optimal for real-time spot auctions (Vast 1m, RunPod 2m)"
              style={{
                backgroundColor: autoRefresh ? 'rgba(99, 102, 241, 0.2)' : '#1e293b',
                color: autoRefresh ? '#a5b4fc' : '#94a3b8',
                border: `1px solid ${autoRefresh ? '#6366f1' : '#334155'}`,
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {autoRefresh ? 'Auto 60s ON' : 'Auto OFF'}
            </button>
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
              title="Seed showcase jobs covering every status, provider, hardware, and execution mode"
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

          {/* Debug Utility Button: Remove all tenant data for tenant-dev in local/dev */}
          {isLocalOrDev && tenantId === 'tenant-dev' && onPurgeTenantData && (
            <button
              data-testid="debug-purge-tenant-data"
              onClick={onPurgeTenantData}
              disabled={isPurgingTenant}
              title="Debug Utility: Purge all jobs and test data for tenant-dev (only available for local/dev)"
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
              <span>{isPurgingTenant ? 'Purging dev data...' : 'Purge Tenant Data'}</span>
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
