import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiReportService } from '../ai-report.service';
import { AiReportType } from '../ai-report.model';
import { AiReportCardComponent } from '../ai-report-card/ai-report-card.component';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiQuadrantService } from '../../quadrant/ai-quadrant.service';
import { AiEveningReviewComponent } from '../../activity-review/ai-evening-review/ai-evening-review.component';
import { EveningReviewService } from '../../activity-review/evening-review.service';
import { DateService } from '../../../../core/date/date.service';

const MARK_READ_DELAY_MS = 1500;

/** Report list with "generate now" buttons; `limit` caps the shown reports. */
@Component({
  selector: 'ai-reports-view',
  imports: [
    MatButton,
    MatIcon,
    TranslatePipe,
    AiReportCardComponent,
    AiEveningReviewComponent,
  ],
  templateUrl: './ai-reports-view.component.html',
  styleUrl: './ai-reports-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReportsViewComponent implements OnInit {
  readonly reportService = inject(AiReportService);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _quadrant = inject(AiQuadrantService);
  private readonly _review = inject(EveningReviewService);
  private readonly _dateService = inject(DateService);

  protected readonly T = T;
  readonly limit = input<number | null>(null);
  readonly isCompact = input(false);
  readonly isConfigured = this._settingsService.isConfigured;
  readonly unclassifiedCount = computed(() => this._quadrant.unclassifiedTasks().length);
  readonly isReflectionOn = computed(() => {
    const a = this._settingsService.settings().automation;
    return a.isEveningEnabled && a.isEveningReflection;
  });
  // The evening slot prepared today's review and it still waits for the user
  readonly isReviewWaiting = computed(
    () =>
      this.isReflectionOn() &&
      this._review.isTodayPending() &&
      !this.reportService.hasReport('evening', this._dateService.todayStr()),
  );
  readonly isReviewOpen = signal(false);

  readonly shownReports = computed(() => {
    const all = this.reportService.reports();
    const limit = this.limit();
    return limit ? all.slice(0, limit) : all;
  });

  private _markReadTimer?: number;

  constructor() {
    effect(() => {
      const unread = this.shownReports().filter((r) => !r.isRead);
      window.clearTimeout(this._markReadTimer);
      if (unread.length) {
        this._markReadTimer = window.setTimeout(
          () => unread.forEach((r) => this.reportService.markRead(r.id)),
          MARK_READ_DELAY_MS,
        );
      }
    });
    inject(DestroyRef).onDestroy(() => window.clearTimeout(this._markReadTimer));
  }

  ngOnInit(): void {
    this.reportService.load();
    this._review.load();
  }

  /** With reflection on, the evening review starts from the look back. */
  eveningClicked(): void {
    if (this.isReflectionOn()) {
      this.isReviewOpen.update((v) => !v);
    } else {
      this.generate('evening');
    }
  }

  generate(type: AiReportType): void {
    // Errors are surfaced through `lastError`
    this.reportService.generate(type).catch(() => undefined);
  }
}
