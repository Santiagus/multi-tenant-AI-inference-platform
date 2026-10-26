interface HeaderProps {
  tenantId: string;
  onTenantChange: (tenant: string) => void;
  apiHealthy: boolean;
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
}

export function Header({
  tenantId,
  onTenantChange,
  apiHealthy,
  autoRefresh,
  onAutoRefreshToggle,
  onManualRefresh,
  isRefreshing,
}: HeaderProps) {
  return (
    <header
      style={{
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
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
            fontSize: '18px',
          }}
        >
          AI
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              AI Inference Platform
            </h1>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                padding: '2px 8px',
                borderRadius: '6px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
              }}
            >
              Product Dashboard
            </span>
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
            Two-Path Asynchronous Inference &amp; FinOps Ledger
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {/* API Health */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: apiHealthy ? '#34d399' : '#f87171',
            backgroundColor: apiHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            padding: '6px 12px',
            borderRadius: '8px',
            border: `1px solid ${apiHealthy ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: apiHealthy ? '#10b981' : '#ef4444',
            }}
          />
          {apiHealthy ? 'Control Plane Online' : 'API Offline'}
        </div>

        {/* Tenant Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Tenant:</label>
          <select
            value={tenantId}
            onChange={(e) => onTenantChange(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
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

        {/* Auto Refresh & Manual Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onAutoRefreshToggle}
            style={{
              backgroundColor: autoRefresh ? 'rgba(99, 102, 241, 0.2)' : '#1e293b',
              color: autoRefresh ? '#a5b4fc' : '#94a3b8',
              border: `1px solid ${autoRefresh ? '#6366f1' : '#334155'}`,
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {autoRefresh ? 'Auto 5s ON' : 'Auto OFF'}
          </button>
          <button
            onClick={onManualRefresh}
            disabled={isRefreshing}
            style={{
              backgroundColor: '#6366f1',
              color: '#ffffff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isRefreshing ? 'wait' : 'pointer',
              opacity: isRefreshing ? 0.7 : 1,
            }}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* External Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderLeft: '1px solid #334155', paddingLeft: '14px' }}>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: '12px',
              color: '#94a3b8',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            Swagger UI ↗
          </a>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: '12px',
              color: '#f59e0b',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Operational metrics & dashboards stay in Grafana"
          >
            Grafana Ops ↗
          </a>
        </div>
      </div>
    </header>
  );
}

