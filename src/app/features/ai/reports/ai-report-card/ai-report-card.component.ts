import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { T } from '../../../../t.const';
import { AiReport, AiSuggestion } from '../ai-report.model';
import { AiReportService } from '../ai-report.service';
import { SnackService } from '../../../../core/snack/snack.service';

const REPORT_META: Record<AiReport['type'], { icon: string; label: string }> = {
  daily: { icon: 'wb_twilight', label: T.F.AI.REPORT.DAILY },
  evening: { icon: 'bedtime', label: T.F.AI.REPORT.EVENING },
  weekly: { icon: 'insights', label: T.F.AI.REPORT.WEEKLY },
};

const SUGGESTION_ICONS: Record<AiSuggestion['tool'], string> = {
  set_quadrant: 'grid_view',
  add_to_today: 'wb_sunny',
  schedule_task: 'event',
};

export const describeSuggestion = (s: AiSuggestion): string => {
  switch (s.tool) {
    case 'set_quadrant':
      return [
        s.args.important ? '★ important' : 'not important',
        s.args.urgent ? '⚡ urgent' : 'not urgent',
      ].join(' · ');
    case 'add_to_today':
      return '→ today';
    case 'schedule_task':
      return `→ ${s.args.day}${s.args.time ? ` ${s.args.time}` : ''}`;
  }
};

/** A daily / weekly report with a checklist of suggestions to apply. */
@Component({
  selector: 'ai-report-card',
  imports: [
    MatButton,
    MatIconButton,
    MatCheckbox,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MarkdownComponent,
  ],
  templateUrl: './ai-report-card.component.html',
  styleUrl: './ai-report-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiReportCardComponent {
  private readonly _reportService = inject(AiReportService);
  private readonly _snackService = inject(SnackService);

  protected readonly T = T;
  readonly report = input.required<AiReport>();
  readonly isCompact = input(false);
  readonly meta = computed(() => REPORT_META[this.report().type]);

  readonly items = computed(() =>
    this.report().suggestions.map((s) => ({
      ...s,
      icon: SUGGESTION_ICONS[s.tool],
      change: describeSuggestion(s),
    })),
  );
  // All still-open suggestions start ticked
  readonly checked = linkedSignal<Set<string>>(
    () =>
      new Set(
        this.report()
          .suggestions.filter((s) => s.state !== 'applied')
          .map((s) => s.uid),
      ),
  );
  readonly checkedCount = computed(() => this.checked().size);
  readonly isApplying = computed(
    () => this._reportService.applyingId() === this.report().id,
  );

  toggle(uid: string, isChecked: boolean): void {
    this.checked.update((set) => {
      const next = new Set(set);
      if (isChecked) {
        next.add(uid);
      } else {
        next.delete(uid);
      }
      return next;
    });
  }

  async apply(): Promise<void> {
    const { applied, failed } = await this._reportService.applySuggestions(
      this.report().id,
      [...this.checked()],
    );
    this._snackService.open({
      type: failed ? 'ERROR' : 'SUCCESS',
      msg: failed ? T.F.AI.REPORT.S.APPLIED_WITH_ERRORS : T.F.AI.REPORT.S.APPLIED,
      translateParams: { nr: applied, failed },
    });
  }

  remove(): void {
    this._reportService.remove(this.report().id);
  }
}
