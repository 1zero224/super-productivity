import { computed, Injectable, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { AiEntityStore } from '../core/ai-db';
import { AiGoal, AiGoalDraft, AiGoalHorizon, parentHorizonOf } from './ai-goal.model';
import { wrapUntrusted } from '../core/ai-untrusted.util';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const MAX_GOALS_IN_CONTEXT = 30;
const MAX_DESC_CHARS = 300;
const MAX_TASKS_PER_GOAL_IN_CONTEXT = 15;
const HORIZON_ORDER = { long: 0, mid: 1, short: 2 };

export type AiTaskLookup = (id: string) => { title: string; isDone: boolean } | undefined;

export interface AiGoalsBlockOptions {
  // 'short' = only active short-term goals (daily planning), 'all' = full tree
  scope?: 'all' | 'short';
  taskLookup?: AiTaskLookup;
}

export const sortGoals = (goals: AiGoal[]): AiGoal[] =>
  [...goals].sort(
    (a, b) =>
      HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon] ||
      (a.targetDate || '9999').localeCompare(b.targetDate || '9999') ||
      a.created - b.created,
  );

/** Fills fields added after a goal was stored. */
export const normalizeGoal = (raw: AiGoal): AiGoal => ({
  ...raw,
  parentId: raw.parentId ?? null,
  taskIds: Array.isArray(raw.taskIds) ? raw.taskIds : [],
  projectIds: Array.isArray(raw.projectIds) ? raw.projectIds : [],
  tagIds: Array.isArray(raw.tagIds) ? raw.tagIds : [],
});

/** A parent is valid when it exists, is active and sits one horizon up. */
export const isValidParent = (
  goals: AiGoal[],
  horizon: AiGoalHorizon,
  parentId: string | null | undefined,
): boolean => {
  if (!parentId) return true;
  const parent = goals.find((g) => g.id === parentId);
  return !!parent && parent.horizon === parentHorizonOf(horizon);
};

const describeGoal = (g: AiGoal): string =>
  `id=${g.id} ${wrapUntrusted(g.title)}` +
  (g.targetDate ? ` target=${g.targetDate}` : '') +
  (g.description.trim()
    ? ` desc=${wrapUntrusted(g.description.slice(0, MAX_DESC_CHARS))}`
    : '');

const describeTasks = (g: AiGoal, lookup?: AiTaskLookup): string => {
  if (!lookup || !g.taskIds.length) {
    return g.horizon === 'short' ? ' tasks=none' : '';
  }
  const tasks = g.taskIds.map((id) => ({ id, t: lookup(id) })).filter((x) => !!x.t);
  const done = tasks.filter((x) => x.t!.isDone).length;
  const open = tasks
    .filter((x) => !x.t!.isDone)
    .slice(0, MAX_TASKS_PER_GOAL_IN_CONTEXT)
    .map((x) => x.id);
  return (
    ` tasks=${done}/${tasks.length} done` +
    (open.length ? ` open=[${open.join(',')}]` : '')
  );
};

/**
 * Model-facing representation of the goals: a tree long → mid → short, with
 * the tasks linked to short-term goals. `scope: 'short'` lists only the
 * active short-term goals, which is all daily planning should look at.
 */
export const buildGoalsBlock = (
  goals: AiGoal[],
  { scope = 'all', taskLookup }: AiGoalsBlockOptions = {},
): string => {
  const active = sortGoals(goals.filter((g) => g.status === 'active'));
  if (scope === 'short') {
    const shorts = active.filter((g) => g.horizon === 'short');
    if (!shorts.length) {
      return 'Short-term goals: none defined';
    }
    return [
      'Short-term goals (the current focus):',
      ...shorts
        .slice(0, MAX_GOALS_IN_CONTEXT)
        .map((g) => `- ${describeGoal(g)}${describeTasks(g, taskLookup)}`),
    ].join('\n');
  }
  if (!active.length) {
    return 'Goals: none defined';
  }
  const ids = new Set(active.map((g) => g.id));
  const childrenOf = (id: string | null, horizon: AiGoalHorizon): AiGoal[] =>
    active.filter(
      (g) =>
        g.horizon === horizon &&
        (id === null ? !g.parentId || !ids.has(g.parentId) : g.parentId === id),
    );
  const lines = [
    'Goals as a tree. long = vision (years), mid = direction (months): both are compasses,',
    'never schedule them directly. short = current focus (weeks); tasks belong to short-term goals.',
  ];
  let count = 0;
  const walk = (g: AiGoal, depth: number): void => {
    if (count++ >= MAX_GOALS_IN_CONTEXT) return;
    const pad = '  '.repeat(depth);
    lines.push(
      `${pad}- [${g.horizon}] ${describeGoal(g)}${describeTasks(g, taskLookup)}`,
    );
    const childHorizon =
      g.horizon === 'long' ? 'mid' : g.horizon === 'mid' ? 'short' : null;
    if (childHorizon) {
      const children = childrenOf(g.id, childHorizon);
      if (!children.length && g.horizon === 'mid') {
        lines.push(`${pad}  (no active short-term goal yet)`);
      }
      children.forEach((c) => walk(c, depth + 1));
    }
  };
  childrenOf(null, 'long').forEach((g) => walk(g, 0));
  childrenOf(null, 'mid').forEach((g) => walk(g, 0));
  childrenOf(null, 'short').forEach((g) => walk(g, 0));
  return lines.join('\n');
};

@Injectable({ providedIn: 'root' })
export class AiGoalsService {
  private readonly _store = new AiEntityStore<AiGoal>('goals');
  private readonly _goals = signal<AiGoal[]>([]);
  private _loadPromise?: Promise<void>;

  readonly goals = computed(() => sortGoals(this._goals()));
  readonly activeGoals = computed(() =>
    this.goals().filter((g) => g.status === 'active'),
  );
  readonly activeShortGoals = computed(() =>
    this.activeGoals().filter((g) => g.horizon === 'short'),
  );

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._store
        .list()
        .then((goals) => this._goals.set(goals.map(normalizeGoal)))
        .catch((e) => {
          AiLog.err('AiGoalsService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  get(id: string): AiGoal | undefined {
    return this._goals().find((g) => g.id === id);
  }

  async add(draft: AiGoalDraft): Promise<AiGoal> {
    await this.load();
    const now = Date.now();
    const goal: AiGoal = {
      ...draft,
      parentId: isValidParent(this._goals(), draft.horizon, draft.parentId)
        ? draft.parentId
        : null,
      taskIds: [],
      id: nanoid(),
      created: now,
      updated: now,
    };
    await this._store.put(goal);
    this._goals.update((goals) => [...goals, goal]);
    return goal;
  }

  async update(id: string, changes: Partial<AiGoalDraft>): Promise<void> {
    await this.load();
    const existing = this.get(id);
    if (!existing) {
      throw new Error('Goal not found');
    }
    const merged = { ...existing, ...changes };
    const goal: AiGoal = {
      ...merged,
      id,
      parentId: isValidParent(this._goals(), merged.horizon, merged.parentId)
        ? merged.parentId
        : null,
      // Only short-term goals hold tasks
      taskIds: merged.horizon === 'short' ? merged.taskIds : [],
      updated: Date.now(),
    };
    await this._put(goal);
  }

  async remove(id: string): Promise<void> {
    await this.load();
    await this._store.delete(id);
    const orphans = this._goals().filter((g) => g.parentId === id);
    this._goals.update((goals) => goals.filter((g) => g.id !== id));
    for (const child of orphans) {
      await this._put({ ...child, parentId: null, updated: Date.now() });
    }
  }

  /** Links a task to an active short-term goal; a task has at most one goal. */
  async linkTask(goalId: string, taskId: string): Promise<void> {
    await this.load();
    const goal = this.get(goalId);
    if (!goal || goal.horizon !== 'short' || goal.status !== 'active') {
      throw new Error('Tasks can only be linked to an active short-term goal');
    }
    await this.unlinkTask(taskId, goalId);
    if (!goal.taskIds.includes(taskId)) {
      await this._put({
        ...goal,
        taskIds: [...goal.taskIds, taskId],
        updated: Date.now(),
      });
    }
  }

  /** Removes the task from every goal except `keepGoalId`. */
  async unlinkTask(taskId: string, keepGoalId?: string): Promise<void> {
    await this.load();
    for (const g of this._goals()) {
      if (g.id !== keepGoalId && g.taskIds.includes(taskId)) {
        await this._put({
          ...g,
          taskIds: g.taskIds.filter((id) => id !== taskId),
          updated: Date.now(),
        });
      }
    }
  }

  goalForTask(taskId: string): AiGoal | undefined {
    return this._goals().find((g) => g.taskIds.includes(taskId));
  }

  buildGoalsBlock(options?: AiGoalsBlockOptions): string {
    return buildGoalsBlock(this._goals(), options);
  }

  private async _put(goal: AiGoal): Promise<void> {
    await this._store.put(goal);
    this._goals.update((goals) => goals.map((g) => (g.id === goal.id ? goal : g)));
  }
}
