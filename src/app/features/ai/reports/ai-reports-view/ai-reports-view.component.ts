import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
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

const MARK_READ_DELAY_MS = 1500;

/** Report list with "generate now" buttons; `limit` caps the shown reports. */
@Component({
  selector: 'ai-reports-view',
  imports: [MatButton, MatIcon, TranslatePipe, AiReportCardComponent],
  templateUrl: './ai-reports-view.component.html',
  styleUrl: './ai-reports-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReportsViewComponent implements OnInit {
  readonly reportService = inject(AiReportService);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _quadrant = inject(AiQuadrantService);

  protected readonly T = T;
  readonly limit = input<number | null>(null);
  readonly isCompact = input(false);
  readonly isConfigured = this._settingsService.isConfigured;
  readonly unclassifiedCount = computed(() => this._quadrant.unclassifiedTasks().length);

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
  }

  generate(type: AiReportType): void {
    // Errors are surfaced through `lastError`
    this.reportService.generate(type).catch(() => undefined);
  }
}
