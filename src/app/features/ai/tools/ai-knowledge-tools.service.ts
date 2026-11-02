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
import {
  AI_GOAL_HORIZONS,
  AiGoal,
  AiGoalDraft,
  AiGoalHorizon,
  AiGoalStatus,
  parentHorizonOf,
} from '../goals/ai-goal.model';
import { parseLocalDay } from './ai-task-tools.service';

const MAX_RECALL_LIMIT = 30;
const MAX_GOAL_TITLE_CHARS = 120;
const MAX_GOAL_DESC_CHARS = 2000;
const GOAL_STATUSES: AiGoalStatus[] = ['active', 'done', 'dropped'];

const goalTitle = (v: unknown): string => {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error('"title" must be a non-empty string');
  }
  return v.trim().slice(0, MAX_GOAL_TITLE_CHARS);
};

const goalDescription = (v: unknown): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_GOAL_DESC_CHARS) : '';

/** "" or null clears the date. */
const goalTargetDate = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') {
    return null;
  }
  if (typeof v !== 'string') {
    throw new Error('targetDate must be YYYY-MM-DD');
  }
  parseLocalDay(v);
  return v;
};

/** Throws unless the parent exists, is active and sits one horizon up. */
const goalParentId = (
  goals: AiGoal[],
  horizon: AiGoalHorizon,
  v: unknown,
): string | null => {
  const parentHorizon = parentHorizonOf(horizon);
  if (v === undefined || v === null || v === '') {
    return null;
  }
  if (!parentHorizon) {
    throw new Error('Long-term goals have no parent');
  }
  const parent = goals.find((g) => g.id === v);
  if (!parent || parent.horizon !== parentHorizon || parent.status !== 'active') {
    throw new Error(`parentId must be the id of an active ${parentHorizon}-term goal`);
  }
  return parent.id;
};

/** Validates create_goal arguments against the existing goals. */
export const parseGoalDraftArgs = (
  args: Record<string, unknown>,
  goals: AiGoal[],
): AiGoalDraft => {
  const horizon = args.horizon as AiGoalHorizon;
  if (!AI_GOAL_HORIZONS.includes(horizon)) {
    throw new Error('horizon must be "long", "mid" or "short"');
  }
  return {
    horizon,
    title: goalTitle(args.title),
    description: goalDescription(args.description),
    targetDate: goalTargetDate(args.targetDate),
    parentId: goalParentId(goals, horizon, args.parentId),
    projectIds: [],
    tagIds: [],
    status: 'active',
  };
};

/** Validates update_goal arguments; only the given fields change. */
export const parseGoalChangeArgs = (
  args: Record<string, unknown>,
  goal: AiGoal,
  goals: AiGoal[],
): Partial<AiGoalDraft> => {
  const changes: Partial<AiGoalDraft> = {};
  if (args.title !== undefined) {
    changes.title = goalTitle(args.title);
  }
  if (args.description !== undefined) {
    changes.description = goalDescription(args.description);
  }
  if (args.targetDate !== undefined) {
    changes.targetDate = goalTargetDate(args.targetDate);
  }
  if (args.parentId !== undefined) {
    changes.parentId = goalParentId(goals, goal.horizon, args.parentId);
  }
  if (args.status !== undefined) {
    if (!GOAL_STATUSES.includes(args.status as AiGoalStatus)) {
      throw new Error('status must be "active", "done" or "dropped"');
    }
    changes.status = args.status as AiGoalStatus;
  }
  if (!Object.keys(changes).length) {
    throw new Error('Nothing to change');
  }
  return changes;
};

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
      {
        name: 'create_goal',
        kind: 'write',
        description:
          'Create one goal. horizon: "long" = vision (1–5 years), "mid" = direction (1–6 months), ' +
          '"short" = current focus (1–4 weeks, concrete and measurable). parentId links a mid-term goal to its ' +
          'long-term goal and a short-term goal to its mid-term goal (use the id returned for a goal you just created). ' +
          'Long-term goals have no parent.',
        parameters: {
          type: 'object',
          properties: {
            horizon: { type: 'string', enum: AI_GOAL_HORIZONS },
            title: { type: 'string', description: 'short outcome statement' },
            description: {
              type: 'string',
              description: 'why it matters and how success is measured',
            },
            targetDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
            parentId: { type: 'string', description: 'id of the active parent goal' },
          },
          required: ['horizon', 'title'],
        },
        execute: async (args) => {
          await this._goals.load();
          const goal = await this._goals.add(
            parseGoalDraftArgs(args, this._goals.goals()),
          );
          return { id: goal.id, horizon: goal.horizon };
        },
      },
      {
        name: 'update_goal',
        kind: 'write',
        description:
          'Change an existing goal: refine title / description / targetDate, re-link it (parentId, "" to unlink) ' +
          'or set status "done" (reached) / "dropped" (abandoned) / "active". Only pass fields that change. ' +
          'The horizon cannot change.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            targetDate: { type: 'string', description: 'YYYY-MM-DD, "" clears it' },
            parentId: { type: 'string' },
            status: { type: 'string', enum: GOAL_STATUSES },
          },
          required: ['id'],
        },
        execute: async (args) => {
          await this._goals.load();
          const goal = typeof args.id === 'string' ? this._goals.get(args.id) : undefined;
          if (!goal) {
            throw new Error('Goal not found');
          }
          await this._goals.update(
            goal.id,
            parseGoalChangeArgs(args, goal, this._goals.goals()),
          );
          return { ok: true };
        },
      },
    ];
  }
}
