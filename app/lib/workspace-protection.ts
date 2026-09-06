'use client';
import { useEffect } from 'react';

/** Let the shell ask mounted workflows whether navigation would lose work or interrupt a write. */
export function useWorkspaceProtection(unsaved: boolean, busy = false) {
  useEffect(() => {
    const protect = (event: Event) => {
      if (!unsaved && !busy) return;
      event.preventDefault();
      if (busy) (event as CustomEvent<{ busy: boolean }>).detail.busy = true;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved || busy) event.preventDefault();
    };
    window.addEventListener('kline-before-navigation', protect);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('kline-before-navigation', protect);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [unsaved, busy]);
}
