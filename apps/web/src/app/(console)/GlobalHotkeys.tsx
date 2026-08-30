'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const GO_TO: Record<string, string> = {
  h: '/',
  e: '/exceptions',
  r: '/runs',
  s: '/settlements',
  a: '/accounts',
};

/**
 * The `g` prefix chords, matching the muscle memory of every other tool an operator lives in.
 * Keystrokes typed into a field are ignored so a note containing "ge" does not navigate away
 * mid-sentence.
 */
export function GlobalHotkeys() {
  const router = useRouter();
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (pending.current === 'g') {
        const destination = GO_TO[event.key.toLowerCase()];
        pending.current = null;
        if (timer.current) window.clearTimeout(timer.current);
        if (destination) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        pending.current = 'g';
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          pending.current = null;
        }, 1_200);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [router]);

  return null;
}
