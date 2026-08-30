'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsString, parseAsArrayOf, useQueryState, useQueryStates } from 'nuqs';
import type { ExceptionPage } from '@magic/contracts';
import { apiFetch, buildQuery } from '@/shared/lib/client';

/**
 * Query keys go through a factory. Ad-hoc key strings are how cache invalidation bugs start:
 * one call site writes `['exceptions', params]` and another writes `['exception-list', params]`,
 * and a resolved finding stays on screen because the two never met.
 */
export const exceptionKeys = {
  all: ['exceptions'] as const,
  lists: () => [...exceptionKeys.all, 'list'] as const,
  list: (params: Record<string, unknown>) => [...exceptionKeys.lists(), params] as const,
  details: () => [...exceptionKeys.all, 'detail'] as const,
  detail: (id: string) => [...exceptionKeys.details(), id] as const,
  counts: () => [...exceptionKeys.all, 'counts'] as const,
};

const arrayParam = parseAsArrayOf(parseAsString).withDefault([]);

/**
 * Filters, sort and cursor live in the URL, so the view survives a refresh and can be pasted into
 * a chat: a colleague opens the identical queue rather than an approximation of it.
 */
export function useExceptionFilters() {
  const [filters, setFilters] = useQueryStates({
    status: arrayParam,
    severity: arrayParam,
    rule_id: parseAsString.withDefault(''),
    account_id: parseAsString.withDefault(''),
    assignee_id: parseAsString.withDefault(''),
    q: parseAsString.withDefault(''),
    sort: parseAsString.withDefault('last_seen_at'),
    direction: parseAsString.withDefault('desc'),
  });

  const [cursor, setCursor] = useQueryState('cursor', parseAsString);

  const clearAll = useCallback(() => {
    void setFilters({
      status: [],
      severity: [],
      rule_id: '',
      account_id: '',
      assignee_id: '',
      q: '',
      sort: 'last_seen_at',
      direction: 'desc',
    });
    void setCursor(null);
  }, [setCursor, setFilters]);

  return { filters, setFilters, cursor, setCursor, clearAll };
}

export function useExceptions(params: Record<string, unknown>) {
  return useQuery({
    queryKey: exceptionKeys.list(params),
    queryFn: () => apiFetch<ExceptionPage>(`/api/exceptions${buildQuery(params)}`),
    placeholderData: (previous) => previous,
  });
}

/**
 * Cursor history kept client-side. Keyset pagination can only walk forward, so "previous" is a
 * stack of the cursors already visited rather than an offset the server could compute.
 */
export function useCursorHistory(cursor: string | null) {
  const [stack, setStack] = useState<string[]>([]);

  useEffect(() => {
    if (cursor === null) setStack([]);
  }, [cursor]);

  const push = useCallback((next: string) => setStack((current) => [...current, next]), []);
  const pop = useCallback(() => {
    let previous: string | null = null;
    setStack((current) => {
      previous = current[current.length - 2] ?? null;
      return current.slice(0, -1);
    });
    return previous;
  }, []);

  return { stack, push, pop, hasPrevious: stack.length > 0 };
}

export function useInvalidateExceptions() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: exceptionKeys.all });
  }, [queryClient]);
}
