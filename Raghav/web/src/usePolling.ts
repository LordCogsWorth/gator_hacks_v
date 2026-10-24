import { useEffect, useRef } from 'react';

/**
 * Call `poll` every `intervalMs` while the browser tab is visible.
 * - Pauses while the tab is hidden; polls right away when it becomes visible.
 * - Skips a tick if the previous poll is still running (slow API).
 * - Always calls the latest `poll`, so it can close over fresh state.
 */
export function usePolling(poll: () => Promise<unknown> | void, intervalMs = 5000) {
  const latest = useRef(poll);
  latest.current = poll;

  useEffect(() => {
    let timer: number | undefined;
    let inFlight = false;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await latest.current();
      } finally {
        inFlight = false;
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

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs]);
}
