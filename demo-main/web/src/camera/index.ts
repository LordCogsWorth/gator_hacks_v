// The app's one camera tracker: a wrapper that runs the real MediaPipe tracker or the fake one.
// Mode: ?tracker=real|fake (remembered for the tab); otherwise fake in demo mode (?demo=1, see patient/demo.tsx), else real.
// If the real tracker can't start (no camera, models fail or take over 10 s) it falls back to the fake one on the same video.
// setDemoOptions only drives the fake tracker (demo sliders); callers use tracker.setDemoOptions?.(…).
import { createFakeTracker, type FakeTrackerControls } from './fakeTracker';
import { createMediapipeTracker, TrackerStartError } from './mediapipeTracker';
import type { CameraTracker, TrackerFallbackReason, TrackerStatus, TrackingFrame } from './types';

type Mode = 'real' | 'fake';
const MODE_KEY = 'rehabtrack.tracker';
// Same flag patient/demo.tsx stores for ?demo=1 (it can't be imported from here: demo.tsx imports this module).
const DEMO_KEY = 'rehabtrack.demo';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Which tracker to try, and (for the fake one) why. */
function trackerMode(): { mode: Mode; reason?: TrackerFallbackReason } {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('tracker');
  if (url === 'real' || url === 'fake') {
    try {
      sessionStorage.setItem(MODE_KEY, url);
    } catch {
      // Not remembered; applies while the parameter is in the URL.
    }
    return url === 'fake' ? { mode: 'fake', reason: 'forced' } : { mode: 'real' };
  }
  const stored = readSession(MODE_KEY);
  if (stored === 'real') return { mode: 'real' };
  if (stored === 'fake') return { mode: 'fake', reason: 'forced' };
  return (params.get('demo') ?? readSession(DEMO_KEY)) === '1' ? { mode: 'fake', reason: 'demo' } : { mode: 'real' };
}

function createTracker(): CameraTracker & FakeTrackerControls {
  const fake = createFakeTracker();
  let real: CameraTracker | null = null;
  let active: CameraTracker | null = null;
  let config: Parameters<CameraTracker['configure']>[0] | null = null;
  let run = 0;
  // Before start() this is what start() will try; afterwards what is actually running.
  let current: TrackerStatus = trackerMode();
  const listeners = new Set<(f: TrackingFrame) => void>();
  // Subscribed once to each tracker, so app subscriptions survive a switch between them.
  const relay = (from: CameraTracker) => (f: TrackingFrame) => {
    if (active === from) listeners.forEach((l) => l(f));
  };
  fake.onFrame(relay(fake));

  function getReal(): CameraTracker {
    if (!real) {
      real = createMediapipeTracker();
      real.onFrame(relay(real));
      if (config) real.configure(config);
    }
    return real;
  }

  return {
    async start(video) {
      const id = ++run;
      active?.stop();
      active = null;
      const want = trackerMode();
      current = want;
      if (want.mode === 'real') {
        active = getReal();
        try {
          await active.start(video);
          return;
        } catch (e) {
          if (id !== run) return; // stopped (or restarted) meanwhile
          const why = e instanceof TrackerStartError ? `${e.reason}: ${e.message}` : String(e);
          console.warn(`[camera] Real camera tracker unavailable (${why}); using the fake tracker.`);
          current = { mode: 'fake', reason: e instanceof TrackerStartError ? e.reason : 'model-load' };
        }
      }
      active = fake;
      await fake.start(video);
    },
    stop() {
      run++;
      active?.stop();
      active = null;
    },
    configure(o) {
      config = o;
      fake.configure(o);
      real?.configure(o);
    },
    onFrame(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    status: () => current,
    preloadHand() {
      if (trackerMode().mode === 'real') getReal().preloadHand();
    },
    setDemoOptions(o) {
      fake.setDemoOptions(o);
    },
  };
}

trackerMode(); // remember ?tracker= now: in-app navigation drops the query string before the camera starts

export const tracker: CameraTracker & Partial<FakeTrackerControls> = createTracker();
