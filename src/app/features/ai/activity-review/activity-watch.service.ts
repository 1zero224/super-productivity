import { inject, Injectable } from '@angular/core';
import { IS_ELECTRON } from '../../../app.constants';
import { DateService } from '../../../core/date/date.service';
import { Log } from '../../../core/log';
import { parseLocalDay } from '../tools/ai-task-tools.service';
import {
  AwBucketInfo,
  AwRawEvent,
  buildDayActivity,
  DayActivity,
  pickBuckets,
} from './aw-activity.util';
import {
  ActivityWatchRequest,
  ActivityWatchResponse,
} from '../../../../../electron/shared-with-frontend/activity-watch.model';

const AiLog = Log.withContext('ai');

export type ActivityUnavailableReason =
  | 'not_desktop'
  | 'unreachable'
  | 'no_window_bucket'
  | 'error';

export type DayActivityResult =
  | { status: 'ok'; activity: DayActivity; fetchedAt: number }
  | { status: 'unavailable'; reason: ActivityUnavailableReason };

/** [start, end) of a logical day, honouring the start-of-next-day setting. */
export const getLogicalDayBounds = (
  day: string,
  offsetMs: number,
): { start: number; end: number } => {
  const start = parseLocalDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime() + offsetMs, end: end.getTime() + offsetMs };
};

/**
 * Reads this device's ActivityWatch records (desktop only) through the main
 * process. Nothing is stored: the day is fetched again each time it is shown.
 */
@Injectable({ providedIn: 'root' })
export class ActivityWatchService {
  private readonly _dateService = inject(DateService);

  readonly isSupported = IS_ELECTRON;

  async loadDay(day: string): Promise<DayActivityResult> {
    if (!IS_ELECTRON || !window.ea?.activityWatchRequest) {
      return { status: 'unavailable', reason: 'not_desktop' };
    }
    try {
      const [info, buckets] = await Promise.all([
        this._request({ kind: 'info' }),
        this._request({ kind: 'buckets' }),
      ]);
      if (!buckets.ok) {
        return {
          status: 'unavailable',
          reason: buckets.error === 'UNREACHABLE' ? 'unreachable' : 'error',
        };
      }
      const hostname = info.ok
        ? (info.data as { hostname?: string } | null)?.hostname
        : undefined;
      const ids = pickBuckets(
        buckets.data as Record<string, AwBucketInfo> | null,
        hostname,
      );
      if (!ids.window) {
        return { status: 'unavailable', reason: 'no_window_bucket' };
      }
      const { start, end } = getLogicalDayBounds(
        day,
        this._dateService.getStartOfNextDayDiffMs(),
      );
      const range = {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      };
      const [windowRes, afkRes] = await Promise.all([
        this._request({ kind: 'events', bucketId: ids.window, ...range }),
        ids.afk
          ? this._request({ kind: 'events', bucketId: ids.afk, ...range })
          : Promise.resolve(null),
      ]);
      if (!windowRes.ok) {
        return { status: 'unavailable', reason: 'error' };
      }
      const toEvents = (res: ActivityWatchResponse | null): AwRawEvent[] | null =>
        res?.ok && Array.isArray(res.data) ? (res.data as AwRawEvent[]) : null;
      const now = Date.now();
      return {
        status: 'ok',
        fetchedAt: now,
        activity: buildDayActivity(
          toEvents(windowRes) ?? [],
          toEvents(afkRes),
          start,
          end,
          now,
        ),
      };
    } catch (e) {
      AiLog.err('ActivityWatchService: loading the day failed', e);
      return { status: 'unavailable', reason: 'error' };
    }
  }

  private _request(req: ActivityWatchRequest): Promise<ActivityWatchResponse> {
    return window.ea.activityWatchRequest(req);
  }
}
