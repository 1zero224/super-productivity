import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { addSubTask } from '../../tasks/store/task.actions';
import {
  selectTaskEntities,
  selectUndoneOverdue,
} from '../../tasks/store/task.selectors';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { selectAllProjects } from '../../project/store/project.selectors';
import { IMPORTANT_TAG, TODAY_TAG, URGENT_TAG } from '../../tag/tag.const';
import { getTaskPriority } from '../../tasks/task-priority.const';
import { WorkContextService } from '../../work-context/work-context.service';
import { WorkContextType } from '../../work-context/work-context.model';
import { DateService } from '../../../core/date/date.service';
import { AiAgentTool } from '../agent/ai-agent.model';

const MAX_NOTES_CHARS = 1500;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;
const MAX_SUBTASKS_PER_CALL = 20;
const MAX_TITLE_CHARS = 300;
const MS_PER_MIN = 60_000;

export interface AiTaskSummary {
  id: string;
  title: string;
  isDone: boolean;
  parentId?: string;
  project?: string;
  dueDay?: string;
  dueAt?: string;
  estimateMinutes?: number;
  spentMinutes?: number;
  priority?: number;
  important: boolean;
  urgent: boolean;
  subTaskCount: number;
  // Wrapped: user-authored text, never instructions for the model
  notes?: string;
}

export interface AiSubtaskInput {
  title: string;
  estimateMinutes?: number;
}

const toMinutes = (ms: number | undefined): number | undefined =>
  ms ? Math.round(ms / MS_PER_MIN) : undefined;

const requireString = (args: Record<string, unknown>, key: string): string => {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return v.trim();
};

const optionalMinutes = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') {
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 60 * 24 * 7) {
    throw new Error('estimateMinutes must be a number between 0 and 10080');
  }
  return Math.round(n);
};

export const wrapUntrusted = (text: string): string =>
  `<untrusted_user_content>${text}</untrusted_user_content>`;

export const computeQuadrantTagIds = (
  currentTagIds: string[],
  isImportant: boolean,
  isUrgent: boolean,
): string[] => {
  const base = currentTagIds.filter(
    (id) => id !== IMPORTANT_TAG.id && id !== URGENT_TAG.id && id !== TODAY_TAG.id,
  );
  return [
    ...base,
    ...(isImportant ? [IMPORTANT_TAG.id] : []),
    ...(isUrgent ? [URGENT_TAG.id] : []),
  ];
};

/**
 * The task operations the AI may use. Every write goes through TaskService /
 * existing persistent actions, so it is captured by the op-log like a manual
 * edit — no new sync surface.
 */
@Injectable({ providedIn: 'root' })
export class AiTaskToolsService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _workContextService = inject(WorkContextService);
  private readonly _dateService = inject(DateService);

  // ---------- reads ----------

  async getTask(id: string): Promise<Task | undefined> {
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    return entities[id];
  }

  async summarize(task: Task, isIncludeNotes = false): Promise<AiTaskSummary> {
    const projects = await firstValueFrom(this._store.select(selectAllProjects));
    const project = projects.find((p) => p.id === task.projectId);
    const priority = getTaskPriority(task.priority);
    return {
      id: task.id,
      title: task.title,
      isDone: task.isDone,
      ...(task.parentId ? { parentId: task.parentId } : {}),
      ...(project ? { project: project.title } : {}),
      ...(task.dueDay ? { dueDay: task.dueDay } : {}),
      ...(task.dueWithTime ? { dueAt: new Date(task.dueWithTime).toISOString() } : {}),
      ...(task.timeEstimate ? { estimateMinutes: toMinutes(task.timeEstimate) } : {}),
      ...(task.timeSpent ? { spentMinutes: toMinutes(task.timeSpent) } : {}),
      ...(priority ? { priority } : {}),
      important: task.tagIds.includes(IMPORTANT_TAG.id),
      urgent: task.tagIds.includes(URGENT_TAG.id),
      subTaskCount: task.subTaskIds.length,
      ...(isIncludeNotes && task.notes?.trim()
        ? { notes: wrapUntrusted(task.notes.slice(0, MAX_NOTES_CHARS)) }
        : {}),
    };
  }

  async getTaskWithSubtasks(
    id: string,
  ): Promise<(AiTaskSummary & { subTasks: AiTaskSummary[] }) | null> {
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    const task = entities[id];
    if (!task) {
      return null;
    }
    const subTasks = await Promise.all(
      task.subTaskIds
        .map((sid) => entities[sid])
        .filter((t): t is Task => !!t)
        .map((t) => this.summarize(t)),
    );
    return { ...(await this.summarize(task, true)), subTasks };
  }

  async listTasks(
    scope: 'today' | 'overdue' | 'all_undone',
    limit = DEFAULT_LIST_LIMIT,
  ): Promise<AiTaskSummary[]> {
    const cappedLimit = Math.min(Math.max(1, limit), MAX_LIST_LIMIT);
    let tasks: Task[];
    if (scope === 'today') {
      const [ids, entities] = await Promise.all([
        firstValueFrom(this._store.select(selectTodayTaskIds)),
        firstValueFrom(this._store.select(selectTaskEntities)),
      ]);
      tasks = ids.map((id) => entities[id]).filter((t): t is Task => !!t);
    } else if (scope === 'overdue') {
      tasks = await firstValueFrom(this._store.select(selectUndoneOverdue));
    } else {
      const entities = await firstValueFrom(this._store.select(selectTaskEntities));
      tasks = Object.values(entities).filter(
        (t): t is Task => !!t && !t.isDone && !t.parentId,
      );
    }
    return Promise.all(tasks.slice(0, cappedLimit).map((t) => this.summarize(t)));
  }

  // ---------- writes ----------

  createTask(input: {
    title: string;
    notes?: string;
    estimateMinutes?: number;
    isToday?: boolean;
    isImportant?: boolean;
    isUrgent?: boolean;
  }): string {
    const ctxType = this._workContextService.activeWorkContextType;
    const ctxId = this._workContextService.activeWorkContextId;
    const contextTagIds =
      ctxType === WorkContextType.TAG && ctxId && ctxId !== TODAY_TAG.id ? [ctxId] : [];
    const additional: Partial<Task> = {
      tagIds: computeQuadrantTagIds(contextTagIds, !!input.isImportant, !!input.isUrgent),
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.estimateMinutes
        ? { timeEstimate: input.estimateMinutes * MS_PER_MIN }
        : {}),
      ...(input.isToday ? { dueDay: this._todayStr() } : {}),
    };
    return this._taskService.add(
      input.title.slice(0, MAX_TITLE_CHARS),
      false,
      additional,
      false,
      true,
    );
  }

  async createSubtasks(parentId: string, items: AiSubtaskInput[]): Promise<string[]> {
    const parent = await this.getTask(parentId);
    if (!parent) {
      throw new Error('Parent task not found');
    }
    if (parent.parentId) {
      throw new Error('Subtasks cannot have their own subtasks');
    }
    const cleaned = items
      .map((it) => ({ ...it, title: (it.title || '').trim() }))
      .filter((it) => !!it.title)
      .slice(0, MAX_SUBTASKS_PER_CALL);
    // One dispatch per subtask: each is its own create op (AGENTS rule 6).
    return cleaned.map((it) => {
      const task = this._taskService.createNewTaskWithDefaults({
        title: it.title.slice(0, MAX_TITLE_CHARS),
        additional: {
          parentId,
          dueDay: undefined,
          ...(it.estimateMinutes
            ? { timeEstimate: it.estimateMinutes * MS_PER_MIN }
            : {}),
        },
      });
      this._store.dispatch(addSubTask({ task, parentId, isIgnoreShortSyntax: true }));
      return task.id;
    });
  }

  async updateTask(
    id: string,
    changes: {
      title?: string;
      notes?: string;
      estimateMinutes?: number;
      priority?: number | null;
    },
  ): Promise<void> {
    if (!(await this.getTask(id))) {
      throw new Error('Task not found');
    }
    const patch: Partial<Task> = {
      ...(changes.title !== undefined
        ? { title: changes.title.slice(0, MAX_TITLE_CHARS) }
        : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      ...(changes.estimateMinutes !== undefined
        ? { timeEstimate: changes.estimateMinutes * MS_PER_MIN }
        : {}),
      ...(changes.priority !== undefined
        ? { priority: getTaskPriority(changes.priority as Task['priority']) }
        : {}),
    };
    if (Object.keys(patch).length) {
      this._taskService.update(id, patch);
    }
  }

  async setQuadrant(id: string, isImportant: boolean, isUrgent: boolean): Promise<void> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error('Task not found');
    }
    if (task.parentId) {
      throw new Error('Quadrants apply to parent tasks only');
    }
    this._taskService.updateTags(
      task,
      computeQuadrantTagIds(task.tagIds, isImportant, isUrgent),
    );
  }

  async setDone(id: string): Promise<void> {
    if (!(await this.getTask(id))) {
      throw new Error('Task not found');
    }
    this._taskService.setDone(id);
  }

  async addToToday(id: string): Promise<void> {
    const task = await firstValueFrom(this._taskService.getByIdWithSubTaskData$(id));
    if (!task) {
      throw new Error('Task not found');
    }
    this._taskService.addToToday(task);
  }

  // ---------- agent tool definitions ----------

  buildAgentTools(): AiAgentTool[] {
    return [
      {
        name: 'list_tasks',
        kind: 'read',
        description:
          'List tasks. scope: "today" (today list), "overdue" (undone, due before today), "all_undone" (all undone parent tasks).',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', enum: ['today', 'overdue', 'all_undone'] },
            limit: { type: 'number', description: `max ${MAX_LIST_LIMIT}` },
          },
          required: ['scope'],
        },
        execute: async (args) => {
          const scope = args.scope;
          if (scope !== 'today' && scope !== 'overdue' && scope !== 'all_undone') {
            throw new Error('Invalid scope');
          }
          return this.listTasks(
            scope,
            typeof args.limit === 'number' ? args.limit : DEFAULT_LIST_LIMIT,
          );
        },
      },
      {
        name: 'get_task',
        kind: 'read',
        description: 'Get one task by id, including its notes and subtasks.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        execute: async (args) =>
          (await this.getTaskWithSubtasks(requireString(args, 'id'))) ?? {
            error: 'Task not found',
          },
      },
      {
        name: 'create_task',
        kind: 'write',
        description: 'Create a new parent task in the current list.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            notes: { type: 'string' },
            estimateMinutes: { type: 'number' },
            isToday: { type: 'boolean', description: 'plan it for today' },
            isImportant: { type: 'boolean' },
            isUrgent: { type: 'boolean' },
          },
          required: ['title'],
        },
        execute: async (args) => ({
          id: this.createTask({
            title: requireString(args, 'title'),
            notes: typeof args.notes === 'string' ? args.notes : undefined,
            estimateMinutes: optionalMinutes(args.estimateMinutes),
            isToday: args.isToday === true,
            isImportant: args.isImportant === true,
            isUrgent: args.isUrgent === true,
          }),
        }),
      },
      {
        name: 'create_subtasks',
        kind: 'write',
        description: 'Add subtasks (in order) to an existing parent task.',
        parameters: {
          type: 'object',
          properties: {
            parentId: { type: 'string' },
            subtasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  estimateMinutes: { type: 'number' },
                },
                required: ['title'],
              },
            },
          },
          required: ['parentId', 'subtasks'],
        },
        execute: async (args) => {
          if (!Array.isArray(args.subtasks)) {
            throw new Error('"subtasks" must be an array');
          }
          const items = (args.subtasks as (Record<string, unknown> | null)[]).map((s) => {
            const title = s?.title;
            return {
              title: typeof title === 'string' ? title : '',
              estimateMinutes: optionalMinutes(s?.estimateMinutes),
            };
          });
          return {
            ids: await this.createSubtasks(requireString(args, 'parentId'), items),
          };
        },
      },
      {
        name: 'update_task',
        kind: 'write',
        description:
          'Update title, notes, estimate or priority (1 low, 2 medium, 3 high, null none) of a task.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            notes: { type: 'string' },
            estimateMinutes: { type: 'number' },
            priority: { type: ['number', 'null'] },
          },
          required: ['id'],
        },
        execute: async (args) => {
          await this.updateTask(requireString(args, 'id'), {
            title: typeof args.title === 'string' ? args.title : undefined,
            notes: typeof args.notes === 'string' ? args.notes : undefined,
            estimateMinutes: optionalMinutes(args.estimateMinutes),
            priority:
              args.priority === null
                ? null
                : typeof args.priority === 'number'
                  ? args.priority
                  : undefined,
          });
          return { ok: true };
        },
      },
      {
        name: 'set_quadrant',
        kind: 'write',
        description:
          'Place a parent task in an Eisenhower quadrant by setting important / urgent.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            important: { type: 'boolean' },
            urgent: { type: 'boolean' },
          },
          required: ['id', 'important', 'urgent'],
        },
        execute: async (args) => {
          await this.setQuadrant(
            requireString(args, 'id'),
            args.important === true,
            args.urgent === true,
          );
          return { ok: true };
        },
      },
      {
        name: 'add_to_today',
        kind: 'write',
        description: 'Plan an existing task for today.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        execute: async (args) => {
          await this.addToToday(requireString(args, 'id'));
          return { ok: true };
        },
      },
      {
        name: 'mark_done',
        kind: 'write',
        description: 'Mark a task as done.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        execute: async (args) => {
          await this.setDone(requireString(args, 'id'));
          return { ok: true };
        },
      },
    ];
  }

  private _todayStr(): string {
    return this._dateService.todayStr();
  }
}
