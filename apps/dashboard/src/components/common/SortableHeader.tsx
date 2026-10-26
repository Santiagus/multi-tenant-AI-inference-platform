import type { CSSProperties, ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';

interface SortableHeaderProps<T extends string> {
  column: T;
  currentSortKey: T | null;
  currentSortDir: SortDirection;
  onSort: (column: T) => void;
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  style?: CSSProperties;
}

export function SortableHeader<T extends string>({
  column,
  currentSortKey,
  currentSortDir,
  onSort,
  children,
  align = 'left',
  style,
}: SortableHeaderProps<T>) {
  const isActive = currentSortKey === column;

  return (
    <th
      onClick={() => onSort(column)}
      style={{
        padding: '12px 16px',
        fontWeight: 600,
        textAlign: align,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'color 0.15s ease, background-color 0.15s ease',
        color: isActive ? '#f8fafc' : '#94a3b8',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.color = '#cbd5e1';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.color = '#94a3b8';
      }}
      title={`Click to sort by ${typeof children === 'string' ? children : column}`}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          width: '100%',
        }}
      >
        <span>{children}</span>
        <span
          style={{
            fontSize: '11px',
            color: isActive ? '#818cf8' : '#475569',
            fontWeight: isActive ? 700 : 400,
          }}
        >
          {isActive ? (currentSortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </div>
    </th>
  );
}

export function genericSort<T>(
  items: T[],
  key: string | null,
  dir: SortDirection,
  getValue?: (item: T, key: string) => unknown
): T[] {
  if (!key) return items;
  return [...items].sort((a, b) => {
    const valA = getValue ? getValue(a, key) : (a as Record<string, unknown>)[key];
    const valB = getValue ? getValue(b, key) : (b as Record<string, unknown>)[key];

    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    let comparison = 0;
    if (typeof valA === 'number' && typeof valB === 'number') {
      comparison = valA - valB;
    } else if (typeof valA === 'boolean' && typeof valB === 'boolean') {
      comparison = valA === valB ? 0 : valA ? 1 : -1;
    } else {
      comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
    }

    return dir === 'asc' ? comparison : -comparison;
  });
}

