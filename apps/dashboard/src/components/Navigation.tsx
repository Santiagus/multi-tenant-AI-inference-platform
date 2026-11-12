export type ActiveTab =
  | 'jobs'
  | 'provider-status'
  | 'pricing'
  | 'economics'
  | 'workload-path';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  jobCount?: number;
  inFlightCount?: number;
  syncedProvidersCount?: number;
  unsyncedProvidersCount?: number;
}

export function Navigation({
  activeTab,
  onTabChange,
  jobCount,
  inFlightCount,
  syncedProvidersCount,
  unsyncedProvidersCount,
}: NavigationProps) {
  const tabs: Array<{
    id: ActiveTab;
    label: string;
    badge?: string | number;
    badgeColor?: string;
  }> = [
    {
      id: 'jobs',
      label: 'Jobs & DLQ',
      badge: inFlightCount && inFlightCount > 0 ? `${inFlightCount} running` : jobCount,
      badgeColor: inFlightCount && inFlightCount > 0 ? '#6366f1' : '#475569',
    },
    {
      id: 'provider-status',
      label: 'Provider Status',
      badge:
        unsyncedProvidersCount !== undefined && syncedProvidersCount !== undefined
          ? unsyncedProvidersCount > 0
            ? `⚠️ ${syncedProvidersCount} Synced · ${unsyncedProvidersCount} Unsynced`
            : `${syncedProvidersCount} Synced · 0 Unsynced`
          : undefined,
      badgeColor:
        unsyncedProvidersCount !== undefined && unsyncedProvidersCount > 0
          ? '#ef4444'
          : '#10b981',
    },
    {
      id: 'pricing',
      label: 'Advisor',
      badge: 'FinOps + Routing',
      badgeColor: '#6366f1',
    },
    {
      id: 'economics',
      label: 'FinOps',
    },
    {
      id: 'workload-path',
      label: 'Workload Path',
    },
  ];

  return (
    <nav
      style={{
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        padding: '0 24px',
        display: 'flex',
        gap: '4px',
        overflowX: 'auto',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              padding: '14px 18px',
              fontSize: '13px',
              fontWeight: 600,
              color: isActive ? '#f8fafc' : '#94a3b8',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${isActive ? '#6366f1' : 'transparent'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '9999px',
                  backgroundColor: tab.badgeColor || '#334155',
                  color: '#ffffff',
                  fontWeight: 700,
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

