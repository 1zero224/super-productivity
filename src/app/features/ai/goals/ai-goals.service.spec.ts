import { TestBed } from '@angular/core/testing';
import { AiGoalsService, buildGoalsBlock, sortGoals } from './ai-goals.service';
import { AiGoal, AiGoalDraft } from './ai-goal.model';
import { AiEntityStore } from '../core/ai-db';

const goal = (over: Partial<AiGoal>): AiGoal => ({
  id: 'g',
  horizon: 'short',
  title: 'Goal',
  description: '',
  targetDate: null,
  projectIds: [],
  tagIds: [],
  status: 'active',
  created: 1,
  updated: 1,
  ...over,
});

const draft: AiGoalDraft = {
  horizon: 'mid',
  title: 'Ship v2',
  description: 'Release it',
  targetDate: '2026-12-01',
  projectIds: ['p1'],
  tagIds: [],
  status: 'active',
};

describe('goal helpers', () => {
  it('sorts by horizon, then target date', () => {
    const sorted = sortGoals([
      goal({ id: 's', horizon: 'short' }),
      goal({ id: 'l', horizon: 'long' }),
      goal({ id: 'm2', horizon: 'mid', targetDate: '2027-01-01' }),
      goal({ id: 'm1', horizon: 'mid', targetDate: '2026-11-01' }),
    ]);
    expect(sorted.map((g) => g.id)).toEqual(['l', 'm1', 'm2', 's']);
  });

  it('lists only active goals, wrapped as untrusted', () => {
    const block = buildGoalsBlock([
      goal({ id: 'a', title: 'Run a marathon', targetDate: '2027-04-01' }),
      goal({ id: 'b', title: 'Old', status: 'done' }),
    ]);
    expect(block).toContain('id=a [short] <untrusted_user_content>Run a marathon');
    expect(block).toContain('target=2027-04-01');
    expect(block).not.toContain('Old');
    expect(buildGoalsBlock([])).toBe('Goals: none defined');
  });
});

describe('AiGoalsService', () => {
  let service: AiGoalsService;
  let stored: AiGoal[];

  beforeEach(() => {
    stored = [];
    spyOn(AiEntityStore.prototype, 'list').and.callFake(async () => [...stored]);
    spyOn(AiEntityStore.prototype, 'put').and.callFake(async (e) => {
      stored = [...stored.filter((g) => g.id !== e.id), e as AiGoal];
    });
    spyOn(AiEntityStore.prototype, 'delete').and.callFake(async (id) => {
      stored = stored.filter((g) => g.id !== id);
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiGoalsService);
  });

  it('adds, updates and removes goals', async () => {
    const added = await service.add(draft);
    expect(service.goals().length).toBe(1);
    expect(stored[0].title).toBe('Ship v2');

    await service.update(added.id, { status: 'done' });
    expect(service.goals()[0].status).toBe('done');
    expect(service.activeGoals()).toEqual([]);

    await service.remove(added.id);
    expect(service.goals()).toEqual([]);
    expect(stored).toEqual([]);
  });

  it('throws when updating an unknown goal', async () => {
    await expectAsync(service.update('nope', { title: 'x' })).toBeRejected();
  });
});
