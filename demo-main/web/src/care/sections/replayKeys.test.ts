import { describe, expect, it } from 'vitest';
import { parseReplayKeys } from './replayKeys';

describe('parseReplayKeys', () => {
  it('parses keys whose session id contains hyphens, sorted by exercise then weak first', () => {
    const sid = 'sess-james-20';
    expect(
      parseReplayKeys(sid, [`${sid}-hand_open-weak`, `${sid}-arm_raise-healthy`, `${sid}-arm_raise-weak`]),
    ).toEqual([
      { exercise: 'arm_raise', side: 'weak' },
      { exercise: 'arm_raise', side: 'healthy' },
      { exercise: 'hand_open', side: 'weak' },
    ]);
  });

  it('drops keys for other sessions, unknown exercises or sides, and duplicates', () => {
    const sid = 'sess-1';
    expect(
      parseReplayKeys(sid, ['sess-2-arm_raise-weak', `${sid}-jump-weak`, `${sid}-arm_raise-left`, `${sid}-arm_raise-weak`, `${sid}-arm_raise-weak`]),
    ).toEqual([{ exercise: 'arm_raise', side: 'weak' }]);
  });
});
