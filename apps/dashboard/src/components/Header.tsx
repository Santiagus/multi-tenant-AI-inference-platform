interface HeaderProps {
  tenantId: string;
  onTenantChange: (tenant: string) => void;
  apiHealthy: boolean;
  dataSource?: 'real' | 'mock';
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  onToggleShowcase?: (action: 'seed' | 'purge') => Promise<void>;
  isTogglingShowcase?: boolean;
}

export function Header({
  tenantId,
  onTenantChange,
  apiHealthy,
  dataSource = 'real',
  autoRefresh,
  onAutoRefreshToggle,
  onManualRefresh,
  isRefreshing,
  onToggleShowcase,
  isTogglingShowcase = false,
}: HeaderProps) {
  const isMock = dataSource === 'mock';

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
      {/* ROW 1: Platform Branding (Left) & Refresh / Demo Toggles (Right) */}
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
        {/* Top Left: Logo & Platform Identity */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '17px', fontWeight: 700, color: '#f8fafc', margin: 0, whiteSpace: 'nowrap' }}>
                AI Inference Platform
              </h1>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  backgroundColor: 'rgba(99, 102, 241, 0.2)',
                  color: '#a5b4fc',
                  padding: '2px 7px',
                  borderRadius: '6px',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  whiteSpace: 'nowrap',
                }}
              >
                Enterprise Control Plane
              </span>
            </div>
            <p style={{ fontSize: '11px', color: '#64748b', margin: 0, whiteSpace: 'nowrap' }}>
              Two-Path Asynchronous Inference &amp; FinOps Ledger
            </p>
          </div>
        </div>

        {/* Top Right: Refresh Controls, Enable Demo Toggle & Real/Mock Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Auto Refresh & Manual Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={onAutoRefreshToggle}
              title="Auto-refresh interval set to 60s optimal for real-time spot auctions (Vast 1m, RunPod 2m)"
              style={{
                backgroundColor: autoRefresh ? 'rgba(99, 102, 241, 0.2)' : '#1e293b',
                color: autoRefresh ? '#a5b4fc' : '#94a3b8',
                border: `1px solid ${autoRefresh ? '#6366f1' : '#334155'}`,
                padding: '6px 11px',
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
                padding: '6px 13px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isRefreshing ? 'wait' : 'pointer',
                opacity: isRefreshing ? 0.75 : 1,
                minWidth: '85px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {isRefreshing ? 'Refreshing...' : '↻ Refresh'}
            </button>
          </div>

          {/* Enable / Clear Demo Button */}
          {onToggleShowcase && (
            <button
              onClick={() => onToggleShowcase(isMock ? 'purge' : 'seed')}
              disabled={isTogglingShowcase || isRefreshing}
              title={
                isMock
                  ? 'Purge showcase demo data and revert dashboard to real data mode'
                  : 'Populate 30 inference jobs, 688 pricing fluctuation snapshots & audits on the fly'
              }
              style={{
                backgroundColor: isMock ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                color: isMock ? '#fca5a5' : '#38bdf8',
                border: `1px solid ${isMock ? 'rgba(239, 68, 68, 0.35)' : 'rgba(56, 189, 248, 0.35)'}`,
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isTogglingShowcase || isRefreshing ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <span>{isMock ? '🗑️' : '✨'}</span>
              <span>
                {isTogglingShowcase
                  ? isMock
                    ? 'Clearing...'
                    : 'Populating...'
                  : isMock
                    ? 'Clear Demo Data'
                    : 'Enable Demo Data'}
              </span>
            </button>
          )}

          {/* Real vs Mock Data Indicator Badge */}
          <div
            data-testid="data-source-badge"
            title={
              isMock
                ? 'Injected demonstration dataset for showcase and offline preview'
                : 'Live production/development data queried from connected APIs and PostgreSQL database'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 700,
              color: isMock ? '#fbbf24' : '#34d399',
              backgroundColor: isMock ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
              padding: '6px 11px',
              borderRadius: '6px',
              border: `1px solid ${isMock ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: isMock ? '#f59e0b' : '#10b981',
                boxShadow: isMock ? '0 0 5px #f59e0b' : '0 0 5px #10b981',
              }}
            />
            <span>{isMock ? 'MOCK / SHOWCASE' : 'REAL DATA'}</span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: 500,
                color: isMock ? '#fde68a' : '#a7f3d0',
                opacity: 0.9,
              }}
            >
              {isMock ? '(Demo)' : '(Live DB)'}
            </span>
          </div>
        </div>
      </div>

      {/* ROW 2: Tenant Selection & Related Filters */}
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
        {/* Left: Tenant Dropdown & Scope Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Tenant:
            </span>
            <select
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
              <option value="tenant-default">tenant-default</option>
              <option value="tenant-acme">tenant-acme</option>
              <option value="tenant-finops">tenant-finops</option>
              <option value="tenant-enterprise">tenant-enterprise</option>
            </select>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: '#38bdf8',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontWeight: 500,
            }}
          >
            <span>🔒 Namespace:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{tenantId}</span>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: '#a78bfa',
              backgroundColor: 'rgba(167, 139, 250, 0.1)',
              border: '1px solid rgba(167, 139, 250, 0.25)',
              padding: '3px 8px',
              borderRadius: '5px',
            }}
          >
            <span>Storage:</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>s3://platform-artifacts/{tenantId}/</span>
          </div>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: '#34d399',
              backgroundColor: 'rgba(52, 211, 153, 0.1)',
              border: '1px solid rgba(52, 211, 153, 0.25)',
              padding: '3px 8px',
              borderRadius: '5px',
            }}
          >
            <span>SLA:</span>
            <span style={{ fontWeight: 600 }}>&lt;500ms P95 Target</span>
          </div>
        </div>

        {/* Right: Environment Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              color: '#94a3b8',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              padding: '3px 9px',
              borderRadius: '5px',
              fontWeight: 500,
            }}
          >
            Deployment: Docker Compose Local (Port 5173 ↔ 3000)
          </span>
        </div>
      </div>

      {/* ROW 3: Services Status Buttons Linking to Their Panels */}
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

        {/* 1. Control Plane API */}
        <a
          href="/healthz"
          target="_blank"
          rel="noreferrer"
          title="Fastify Control Plane API (Port 3000) - Click to inspect /healthz probe"
          style={{
            fontSize: '11px',
            color: apiHealthy ? '#34d399' : '#f87171',
            backgroundColor: apiHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${apiHealthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: apiHealthy ? '#10b981' : '#ef4444',
            }}
          />
          API 3000
        </a>

        {/* 2. Swagger UI */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          title="OpenAPI 3.0 Interactive Swagger UI & Schema Reference"
          style={{
            fontSize: '11px',
            color: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#38bdf8' }} />
          Swagger UI
        </a>

        {/* 3. Grafana Ops */}
        <a
          href="http://localhost:3001"
          target="_blank"
          rel="noreferrer"
          title="Grafana Operational Dashboards & SLO Monitoring (Port 3001)"
          style={{
            fontSize: '11px',
            color: '#fbbf24',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#f59e0b' }} />
          Grafana 3001
        </a>

        {/* 4. Prometheus */}
        <a
          href="http://localhost:9090"
          target="_blank"
          rel="noreferrer"
          title="Prometheus Metrics Engine & TSDB Query Browser (Port 9090)"
          style={{
            fontSize: '11px',
            color: '#fb923c',
            backgroundColor: 'rgba(251, 146, 60, 0.1)',
            border: '1px solid rgba(251, 146, 60, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fb923c' }} />
          Prometheus 9090
        </a>

        {/* 5. MinIO S3 Console */}
        <a
          href="http://localhost:9001"
          target="_blank"
          rel="noreferrer"
          title="MinIO Object Storage Web Console (Port 9001) - platform-artifacts bucket"
          style={{
            fontSize: '11px',
            color: '#34d399',
            backgroundColor: 'rgba(52, 211, 153, 0.1)',
            border: '1px solid rgba(52, 211, 153, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#34d399' }} />
          MinIO Console 9001
        </a>

        {/* 6. PostgreSQL */}
        <div
          title="PostgreSQL 16 Alpine (Port 5432) - Jobs, FinOps pricing snapshots, and tenant isolation"
          style={{
            fontSize: '11px',
            color: '#22d3ee',
            backgroundColor: 'rgba(34, 211, 238, 0.1)',
            border: '1px solid rgba(34, 211, 238, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#06b6d4' }} />
          Postgres 5432
        </div>

        {/* 7. ElasticMQ (SQS) */}
        <a
          href="http://localhost:9324"
          target="_blank"
          rel="noreferrer"
          title="ElasticMQ SQS & DLQ Message Broker (Port 9324)"
          style={{
            fontSize: '11px',
            color: '#c084fc',
            backgroundColor: 'rgba(192, 132, 252, 0.1)',
            border: '1px solid rgba(192, 132, 252, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#a855f7' }} />
          ElasticMQ SQS 9324
        </a>

        {/* 8. OpenTelemetry Collector */}
        <a
          href="http://localhost:8889/metrics"
          target="_blank"
          rel="noreferrer"
          title="OpenTelemetry Collector (Ports 4317/4318, Prometheus Exporter 8889)"
          style={{
            fontSize: '11px',
            color: '#f472b6',
            backgroundColor: 'rgba(244, 114, 182, 0.1)',
            border: '1px solid rgba(244, 114, 182, 0.3)',
            padding: '3px 8px',
            borderRadius: '5px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ec4899' }} />
          OTel Collector 4318
        </a>
      </div>
    </header>
  );
}
