import { aggregateWeek, getWeekDays } from './ai-report-data.service';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

const task = (over: Partial<Task>): Task =>
  ({ ...DEFAULT_TASK, id: 'x', title: 'X', ...over }) as Task;
const H = 60 * 60_000;
const D10_01 = '2026-10-01';
const D10_20 = '2026-10-20';
const D10_22 = '2026-10-22';
const D10_25 = '2026-10-25';

describe('getWeekDays', () => {
  it('returns the 7 days ending on the given day, across a month boundary', () => {
    expect(getWeekDays('2026-11-02')).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});

describe('aggregateWeek', () => {
  const days = getWeekDays('2026-10-25');

  it('sums tracked time per day and per parent task within the range', () => {
    const res = aggregateWeek(
      [
        task({
          id: 'a',
          title: 'Write',
          projectId: 'p1',
          timeSpentOnDay: { [D10_20]: H, [D10_25]: 2 * H, [D10_01]: H },
        }),
        task({ id: 'a-sub', parentId: 'a', timeSpentOnDay: { [D10_25]: H } }),
        task({ id: 'b', title: 'Read', timeSpentOnDay: { [D10_22]: H / 2 } }),
        // Duplicate (e.g. active + archive) is counted once
        task({ id: 'b', title: 'Read', timeSpentOnDay: { [D10_22]: H / 2 } }),
      ],
      days,
      { p1: 'Book' },
    );
    expect(res.fromDay).toBe('2026-10-19');
    expect(res.toDay).toBe('2026-10-25');
    expect(res.minutesPerDay['2026-10-25']).toBe(120);
    expect(res.minutesPerDay['2026-10-22']).toBe(30);
    expect(res.totalMinutes).toBe(210);
    expect(res.topTasks).toEqual([
      { id: 'a', title: 'Write', project: 'Book', minutes: 180, isDone: false },
      { id: 'b', title: 'Read', minutes: 30, isDone: false },
    ]);
  });

  it('lists tasks completed within the range', () => {
    const res = aggregateWeek(
      [
        task({
          id: 'd',
          title: 'Done',
          isDone: true,
          doneOn: new Date(2026, 9, 21, 15).getTime(),
        }),
        task({ id: 'e', isDone: true, doneOn: new Date(2026, 9, 1).getTime() }),
      ],
      days,
      {},
    );
    expect(res.doneTasks).toEqual([{ id: 'd', title: 'Done', doneOn: '2026-10-21' }]);
  });
});
