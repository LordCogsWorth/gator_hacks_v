// Which camera tracker the app uses. When Stuti's module is ready, swap this one line.
import { getPatient } from '../api';
import { createFakeTracker } from './fakeTracker';
import type { CameraTracker } from './types';

export const tracker: CameraTracker = createFakeTracker(getPatient().weak_side);
