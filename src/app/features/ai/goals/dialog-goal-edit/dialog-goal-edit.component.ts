import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiGoal, AiGoalDraft, AiGoalHorizon } from '../ai-goal.model';
import { selectAllProjects } from '../../../project/store/project.selectors';
import { selectAllTagsWithoutMyDay } from '../../../tag/store/tag.reducer';
import { GOAL_HORIZON_LABELS, GOAL_STATUS_LABELS } from '../ai-goal.const';

export interface DialogGoalEditData {
  goal?: AiGoal;
  horizon?: AiGoalHorizon;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Component({
  selector: 'dialog-goal-edit',
  imports: [
    FormsModule,
    MatButton,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatFormField,
    MatLabel,
    MatInput,
    MatSelect,
    MatOption,
    TranslatePipe,
  ],
  templateUrl: './dialog-goal-edit.component.html',
  styleUrl: './dialog-goal-edit.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogGoalEditComponent {
  private readonly _dialogRef = inject(MatDialogRef<DialogGoalEditComponent>);
  private readonly _data = inject<DialogGoalEditData>(MAT_DIALOG_DATA);
  private readonly _store = inject(Store);

  protected readonly T = T;
  readonly HORIZONS = Object.entries(GOAL_HORIZON_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
  readonly STATUSES = Object.entries(GOAL_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));
  readonly isEdit = !!this._data.goal;
  readonly projects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });
  readonly tags = toSignal(this._store.select(selectAllTagsWithoutMyDay), {
    initialValue: [],
  });

  readonly model = signal<AiGoalDraft>({
    horizon: this._data.goal?.horizon ?? this._data.horizon ?? 'short',
    title: this._data.goal?.title ?? '',
    description: this._data.goal?.description ?? '',
    targetDate: this._data.goal?.targetDate ?? null,
    projectIds: this._data.goal?.projectIds ?? [],
    tagIds: this._data.goal?.tagIds ?? [],
    status: this._data.goal?.status ?? 'active',
  });

  set<K extends keyof AiGoalDraft>(key: K, value: AiGoalDraft[K]): void {
    this.model.update((m) => ({ ...m, [key]: value }));
  }

  setTargetDate(value: string): void {
    this.set('targetDate', DATE_RE.test(value) ? value : null);
  }

  save(): void {
    const m = this.model();
    if (!m.title.trim()) {
      return;
    }
    this._dialogRef.close({
      ...m,
      title: m.title.trim(),
      description: m.description.trim(),
    } satisfies AiGoalDraft);
  }

  cancel(): void {
    this._dialogRef.close();
  }
}
