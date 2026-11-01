import { computed, inject, Injectable, signal } from '@angular/core';
import { getAiKv, setAiKv } from '../core/ai-db';
import { wrapUntrusted } from '../core/ai-untrusted.util';
import { DateService } from '../../../core/date/date.service';
import { Log } from '../../../core/log';
import { parseLocalDay } from '../tools/ai-task-tools.service';
import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  AdjustmentFeedback,
  ADJUST_VIEWS,
  AdoptedAdjustment,
  createEmptyDraft,
  EveningReviewDraft,
  ReviewFocus,
} from './evening-review.model';

const AiLog = Log.withContext('ai');
const DRAFTS_KEY = 'eveningReview.drafts';
const ADOPTIONS_KEY = 'eveningReview.adoptions';
// Short-term comparison only; older reviews are dropped
const MAX_DRAFT_DAYS = 30;
const MAX_ADOPTIONS = 30;
const MAX_NOTE_CHARS = 1000;

const pad = (n: number): string => String(n).padStart(2, '0');
export const formatClock = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const nextDay = (day: string): string => {
  const d = parseLocalDay(day);
  d.setDate(d.getDate() + 1);
  return getDbDateStr(d);
};

/** Keeps the newest `max` days. */
export const pruneDrafts = (
  drafts: Record<string, EveningReviewDraft>,
  max = MAX_DRAFT_DAYS,
): Record<string, EveningReviewDraft> =>
  Object.fromEntries(
    Object.entries(drafts)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .slice(0, max),
  );

export interface ReflectionInput {
  disposition: EveningReviewDraft['disposition'];
  // Only the ranges the user chose; never the whole day's records
  focuses: {
    // null = described from memory, without a recorded range
    timeRange: string | null;
    userView: string[];
    influences: string[];
    note: string | null;
    relatedTasks: { title: string; isDone: boolean }[];
    activityObservation: {
      activeMinutes: number;
      idleMinutes: number;
      unrecordedMinutes: number;
      apps: { app: string; minutes: number }[];
      titles?: { app: string; title: string; minutes: number }[];
    } | null;
  }[];
  offScreenNote: string | null;
}

/**
 * The minimal, user-confirmed summary sent with the evening review. Raw
 * events, other hours and (unless shared) window titles stay on the device.
 * App names, titles and notes are wrapped as untrusted data.
 */
export const buildReflectionInput = (
  draft: EveningReviewDraft,
  taskLookup: (id: string) => { title: string; isDone: boolean } | undefined,
): ReflectionInput => {
  // "End for today" means: do not analyze the day's records at all
  const focuses = draft.disposition === 'skipped' ? [] : draft.focuses;
  const note = (text: string): string | null =>
    text.trim() ? wrapUntrusted(text.trim().slice(0, MAX_NOTE_CHARS)) : null;
  return {
    disposition: draft.disposition,
    focuses: focuses.map((f) => ({
      timeRange: f.end > f.start ? `${formatClock(f.start)}–${formatClock(f.end)}` : null,
      userView: f.views,
      // The follow-up only applies when the user wants to arrange things differently
      influences: f.views.some((v) => ADJUST_VIEWS.includes(v)) ? f.influences : [],
      note: note(f.note),
      relatedTasks: f.taskIds
        .map((id) => taskLookup(id))
        .filter((t): t is { title: string; isDone: boolean } => !!t)
        .map((t) => ({ title: wrapUntrusted(t.title), isDone: t.isDone })),
      activityObservation: f.observation
        ? {
            activeMinutes: f.observation.activeMinutes,
            idleMinutes: f.observation.idleMinutes,
            unrecordedMinutes: f.observation.unrecordedMinutes,
            apps: f.observation.apps.map((a) => ({
              app: wrapUntrusted(a.app),
              minutes: a.minutes,
            })),
            ...(f.isShareTitles
              ? {
                  titles: f.observation.titles.map((t) => ({
                    app: wrapUntrusted(t.app),
                    title: wrapUntrusted(t.title),
                    minutes: t.minutes,
                  })),
                }
              : {}),
          }
        : null,
    })),
    offScreenNote: draft.disposition === 'skipped' ? null : note(draft.offScreenNote),
  };
};

/**
 * Device-local evening review drafts and adopted adjustments (sup-ai KV, never
 * synced). Drafts hold the user's answers plus a snapshot summary of each
 * chosen range — never the raw ActivityWatch events.
 */
@Injectable({ providedIn: 'root' })
export class EveningReviewService {
  private readonly _dateService = inject(DateService);

  private readonly _drafts = signal<Record<string, EveningReviewDraft>>({});
  private readonly _adoptions = signal<AdoptedAdjustment[]>([]);
  private _loadPromise?: Promise<void>;

  readonly drafts = this._drafts.asReadonly();
  readonly adoptions = this._adoptions.asReadonly();

  /** Today's draft waits for the user (scheduled slot passed, nothing decided). */
  readonly isTodayPending = computed(
    () => this._drafts()[this._dateService.todayStr()]?.disposition === 'pending',
  );

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = Promise.all([
        getAiKv<Record<string, EveningReviewDraft>>(DRAFTS_KEY),
        getAiKv<AdoptedAdjustment[]>(ADOPTIONS_KEY),
      ])
        .then(([drafts, adoptions]) => {
          this._drafts.set(drafts && typeof drafts === 'object' ? drafts : {});
          this._adoptions.set(Array.isArray(adoptions) ? adoptions : []);
        })
        .catch((e) => {
          AiLog.err('EveningReviewService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  getDraft(day: string): EveningReviewDraft {
    return this._drafts()[day] ?? createEmptyDraft(day);
  }

  /** Creates the day's draft if missing (used by the evening schedule). */
  async ensureDraft(day: string): Promise<EveningReviewDraft> {
    await this.load();
    const existing = this._drafts()[day];
    if (existing) {
      return existing;
    }
    const draft = createEmptyDraft(day);
    await this._saveDrafts({ ...this._drafts(), [day]: draft });
    return draft;
  }

  /** Applies a change to the day's answers and bumps its revision. */
  async update(
    day: string,
    change: (draft: EveningReviewDraft) => Partial<EveningReviewDraft>,
  ): Promise<EveningReviewDraft> {
    await this.load();
    const current = this.getDraft(day);
    const next: EveningReviewDraft = {
      ...current,
      ...change(current),
      day,
      revision: current.revision + 1,
      updated: Date.now(),
    };
    await this._saveDrafts({ ...this._drafts(), [day]: next });
    return next;
  }

  updateFocus(
    day: string,
    focusId: string,
    patch: Partial<ReviewFocus>,
  ): Promise<EveningReviewDraft> {
    return this.update(day, (d) => ({
      focuses: d.focuses.map((f) => (f.id === focusId ? { ...f, ...patch } : f)),
    }));
  }

  /** Deletes the day's answers and range summaries. */
  async remove(day: string): Promise<void> {
    await this.load();
    const rest = { ...this._drafts() };
    delete rest[day];
    await this._saveDrafts(rest);
  }

  // ---------- adjustments ----------

  isAdopted(reportId: string): boolean {
    return this._adoptions().some((a) => a.reportId === reportId);
  }

  /** The user chose to try `text`, from the evening report of `reportDay`. */
  async adopt(reportId: string, reportDay: string, text: string): Promise<void> {
    await this.load();
    if (this.isAdopted(reportId)) {
      return;
    }
    const adoption: AdoptedAdjustment = {
      reportId,
      text: text.slice(0, MAX_NOTE_CHARS),
      adoptedOn: this._dateService.todayStr(),
      targetDay: nextDay(reportDay),
    };
    await this._saveAdoptions([...this._adoptions(), adoption].slice(-MAX_ADOPTIONS));
  }

  async setFeedback(reportId: string, feedback: AdjustmentFeedback): Promise<void> {
    await this.load();
    await this._saveAdoptions(
      this._adoptions().map((a) => (a.reportId === reportId ? { ...a, feedback } : a)),
    );
  }

  /** Asked once, on the target day only: older ones never pile up as debt. */
  followUpFor(day: string): AdoptedAdjustment | null {
    return (
      [...this._adoptions()].reverse().find((a) => a.targetDay === day && !a.feedback) ??
      null
    );
  }

  /** The latest adjustment adopted before `day`, with the feedback given on it. */
  priorAdjustment(
    day: string,
  ): { text: string; tryDay: string; feedback: string } | null {
    const a = [...this._adoptions()]
      .reverse()
      .find((x) => x.targetDay <= day && x.adoptedOn < day);
    if (!a) {
      return null;
    }
    return {
      text: wrapUntrusted(a.text),
      tryDay: a.targetDay,
      feedback: a.feedback && a.feedback !== 'dismissed' ? a.feedback : 'unknown',
    };
  }

  private async _saveDrafts(drafts: Record<string, EveningReviewDraft>): Promise<void> {
    const pruned = pruneDrafts(drafts);
    this._drafts.set(pruned);
    await setAiKv(DRAFTS_KEY, pruned);
  }

  private async _saveAdoptions(list: AdoptedAdjustment[]): Promise<void> {
    this._adoptions.set(list);
    await setAiKv(ADOPTIONS_KEY, list);
  }
}
