'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RuleSetting } from '@magic/contracts';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { TableSkeleton } from '@/shared/components/feedback/States';
import { useToast } from '@/shared/components/feedback/Toast';
import { apiFetch } from '@/shared/lib/client';
import { cn } from '@/shared/lib/cn';
import { formatCount } from '@/shared/lib/money';

const LAYER_TITLES: Record<number, { title: string; description: string }> = {
  1: {
    title: 'Layer 1 — ledger integrity',
    description: 'Universal arithmetic. These do not know what a charge type is, and a failure here stops the layers below it for that object.',
  },
  2: {
    title: 'Layer 2 — expected postings',
    description: 'The only layer that forks on charge type. Each mapper emits what should have posted; one shared comparator checks it.',
  },
  3: {
    title: 'Layer 3 — business rules',
    description: 'Reads settlements and orders. Evaluated once per tenant, so an order is judged with every account in view.',
  },
};

/**
 * The ignore rate next to each rule is the tuning signal.
 *
 * A rule ignored eighty per cent of the time is producing noise, and the false-positive rate is
 * the metric that decides whether this queue gets used at all. Showing it here makes tuning a
 * routine act rather than a project someone has to schedule.
 */
export function RulesSettings({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: () => apiFetch<{ data: RuleSetting[] }>('/api/rules'),
  });

  async function patch(ruleId: string, body: Record<string, unknown>): Promise<void> {
    setSaving(ruleId);
    try {
      await apiFetch(`/api/rules/${encodeURIComponent(ruleId)}`, { method: 'PATCH', body });
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast.push({ tone: 'success', message: 'Rule updated', detail: 'It takes effect on the next run.' });
    } catch (caught) {
      toast.push({
        tone: 'danger',
        message: 'The rule was not changed',
        detail: caught instanceof Error ? caught.message : undefined,
      });
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) return <TableSkeleton rows={10} columns={5} />;

  const rules = data?.data ?? [];
  const byLayer = new Map<number, RuleSetting[]>();
  for (const rule of rules) byLayer.set(rule.layer, [...(byLayer.get(rule.layer) ?? []), rule]);

  return (
    <div className="flex flex-col gap-5">
      {[1, 2, 3].map((layer) => {
        const layerRules = byLayer.get(layer) ?? [];
        if (layerRules.length === 0) return null;
        const meta = LAYER_TITLES[layer]!;

        return (
          <section key={layer} className="surface overflow-hidden">
            <header className="border-b border-[var(--border-subtle)] px-4 py-3">
              <h2 className="type-h3 text-[var(--text-primary)]">{meta.title}</h2>
              <p className="mt-0.5 max-w-3xl type-caption text-[var(--text-secondary)]">{meta.description}</p>
            </header>

            <ul className="divide-y divide-[var(--border-subtle)]">
              {layerRules.map((rule) => {
                const noisy = rule.raised_30d >= 5 && rule.ignore_rate >= 0.5;

                return (
                  <li key={rule.rule_id} className={cn('px-4 py-3', !rule.enabled && 'opacity-60')}>
                    <div className="flex flex-wrap items-start gap-3">
                      <label className="mt-0.5 inline-flex shrink-0 items-center">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          disabled={!canEdit || saving === rule.rule_id}
                          onChange={(event) => void patch(rule.rule_id, { enabled: event.target.checked })}
                          className="size-3.5 accent-[var(--brand-fill)]"
                        />
                        <span className="sr-only">{`Enable ${rule.name}`}</span>
                      </label>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="type-body-sm font-medium text-[var(--text-primary)]">{rule.name}</span>
                          <span className="type-mono-sm text-[var(--text-tertiary)]">{rule.rule_id}</span>
                          {rule.charge_types ? (
                            <Badge tone="brand">{rule.charge_types.join(' · ')}</Badge>
                          ) : null}
                          {noisy ? <Badge tone="warning">Noisy</Badge> : null}
                        </div>
                        <p className="mt-1 max-w-3xl type-caption text-[var(--text-secondary)]">{rule.description}</p>

                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-1.5 type-caption text-[var(--text-secondary)]">
                            Severity
                            <select
                              value={rule.severity}
                              disabled={!canEdit || saving === rule.rule_id}
                              onChange={(event) => void patch(rule.rule_id, { severity: event.target.value })}
                              className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 type-caption"
                            >
                              {['critical', 'high', 'medium', 'low'].map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="flex items-center gap-1.5 type-caption text-[var(--text-secondary)]">
                            Maturity window
                            <select
                              value={rule.maturity_seconds}
                              disabled={!canEdit || saving === rule.rule_id}
                              onChange={(event) =>
                                void patch(rule.rule_id, { maturity_seconds: Number(event.target.value) })
                              }
                              className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 type-caption"
                            >
                              {[0, 1_800, 3_600, 7_200, 43_200, 86_400, 259_200, 604_800].map((option) => (
                                <option key={option} value={option}>
                                  {option === 0 ? 'immediate' : humanDuration(option)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <span className="type-caption text-[var(--text-tertiary)]">
                            {formatCount(rule.raised_30d)} raised · {Math.round(rule.ignore_rate * 100)}% ignored in 30 days
                          </span>

                          {rule.maturity_seconds !== rule.default_maturity_seconds ||
                          rule.severity !== rule.default_severity ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canEdit}
                              onClick={() =>
                                void patch(rule.rule_id, {
                                  severity: rule.default_severity,
                                  maturity_seconds: rule.default_maturity_seconds,
                                })
                              }
                            >
                              Reset to default
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function humanDuration(seconds: number): string {
  if (seconds < 3_600) return `${seconds / 60} min`;
  if (seconds < 86_400) return `${seconds / 3_600} h`;
  return `${seconds / 86_400} d`;
}
