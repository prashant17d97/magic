import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCircleExclamation,
  faCircle,
  faCircleDot,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import type { Severity } from '@magic/contracts';
import { cn } from '@/shared/lib/cn';

const SEVERITY = {
  critical: {
    icon: faCircleExclamation,
    label: 'Critical',
    tone: 'text-[var(--danger-fg)]',
    meaning: 'Money is provably missing or misdirected',
  },
  high: {
    icon: faTriangleExclamation,
    label: 'High',
    tone: 'text-[var(--warning-fg)]',
    meaning: 'Likely discrepancy needing action this week',
  },
  medium: {
    icon: faCircleDot,
    label: 'Medium',
    tone: 'text-[var(--info-fg)]',
    meaning: 'Anomaly worth reviewing',
  },
  low: {
    icon: faCircle,
    label: 'Low',
    tone: 'text-[var(--muted-fg)]',
    meaning: 'Informational; safe to batch',
  },
} as const;

/**
 * Severity is the sort key an operator thinks in, so it leads the row. It always travels as
 * icon plus label plus colour — never colour alone.
 */
export function SeverityIndicator({
  severity,
  showLabel = true,
  className,
}: {
  severity: Severity;
  showLabel?: boolean;
  className?: string;
}) {
  const config = SEVERITY[severity];

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', config.tone, className)}
      title={config.meaning}
    >
      <FontAwesomeIcon icon={config.icon} className={severity === 'low' ? 'text-[7px]' : 'text-[11px]'} aria-hidden />
      {showLabel ? <span className="type-table font-medium">{config.label}</span> : null}
      <span className="sr-only">{`${config.label} severity: ${config.meaning}`}</span>
    </span>
  );
}

export function severityMeaning(severity: Severity): string {
  return SEVERITY[severity].meaning;
}
