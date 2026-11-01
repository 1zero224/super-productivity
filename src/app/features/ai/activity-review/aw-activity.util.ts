// Pure interval math over ActivityWatch events. Window, AFK and "no record"
// time are computed with interval unions / intersections so nothing is ever
// counted twice. The results are observations only: they say which apps were
// in front, never whether that time was productive.

const MIN_MS = 60_000;
// Adjacent spans of the same app closer than this are shown as one row
const DISPLAY_MERGE_GAP_MS = 2 * MIN_MS;
const MAX_APPS = 6;
const MAX_TITLES = 8;
const MAX_TITLE_CHARS = 120;

/** An event as returned by aw-server (`duration` in seconds). */
export interface AwRawEvent {
  id?: number;
  timestamp: string;
  duration: number;
  data: Record<string, unknown>;
}

export interface AwBucketInfo {
  id: string;
  type?: string;
  hostname?: string;
  last_updated?: string;
}

export interface Interval {
  start: number;
  end: number;
}

/** A front window, clipped to the day and (if AFK data exists) to non-idle time. */
export interface WindowSpan extends Interval {
  app: string;
  title: string;
}

export interface AppUsage {
  app: string;
  minutes: number;
}

export interface TitleUsage {
  app: string;
  title: string;
  minutes: number;
}

/** What the records show for one time range. Minutes are rounded. */
export interface ActivityObservation extends Interval {
  activeMinutes: number;
  idleMinutes: number;
  // Neither a window nor an AFK record: watcher not running, PC off, unknown
  unrecordedMinutes: number;
  apps: AppUsage[];
  titles: TitleUsage[];
}

/** One row of the expanded timeline: same-app spans merged for display. */
export interface DisplaySpan extends Interval {
  app: string;
  activeMinutes: number;
  titles: string[];
}

export interface HourSlot extends ActivityObservation {
  part: 'morning' | 'afternoon' | 'evening' | 'night';
  spans: DisplaySpan[];
}

export interface DayActivity {
  dayStart: number;
  dayEnd: number;
  // false = no AFK bucket: window time could not be reduced to non-idle time
  hasAfk: boolean;
  spans: WindowSpan[];
  idle: Interval[];
  recorded: Interval[];
  activeMinutes: number;
  firstSeen: number | null;
  lastSeen: number | null;
  hours: HourSlot[];
}

export const eventToInterval = (e: AwRawEvent): Interval | null => {
  const start = Date.parse(e.timestamp);
  const dur = Number(e.duration);
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) {
    return null;
  }
  const durMs = dur * 1000;
  return { start, end: start + durMs };
};

export const clipInterval = <T extends Interval>(
  iv: T,
  from: number,
  to: number,
): T | null => {
  const start = Math.max(iv.start, from);
  const end = Math.min(iv.end, to);
  return end > start ? { ...iv, start, end } : null;
};

/** Sorted union of possibly overlapping intervals. */
export const mergeIntervals = (ivs: Interval[]): Interval[] => {
  const sorted = [...ivs]
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
};

/** Intersection of two unions (both sorted, non-overlapping). */
export const intersectIntervals = (a: Interval[], b: Interval[]): Interval[] => {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end > start) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
};

/** `a` minus `b` (both sorted unions). */
export const subtractIntervals = (a: Interval[], b: Interval[]): Interval[] => {
  const out: Interval[] = [];
  for (const iv of a) {
    let cursor = iv.start;
    for (const cut of b) {
      if (cut.end <= cursor) continue;
      if (cut.start >= iv.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: cut.start });
      cursor = Math.max(cursor, cut.end);
    }
    if (cursor < iv.end) out.push({ start: cursor, end: iv.end });
  }
  return out;
};

export const totalMs = (ivs: Interval[]): number =>
  ivs.reduce((sum, iv) => sum + (iv.end - iv.start), 0);

const toMinutes = (ms: number): number => Math.round(ms / MIN_MS);

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TITLE_CHARS) : fallback;

/**
 * Window events → front-window spans within [from, to). Overlaps (heartbeat
 * artefacts) are trimmed so a moment belongs to one window only; with AFK data
 * the spans are cut down to non-idle time.
 */
export const toWindowSpans = (
  events: AwRawEvent[],
  from: number,
  to: number,
  notAfk: Interval[] | null,
): WindowSpan[] => {
  const raw: WindowSpan[] = [];
  for (const e of events) {
    const iv = eventToInterval(e);
    const clipped = iv && clipInterval(iv, from, to);
    if (!clipped) continue;
    raw.push({
      ...clipped,
      app: str(e.data?.app, 'unknown'),
      title: str(e.data?.title, ''),
    });
  }
  raw.sort((a, b) => a.start - b.start);
  const deduped: WindowSpan[] = [];
  let lastEnd = -Infinity;
  for (const s of raw) {
    const start = Math.max(s.start, lastEnd);
    if (s.end <= start) continue;
    deduped.push({ ...s, start });
    lastEnd = s.end;
  }
  if (!notAfk) {
    return deduped;
  }
  return deduped.flatMap((s) =>
    intersectIntervals([s], notAfk).map((iv) => ({ ...s, ...iv })),
  );
};

/** Unions of AFK and non-AFK time within [from, to). */
export const toAfkIntervals = (
  events: AwRawEvent[],
  from: number,
  to: number,
): { idle: Interval[]; notIdle: Interval[] } => {
  const idle: Interval[] = [];
  const notIdle: Interval[] = [];
  for (const e of events) {
    const iv = eventToInterval(e);
    const clipped = iv && clipInterval(iv, from, to);
    if (!clipped) continue;
    if (e.data?.status === 'afk') idle.push(clipped);
    else if (e.data?.status === 'not-afk') notIdle.push(clipped);
  }
  const idleUnion = mergeIntervals(idle);
  // A moment reported as both counts as idle: never inflate active time
  return {
    idle: idleUnion,
    notIdle: subtractIntervals(mergeIntervals(notIdle), idleUnion),
  };
};

const topBy = <T>(
  map: Map<string, T & { ms: number }>,
  max: number,
): (T & { ms: number })[] => [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, max);

/** What the records show for [from, to); `now` caps the "no record" time. */
export const observeRange = (
  day: Pick<DayActivity, 'spans' | 'idle' | 'recorded'>,
  from: number,
  to: number,
  now: number,
): ActivityObservation => {
  const range = [{ start: from, end: Math.max(from, Math.min(to, now)) }];
  const apps = new Map<string, { app: string; ms: number }>();
  const titles = new Map<string, { app: string; title: string; ms: number }>();
  let activeMs = 0;
  for (const s of day.spans) {
    const c = clipInterval(s, from, to);
    if (!c) continue;
    const ms = c.end - c.start;
    activeMs += ms;
    const a = apps.get(s.app) ?? { app: s.app, ms: 0 };
    a.ms += ms;
    apps.set(s.app, a);
    if (s.title) {
      const key = `${s.app}\n${s.title}`;
      const t = titles.get(key) ?? { app: s.app, title: s.title, ms: 0 };
      t.ms += ms;
      titles.set(key, t);
    }
  }
  return {
    start: from,
    end: to,
    activeMinutes: toMinutes(activeMs),
    idleMinutes: toMinutes(totalMs(intersectIntervals(day.idle, range))),
    unrecordedMinutes: toMinutes(totalMs(subtractIntervals(range, day.recorded))),
    apps: topBy(apps, MAX_APPS)
      .map(({ app, ms }) => ({ app, minutes: toMinutes(ms) }))
      .filter((a) => a.minutes > 0),
    titles: topBy(titles, MAX_TITLES)
      .map(({ app, title, ms }) => ({ app, title, minutes: toMinutes(ms) }))
      .filter((t) => t.minutes > 0),
  };
};

/** Same-app spans close to each other become one display row. */
export const toDisplaySpans = (spans: WindowSpan[]): DisplaySpan[] => {
  const out: (DisplaySpan & { ms: number; titleMs: Map<string, number> })[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    const ms = s.end - s.start;
    if (last && last.app === s.app && s.start - last.end <= DISPLAY_MERGE_GAP_MS) {
      last.end = s.end;
      last.ms += ms;
      if (s.title) last.titleMs.set(s.title, (last.titleMs.get(s.title) ?? 0) + ms);
    } else {
      out.push({
        start: s.start,
        end: s.end,
        app: s.app,
        activeMinutes: 0,
        titles: [],
        ms,
        titleMs: new Map(s.title ? [[s.title, ms]] : []),
      });
    }
  }
  return out.map(({ ms, titleMs, ...span }) => ({
    ...span,
    activeMinutes: toMinutes(ms),
    titles: [...titleMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t),
  }));
};

const partOfDay = (hour: number): HourSlot['part'] =>
  hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

/**
 * Builds the neutral day view. `windowEvents` / `afkEvents` are raw bucket
 * events (afk = null when there is no AFK bucket); the day is [dayStart, dayEnd).
 */
export const buildDayActivity = (
  windowEvents: AwRawEvent[],
  afkEvents: AwRawEvent[] | null,
  dayStart: number,
  dayEnd: number,
  now: number,
): DayActivity => {
  const afk = afkEvents ? toAfkIntervals(afkEvents, dayStart, dayEnd) : null;
  const spans = toWindowSpans(windowEvents, dayStart, dayEnd, afk ? afk.notIdle : null);
  const idle = afk ? afk.idle : [];
  const windowRecorded = windowEvents
    .map(eventToInterval)
    .filter((iv): iv is Interval => !!iv)
    .map((iv) => clipInterval(iv, dayStart, dayEnd))
    .filter((iv): iv is Interval => !!iv);
  const recorded = mergeIntervals([
    ...windowRecorded,
    ...(afk ? [...afk.idle, ...afk.notIdle] : []),
  ]);
  const day = { spans, idle, recorded };

  const hours: HourSlot[] = [];
  const cursor = new Date(dayStart);
  cursor.setMinutes(0, 0, 0);
  while (cursor.getTime() < dayEnd && cursor.getTime() < now) {
    const hourStart = Math.max(cursor.getTime(), dayStart);
    const hourDate = new Date(cursor);
    cursor.setHours(cursor.getHours() + 1);
    const hourEnd = Math.min(cursor.getTime(), dayEnd);
    const obs = observeRange(day, hourStart, hourEnd, now);
    if (!obs.activeMinutes && !obs.idleMinutes) continue;
    hours.push({
      ...obs,
      part: partOfDay(hourDate.getHours()),
      spans: toDisplaySpans(
        spans
          .map((s) => clipInterval(s, hourStart, hourEnd))
          .filter((s): s is WindowSpan => !!s),
      ),
    });
  }
  return {
    dayStart,
    dayEnd,
    hasAfk: !!afk,
    spans,
    idle,
    recorded,
    activeMinutes: toMinutes(totalMs(mergeIntervals(spans))),
    firstSeen: spans.length ? spans[0].start : null,
    lastSeen: spans.length ? spans[spans.length - 1].end : null,
    hours,
  };
};

/**
 * Picks the window and AFK buckets of this device: the server's own hostname
 * first, otherwise the most recently updated bucket of each type.
 */
export const pickBuckets = (
  buckets: Record<string, AwBucketInfo> | AwBucketInfo[] | null | undefined,
  hostname: string | undefined,
): { window?: string; afk?: string } => {
  const list = Array.isArray(buckets) ? buckets : Object.values(buckets || {});
  const pick = (type: string): string | undefined => {
    const ofType = list.filter((b) => b && b.type === type && typeof b.id === 'string');
    const own = ofType.filter((b) => hostname && b.hostname === hostname);
    const pool = own.length ? own : ofType;
    return [...pool].sort(
      (a, b) => Date.parse(b.last_updated || '') - Date.parse(a.last_updated || '') || 0,
    )[0]?.id;
  };
  return { window: pick('currentwindow'), afk: pick('afkstatus') };
};
