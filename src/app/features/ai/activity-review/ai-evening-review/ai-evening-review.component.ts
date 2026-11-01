import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatTooltip } from '@angular/material/tooltip';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import {
  MatAutocomplete,
  MatAutocompleteTrigger,
  MatOption,
} from '@angular/material/autocomplete';
import { TranslatePipe } from '@ngx-translate/core';
import { nanoid } from 'nanoid';
import { T } from '../../../../t.const';
import { DateService } from '../../../../core/date/date.service';
import { selectAllTasks } from '../../../tasks/store/task.selectors';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiReportService } from '../../reports/ai-report.service';
import { AiReportCardComponent } from '../../reports/ai-report-card/ai-report-card.component';
import { ActivityWatchService, DayActivityResult } from '../activity-watch.service';
import { HourSlot, observeRange } from '../aw-activity.util';
import {
  AdjustmentFeedback,
  ADJUST_VIEWS,
  REVIEW_INFLUENCES,
  REVIEW_VIEWS,
  ReviewFocus,
  ReviewInfluence,
  ReviewView,
} from '../evening-review.model';
import {
  buildReflectionInput,
  EveningReviewService,
  formatClock,
} from '../evening-review.service';

const MAX_TASK_OPTIONS = 8;
const PART_KEYS: Record<HourSlot['part'], string> = {
  night: T.F.AI.REVIEW.PART_NIGHT,
  morning: T.F.AI.REVIEW.PART_MORNING,
  afternoon: T.F.AI.REVIEW.PART_AFTERNOON,
  evening: T.F.AI.REVIEW.PART_EVENING,
};
const VIEW_KEYS: Record<ReviewView, string> = {
  as_intended: T.F.AI.REVIEW.VIEW.AS_INTENDED,
  overran: T.F.AI.REVIEW.VIEW.OVERRAN,
  never_started: T.F.AI.REVIEW.VIEW.NEVER_STARTED,
  blocked: T.F.AI.REVIEW.VIEW.BLOCKED,
  reprioritized: T.F.AI.REVIEW.VIEW.REPRIORITIZED,
  record_misleading: T.F.AI.REVIEW.VIEW.RECORD_MISLEADING,
};
const INFLUENCE_KEYS: Record<ReviewInfluence, string> = {
  next_step_unclear: T.F.AI.REVIEW.INFLUENCE.NEXT_STEP_UNCLEAR,
  harder_than_expected: T.F.AI.REVIEW.INFLUENCE.HARDER_THAN_EXPECTED,
  interrupted: T.F.AI.REVIEW.INFLUENCE.INTERRUPTED,
  tired: T.F.AI.REVIEW.INFLUENCE.TIRED,
  lost_track_of_time: T.F.AI.REVIEW.INFLUENCE.LOST_TRACK_OF_TIME,
  other: T.F.AI.REVIEW.INFLUENCE.OTHER,
};
const UNAVAILABLE_KEYS = {
  not_desktop: T.F.AI.REVIEW.AW_NOT_DESKTOP,
  unreachable: T.F.AI.REVIEW.AW_UNREACHABLE,
  no_window_bucket: T.F.AI.REVIEW.AW_NO_BUCKET,
  error: T.F.AI.REVIEW.AW_ERROR,
};
const FEEDBACK_OPTIONS: { value: AdjustmentFeedback; label: string }[] = [
  { value: 'helped', label: T.F.AI.REVIEW.FEEDBACK.HELPED },
  { value: 'not_helpful', label: T.F.AI.REVIEW.FEEDBACK.NOT_HELPFUL },
  { value: 'not_tried', label: T.F.AI.REVIEW.FEEDBACK.NOT_TRIED },
  { value: 'not_applicable', label: T.F.AI.REVIEW.FEEDBACK.NOT_APPLICABLE },
];

const stripUntrustedTags = (text: string): string =>
  text.replace(/<\/?untrusted_user_content>/g, '');

/**
 * The look back before the evening review: a neutral timeline of the day's
 * ActivityWatch records, one question, and at most the ranges the user picks.
 * Nothing has to be explained; the records never decide what "needs" review.
 */
@Component({
  selector: 'ai-evening-review',
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    MatCheckbox,
    MatTooltip,
    MatFormField,
    MatLabel,
    MatInput,
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatOption,
    TranslatePipe,
    AiReportCardComponent,
  ],
  templateUrl: './ai-evening-review.component.html',
  styleUrl: './ai-evening-review.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiEveningReviewComponent implements OnInit {
  private readonly _review = inject(EveningReviewService);
  private readonly _aw = inject(ActivityWatchService);
  private readonly _settings = inject(AiSettingsService);
  private readonly _dateService = inject(DateService);
  readonly reportService = inject(AiReportService);

  protected readonly T = T;
  protected readonly VIEWS = REVIEW_VIEWS.map((v) => ({ value: v, label: VIEW_KEYS[v] }));
  protected readonly INFLUENCES = REVIEW_INFLUENCES.map((v) => ({
    value: v,
    label: INFLUENCE_KEYS[v],
  }));
  protected readonly FEEDBACK_OPTIONS = FEEDBACK_OPTIONS;
  protected readonly formatClock = formatClock;

  // Logical day to review; defaults to today
  readonly day = input<string | null>(null);
  readonly dayStr = computed(() => this.day() ?? this._dateService.todayStr());
  // Inside the report list, which shows progress, errors and reports itself
  readonly isInReportList = input(false);

  readonly isEnabled = computed(() => {
    const a = this._settings.settings().automation;
    return a.isEveningEnabled && a.isEveningReflection;
  });
  readonly isConfigured = this._settings.isConfigured;

  readonly draft = computed(() => this._review.getDraft(this.dayStr()));
  readonly followUp = computed(() => this._review.followUpFor(this.dayStr()));

  readonly activity = signal<DayActivityResult | null>(null);
  readonly isLoadingActivity = signal(false);
  readonly dayActivity = computed(() => {
    const res = this.activity();
    return res?.status === 'ok' ? res.activity : null;
  });
  readonly unavailableKey = computed(() => {
    const res = this.activity();
    return res?.status === 'unavailable' ? UNAVAILABLE_KEYS[res.reason] : null;
  });
  readonly dayActive = computed(() => {
    const a = this.dayActivity();
    if (!a) return null;
    return {
      h: Math.floor(a.activeMinutes / 60),
      m: a.activeMinutes % 60,
      first: a.firstSeen ? formatClock(a.firstSeen) : '–',
      last: a.lastSeen ? formatClock(a.lastSeen) : '–',
    };
  });
  readonly hourGroups = computed(() => {
    const groups: { label: string; hours: HourSlot[] }[] = [];
    for (const h of this.dayActivity()?.hours ?? []) {
      const label = PART_KEYS[h.part];
      const last = groups[groups.length - 1];
      if (last?.label === label) last.hours.push(h);
      else groups.push({ label, hours: [h] });
    }
    return groups;
  });

  // Picking a range: hour starts of the ticked hours
  readonly isPicking = signal(false);
  readonly pickedHours = signal<Set<number>>(new Set());
  readonly pickedRange = computed(() => {
    const hours = (this.dayActivity()?.hours ?? []).filter((h) =>
      this.pickedHours().has(h.start),
    );
    if (!hours.length) return null;
    return {
      start: Math.min(...hours.map((h) => h.start)),
      end: Math.max(...hours.map((h) => h.end)),
    };
  });
  readonly expandedHour = signal<number | null>(null);
  readonly isPreviewOpen = signal(false);
  readonly isConfirmingDelete = signal(false);

  readonly focuses = computed(() =>
    this.draft().focuses.map((f) => ({
      ...f,
      range: f.end > f.start ? `${formatClock(f.start)}–${formatClock(f.end)}` : null,
      isAdjust: f.views.some((v) => ADJUST_VIEWS.includes(v)),
      isMisleading: f.views.includes('record_misleading'),
      tasks: f.taskIds
        .map((id) => this._taskById().get(id))
        .filter((t): t is { id: string; title: string; isDone: boolean } => !!t),
    })),
  );

  private readonly _allTasks = toSignal(inject(Store).select(selectAllTasks), {
    initialValue: [],
  });
  private readonly _taskById = computed(
    () =>
      new Map(
        this._allTasks().map((t) => [
          t.id,
          { id: t.id, title: t.title, isDone: t.isDone },
        ]),
      ),
  );
  readonly taskQuery = signal('');
  readonly taskQueryFocusId = signal<string | null>(null);

  readonly preview = computed(() =>
    stripUntrustedTags(
      JSON.stringify(
        buildReflectionInput(this.draft(), (id) => this._taskById().get(id)),
        null,
        2,
      ),
    ),
  );

  readonly matchingReport = computed(() =>
    this.reportService.findEveningForRevision(this.dayStr(), this.draft().revision),
  );
  readonly hasEarlierReport = computed(() =>
    this.reportService
      .reports()
      .some((r) => r.type === 'evening' && r.periodKey === this.dayStr()),
  );
  readonly canGenerate = computed(
    () =>
      this.isConfigured() &&
      this.draft().disposition !== 'pending' &&
      !this.reportService.generating() &&
      !this.matchingReport(),
  );

  ngOnInit(): void {
    this._settings.load();
    this._review.load();
    this.reportService.load();
    this.loadActivity();
  }

  async loadActivity(): Promise<void> {
    if (this.isLoadingActivity()) return;
    this.isLoadingActivity.set(true);
    try {
      this.activity.set(await this._aw.loadDay(this.dayStr()));
    } finally {
      this.isLoadingActivity.set(false);
    }
  }

  // ---------- entry question ----------

  startPicking(): void {
    if (!this.dayActivity()) {
      this.addFocusFromMemory();
      return;
    }
    this.pickedHours.set(new Set());
    this.isPicking.set(true);
  }

  togglePickedHour(start: number): void {
    this.pickedHours.update((set) => {
      const next = new Set(set);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }

  confirmPick(): void {
    const range = this.pickedRange();
    const activity = this.dayActivity();
    if (!range || !activity) return;
    this._addFocus({
      start: range.start,
      end: range.end,
      observation: observeRange(activity, range.start, range.end, Date.now()),
    });
    this.isPicking.set(false);
  }

  addFocusFromMemory(): void {
    this._addFocus({ start: 0, end: 0, observation: null });
  }

  setDisposition(disposition: 'acceptable' | 'skipped' | 'pending'): void {
    this.isPicking.set(false);
    this._review.update(this.dayStr(), (d) => ({
      // A reviewed range stays as it is; "change" goes back to the question
      disposition:
        disposition === 'pending' && d.focuses.length ? 'reviewed' : disposition,
    }));
  }

  // ---------- one focus ----------

  toggleView(focus: ReviewFocus, view: ReviewView): void {
    let views: ReviewView[];
    if (focus.views.includes(view)) {
      views = focus.views.filter((v) => v !== view);
    } else if (view === 'as_intended') {
      // "It was fine" ends the range: no follow-up questions
      views = ['as_intended'];
    } else {
      views = [...focus.views.filter((v) => v !== 'as_intended'), view];
    }
    this._updateFocus(focus.id, { views });
  }

  toggleInfluence(focus: ReviewFocus, influence: ReviewInfluence): void {
    const influences = focus.influences.includes(influence)
      ? focus.influences.filter((i) => i !== influence)
      : [...focus.influences, influence];
    this._updateFocus(focus.id, { influences });
  }

  setNote(focus: ReviewFocus, note: string): void {
    if (note !== focus.note) this._updateFocus(focus.id, { note });
  }

  setShareTitles(focus: ReviewFocus, isShareTitles: boolean): void {
    this._updateFocus(focus.id, { isShareTitles });
  }

  taskOptions(focus: ReviewFocus): { id: string; title: string; isDone: boolean }[] {
    if (this.taskQueryFocusId() !== focus.id) return [];
    const q = this.taskQuery().trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(focus.taskIds);
    return [...this._taskById().values()]
      .filter((t) => !chosen.has(t.id) && t.title.toLowerCase().includes(q))
      .slice(0, MAX_TASK_OPTIONS);
  }

  onTaskQuery(focus: ReviewFocus, query: string): void {
    this.taskQueryFocusId.set(focus.id);
    this.taskQuery.set(query);
  }

  addTask(focus: ReviewFocus, taskId: string, inputEl: HTMLInputElement): void {
    inputEl.value = '';
    this.taskQuery.set('');
    if (!focus.taskIds.includes(taskId)) {
      this._updateFocus(focus.id, { taskIds: [...focus.taskIds, taskId] });
    }
  }

  removeTask(focus: ReviewFocus, taskId: string): void {
    this._updateFocus(focus.id, { taskIds: focus.taskIds.filter((id) => id !== taskId) });
  }

  removeFocus(focusId: string): void {
    this._review.update(this.dayStr(), (d) => {
      const focuses = d.focuses.filter((f) => f.id !== focusId);
      return {
        focuses,
        disposition: focuses.length ? d.disposition : 'pending',
      };
    });
  }

  setOffScreenNote(note: string): void {
    if (note !== this.draft().offScreenNote) {
      this._review.update(this.dayStr(), () => ({ offScreenNote: note }));
    }
  }

  // ---------- report ----------

  generate(): void {
    if (!this.canGenerate()) return;
    // Errors are surfaced through `lastError`
    this.reportService.generate('evening', this.dayStr()).catch(() => undefined);
  }

  feedback(reportId: string, value: AdjustmentFeedback): void {
    this._review.setFeedback(reportId, value);
  }

  async deleteReview(): Promise<void> {
    if (!this.isConfirmingDelete()) {
      this.isConfirmingDelete.set(true);
      return;
    }
    this.isConfirmingDelete.set(false);
    await this._review.remove(this.dayStr());
  }

  private _addFocus(range: Pick<ReviewFocus, 'start' | 'end' | 'observation'>): void {
    const focus: ReviewFocus = {
      id: nanoid(),
      ...range,
      isShareTitles: false,
      views: [],
      influences: [],
      note: '',
      taskIds: [],
    };
    this._review.update(this.dayStr(), (d) => ({
      disposition: 'reviewed',
      focuses: [...d.focuses, focus],
    }));
  }

  private _updateFocus(focusId: string, patch: Partial<ReviewFocus>): void {
    this._review.updateFocus(this.dayStr(), focusId, patch);
  }
}
