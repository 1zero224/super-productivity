import { inject, Injectable, OnDestroy } from '@angular/core';
import { Store } from '@ngrx/store';
import { Subscription } from 'rxjs';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import { AiSettingsService } from '../core/ai-settings.service';
import { AiTaskToolsService } from '../tools/ai-task-tools.service';
import { AiQuadrantService } from './ai-quadrant.service';
import {
  AiQuadrantClassifyService,
  MAX_CLASSIFY_BATCH,
} from './ai-quadrant-classify.service';
import { AiQuadrantTagMap, flagsFromQuadrant, getTaskQuadrant } from './ai-quadrant.util';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
// Wait until the user stops adding tasks before one batched request
export const AUTO_QUADRANT_DEBOUNCE_MS = 20_000;

/** Parent tasks created since `sinceMs` that still have no quadrant tag. */
export const findTasksToAutoClassify = (
  tasks: (Task | undefined)[],
  map: AiQuadrantTagMap,
  sinceMs: number,
  attempted: ReadonlySet<string>,
): Task[] =>
  tasks.filter(
    (t): t is Task =>
      !!t &&
      !t.parentId &&
      !t.isDone &&
      t.created >= sinceMs &&
      !attempted.has(t.id) &&
      !getTaskQuadrant(t.tagIds, map),
  );

/**
 * Gives newly created tasks a quadrant tag automatically (no confirmation, as
 * agreed with the user). Only looks at tasks created while the app is open;
 * existing unclassified tasks are offered as a one-click report instead.
 */
@Injectable({ providedIn: 'root' })
export class AiAutoQuadrantService implements OnDestroy {
  private readonly _store = inject(Store);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _quadrant = inject(AiQuadrantService);
  private readonly _classifier = inject(AiQuadrantClassifyService);
  private readonly _tools = inject(AiTaskToolsService);

  private _sub?: Subscription;
  private _timer?: number;
  private _startedAt = 0;
  private _isRunning = false;
  private _pendingKey = '';
  private _entities: Record<string, Task | undefined> = {};
  private readonly _attempted = new Set<string>();

  init(): void {
    if (this._sub) {
      return;
    }
    this._startedAt = Date.now();
    this._sub = this._store.select(selectTaskEntities).subscribe((entities) => {
      this._entities = entities;
      // Restart the debounce only when the pending set changes: entities
      // also emit every second while time is tracked
      const key = this._pending()
        .map((t) => t.id)
        .join(',');
      if (key !== this._pendingKey) {
        this._pendingKey = key;
        window.clearTimeout(this._timer);
        if (key) {
          this._timer = window.setTimeout(() => this.run(), AUTO_QUADRANT_DEBOUNCE_MS);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
    window.clearTimeout(this._timer);
  }

  async run(): Promise<void> {
    if (this._isRunning) {
      return;
    }
    const settings = await this._settingsService.load();
    if (!settings.automation.isAutoQuadrant || !this._settingsService.isConfigured()) {
      return;
    }
    const tasks = this._pending().slice(0, MAX_CLASSIFY_BATCH);
    if (!tasks.length) {
      return;
    }
    this._isRunning = true;
    tasks.forEach((t) => this._attempted.add(t.id));
    try {
      const summaries = await Promise.all(tasks.map((t) => this._tools.summarize(t)));
      const { items } = await this._classifier.classify(summaries);
      for (const item of items) {
        const current = this._entities[item.id];
        // Skip tasks the user classified in the meantime
        if (!current || this._quadrant.quadrantOf(current.tagIds)) continue;
        const { important, urgent } = flagsFromQuadrant(item.quadrant);
        await this._tools.setQuadrant(item.id, important, urgent);
      }
      AiLog.log('Auto quadrant applied', {
        requested: tasks.length,
        applied: items.length,
      });
    } catch (e) {
      AiLog.err('Auto quadrant failed', { count: tasks.length });
    } finally {
      this._isRunning = false;
    }
  }

  private _pending(): Task[] {
    return findTasksToAutoClassify(
      Object.values(this._entities),
      this._quadrant.map(),
      this._startedAt,
      this._attempted,
    );
  }
}
