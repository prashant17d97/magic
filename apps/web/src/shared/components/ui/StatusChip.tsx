import { faCheck, faCircleHalfStroke, faEyeSlash, faInbox } from '@fortawesome/free-solid-svg-icons';
import type { ExceptionStatus } from '@magic/contracts';
import { Badge, type BadgeTone } from './Badge';

const STATUS: Record<ExceptionStatus, { label: string; tone: BadgeTone; icon: typeof faCheck }> = {
  open: { label: 'Open', tone: 'info', icon: faInbox },
  investigating: { label: 'Investigating', tone: 'warning', icon: faCircleHalfStroke },
  resolved: { label: 'Resolved', tone: 'success', icon: faCheck },
  ignored: { label: 'Ignored', tone: 'muted', icon: faEyeSlash },
};

export function StatusChip({ status }: { status: ExceptionStatus }) {
  const config = STATUS[status];
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {config.label}
    </Badge>
  );
}
