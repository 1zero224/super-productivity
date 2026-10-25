import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { filter, map, startWith } from 'rxjs/operators';
import { TaskService } from '../../tasks/task.service';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import {
  selectTaskEntities,
  selectUndoneOverdue,
} from '../../tasks/store/task.selectors';
import { WorkContextService } from '../../work-context/work-context.service';
import { DateService } from '../../../core/date/date.service';
import { IMPORTANT_TAG, URGENT_TAG } from '../../tag/tag.const';
import { wrapUntrusted } from '../tools/ai-task-tools.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { AiMemoryService } from '../memory/ai-memory.service';

export interface AiContextChips {
  page: string;
  contextTitle: string | null;
  selectedTaskTitle: string | null;
  todayUndoneCount: number;
  overdueCount: number;
}

const pageFromUrl = (url: string): string => {
  if (url.includes('/boards')) return 'boards';
  if (url.includes('/planner')) return 'planner';
  if (url.includes('/schedule')) return 'schedule';
  if (url.includes('/daily-summary')) return 'daily-summary';
  if (url.includes('/goals')) return 'goals';
  if (/^\/ai(?:[/?#]|$)/.test(url)) return 'ai';
  if (url.includes('/tasks') || url.includes('/tag/') || url.includes('/project/')) {
    return 'tasks';
  }
  return 'other';
};

/**
 * Builds the shared context every AI feature sees: what page the user is on,
 * which list / task is in focus, and today's load.
 */
@Injectable({ providedIn: 'root' })
export class AiContextService {
  private readonly _router = inject(Router);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _dateService = inject(DateService);
  private readonly _goals = inject(AiGoalsService);
  private readonly _memory = inject(AiMemoryService);

  private readonly _url = toSignal(
    this._router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this._router.url),
    ),
    { initialValue: this._router.url },
  );
  private readonly _selectedTask = toSignal(this._taskService.selectedTask$, {
    initialValue: null,
  });
  private readonly _activeContext = toSignal(
    this._workContextService.activeWorkContext$,
    {
      initialValue: null,
    },
  );
  private readonly _todayIds = toSignal(this._store.select(selectTodayTaskIds), {
    initialValue: [] as string[],
  });
  private readonly _entities = toSignal(this._store.select(selectTaskEntities), {
    initialValue: {},
  });
  private readonly _overdue = toSignal(this._store.select(selectUndoneOverdue), {
    initialValue: [],
  });

  readonly chips = computed<AiContextChips>(() => {
    const entities = this._entities();
    return {
      page: pageFromUrl(this._url()),
      contextTitle: this._activeContext()?.title ?? null,
      selectedTaskTitle: this._selectedTask()?.title ?? null,
      todayUndoneCount: this._todayIds().filter(
        (id) => entities[id] && !entities[id]!.isDone,
      ).length,
      overdueCount: this._overdue().length,
    };
  });

  /** Plain-text context block appended to the system prompt. */
  buildContextBlock(focusTaskId?: string | null, query = ''): string {
    const chips = this.chips();
    const entities = this._entities();
    const todayTasks = this._todayIds()
      .map((id) => entities[id])
      .filter((t) => !!t && !t.isDone)
      .slice(0, 25);
    const focusTask =
      (focusTaskId && entities[focusTaskId]) || this._selectedTask() || null;

    const lines = [
      `Current date: ${this._dateService.todayStr()} (${new Date().toLocaleString()})`,
      `Current page: ${chips.page}`,
      chips.contextTitle
        ? `Active list: ${wrapUntrusted(chips.contextTitle)}`
        : 'Active list: none',
      `Undone today: ${chips.todayUndoneCount}, overdue: ${chips.overdueCount}`,
    ];
    if (focusTask) {
      lines.push(
        `Task in focus: id=${focusTask.id} title=${wrapUntrusted(focusTask.title)}` +
          ` subtasks=${focusTask.subTaskIds.length}`,
      );
    }
    if (todayTasks.length) {
      lines.push('Today list (undone):');
      for (const t of todayTasks) {
        const q = [
          t!.tagIds.includes(IMPORTANT_TAG.id) ? 'important' : '',
          t!.tagIds.includes(URGENT_TAG.id) ? 'urgent' : '',
        ]
          .filter(Boolean)
          .join('+');
        lines.push(
          `- id=${t!.id} ${wrapUntrusted(t!.title)}${q ? ` [${q}]` : ''}` +
            (t!.timeEstimate ? ` est=${Math.round(t!.timeEstimate / 60000)}m` : ''),
        );
      }
    }
    lines.push('', this._goals.buildGoalsBlock());
    // Relevance: the latest user message plus whatever is in focus
    lines.push(
      '',
      this._memory.buildMemoryBlock(
        [query, focusTask?.title ?? '', chips.contextTitle ?? ''].join(' '),
      ),
    );
    return lines.join('\n');
  }
}
