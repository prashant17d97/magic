'use client';

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowDown, faArrowUp, faSort } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';

export interface Column<T> {
  id: string;
  header: string;
  width: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /**
   * Columns drop in this order as the viewport narrows: 3 goes first, 1 never goes.
   *
   * The breakpoints sit one step wider than they look, because the table never gets the whole
   * viewport — the sidebar takes 240px of it. Hiding a column at the nominal 1280 breakpoint
   * would still leave 1040px of table trying to hold 1280px of columns.
   */
  priority?: 1 | 2 | 3;
  cell(row: T): ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string;
  caption: string;
  selectedId?: string | null;
  focusedIndex?: number;
  selection?: Set<string>;
  onToggleSelect?(id: string): void;
  onToggleSelectAll?(): void;
  onRowClick?(row: T, index: number): void;
  sort?: { column: string; direction: 'asc' | 'desc' };
  onSortChange?(column: string): void;
  emptyState?: ReactNode;
}

/**
 * A real table, not a grid of divs: `<table>` semantics, `scope` on headers, `aria-sort` on
 * sortable columns and a caption. Screen-reader users navigate a financial ledger by column and
 * row, and a div soup takes that away.
 *
 * Two performance decisions that matter at fifty dense rows: hover is CSS only, never React
 * state, and the column widths live in one `grid-template-columns` value on the container rather
 * than in per-cell JavaScript.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  selectedId,
  focusedIndex,
  selection,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  sort,
  onSortChange,
  emptyState,
}: DataTableProps<T>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const selectable = Boolean(onToggleSelect);

  useEffect(() => {
    if (focusedIndex === undefined || focusedIndex < 0) return;
    const row = bodyRef.current?.children[focusedIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const ariaSort = useCallback(
    (column: Column<T>): 'ascending' | 'descending' | 'none' | undefined => {
      if (!column.sortable) return undefined;
      if (sort?.column !== column.id) return 'none';
      return sort.direction === 'asc' ? 'ascending' : 'descending';
    },
    [sort],
  );

  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  const allSelected = selection !== undefined && rows.length > 0 && rows.every((r) => selection.has(rowKey(r)));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-[var(--z-sticky)] bg-[var(--bg-surface)]">
          <tr className="border-b border-[var(--border-default)]">
            {selectable ? (
              <th scope="col" className="w-9 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  aria-label="Select all rows on this page"
                  className="size-3.5 cursor-pointer accent-[var(--brand-fill)]"
                />
              </th>
            ) : null}

            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={ariaSort(column)}
                className={cn(
                  'type-table-head px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.priority === 3 && 'hidden 2xl:table-cell',
                  column.priority === 2 && 'hidden xl:table-cell',
                )}
                style={{ width: column.width }}
              >
                {column.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(column.id)}
                    className="inline-flex items-center gap-1.5 hover:text-[var(--text-primary)]"
                  >
                    {column.header}
                    <FontAwesomeIcon
                      icon={
                        sort?.column === column.id
                          ? sort.direction === 'asc'
                            ? faArrowUp
                            : faArrowDown
                          : faSort
                      }
                      className={cn(
                        'text-[9px]',
                        sort?.column === column.id ? 'text-[var(--text-brand)]' : 'text-[var(--text-tertiary)]',
                      )}
                      aria-hidden
                    />
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody ref={bodyRef}>
          {rows.map((row, index) => {
            const id = rowKey(row);
            const isSelected = selectedId === id;
            const isChecked = selection?.has(id) ?? false;
            const isFocused = focusedIndex === index;

            return (
              <tr
                key={id}
                onClick={() => onRowClick?.(row, index)}
                aria-selected={isSelected || undefined}
                data-focused={isFocused || undefined}
                className={cn(
                  'group border-b border-[var(--border-subtle)] transition-colors duration-[var(--duration-instant)]',
                  onRowClick && 'cursor-pointer',
                  'hover:bg-[var(--bg-hover)]',
                  isSelected && 'bg-[var(--bg-selected)]',
                  isFocused && 'outline outline-2 -outline-offset-2 outline-[var(--border-focus)]',
                )}
                style={{ height: 'var(--row-height)' }}
              >
                {selectable ? (
                  <td className="px-3" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggleSelect?.(id)}
                      aria-label={`Select row ${index + 1}`}
                      className="size-3.5 cursor-pointer accent-[var(--brand-fill)]"
                    />
                  </td>
                ) : null}

                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'type-table px-3 text-[var(--text-primary)]',
                      column.align === 'right' && 'numeric',
                      column.align === 'center' && 'text-center',
                      column.priority === 3 && 'hidden 2xl:table-cell',
                      column.priority === 2 && 'hidden xl:table-cell',
                    )}
                    style={{ paddingTop: 'var(--cell-pad-y)', paddingBottom: 'var(--cell-pad-y)' }}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
