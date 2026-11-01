import {
  AwRawEvent,
  buildDayActivity,
  intersectIntervals,
  mergeIntervals,
  observeRange,
  pickBuckets,
  subtractIntervals,
  toDisplaySpans,
  toWindowSpans,
} from './aw-activity.util';

const MIN = 60_000;
const DAY_START = new Date(2026, 10, 1, 0, 0).getTime();
const DAY_END = new Date(2026, 10, 2, 0, 0).getTime();
const at = (h: number, m = 0): number => new Date(2026, 10, 1, h, m).getTime();
const HALF_HOUR = 30 * MIN;

const win = (from: number, minutes: number, app: string, title = ''): AwRawEvent => ({
  timestamp: new Date(from).toISOString(),
  duration: minutes * 60,
  data: { app, title },
});
const afk = (from: number, minutes: number, isAfk: boolean): AwRawEvent => ({
  timestamp: new Date(from).toISOString(),
  duration: minutes * 60,
  data: { status: isAfk ? 'afk' : 'not-afk' },
});

describe('interval helpers', () => {
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { start: 5, end: 8 },
        { start: 0, end: 3 },
        { start: 3, end: 4 },
        { start: 7, end: 10 },
      ]),
    ).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 10 },
    ]);
  });

  it('intersects and subtracts unions', () => {
    const a = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    const b = [{ start: 5, end: 25 }];
    expect(intersectIntervals(a, b)).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
    expect(subtractIntervals(a, b)).toEqual([
      { start: 0, end: 5 },
      { start: 25, end: 30 },
    ]);
  });
});

describe('toWindowSpans', () => {
  it('clips to the day and never counts a moment twice', () => {
    const spans = toWindowSpans(
      [
        // Starts the evening before: only the part inside the day counts
        win(at(0) - HALF_HOUR, 40, 'Code'),
        // Overlaps the first one (heartbeat artefact)
        win(at(0, 5), 10, 'Chrome'),
      ],
      DAY_START,
      DAY_END,
      null,
    );
    expect(spans.map((s) => [s.app, (s.end - s.start) / MIN])).toEqual([
      ['Code', 10],
      ['Chrome', 5],
    ]);
  });

  it('cuts window time down to non-idle time when AFK data exists', () => {
    const spans = toWindowSpans([win(at(9), 60, 'Code')], DAY_START, DAY_END, [
      { start: at(9), end: at(9, 20) },
    ]);
    expect(spans.length).toBe(1);
    expect((spans[0].end - spans[0].start) / MIN).toBe(20);
  });
});

describe('buildDayActivity', () => {
  const day = buildDayActivity(
    [
      win(at(9), 30, 'Code', 'report.ts'),
      win(at(9, 30), 30, 'Chrome', 'Docs'),
      win(at(14), 60, 'Video'),
    ],
    [afk(at(9), 50, false), afk(at(9, 50), 10, true), afk(at(14), 60, true)],
    DAY_START,
    DAY_END,
    at(23),
  );

  it('splits window, idle and unrecorded time without double counting', () => {
    expect(day.hasAfk).toBeTrue();
    // 09:00–09:50 not idle; 14:00 window time is all idle
    expect(day.activeMinutes).toBe(50);
    const nine = day.hours.find((h) => h.start === at(9))!;
    expect(nine.activeMinutes).toBe(50);
    expect(nine.idleMinutes).toBe(10);
    expect(nine.unrecordedMinutes).toBe(0);
    expect(nine.part).toBe('morning');
    const two = day.hours.find((h) => h.start === at(14))!;
    expect(two.activeMinutes).toBe(0);
    expect(two.idleMinutes).toBe(60);
    expect(two.part).toBe('afternoon');
  });

  it('only lists hours that have records', () => {
    expect(day.hours.map((h) => new Date(h.start).getHours())).toEqual([9, 14]);
  });

  it('observes an arbitrary range with apps and titles', () => {
    const obs = observeRange(day, at(9), at(10), at(23));
    expect(obs.apps).toEqual([
      { app: 'Code', minutes: 30 },
      { app: 'Chrome', minutes: 20 },
    ]);
    expect(obs.titles[0]).toEqual({ app: 'Code', title: 'report.ts', minutes: 30 });
  });

  it('counts a gap without any record as unrecorded, capped at now', () => {
    const obs = observeRange(day, at(11), at(13), at(12));
    expect(obs.unrecordedMinutes).toBe(60);
    expect(obs.activeMinutes).toBe(0);
  });

  it('keeps the window time as it is without AFK data', () => {
    const noAfk = buildDayActivity(
      [win(at(9), 60, 'Code')],
      null,
      DAY_START,
      DAY_END,
      at(23),
    );
    expect(noAfk.hasAfk).toBeFalse();
    expect(noAfk.activeMinutes).toBe(60);
  });
});

describe('toDisplaySpans', () => {
  it('merges close spans of the same app and keeps their titles', () => {
    const rows = toDisplaySpans([
      { start: at(9), end: at(9, 10), app: 'Code', title: 'a.ts' },
      { start: at(9, 11), end: at(9, 20), app: 'Code', title: 'b.ts' },
      { start: at(9, 20), end: at(9, 30), app: 'Chrome', title: '' },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0].activeMinutes).toBe(19);
    expect(rows[0].titles).toEqual(['a.ts', 'b.ts']);
  });
});

describe('pickBuckets', () => {
  it("prefers this server's hostname, else the most recent bucket", () => {
    // aw-server returns a map keyed by bucket id; the values are what matters
    const buckets = [
      {
        id: 'aw-watcher-window_old',
        type: 'currentwindow',
        hostname: 'old',
        last_updated: '2026-10-01T00:00:00Z',
      },
      {
        id: 'aw-watcher-window_me',
        type: 'currentwindow',
        hostname: 'me',
        last_updated: '2026-09-01T00:00:00Z',
      },
      { id: 'aw-watcher-afk_old', type: 'afkstatus', hostname: 'old' },
    ];
    expect(pickBuckets(buckets, 'me')).toEqual({
      window: 'aw-watcher-window_me',
      afk: 'aw-watcher-afk_old',
    });
    expect(pickBuckets(buckets, undefined).window).toBe('aw-watcher-window_old');
    expect(pickBuckets(null, 'me')).toEqual({ window: undefined, afk: undefined });
  });
});
