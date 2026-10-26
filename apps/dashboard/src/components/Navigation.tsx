export type ActiveTab = 'jobs' | 'providers' | 'routing' | 'economics' | 'workload-path';

interface NavigationProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  jobCount?: number;
  inFlightCount?: number;
}

export function Navigation({
  activeTab,
  onTabChange,
  jobCount,
  inFlightCount,
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
      id: 'providers',
      label: 'Providers & Models',
    },
    {
      id: 'routing',
      label: 'Routing Explanation',
    },
    {
      id: 'economics',
      label: 'Usage & Economics',
    },
    {
      id: 'workload-path',
      label: 'Workload Path (React Flow)',
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

