import { inject, Injectable } from '@angular/core';
import { AiAgentTool } from '../agent/ai-agent.model';
import {
  AI_MEMORY_KINDS,
  AiMemoryKind,
  AiMemoryService,
  DEFAULT_RECALL_LIMIT,
} from '../memory/ai-memory.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { wrapUntrusted } from '../core/ai-untrusted.util';

const MAX_RECALL_LIMIT = 30;

/** Agent tools over the local goals and long-term memory stores. */
@Injectable({ providedIn: 'root' })
export class AiKnowledgeToolsService {
  private readonly _memory = inject(AiMemoryService);
  private readonly _goals = inject(AiGoalsService);

  buildAgentTools(): AiAgentTool[] {
    return [
      {
        name: 'remember',
        kind: 'write',
        description:
          'Save a durable fact about the user to long-term memory (preference, habit, review conclusion or fact). ' +
          'Only for things worth knowing in future conversations; one short sentence.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            kind: { type: 'string', enum: AI_MEMORY_KINDS },
          },
          required: ['text'],
        },
        execute: async (args) => {
          const text = typeof args.text === 'string' ? args.text : '';
          const kind = AI_MEMORY_KINDS.includes(args.kind as AiMemoryKind)
            ? (args.kind as AiMemoryKind)
            : 'fact';
          const memory = await this._memory.remember(text, kind, 'chat');
          return { id: memory.id };
        },
      },
      {
        name: 'recall',
        kind: 'read',
        description: 'Search long-term memory for entries related to a query.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number', description: `max ${MAX_RECALL_LIMIT}` },
          },
          required: ['query'],
        },
        execute: async (args) => {
          await this._memory.load();
          const limit =
            typeof args.limit === 'number'
              ? Math.min(Math.max(1, Math.round(args.limit)), MAX_RECALL_LIMIT)
              : DEFAULT_RECALL_LIMIT;
          return this._memory
            .recall(typeof args.query === 'string' ? args.query : '', limit)
            .map((m) => ({ id: m.id, kind: m.kind, text: wrapUntrusted(m.text) }));
        },
      },
      {
        name: 'list_goals',
        kind: 'read',
        description:
          'List the user goals (long / mid / short term, with parentId) including done and dropped ones. ' +
          'Short-term goals include the ids of their linked tasks.',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          await this._goals.load();
          return this._goals.goals().map((g) => ({
            id: g.id,
            horizon: g.horizon,
            status: g.status,
            title: wrapUntrusted(g.title),
            ...(g.description.trim()
              ? { description: wrapUntrusted(g.description) }
              : {}),
            ...(g.targetDate ? { targetDate: g.targetDate } : {}),
            ...(g.parentId ? { parentId: g.parentId } : {}),
            ...(g.horizon === 'short' ? { taskIds: g.taskIds } : {}),
          }));
        },
      },
    ];
  }
}
