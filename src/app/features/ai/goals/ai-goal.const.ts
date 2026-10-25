import { T } from '../../../t.const';
import { AiGoalHorizon, AiGoalStatus } from './ai-goal.model';

export const GOAL_HORIZON_LABELS: Record<AiGoalHorizon, string> = {
  long: T.F.AI.GOALS.LONG,
  mid: T.F.AI.GOALS.MID,
  short: T.F.AI.GOALS.SHORT,
};

export const GOAL_STATUS_LABELS: Record<AiGoalStatus, string> = {
  active: T.F.AI.GOALS.STATUS_ACTIVE,
  done: T.F.AI.GOALS.STATUS_DONE,
  dropped: T.F.AI.GOALS.STATUS_DROPPED,
};
