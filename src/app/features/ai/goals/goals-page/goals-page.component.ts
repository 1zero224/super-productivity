import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiGoalsService } from '../ai-goals.service';
import {
  AI_GOAL_HORIZONS,
  AiGoal,
  AiGoalDraft,
  AiGoalHorizon,
  AiGoalStatus,
} from '../ai-goal.model';
import { GOAL_HORIZON_LABELS, GOAL_STATUS_LABELS } from '../ai-goal.const';
import {
  DialogGoalEditComponent,
  DialogGoalEditData,
} from '../dialog-goal-edit/dialog-goal-edit.component';
import { selectAllProjects } from '../../../project/store/project.selectors';
import { selectAllTagsWithoutMyDay } from '../../../tag/store/tag.reducer';
import { selectTaskEntities } from '../../../tasks/store/task.selectors';
import { LayoutService } from '../../../../core-ui/layout/layout.service';
import { AiPanelStateService } from '../../ai-panel-state.service';

const HORIZON_ICONS: Record<AiGoalHorizon, string> = {
  long: 'landscape',
  mid: 'route',
  short: 'flag',
};

interface GoalCardView extends AiGoal {
  links: string[];
  parentTitle: string | null;
  tasks: { id: string; title: string; isDone: boolean }[];
  doneCount: number;
}

/** Long / mid / short-term goals, stored locally and fed into the AI context. */
@Component({
  selector: 'goals-page',
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    TranslatePipe,
  ],
  templateUrl: './goals-page.component.html',
  styleUrl: './goals-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoalsPageComponent implements OnInit {
  private readonly _goalsService = inject(AiGoalsService);
  private readonly _dialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _layoutService = inject(LayoutService);
  private readonly _panelState = inject(AiPanelStateService);

  protected readonly T = T;
  readonly STATUS_LABELS = GOAL_STATUS_LABELS;
  readonly STATUSES = Object.keys(GOAL_STATUS_LABELS) as AiGoalStatus[];

  private readonly _projects = toSignal(this._store.select(selectAllProjects), {
    initialValue: [],
  });
  private readonly _tags = toSignal(this._store.select(selectAllTagsWithoutMyDay), {
    initialValue: [],
  });

  private readonly _taskEntities = toSignal(this._store.select(selectTaskEntities), {
    initialValue: {},
  });

  readonly columns = computed(() => {
    const titles = new Map<string, string>([
      ...this._projects().map((p) => [p.id, p.title] as [string, string]),
      ...this._tags().map((t) => [t.id, `#${t.title}`] as [string, string]),
    ]);
    const goals = this._goalsService.goals();
    const entities = this._taskEntities();
    const goalTitles = new Map(goals.map((g) => [g.id, g.title]));
    return AI_GOAL_HORIZONS.map((horizon) => ({
      horizon,
      icon: HORIZON_ICONS[horizon],
      label: GOAL_HORIZON_LABELS[horizon],
      goals: goals
        .filter((g) => g.horizon === horizon)
        // Active first; done / dropped sink to the bottom
        .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'))
        .map((g): GoalCardView => {
          const tasks = g.taskIds
            .map((id) => entities[id])
            .filter((t) => !!t)
            .map((t) => ({ id: t!.id, title: t!.title, isDone: t!.isDone }))
            // Open tasks first
            .sort((a, b) => Number(a.isDone) - Number(b.isDone));
          return {
            ...g,
            links: [...g.projectIds, ...g.tagIds]
              .map((id) => titles.get(id))
              .filter((t): t is string => !!t),
            parentTitle: (g.parentId && goalTitles.get(g.parentId)) || null,
            tasks,
            doneCount: tasks.filter((t) => t.isDone).length,
          };
        }),
    }));
  });

  ngOnInit(): void {
    this._goalsService.load();
  }

  add(horizon: AiGoalHorizon): void {
    this._openDialog({ horizon }).then((draft) => draft && this._goalsService.add(draft));
  }

  edit(goal: AiGoal): void {
    this._openDialog({ goal }).then(
      (draft) => draft && this._goalsService.update(goal.id, draft),
    );
  }

  setStatus(goal: AiGoal, status: AiGoalStatus): void {
    this._goalsService.update(goal.id, { status });
  }

  remove(goal: AiGoal): void {
    this._goalsService.remove(goal.id);
  }

  unlinkTask(taskId: string): void {
    this._goalsService.unlinkTask(taskId);
  }

  askAi(): void {
    this._panelState.panelView.set('chat');
    this._layoutService.showAiPanel();
  }

  private _openDialog(data: DialogGoalEditData): Promise<AiGoalDraft | undefined> {
    return new Promise((resolve) =>
      this._dialog
        .open(DialogGoalEditComponent, {
          data,
          restoreFocus: true,
          autoFocus: 'first-tabbable',
        })
        .afterClosed()
        .subscribe((res: AiGoalDraft | undefined) => resolve(res)),
    );
  }
}
