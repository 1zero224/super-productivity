import { TestBed } from '@angular/core/testing';
import {
  AiGoalsService,
  buildGoalsBlock,
  normalizeGoal,
  sortGoals,
} from './ai-goals.service';
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
  parentId: null,
  taskIds: [],
  created: 1,
  updated: 1,
  ...over,
});

const draft = (over: Partial<AiGoalDraft> = {}): AiGoalDraft => ({
  horizon: 'mid',
  title: 'Ship v2',
  description: 'Release it',
  targetDate: '2026-12-01',
  projectIds: ['p1'],
  tagIds: [],
  status: 'active',
  parentId: null,
  ...over,
});

const TREE = [
  goal({ id: 'L', horizon: 'long', title: 'Live in Japan' }),
  goal({ id: 'M', horizon: 'mid', title: 'Pass JLPT N2', parentId: 'L' }),
  goal({ id: 'M2', horizon: 'mid', title: 'Save money', parentId: 'L' }),
  goal({
    id: 'S',
    horizon: 'short',
    title: 'Finish textbook',
    parentId: 'M',
    taskIds: ['t1', 't2'],
  }),
  goal({ id: 'old', horizon: 'short', title: 'Old', status: 'done' }),
];
const lookup = (id: string): { title: string; isDone: boolean } | undefined =>
  ({ t1: { title: 'Ch.1', isDone: true }, t2: { title: 'Ch.2', isDone: false } })[id];

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

  it('renders the active goals as a tree with linked task progress', () => {
    const block = buildGoalsBlock(TREE, { taskLookup: lookup });
    const lines = block.split('\n');
    const idx = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    expect(idx('id=L')).toBeLessThan(idx('id=M '));
    expect(lines[idx('id=M ')].startsWith('  - [mid]')).toBe(true);
    expect(lines[idx('id=S')].startsWith('    - [short]')).toBe(true);
    expect(block).toContain('tasks=1/2 done open=[t2]');
    // A mid-term goal without a short-term goal is flagged for the weekly review
    expect(lines[idx('id=M2') + 1]).toContain('(no active short-term goal yet)');
    expect(block).not.toContain('Old');
    expect(buildGoalsBlock([goal({ id: 'L9', horizon: 'long' })])).toContain(
      '(no active mid-term goal yet)',
    );
    expect(block).toContain('<untrusted_user_content>Live in Japan');
  });

  it('lists only active short-term goals for daily planning', () => {
    const block = buildGoalsBlock(TREE, { scope: 'short', taskLookup: lookup });
    expect(block).toContain('id=S');
    expect(block).not.toContain('id=L');
    expect(block).not.toContain('id=M');
    expect(buildGoalsBlock([], { scope: 'short' })).toBe(
      'Short-term goals: none defined',
    );
  });

  it('normalizes goals stored before the hierarchy existed', () => {
    const legacy = {
      ...goal({}),
      parentId: undefined,
      taskIds: undefined,
    } as unknown as AiGoal;
    expect(normalizeGoal(legacy)).toEqual(
      jasmine.objectContaining({ parentId: null, taskIds: [] }),
    );
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
    const added = await service.add(draft());
    expect(service.goals().length).toBe(1);
    expect(stored[0].title).toBe('Ship v2');

    await service.update(added.id, { status: 'done' });
    expect(service.goals()[0].status).toBe('done');
    expect(service.activeGoals()).toEqual([]);

    await service.remove(added.id);
    expect(service.goals()).toEqual([]);
    expect(stored).toEqual([]);
  });

  it('only accepts a parent one horizon up and clears children on delete', async () => {
    const long = await service.add(draft({ horizon: 'long', title: 'Vision' }));
    const mid = await service.add(draft({ parentId: long.id }));
    const badShort = await service.add(draft({ horizon: 'short', parentId: long.id }));
    expect(mid.parentId).toBe(long.id);
    expect(badShort.parentId).toBeNull();

    await service.remove(long.id);
    expect(service.get(mid.id)!.parentId).toBeNull();
  });

  it('links a task to one active short-term goal at a time', async () => {
    const s1 = await service.add(draft({ horizon: 'short', title: 'A' }));
    const s2 = await service.add(draft({ horizon: 'short', title: 'B' }));
    const mid = await service.add(draft({ title: 'Mid' }));

    await service.linkTask(s1.id, 't1');
    await service.linkTask(s2.id, 't1');
    expect(service.get(s1.id)!.taskIds).toEqual([]);
    expect(service.get(s2.id)!.taskIds).toEqual(['t1']);
    expect(service.goalForTask('t1')!.id).toBe(s2.id);

    await expectAsync(service.linkTask(mid.id, 't2')).toBeRejected();
    await service.unlinkTask('t1');
    expect(service.goalForTask('t1')).toBeUndefined();
  });

  it('throws when updating an unknown goal', async () => {
    await expectAsync(service.update('nope', { title: 'x' })).toBeRejected();
  });
});
