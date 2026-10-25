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
  created: number;
  updated: number;
}

export type AiGoalDraft = Pick<
  AiGoal,
  'horizon' | 'title' | 'description' | 'targetDate' | 'projectIds' | 'tagIds' | 'status'
>;
