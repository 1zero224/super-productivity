export type AiGoalHorizon = 'long' | 'mid' | 'short';
export type AiGoalStatus = 'active' | 'done' | 'dropped';

export const AI_GOAL_HORIZONS: AiGoalHorizon[] = ['long', 'mid', 'short'];

/** A user goal. Local-only (sup-ai IndexedDB), never synced. */
export interface AiGoal {
  id: string;
  horizon: AiGoalHorizon;
  title: string;
  description: string;
  // YYYY-MM-DD
  targetDate: string | null;
  projectIds: string[];
  tagIds: string[];
  status: AiGoalStatus;
  // mid → long, short → mid; long goals have none
  parentId: string | null;
  // Concrete tasks serving this goal (short-term goals only)
  taskIds: string[];
  created: number;
  updated: number;
}

export type AiGoalDraft = Pick<
  AiGoal,
  | 'horizon'
  | 'title'
  | 'description'
  | 'targetDate'
  | 'projectIds'
  | 'tagIds'
  | 'status'
  | 'parentId'
>;

/** The horizon a parent goal must have, or null for long-term goals. */
export const parentHorizonOf = (horizon: AiGoalHorizon): AiGoalHorizon | null =>
  horizon === 'short' ? 'mid' : horizon === 'mid' ? 'long' : null;
