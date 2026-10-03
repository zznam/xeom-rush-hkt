import { expect, it } from 'vitest';
import {
  activeObjectives,
  progressionPeriods,
  DAILY_OBJECTIVES,
  WEEKLY_CONTRACTS,
  COSMETICS,
  MASTERY_BADGES,
} from './progression';
it('resets at Vietnam midnight and Monday and serves all authored templates', () => {
  expect(progressionPeriods(Date.parse('2026-10-04T16:59:59Z'))).toEqual({
    daily: 'd:2026-10-04',
    weekly: 'w:2026-09-28',
  });
  expect(progressionPeriods(Date.parse('2026-10-04T17:00:00Z'))).toEqual({
    daily: 'd:2026-10-05',
    weekly: 'w:2026-10-05',
  });
  expect(DAILY_OBJECTIVES).toHaveLength(12);
  expect(WEEKLY_CONTRACTS).toHaveLength(8);
  expect(COSMETICS).toHaveLength(28);
  expect(MASTERY_BADGES).toHaveLength(12);
  expect(
    new Set(
      Array.from({ length: 4 }, (_, i) =>
        activeObjectives(Date.parse('2026-10-01T18:00:00Z') + i * 86400000)
          .slice(0, 3)
          .map((o) => o.id),
      ).flat(),
    ).size,
  ).toBe(12);
});
