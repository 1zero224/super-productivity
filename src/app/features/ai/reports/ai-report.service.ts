import { computed, inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { AiEntityStore } from '../core/ai-db';
import { AiClientService, AiRequestError } from '../core/ai-client.service';
import { extractJsonObject } from '../core/ai-stream.util';
import {
  AI_CREATE_SUGGESTION_TOOLS,
  AI_TASK_SUGGESTION_TOOLS,
  AiReport,
  AiReportType,
  AiSuggestion,
  AiSuggestionTool,
} from './ai-report.model';
import { AiReportDataService } from './ai-report-data.service';
import { AiTaskToolsService, parseLocalDay } from '../tools/ai-task-tools.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { AiGoal } from '../goals/ai-goal.model';
import { AiQuadrantService } from '../quadrant/ai-quadrant.service';
import {
  AiQuadrantClassifyService,
  MAX_CLASSIFY_BATCH,
} from '../quadrant/ai-quadrant-classify.service';
import { flagsFromQuadrant, quadrantFromFlags } from '../quadrant/ai-quadrant.util';
import { AiMemoryKind, AiMemoryService } from '../memory/ai-memory.service';
import {
  AI_DAILY_REPORT_PROMPT,
  AI_EVENING_REVIEW_PROMPT,
  AI_WEEKLY_REPORT_PROMPT,
} from '../prompts/ai-prompts.const';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Task } from '../../tasks/task.model';
import { DateService } from '../../../core/date/date.service';
import { AiContextService } from '../context/ai-context.service';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const MAX_SUGGESTIONS = 10;
const MAX_CREATE_TASKS = 5;
const MAX_CREATE_GOALS = 1;
const MAX_WEEKLY_MEMORIES = 3;
const MAX_STORED_REPORTS = 60;
const MAX_REASON_CHARS = 200;
const MAX_TITLE_CHARS = 200;
const MAX_MORNING_PLAN_CHARS = 3000;
const MAX_OPEN_TASKS_WEEKLY = 60;

const REPORT_PROMPTS: Record<Exclude<AiReportType, 'classify'>, string> = {
  daily: AI_DAILY_REPORT_PROMPT,
  evening: AI_EVENING_REVIEW_PROMPT,
  weekly: AI_WEEKLY_REPORT_PROMPT,
};

export interface ParsedReport {
  markdown: string;
  suggestions: AiSuggestion[];
  memories: { text: string; kind: AiMemoryKind }[];
}

export interface ParseReportOptions {
  goals?: AiGoal[];
  // Allow create_task / create_goal (weekly review only)
  isCreateAllowed?: boolean;
}

const isTaskOpen = (t: Task | undefined): t is Task => !!t && !t.isDone;

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const quadrantLabel = (important: boolean, urgent: boolean): string =>
  quadrantFromFlags(important, urgent).toUpperCase();

const validateTaskArgs = (
  tool: AiSuggestionTool,
  raw: Record<string, unknown>,
  task: Task,
): Record<string, unknown> | null => {
  switch (tool) {
    case 'set_quadrant':
      if (task.parentId) return null;
      return {
        id: task.id,
        important: raw.important === true,
        urgent: raw.urgent === true,
      };
    case 'add_to_today':
      return { id: task.id };
    case 'schedule_task': {
      const day = typeof raw.day === 'string' ? raw.day : '';
      try {
        parseLocalDay(day);
      } catch {
        return null;
      }
      const time = typeof raw.time === 'string' ? raw.time.trim() : '';
      return {
        id: task.id,
        day,
        ...(time && isValidSplitTime(time) ? { time } : {}),
      };
    }
    default:
      return null;
  }
};

/** Mid-term goals that have no active short-term goal yet. */
const midGoalsWithoutShort = (goals: AiGoal[]): Set<string> => {
  const active = goals.filter((g) => g.status === 'active');
  const withShort = new Set(
    active.filter((g) => g.horizon === 'short' && g.parentId).map((g) => g.parentId),
  );
  return new Set(
    active.filter((g) => g.horizon === 'mid' && !withShort.has(g.id)).map((g) => g.id),
  );
};

/**
 * Parses a report response. Suggestions are whitelisted: unknown tools, task
 * ids that do not exist (or are done) and malformed args are dropped.
 * create_task / create_goal are only accepted with `isCreateAllowed`; a new
 * goal must be short-term under a mid-term goal that has none yet.
 */
export const parseReportResponse = (
  text: string,
  tasks: Record<string, Task | undefined>,
  { goals = [], isCreateAllowed = false }: ParseReportOptions = {},
): ParsedReport => {
  const json = (extractJsonObject(text) || {}) as {
    markdown?: unknown;
    suggestions?: unknown;
    memories?: unknown;
  };
  const markdown = typeof json.markdown === 'string' ? json.markdown.trim() : '';
  const suggestions: AiSuggestion[] = [];
  const seen = new Set<string>();
  const activeShortGoals = new Map(
    goals
      .filter((g) => g.horizon === 'short' && g.status === 'active')
      .map((g) => [g.id, g]),
  );
  const openMidGoals = midGoalsWithoutShort(goals);
  let createdTasks = 0;
  let createdGoals = 0;

  for (const rawItem of Array.isArray(json.suggestions) ? json.suggestions : []) {
    if (suggestions.length >= MAX_SUGGESTIONS) break;
    const item = (rawItem || {}) as { tool?: unknown; args?: unknown; reason?: unknown };
    const tool = item.tool as AiSuggestionTool;
    const rawArgs = (
      item.args && typeof item.args === 'object' ? item.args : {}
    ) as Record<string, unknown>;
    const reason = str(item.reason, MAX_REASON_CHARS);

    if (AI_TASK_SUGGESTION_TOOLS.includes(tool)) {
      const task = typeof rawArgs.id === 'string' ? tasks[rawArgs.id] : undefined;
      if (!isTaskOpen(task)) continue;
      const args = validateTaskArgs(tool, rawArgs, task);
      const key = `${tool}:${task.id}`;
      if (!args || seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        uid: nanoid(),
        tool,
        args,
        taskTitle: task.title,
        reason,
        state: 'open',
      });
      continue;
    }

    if (!isCreateAllowed || !AI_CREATE_SUGGESTION_TOOLS.includes(tool)) continue;
    const title = str(rawArgs.title, MAX_TITLE_CHARS);
    const key = `${tool}:${title.toLowerCase()}`;
    if (!title || seen.has(key)) continue;

    if (tool === 'create_task') {
      if (createdTasks >= MAX_CREATE_TASKS) continue;
      const goal =
        typeof rawArgs.goalId === 'string'
          ? activeShortGoals.get(rawArgs.goalId)
          : undefined;
      const important = rawArgs.important === true;
      const urgent = rawArgs.urgent === true;
      const est = Number(rawArgs.estimateMinutes);
      seen.add(key);
      createdTasks++;
      suggestions.push({
        uid: nanoid(),
        tool,
        args: {
          title,
          important,
          urgent,
          ...(goal ? { goalId: goal.id } : {}),
          ...(Number.isFinite(est) && est > 0 && est <= 600
            ? { estimateMinutes: Math.round(est) }
            : {}),
        },
        taskTitle: title,
        detail: quadrantLabel(important, urgent) + (goal ? ` · ${goal.title}` : ''),
        reason,
        state: 'open',
      });
    } else {
      const parentId = typeof rawArgs.parentId === 'string' ? rawArgs.parentId : '';
      if (createdGoals >= MAX_CREATE_GOALS || !openMidGoals.has(parentId)) continue;
      const parent = goals.find((g) => g.id === parentId)!;
      seen.add(key);
      createdGoals++;
      openMidGoals.delete(parentId);
      suggestions.push({
        uid: nanoid(),
        tool,
        args: {
          title,
          description: str(rawArgs.description, 1000),
          parentId,
        },
        taskTitle: title,
        detail: `↳ ${parent.title}`,
        reason,
        state: 'open',
      });
    }
  }

  const memories: ParsedReport['memories'] = [];
  for (const rawMem of Array.isArray(json.memories) ? json.memories : []) {
    const m = (rawMem || {}) as { text?: unknown; kind?: unknown };
    if (typeof m.text !== 'string' || !m.text.trim()) continue;
    const kind: AiMemoryKind =
      m.kind === 'habit' || m.kind === 'preference' ? m.kind : 'review';
    memories.push({ text: m.text.trim(), kind });
    if (memories.length >= MAX_WEEKLY_MEMORIES) break;
  }
  return { markdown, suggestions, memories };
};

@Injectable({ providedIn: 'root' })
export class AiReportService {
  private readonly _store = inject(Store);
  private readonly _client = inject(AiClientService);
  private readonly _data = inject(AiReportDataService);
  private readonly _tools = inject(AiTaskToolsService);
  private readonly _goals = inject(AiGoalsService);
  private readonly _memory = inject(AiMemoryService);
  private readonly _dateService = inject(DateService);
  private readonly _context = inject(AiContextService);
  private readonly _quadrant = inject(AiQuadrantService);
  private readonly _classifier = inject(AiQuadrantClassifyService);
  private readonly _db = new AiEntityStore<AiReport>('reports');

  private readonly _reports = signal<AiReport[]>([]);
  private _loadPromise?: Promise<void>;

  readonly reports = computed(() =>
    [...this._reports()].sort((a, b) => b.created - a.created),
  );
  readonly latest = computed(() => this.reports()[0] ?? null);
  readonly unreadCount = computed(() => this._reports().filter((r) => !r.isRead).length);
  readonly generating = signal<AiReportType | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly applyingId = signal<string | null>(null);

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._db
        .list()
        .then((list) => this._reports.set(list))
        .catch((e) => {
          AiLog.err('AiReportService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  /** Generates (or regenerates) a report; `periodKey` defaults to today. */
  async generate(type: AiReportType, periodKey?: string): Promise<AiReport | null> {
    if (this.generating()) {
      return null;
    }
    this.generating.set(type);
    this.lastError.set(null);
    try {
      await Promise.all([this.load(), this._goals.load(), this._memory.load()]);
      const key = periodKey ?? this._dateService.todayStr();
      const parsed =
        type === 'classify'
          ? await this._generateClassify()
          : await this._generateReport(type, key);
      if (!parsed.markdown) {
        throw new Error('The AI returned an empty report');
      }
      const memoryIds: string[] = [];
      if (type === 'weekly') {
        for (const m of parsed.memories) {
          memoryIds.push((await this._memory.remember(m.text, m.kind, 'weekly')).id);
        }
      }
      const report: AiReport = {
        id: nanoid(),
        type,
        periodKey: key,
        created: Date.now(),
        markdown: parsed.markdown,
        suggestions: parsed.suggestions,
        memoryIds,
        isRead: false,
      };
      await this._db.put(report);
      this._reports.update((list) => [...list, report]);
      await this._prune();
      AiLog.log('Report generated', {
        type,
        suggestions: report.suggestions.length,
        memories: memoryIds.length,
      });
      return report;
    } catch (e) {
      AiLog.err('Report generation failed', {
        type,
        status: (e as AiRequestError).status,
      });
      this.lastError.set((e as Error).message || String(e));
      throw e;
    } finally {
      this.generating.set(null);
    }
  }

  private async _generateReport(
    type: Exclude<AiReportType, 'classify'>,
    key: string,
  ): Promise<ParsedReport> {
    const entities = await firstValueFrom(this._store.select(selectTaskEntities));
    const taskLookup = (id: string): { title: string; isDone: boolean } | undefined =>
      entities[id]
        ? { title: entities[id]!.title, isDone: entities[id]!.isDone }
        : undefined;
    // Daily planning only looks at short-term goals; the weekly review sees the tree
    const isWeekly = type === 'weekly';
    const goalsForQuery = isWeekly
      ? this._goals.activeGoals()
      : this._goals.activeShortGoals();
    const content = await this._client.chatJson({
      messages: [
        {
          role: 'system',
          content: `${REPORT_PROMPTS[type]}\n\n${this._context.buildLanguageRule()}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            ...(await this._collectInput(type, key)),
            goals: this._goals.buildGoalsBlock({
              scope: isWeekly ? 'all' : 'short',
              taskLookup,
            }),
            memory: this._memory.buildMemoryBlock(
              goalsForQuery.map((g) => g.title).join(' '),
              12,
            ),
          }),
        },
      ],
      temperature: 0.5,
    });
    const freshEntities = await firstValueFrom(this._store.select(selectTaskEntities));
    return parseReportResponse(content, freshEntities, {
      goals: this._goals.goals(),
      isCreateAllowed: isWeekly,
    });
  }

  /** One-click quadrant fill: a set_quadrant suggestion per unclassified task. */
  private async _generateClassify(): Promise<ParsedReport> {
    const tasks = this._quadrant.unclassifiedTasks().slice(0, MAX_CLASSIFY_BATCH);
    if (!tasks.length) {
      throw new Error('All tasks already have a quadrant');
    }
    const summaries = await Promise.all(tasks.map((t) => this._tools.summarize(t, true)));
    const { summary, items } = await this._classifier.classify(summaries);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return {
      markdown: summary || '—',
      suggestions: items.map((it) => {
        const { important, urgent } = flagsFromQuadrant(it.quadrant);
        return {
          uid: nanoid(),
          tool: 'set_quadrant' as const,
          args: { id: it.id, important, urgent },
          taskTitle: byId.get(it.id)?.title ?? '',
          reason: it.reason,
          state: 'open' as const,
        };
      }),
      memories: [],
    };
  }
  /** Applies the ticked suggestions one by one, recording each outcome. */
  async applySuggestions(
    reportId: string,
    uids: string[],
  ): Promise<{ applied: number; failed: number }> {
    const report = this._reports().find((r) => r.id === reportId);
    if (!report || this.applyingId()) {
      return { applied: 0, failed: 0 };
    }
    this.applyingId.set(reportId);
    const wanted = new Set(uids);
    let applied = 0;
    let failed = 0;
    try {
      const suggestions: AiSuggestion[] = [];
      for (const s of report.suggestions) {
        if (!wanted.has(s.uid) || s.state === 'applied') {
          suggestions.push(s);
          continue;
        }
        try {
          await this._execute(s);
          suggestions.push({ ...s, state: 'applied', error: undefined });
          applied++;
        } catch (e) {
          suggestions.push({ ...s, state: 'failed', error: (e as Error).message });
          failed++;
        }
      }
      await this._save({ ...report, suggestions });
    } finally {
      this.applyingId.set(null);
    }
    return { applied, failed };
  }

  async markRead(reportId: string): Promise<void> {
    const report = this._reports().find((r) => r.id === reportId);
    if (report && !report.isRead) {
      await this._save({ ...report, isRead: true });
    }
  }

  async remove(reportId: string): Promise<void> {
    await this._db.delete(reportId);
    this._reports.update((list) => list.filter((r) => r.id !== reportId));
  }

  hasReport(type: AiReportType, periodKey: string): boolean {
    return this._reports().some((r) => r.type === type && r.periodKey === periodKey);
  }

  private async _collectInput(
    type: Exclude<AiReportType, 'classify'>,
    key: string,
  ): Promise<object> {
    switch (type) {
      case 'daily':
        return this._data.collectDaily(key);
      case 'evening': {
        const morning = this._reports().find(
          (r) => r.type === 'daily' && r.periodKey === key,
        );
        return {
          ...(await this._data.collectEvening(key)),
          // The model's own earlier output, so the review can compare
          morningPlan: morning ? morning.markdown.slice(0, MAX_MORNING_PLAN_CHARS) : null,
        };
      }
      case 'weekly':
        return {
          week: await this._data.collectWeekly(key),
          openTasks: await this._tools.listTasks('all_undone', MAX_OPEN_TASKS_WEEKLY),
        };
    }
  }

  private async _execute(s: AiSuggestion): Promise<void> {
    const id = s.args.id as string;
    switch (s.tool) {
      case 'set_quadrant':
        return this._tools.setQuadrant(
          id,
          s.args.important === true,
          s.args.urgent === true,
        );
      case 'add_to_today':
        return this._tools.addToToday(id);
      case 'schedule_task':
        return this._tools.scheduleTask(
          id,
          s.args.day as string,
          typeof s.args.time === 'string' ? s.args.time : undefined,
        );
      case 'create_task': {
        const taskId = this._tools.createTask({
          title: s.args.title as string,
          isImportant: s.args.important === true,
          isUrgent: s.args.urgent === true,
          estimateMinutes:
            typeof s.args.estimateMinutes === 'number'
              ? s.args.estimateMinutes
              : undefined,
        });
        if (typeof s.args.goalId === 'string') {
          await this._goals.linkTask(s.args.goalId, taskId);
        }
        return;
      }
      case 'create_goal':
        await this._goals.add({
          horizon: 'short',
          title: s.args.title as string,
          description: (s.args.description as string) || '',
          parentId: s.args.parentId as string,
          targetDate: null,
          projectIds: [],
          tagIds: [],
          status: 'active',
        });
        return;
    }
  }

  private async _save(report: AiReport): Promise<void> {
    await this._db.put(report);
    this._reports.update((list) => list.map((r) => (r.id === report.id ? report : r)));
  }

  private async _prune(): Promise<void> {
    const sorted = this.reports();
    for (const r of sorted.slice(MAX_STORED_REPORTS)) {
      await this._db.delete(r.id);
    }
    if (sorted.length > MAX_STORED_REPORTS) {
      const keep = new Set(sorted.slice(0, MAX_STORED_REPORTS).map((r) => r.id));
      this._reports.update((list) => list.filter((r) => keep.has(r.id)));
    }
  }
}
