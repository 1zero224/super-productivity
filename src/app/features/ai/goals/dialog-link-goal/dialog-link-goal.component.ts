import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiGoalsService } from '../ai-goals.service';

export interface DialogLinkGoalData {
  taskId: string;
  taskTitle: string;
}

/** Picks the short-term goal a task serves (stored locally on the goal). */
@Component({
  selector: 'dialog-link-goal',
  imports: [
    MatButton,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIcon,
    TranslatePipe,
  ],
  templateUrl: './dialog-link-goal.component.html',
  styleUrl: './dialog-link-goal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogLinkGoalComponent implements OnInit {
  private readonly _dialogRef = inject(MatDialogRef<DialogLinkGoalComponent>);
  private readonly _goalsService = inject(AiGoalsService);
  private readonly _router = inject(Router);
  readonly data = inject<DialogLinkGoalData>(MAT_DIALOG_DATA);

  protected readonly T = T;
  readonly shortGoals = this._goalsService.activeShortGoals;
  readonly currentGoalId = computed(
    () =>
      this._goalsService.goals().find((g) => g.taskIds.includes(this.data.taskId))?.id ??
      null,
  );
  readonly parentTitles = computed(
    () => new Map(this._goalsService.goals().map((g) => [g.id, g.title])),
  );

  ngOnInit(): void {
    this._goalsService.load();
  }

  async link(goalId: string): Promise<void> {
    await this._goalsService.linkTask(goalId, this.data.taskId);
    this._dialogRef.close();
  }

  async unlink(): Promise<void> {
    await this._goalsService.unlinkTask(this.data.taskId);
    this._dialogRef.close();
  }

  openGoals(): void {
    this._dialogRef.close();
    this._router.navigate(['/goals']);
  }
}
