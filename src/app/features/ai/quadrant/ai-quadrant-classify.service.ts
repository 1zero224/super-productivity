import { inject, Injectable } from '@angular/core';
import { AiClientService } from '../core/ai-client.service';
import { extractJsonObject } from '../core/ai-stream.util';
import { AI_QUADRANT_CLASSIFY_PROMPT } from '../prompts/ai-prompts.const';
import { AiTaskSummary } from '../tools/ai-task-tools.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { AiMemoryService } from '../memory/ai-memory.service';
import { AiContextService } from '../context/ai-context.service';
import { DateService } from '../../../core/date/date.service';
import { AI_QUADRANTS, AiQuadrant } from './ai-quadrant.util';

const MAX_REASON_CHARS = 200;
export const MAX_CLASSIFY_BATCH = 40;

export interface AiQuadrantClassification {
  id: string;
  quadrant: AiQuadrant;
  reason: string;
}

export interface AiClassifyResult {
  summary: string;
  items: AiQuadrantClassification[];
}

/** Keeps one valid entry per requested task id. */
export const parseClassifyResponse = (
  text: string,
  allowedIds: ReadonlySet<string>,
): AiClassifyResult => {
  const json = (extractJsonObject(text) || {}) as { summary?: unknown; items?: unknown };
  const seen = new Set<string>();
  const items: AiQuadrantClassification[] = [];
  for (const raw of Array.isArray(json.items) ? json.items : []) {
    const it = (raw || {}) as { id?: unknown; quadrant?: unknown; reason?: unknown };
    if (
      typeof it.id !== 'string' ||
      !allowedIds.has(it.id) ||
      seen.has(it.id) ||
      !AI_QUADRANTS.includes(it.quadrant as AiQuadrant)
    ) {
      continue;
    }
    seen.add(it.id);
    items.push({
      id: it.id,
      quadrant: it.quadrant as AiQuadrant,
      reason:
        typeof it.reason === 'string' ? it.reason.trim().slice(0, MAX_REASON_CHARS) : '',
    });
  }
  return {
    summary: typeof json.summary === 'string' ? json.summary.trim() : '',
    items,
  };
};

/** One JSON call that proposes a quadrant for each given task. */
@Injectable({ providedIn: 'root' })
export class AiQuadrantClassifyService {
  private readonly _client = inject(AiClientService);
  private readonly _goals = inject(AiGoalsService);
  private readonly _memory = inject(AiMemoryService);
  private readonly _context = inject(AiContextService);
  private readonly _dateService = inject(DateService);

  async classify(tasks: AiTaskSummary[]): Promise<AiClassifyResult> {
    const batch = tasks.slice(0, MAX_CLASSIFY_BATCH);
    if (!batch.length) {
      return { summary: '', items: [] };
    }
    await Promise.all([this._goals.load(), this._memory.load()]);
    const content = await this._client.chatJson({
      messages: [
        {
          role: 'system',
          content: `${AI_QUADRANT_CLASSIFY_PROMPT}\n\n${this._context.buildLanguageRule()}`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            today: this._dateService.todayStr(),
            tasks: batch.map((t) => ({
              id: t.id,
              title: t.title,
              ...(t.project ? { project: t.project } : {}),
              ...(t.dueDay ? { dueDay: t.dueDay } : {}),
              ...(t.dueAt ? { dueAt: t.dueAt } : {}),
              ...(t.notes ? { notes: t.notes } : {}),
            })),
            goals: this._goals.buildGoalsBlock(),
            memory: this._memory.buildMemoryBlock(batch.map((t) => t.title).join(' '), 8),
          }),
        },
      ],
      temperature: 0.2,
    });
    return parseClassifyResponse(content, new Set(batch.map((t) => t.id)));
  }
}
