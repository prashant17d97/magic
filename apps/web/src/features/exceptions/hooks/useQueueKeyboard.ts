'use client';

import { useEffect } from 'react';

export interface QueueKeyboardHandlers {
  onNext(): void;
  onPrevious(): void;
  onOpen(): void;
  onClose(): void;
  onResolve(): void;
  onIgnore(): void;
  onAssign(): void;
  onToggleSelect(): void;
  enabled: boolean;
}

/**
 * The queue is worked from the keyboard.
 *
 * Keystrokes are ignored while a field has focus, so typing a resolution note never fires a
 * shortcut mid-sentence — and `e` inside a note stays a letter rather than becoming a resolve.
 */
export function useQueueKeyboard(handlers: QueueKeyboardHandlers): void {
  useEffect(() => {
    if (!handlers.enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        if (event.key === 'Escape') handlers.onClose();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'j':
          event.preventDefault();
          handlers.onNext();
          break;
        case 'k':
          event.preventDefault();
          handlers.onPrevious();
          break;
        case 'Enter':
        case 'o':
          event.preventDefault();
          handlers.onOpen();
          break;
        case 'Escape':
          handlers.onClose();
          break;
        case 'e':
          event.preventDefault();
          handlers.onResolve();
          break;
        case 'i':
          event.preventDefault();
          handlers.onIgnore();
          break;
        case 'a':
          event.preventDefault();
          handlers.onAssign();
          break;
        case 'x':
          event.preventDefault();
          handlers.onToggleSelect();
          break;
        default:
          break;
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
