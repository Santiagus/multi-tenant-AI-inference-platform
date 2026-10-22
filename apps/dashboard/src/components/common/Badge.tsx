import type { JobStatus } from '../../types';

interface BadgeProps {
  status: JobStatus | string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: BadgeProps) {
  const normalized = status.toUpperCase();

  let bg = '#334155';
  let color = '#f8fafc';
  let border = '#475569';
  let pulse = false;

  switch (normalized) {
    case 'SUCCEEDED':
    case 'HEALTHY':
    case 'OPTIMAL':
      bg = 'rgba(16, 185, 129, 0.15)';
      color = '#34d399';
      border = 'rgba(16, 185, 129, 0.4)';
      break;
    case 'FAILED':
    case 'UNHEALTHY':
    case 'CRITICAL':
      bg = 'rgba(239, 68, 68, 0.15)';
      color = '#f87171';
      border = 'rgba(239, 68, 68, 0.4)';
      break;
    case 'PROCESSING':
    case 'GENERATING':
      bg = 'rgba(99, 102, 241, 0.15)';
      color = '#818cf8';
      border = 'rgba(99, 102, 241, 0.4)';
      pulse = true;
      break;
    case 'QUEUED':
    case 'SUBMITTED':
      bg = 'rgba(245, 158, 11, 0.15)';
      color = '#fbbf24';
      border = 'rgba(245, 158, 11, 0.4)';
      break;
    case 'RETRYING':
      bg = 'rgba(217, 70, 239, 0.15)';
      color = '#e879f9';
      border = 'rgba(217, 70, 239, 0.4)';
      pulse = true;
      break;
    case 'CANCELLED':
    default:
      bg = 'rgba(100, 116, 139, 0.15)';
      color = '#94a3b8';
      border = 'rgba(100, 116, 139, 0.4)';
      break;
  }

  const padding = size === 'sm' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? '11px' : '12px';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding,
        borderRadius: '9999px',
        backgroundColor: bg,
        color,
        border: `1px solid ${border}`,
        fontSize,
        fontWeight: 600,
        letterSpacing: '0.025em',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
          animation: pulse ? 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none',
        }}
      />
      {status}
    </span>
  );
}

