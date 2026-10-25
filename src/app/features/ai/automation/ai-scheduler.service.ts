import { inject, Injectable, OnDestroy } from '@angular/core';
import { AiSettingsService } from '../core/ai-settings.service';
import { getAiKv, setAiKv } from '../core/ai-db';
import { AiAutomationSettings } from '../core/ai-client.model';
import { AiReportService } from '../reports/ai-report.service';
import { AiReportType } from '../reports/ai-report.model';
import { AiPanelStateService } from '../ai-panel-state.service';
import { parseLocalDay } from '../tools/ai-task-tools.service';
import { DateService } from '../../../core/date/date.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { getDateTimeFromClockString } from '../../../util/get-date-time-from-clock-string';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const TICK_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;
const LAST_RUN_KEY = 'scheduler.lastRun';

type LastRunMap = Partial<Record<AiReportType, string>>;

/**
 * Daily slot: due once the configured time of the logical day has passed and
 * no run happened for that day yet (also catches up a run missed while the
 * app was closed). Returns the period key to run for, or null.
 */
export const computeDailyDueKey = (
  todayStr: string,
  time: string,
  nowMs: number,
  lastKey: string | undefined,
): string | null => {
  if (lastKey === todayStr) {
    return null;
  }
  const slotMs = getDateTimeFromClockString(time, parseLocalDay(todayStr));
  return nowMs >= slotMs ? todayStr : null;
};

/**
 * Weekly slot: the most recent configured weekday + time at or before now.
 * Due when that slot has not been run yet; the key is the slot's day, which
 * is the last day of the 7 summarized days.
 */
export const computeWeeklyDueKey = (
  todayStr: string,
  weekday: number,
  time: string,
  nowMs: number,
  lastKey: string | undefined,
): string | null => {
  const day = parseLocalDay(todayStr);
  day.setDate(day.getDate() - ((day.getDay() - weekday + 7) % 7));
  if (getDateTimeFromClockString(time, day) > nowMs) {
    day.setDate(day.getDate() - 7);
  }
  const key = getDbDateStr(day);
  return key === lastKey ? null : key;
};

interface AiScheduledJob {
  type: AiReportType;
  dueKey: (
    cfg: AiAutomationSettings,
    todayStr: string,
    nowMs: number,
    last?: string,
  ) => string | null;
}

// Table-driven so further scheduled jobs can be added later
const JOBS: AiScheduledJob[] = [
  {
    type: 'weekly',
    dueKey: (cfg, today, now, last) =>
      cfg.isWeeklyEnabled
        ? computeWeeklyDueKey(today, cfg.weeklyDay, cfg.weeklyTime, now, last)
        : null,
  },
  {
    type: 'evening',
    dueKey: (cfg, today, now, last) =>
      cfg.isEveningEnabled ? computeDailyDueKey(today, cfg.eveningTime, now, last) : null,
  },
  {
    type: 'daily',
    dueKey: (cfg, today, now, last) =>
      cfg.isDailyEnabled ? computeDailyDueKey(today, cfg.dailyTime, now, last) : null,
  },
];

/**
 * Runs the scheduled AI reports while the app is open. Started from the
 * deferred startup block; everything it touches is local or the user's own
 * AI endpoint.
 */
@Injectable({ providedIn: 'root' })
export class AiSchedulerService implements OnDestroy {
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _reportService = inject(AiReportService);
  private readonly _panelState = inject(AiPanelStateService);
  private readonly _dateService = inject(DateService);

  private _intervalId?: number;
  private _isTicking = false;
  private readonly _failedAt = new Map<AiReportType, number>();

  init(): void {
    if (this._intervalId !== undefined) {
      return;
    }
    this._intervalId = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  ngOnDestroy(): void {
    window.clearInterval(this._intervalId);
  }

  async tick(): Promise<void> {
    if (this._isTicking) {
      return;
    }
    this._isTicking = true;
    try {
      const settings = await this._settingsService.load();
      if (!this._settingsService.isConfigured()) {
        return;
      }
      await this._reportService.load();
      const lastRun = (await getAiKv<LastRunMap>(LAST_RUN_KEY)) || {};
      const todayStr = this._dateService.todayStr();

      for (const job of JOBS) {
        const now = Date.now();
        const key = job.dueKey(settings.automation, todayStr, now, lastRun[job.type]);
        if (!key) continue;
        const failedAt = this._failedAt.get(job.type);
        if (failedAt && now - failedAt < RETRY_AFTER_FAILURE_MS) continue;

        // A report generated manually for this period also counts as a run
        if (!this._reportService.hasReport(job.type, key)) {
          try {
            // null = another generation is running; try again next tick
            if (!(await this._reportService.generate(job.type, key))) continue;
            this._failedAt.delete(job.type);
            if (settings.automation.isAutoOpen) {
              this._panelState.showReports();
            }
          } catch {
            this._failedAt.set(job.type, Date.now());
            continue;
          }
        }
        lastRun[job.type] = key;
        await setAiKv(LAST_RUN_KEY, lastRun);
      }
    } catch (e) {
      AiLog.err('AiSchedulerService: tick failed', e);
    } finally {
      this._isTicking = false;
    }
  }
}
