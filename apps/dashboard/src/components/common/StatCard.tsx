interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: string;
  trendPositive?: boolean;
  accentColor?: string;
  onClick?: () => void;
  active?: boolean;
}

export function StatCard({
  label,
  value,
  subtext,
  trend,
  trendPositive,
  accentColor = '#6366f1',
  onClick,
  active = false,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: active ? '#172033' : '#0f172a',
        borderRadius: '10px',
        padding: subtext || trend ? '14px 16px' : '12px 16px',
        border: active ? `1px solid ${accentColor}` : '1px solid #1e293b',
        boxShadow: active
          ? `0 0 0 1px ${accentColor}40, 0 4px 6px -1px rgba(0, 0, 0, 0.1)`
          : '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, border-color 0.15s ease, background-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (onClick && !active) {
          e.currentTarget.style.borderColor = accentColor;
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={(e) => {
        if (onClick && !active) {
          e.currentTarget.style.borderColor = '#1e293b';
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          backgroundColor: accentColor,
        }}
      />
      <div>
        <div
          style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: active ? '#f8fafc' : '#94a3b8',
            fontWeight: 600,
            marginBottom: subtext || trend ? '6px' : '4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '23px',
            fontWeight: 700,
            color: '#f8fafc',
            lineHeight: 1.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {value}
        </div>
      </div>
      {(subtext || trend) && (
        <div
          style={{
            marginTop: '8px',
            fontSize: '11px',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          {trend && (
            <span
              style={{
                color: trendPositive ? '#10b981' : '#ef4444',
                fontWeight: 600,
              }}
            >
              {trend}
            </span>
          )}
          {subtext && <span>{subtext}</span>}
        </div>
      )}
    </div>
  );
}

