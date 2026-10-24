import type { Exercise, Side } from '../../types';

const EXERCISE_ORDER: Exercise[] = ['arm_raise', 'forward_reach', 'hand_open'];
const SIDE_ORDER: Side[] = ['weak', 'healthy'];

/**
 * Session.replays holds keys "<sessionId>-<exercise>-<side>". Session ids contain hyphens, so the
 * session prefix is stripped first. Unknown keys are dropped; the result is sorted by exercise, weak first.
 */
export function parseReplayKeys(sessionId: string, keys: string[]): { exercise: Exercise; side: Side }[] {
  const prefix = `${sessionId}-`;
  const out: { exercise: Exercise; side: Side }[] = [];
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const [exercise, side, ...rest] = key.slice(prefix.length).split('-');
    if (rest.length > 0) continue;
    if (!EXERCISE_ORDER.includes(exercise as Exercise) || !SIDE_ORDER.includes(side as Side)) continue;
    if (out.some((r) => r.exercise === exercise && r.side === side)) continue;
    out.push({ exercise: exercise as Exercise, side: side as Side });
  }
  return out.sort(
    (a, b) => EXERCISE_ORDER.indexOf(a.exercise) - EXERCISE_ORDER.indexOf(b.exercise) || SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side),
  );
}
