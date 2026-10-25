import { computeDailyDueKey, computeWeeklyDueKey } from './ai-scheduler.service';

const at = (y: number, m: number, d: number, h: number, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

describe('computeDailyDueKey', () => {
  it('is due once the configured time has passed', () => {
    expect(
      computeDailyDueKey('2026-10-25', '08:30', at(2026, 10, 25, 8, 29), undefined),
    ).toBeNull();
    expect(
      computeDailyDueKey('2026-10-25', '08:30', at(2026, 10, 25, 8, 30), undefined),
    ).toBe('2026-10-25');
  });

  it('catches up later the same day but never runs twice', () => {
    expect(
      computeDailyDueKey('2026-10-25', '08:30', at(2026, 10, 25, 17), '2026-10-24'),
    ).toBe('2026-10-25');
    expect(
      computeDailyDueKey('2026-10-25', '08:30', at(2026, 10, 25, 17), '2026-10-25'),
    ).toBeNull();
  });

  it('uses the logical day, e.g. after midnight before the day switch', () => {
    // Logical day is still the 25th at 01:00 on the 26th
    expect(
      computeDailyDueKey('2026-10-25', '08:30', at(2026, 10, 26, 1), '2026-10-25'),
    ).toBeNull();
  });
});

describe('computeWeeklyDueKey', () => {
  // 2026-10-25 is a Sunday
  it('is due on the configured weekday after the time', () => {
    expect(
      computeWeeklyDueKey('2026-10-25', 0, '20:00', at(2026, 10, 25, 20), undefined),
    ).toBe('2026-10-25');
  });

  it('before the time it points at the previous week, which can be caught up', () => {
    expect(
      computeWeeklyDueKey('2026-10-25', 0, '20:00', at(2026, 10, 25, 19), '2026-10-18'),
    ).toBeNull();
    expect(
      computeWeeklyDueKey('2026-10-25', 0, '20:00', at(2026, 10, 25, 19), '2026-10-11'),
    ).toBe('2026-10-18');
  });

  it('catches up a missed slot later in the week', () => {
    // Wednesday 2026-10-28, last run was for the 18th
    expect(
      computeWeeklyDueKey('2026-10-28', 0, '20:00', at(2026, 10, 28, 9), '2026-10-18'),
    ).toBe('2026-10-25');
    expect(
      computeWeeklyDueKey('2026-10-28', 0, '20:00', at(2026, 10, 28, 9), '2026-10-25'),
    ).toBeNull();
  });

  it('supports other weekdays', () => {
    // Monday slot, now Tuesday 2026-10-27
    expect(
      computeWeeklyDueKey('2026-10-27', 1, '08:00', at(2026, 10, 27, 7), undefined),
    ).toBe('2026-10-26');
  });
});
