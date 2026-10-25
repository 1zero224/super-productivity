import { computed, inject, Injectable, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { AiEntityStore } from '../core/ai-db';
import { AiClientService, AiRequestError } from '../core/ai-client.service';
import { extractJsonObject } from '../core/ai-stream.util';
import {
  AI_SUGGESTION_TOOLS,
  AiReport,
  AiReportType,
  AiSuggestion,
  AiSuggestionTool,
} from './ai-report.model';
import { AiReportDataService } from './ai-report-data.service';
import { AiTaskToolsService, parseLocalDay } from '../tools/ai-task-tools.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { AiMemoryKind, AiMemoryService } from '../memory/ai-memory.service';
import {
  AI_DAILY_REPORT_PROMPT,
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
const MAX_WEEKLY_MEMORIES = 3;
const MAX_STORED_REPORTS = 60;
const MAX_REASON_CHARS = 200;

export interface ParsedReport {
  markdown: string;
  suggestions: AiSuggestion[];
  memories: { text: string; kind: AiMemoryKind }[];
}

const isTaskOpen = (t: Task | undefined): t is Task => !!t && !t.isDone;

const validateSuggestionArgs = (
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
  }
};

/**
 * Parses a report response. Suggestions are whitelisted: unknown tools, task
 * ids that do not exist (or are done) and malformed args are dropped.
 */
export const parseReportResponse = (
  text: string,
  tasks: Record<string, Task | undefined>,
): ParsedReport => {
  const json = (extractJsonObject(text) || {}) as {
    markdown?: unknown;
    suggestions?: unknown;
    memories?: unknown;
  };
  const markdown = typeof json.markdown === 'string' ? json.markdown.trim() : '';
  const suggestions: AiSuggestion[] = [];
  const seen = new Set<string>();
  for (const rawItem of Array.isArray(json.suggestions) ? json.suggestions : []) {
    const item = (rawItem || {}) as { tool?: unknown; args?: unknown; reason?: unknown };
    const tool = item.tool as AiSuggestionTool;
    if (!AI_SUGGESTION_TOOLS.includes(tool)) continue;
    const rawArgs = (
      item.args && typeof item.args === 'object' ? item.args : {}
    ) as Record<string, unknown>;
    const task = typeof rawArgs.id === 'string' ? tasks[rawArgs.id] : undefined;
    if (!isTaskOpen(task)) continue;
    const args = validateSuggestionArgs(tool, rawArgs, task);
    const key = `${tool}:${task.id}`;
    if (!args || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      uid: nanoid(),
      tool,
      args,
      taskTitle: task.title,
      reason:
        typeof item.reason === 'string'
          ? item.reason.trim().slice(0, MAX_REASON_CHARS)
          : '',
      state: 'open',
    });
    if (suggestions.length >= MAX_SUGGESTIONS) break;
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
      const input =
        type === 'daily'
          ? await this._data.collectDaily(key)
          : {
              week: await this._data.collectWeekly(key),
              openTasks: await this._tools.listTasks('all_undone', 60),
            };
      const memoryQuery = this._goals
        .activeGoals()
        .map((g) => g.title)
        .join(' ');
      const content = await this._client.chatJson({
        messages: [
          {
            role: 'system',
            content: `${
              type === 'daily' ? AI_DAILY_REPORT_PROMPT : AI_WEEKLY_REPORT_PROMPT
            }\n\n${this._context.buildLanguageRule()}`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              ...input,
              goals: this._goals.buildGoalsBlock(),
              memory: this._memory.buildMemoryBlock(memoryQuery, 12),
            }),
          },
        ],
        temperature: 0.5,
      });
      const entities = await firstValueFrom(this._store.select(selectTaskEntities));
      const parsed = parseReportResponse(content, entities);
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
