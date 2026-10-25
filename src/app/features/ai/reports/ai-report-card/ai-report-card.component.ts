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
import { AiQuadrant, quadrantFromFlags } from '../../quadrant/ai-quadrant.util';

const REPORT_META: Record<AiReport['type'], { icon: string; label: string }> = {
  daily: { icon: 'wb_twilight', label: T.F.AI.REPORT.DAILY },
  evening: { icon: 'bedtime', label: T.F.AI.REPORT.EVENING },
  weekly: { icon: 'insights', label: T.F.AI.REPORT.WEEKLY },
  classify: { icon: 'grid_view', label: T.F.AI.REPORT.CLASSIFY },
};

const SUGGESTION_ICONS: Record<AiSuggestion['tool'], string> = {
  set_quadrant: 'grid_view',
  add_to_today: 'wb_sunny',
  schedule_task: 'event',
  create_task: 'add_task',
  create_goal: 'flag',
};

export const QUADRANT_LABEL_KEYS: Record<AiQuadrant, string> = {
  q1: T.F.AI.QUADRANT.Q1,
  q2: T.F.AI.QUADRANT.Q2,
  q3: T.F.AI.QUADRANT.Q3,
  q4: T.F.AI.QUADRANT.Q4,
};

/** What a suggestion changes: a translation key, or plain text. */
export const describeSuggestion = (s: AiSuggestion): { key?: string; text?: string } => {
  switch (s.tool) {
    case 'set_quadrant':
      return {
        key: QUADRANT_LABEL_KEYS[
          quadrantFromFlags(s.args.important === true, s.args.urgent === true)
        ],
      };
    case 'add_to_today':
      return { key: T.F.AI.REPORT.TO_TODAY };
    case 'schedule_task':
      return { text: `${s.args.day}${s.args.time ? ` ${s.args.time}` : ''}` };
    case 'create_task':
    case 'create_goal':
      return { text: s.detail ?? '' };
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
      isCreate: s.tool === 'create_task' || s.tool === 'create_goal',
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
