'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faBarsStaggered, faGripLines } from '@fortawesome/free-solid-svg-icons';
import { cn } from '@/shared/lib/cn';
import { useConsoleStore, type Density } from '@/shared/hooks/useConsoleStore';

const MODES: { value: Density; label: string; icon: typeof faBars }[] = [
  { value: 'compact', label: 'Compact', icon: faBarsStaggered },
  { value: 'default', label: 'Default', icon: faBars },
  { value: 'comfortable', label: 'Comfortable', icon: faGripLines },
];

/** Different operators genuinely differ on row height, and forcing one is a needless fight. */
export function DensityToggle() {
  const density = useConsoleStore((state) => state.density);
  const setDensity = useConsoleStore((state) => state.setDensity);

  return (
    <div
      role="radiogroup"
      aria-label="Row density"
      className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5"
    >
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          role="radio"
          aria-checked={density === mode.value}
          title={mode.label}
          onClick={() => setDensity(mode.value)}
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-[var(--radius-xs)]',
            'transition-colors duration-[var(--duration-instant)]',
            density === mode.value
              ? 'bg-[var(--bg-selected)] text-[var(--text-brand)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
          )}
        >
          <FontAwesomeIcon icon={mode.icon} className="text-[11px]" aria-hidden />
          <span className="sr-only">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
