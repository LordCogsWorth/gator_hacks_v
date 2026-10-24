import type { AlertType } from '../types';
import type { BadgeTone } from '../ui';

/** Safety-related alerts are danger; progress and adherence alerts are warning. */
export const ALERT_TONE: Record<AlertType, Extract<BadgeTone, 'warning' | 'danger'>> = {
  plateau: 'warning',
  setback: 'danger',
  compensation: 'warning',
  adherence: 'warning',
  pain: 'danger',
  'safety-stop': 'danger',
  'heart-rate': 'danger',
  'blood-pressure': 'danger',
  fall: 'danger',
};
