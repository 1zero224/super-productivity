import { parseGoalChangeArgs, parseGoalDraftArgs } from './ai-knowledge-tools.service';
import { AiGoal } from '../goals/ai-goal.model';

const g = (over: Partial<AiGoal>): AiGoal => ({
  id: 'g',
  horizon: 'short',
  title: 'Goal',
  description: '',
  targetDate: null,
  projectIds: [],
  tagIds: [],
  status: 'active',
  parentId: null,
  taskIds: [],
  created: 1,
  updated: 1,
  ...over,
});

const goals = [
  g({ id: 'L', horizon: 'long' }),
  g({ id: 'M', horizon: 'mid', parentId: 'L' }),
  g({ id: 'Mx', horizon: 'mid', status: 'done' }),
  g({ id: 'S', horizon: 'short', parentId: 'M' }),
];

describe('parseGoalDraftArgs', () => {
  it('builds an active goal linked to a parent one horizon up', () => {
    expect(
      parseGoalDraftArgs(
        {
          horizon: 'short',
          title: '  Run 5 km  ',
          description: 'three runs a week',
          targetDate: '2026-11-30',
          parentId: 'M',
        },
        goals,
      ),
    ).toEqual({
      horizon: 'short',
      title: 'Run 5 km',
      description: 'three runs a week',
      targetDate: '2026-11-30',
      parentId: 'M',
      projectIds: [],
      tagIds: [],
      status: 'active',
    });
  });

  it('allows goals without a parent', () => {
    expect(parseGoalDraftArgs({ horizon: 'long', title: 'Vision' }, goals).parentId).toBe(
      null,
    );
    expect(parseGoalDraftArgs({ horizon: 'mid', title: 'Dir' }, goals).parentId).toBe(
      null,
    );
  });

  it('rejects invalid input', () => {
    expect(() => parseGoalDraftArgs({ horizon: 'year', title: 'x' }, goals)).toThrow();
    expect(() => parseGoalDraftArgs({ horizon: 'short', title: ' ' }, goals)).toThrow();
    expect(() =>
      parseGoalDraftArgs(
        { horizon: 'short', title: 'x', targetDate: '30.11.2026' },
        goals,
      ),
    ).toThrow();
    // Wrong horizon, inactive or missing parent, parent on a long-term goal
    for (const [horizon, parentId] of [
      ['short', 'L'],
      ['short', 'Mx'],
      ['mid', 'nope'],
      ['long', 'L'],
    ]) {
      expect(() =>
        parseGoalDraftArgs({ horizon, title: 'x', parentId }, goals),
      ).toThrow();
    }
  });
});

describe('parseGoalChangeArgs', () => {
  const short = goals[3];

  it('returns only the given fields', () => {
    expect(
      parseGoalChangeArgs({ id: 'S', status: 'done', targetDate: '' }, short, goals),
    ).toEqual({ status: 'done', targetDate: null });
    expect(parseGoalChangeArgs({ id: 'S', parentId: '' }, short, goals)).toEqual({
      parentId: null,
    });
  });

  it('rejects empty and invalid changes', () => {
    expect(() => parseGoalChangeArgs({ id: 'S' }, short, goals)).toThrow();
    expect(() =>
      parseGoalChangeArgs({ id: 'S', status: 'paused' }, short, goals),
    ).toThrow();
    expect(() => parseGoalChangeArgs({ id: 'S', parentId: 'L' }, short, goals)).toThrow();
  });
});
