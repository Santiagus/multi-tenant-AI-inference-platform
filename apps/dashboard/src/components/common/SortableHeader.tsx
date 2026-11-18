import type { CSSProperties, ReactNode, MouseEvent } from 'react';

export type SortDirection = 'asc' | 'desc';

interface SortableHeaderProps<T extends string> {
  column: T;
  currentSortKey: T | null;
  currentSortDir: SortDirection;
  onSort: (column: T) => void;
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  style?: CSSProperties;
  /** Optional filter control rendered under the sort label (clicks do not trigger sort). */
  filter?: ReactNode;
}

export function SortableHeader<T extends string>({
  column,
  currentSortKey,
  currentSortDir,
  onSort,
  children,
  align = 'left',
  style,
  filter,
}: SortableHeaderProps<T>) {
  const isActive = currentSortKey === column;

  return (
    <th
      style={{
        padding: '8px 8px',
        fontWeight: 600,
        textAlign: align,
        userSelect: 'none',
        verticalAlign: 'bottom',
        color: isActive ? '#f8fafc' : '#94a3b8',
        ...style,
      }}
      title={filter ? undefined : `Click to sort by ${typeof children === 'string' ? children : column}`}
    >
      <div
        onClick={() => onSort(column)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          width: '100%',
          cursor: 'pointer',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.color = '#cbd5e1';
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.color = isActive ? '#f8fafc' : '#94a3b8';
        }}
        title={`Click to sort by ${typeof children === 'string' ? children : column}`}
      >
        <span>{children}</span>
        <span
          style={{
            fontSize: '10px',
            color: isActive ? '#818cf8' : '#475569',
            fontWeight: isActive ? 700 : 400,
          }}
        >
          {isActive ? (currentSortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </div>
      {filter ? (
        <div
          onClick={(e: MouseEvent) => e.stopPropagation()}
          onMouseDown={(e: MouseEvent) => e.stopPropagation()}
          style={{ marginTop: '6px', width: '100%' }}
        >
          {filter}
        </div>
      ) : null}
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
