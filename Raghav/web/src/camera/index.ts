// Which camera tracker the app uses. When Stuti's module is ready, swap this one line.
// setDemoOptions is fake-only (demo sliders); callers use tracker.setDemoOptions?.(…) so a real tracker can omit it.
import { createFakeTracker, type FakeTrackerControls } from './fakeTracker';
import type { CameraTracker } from './types';

export const tracker: CameraTracker & Partial<FakeTrackerControls> = createFakeTracker();
