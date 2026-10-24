import { useEffect, useRef } from 'react';
import { onDataChange } from './api';

/** Data-change bursts (a save runs several writes) collapse into one poll. */
const CHANGE_DEBOUNCE_MS = 150;

/**
 * Call `poll` every `intervalMs` while the browser tab is visible, and soon after any data change.
 * - Pauses while the tab is hidden; polls right away when it becomes visible.
 * - Never overlaps polls: a tick during a running poll is skipped, a data change during one re-polls after it.
 * - Always calls the latest `poll`, so it can close over fresh state.
 */
export function usePolling(poll: () => Promise<unknown> | void, intervalMs = 5000) {
  const latest = useRef(poll);
  latest.current = poll;

  useEffect(() => {
    let timer: number | undefined;
    let debounce: number | undefined;
    let inFlight = false;
    let rerun = false;
    let active = true;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await latest.current();
      } finally {
        inFlight = false;
      }
      if (rerun && active && !document.hidden) {
        rerun = false;
        void tick();
      }
    };
    const start = () => {
      if (timer === undefined) timer = window.setInterval(tick, intervalMs);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        void tick();
        start();
      }
    };
    const onChange = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        if (document.hidden) return;
        if (inFlight) rerun = true;
        else void tick();
      }, CHANGE_DEBOUNCE_MS);
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    const unsubscribe = onDataChange(onChange);
    return () => {
      active = false;
      stop();
      window.clearTimeout(debounce);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
