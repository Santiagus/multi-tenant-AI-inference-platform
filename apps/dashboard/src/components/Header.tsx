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
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'nowrap',
        gap: '16px',
        minHeight: '64px',
      }}
    >
      {/* Left: Logo, Title, and Tenant Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              color: '#fff',
              fontSize: '16px',
              flexShrink: 0,
            }}
          >
            AI
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0, whiteSpace: 'nowrap' }}>
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
                Dashboard
              </span>
            </div>
            <p style={{ fontSize: '11px', color: '#64748b', margin: 0, whiteSpace: 'nowrap' }}>
              Two-Path Asynchronous Inference &amp; FinOps Ledger
            </p>
          </div>
        </div>

        {/* Tenant Selector on the Left */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderLeft: '1px solid #334155',
            paddingLeft: '16px',
          }}
        >
          <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Tenant:
          </label>
          <select
            value={tenantId}
            onChange={(e) => onTenantChange(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              padding: '5px 10px',
              borderRadius: '6px',
              fontSize: '12px',
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
      </div>

      {/* Right: Refresh Controls, Swagger & Grafana buttons, API Health, and Mock/Real Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        {/* Auto Refresh & Manual Refresh */}
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
              minWidth: '85px',
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Swagger & Grafana as clean action buttons without [↗] */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderLeft: '1px solid #334155', paddingLeft: '10px' }}>
          <a
            href="/docs"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: '11px',
              color: '#cbd5e1',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              padding: '5px 10px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            Swagger UI
          </a>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            title="Operational metrics & dashboards stay in Grafana"
            style={{
              fontSize: '11px',
              color: '#fbbf24',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              padding: '5px 10px',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            Grafana Ops
          </a>
        </div>

        {/* API Health Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: apiHealthy ? '#34d399' : '#f87171',
            backgroundColor: apiHealthy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            padding: '5px 10px',
            borderRadius: '6px',
            border: `1px solid ${apiHealthy ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: apiHealthy ? '#10b981' : '#ef4444',
            }}
          />
          {apiHealthy ? 'Control Plane Online' : 'API Offline'}
        </div>

        {/* Real vs Mock Data Indicator Badge & On-The-Fly Toggle Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              padding: '5px 10px',
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
                padding: '5px 10px',
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
                    ? 'Clear Showcase'
                    : 'Populate Showcase'}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

