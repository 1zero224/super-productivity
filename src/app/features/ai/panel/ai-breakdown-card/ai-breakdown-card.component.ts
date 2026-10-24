import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiPanelStateService } from '../../ai-panel-state.service';

@Component({
  selector: 'ai-breakdown-card',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    MatButton,
    MatIconButton,
    MatIcon,
    MatProgressBar,
    MatTooltip,
    TranslatePipe,
  ],
  templateUrl: './ai-breakdown-card.component.html',
  styleUrl: './ai-breakdown-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiBreakdownCardComponent {
  readonly state = inject(AiPanelStateService);
  protected readonly T = T;

  readonly breakdown = this.state.breakdown;
  readonly refineText = signal('');
  readonly validCount = computed(
    () => this.breakdown()?.items.filter((it) => it.title.trim()).length ?? 0,
  );
  readonly totalMinutes = computed(
    () =>
      this.breakdown()?.items.reduce((sum, it) => sum + (it.estimateMinutes || 0), 0) ??
      0,
  );

  onDrop(ev: CdkDragDrop<unknown>): void {
    this.state.moveDraftItem(ev.previousIndex, ev.currentIndex);
  }

  onTitleInput(uid: string, ev: Event): void {
    this.state.updateDraftItem(uid, { title: (ev.target as HTMLInputElement).value });
  }

  onMinutesInput(uid: string, ev: Event): void {
    const n = Number((ev.target as HTMLInputElement).value);
    this.state.updateDraftItem(uid, {
      estimateMinutes: Number.isFinite(n) && n > 0 ? Math.round(n) : null,
    });
  }

  onRefineInput(ev: Event): void {
    this.refineText.set((ev.target as HTMLInputElement).value);
  }

  regenerate(): void {
    const b = this.breakdown();
    if (!b) {
      return;
    }
    const extra = this.refineText().trim();
    this.refineText.set('');
    this.state.generateBreakdown(b.taskId, extra || undefined);
  }
}
