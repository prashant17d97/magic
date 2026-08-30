'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HealthSummary } from '@magic/contracts';

/**
 * Opened against resolved over thirty days.
 *
 * The palette is deliberately muted: blue is the only saturated accent in this product, and a
 * chart that shouts competes with the severity system, which is the one place colour is allowed
 * to carry meaning.
 *
 * The series do not animate in. A console is navigated back and forth all day, and redrawing the
 * history on every visit reads as the chart still loading rather than as polish.
 */
export function TrendChart({ trend }: { trend: HealthSummary['trend'] }) {
  return (
    <section className="surface flex flex-col">
      <header className="border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="type-h3 text-[var(--text-primary)]">Exceptions over time</h2>
        <p className="mt-0.5 type-caption text-[var(--text-secondary)]">
          Opened against resolved, last 30 days
        </p>
      </header>

      <div className="h-[220px] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="openedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--danger-fg)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--danger-fg)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success-fg)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--success-fg)" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              tickFormatter={(value: string) => value.slice(5)}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
                boxShadow: 'var(--shadow-md)',
              }}
              labelStyle={{ color: 'var(--text-secondary)' }}
            />
            <Area
              type="monotone"
              dataKey="opened"
              name="Opened"
              stroke="var(--danger-fg)"
              strokeWidth={1.5}
              fill="url(#openedFill)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="resolved"
              name="Resolved"
              stroke="var(--success-fg)"
              strokeWidth={1.5}
              fill="url(#resolvedFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
