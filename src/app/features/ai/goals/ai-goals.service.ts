import { computed, Injectable, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { AiEntityStore } from '../core/ai-db';
import { AiGoal, AiGoalDraft } from './ai-goal.model';
import { wrapUntrusted } from '../tools/ai-task-tools.service';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const MAX_GOALS_IN_CONTEXT = 20;
const MAX_DESC_CHARS = 300;
const HORIZON_ORDER = { long: 0, mid: 1, short: 2 };

export const sortGoals = (goals: AiGoal[]): AiGoal[] =>
  [...goals].sort(
    (a, b) =>
      HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon] ||
      (a.targetDate || '9999').localeCompare(b.targetDate || '9999') ||
      a.created - b.created,
  );

/** Compact, model-facing representation of the active goals. */
export const buildGoalsBlock = (goals: AiGoal[]): string => {
  const active = sortGoals(goals.filter((g) => g.status === 'active')).slice(
    0,
    MAX_GOALS_IN_CONTEXT,
  );
  if (!active.length) {
    return 'Goals: none defined';
  }
  return [
    'Goals (long = years, mid = months, short = weeks):',
    ...active.map(
      (g) =>
        `- id=${g.id} [${g.horizon}] ${wrapUntrusted(g.title)}` +
        (g.targetDate ? ` target=${g.targetDate}` : '') +
        (g.description.trim()
          ? ` desc=${wrapUntrusted(g.description.slice(0, MAX_DESC_CHARS))}`
          : ''),
    ),
  ].join('\n');
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

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._store
        .list()
        .then((goals) => this._goals.set(goals))
        .catch((e) => {
          AiLog.err('AiGoalsService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  async add(draft: AiGoalDraft): Promise<AiGoal> {
    await this.load();
    const now = Date.now();
    const goal: AiGoal = { ...draft, id: nanoid(), created: now, updated: now };
    await this._store.put(goal);
    this._goals.update((goals) => [...goals, goal]);
    return goal;
  }

  async update(id: string, changes: Partial<AiGoalDraft>): Promise<void> {
    await this.load();
    const existing = this._goals().find((g) => g.id === id);
    if (!existing) {
      throw new Error('Goal not found');
    }
    const goal: AiGoal = { ...existing, ...changes, id, updated: Date.now() };
    await this._store.put(goal);
    this._goals.update((goals) => goals.map((g) => (g.id === id ? goal : g)));
  }

  async remove(id: string): Promise<void> {
    await this.load();
    await this._store.delete(id);
    this._goals.update((goals) => goals.filter((g) => g.id !== id));
  }

  buildGoalsBlock(): string {
    return buildGoalsBlock(this._goals());
  }
}
