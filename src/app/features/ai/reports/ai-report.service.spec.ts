import { parseReportResponse } from './ai-report.service';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import { AiGoal } from '../goals/ai-goal.model';

const task = (over: Partial<Task>): Task =>
  ({ ...DEFAULT_TASK, id: 'x', title: 'X', ...over }) as Task;

const tasks: Record<string, Task> = {
  a: task({ id: 'a', title: 'Write report' }),
  b: task({ id: 'b', title: 'Done one', isDone: true }),
  s: task({ id: 's', title: 'Sub', parentId: 'a' }),
};

describe('parseReportResponse', () => {
  it('keeps valid suggestions and normalizes their args', () => {
    const res = parseReportResponse(
      JSON.stringify({
        markdown: ' **First** ',
        suggestions: [
          {
            tool: 'set_quadrant',
            args: { id: 'a', important: true, urgent: 'yes' },
            reason: 'moves goal',
          },
          { tool: 'schedule_task', args: { id: 'a', day: '2026-10-27', time: '9am' } },
        ],
      }),
      tasks,
    );
    expect(res.markdown).toBe('**First**');
    expect(res.suggestions.map((s) => [s.tool, s.args])).toEqual([
      ['set_quadrant', { id: 'a', important: true, urgent: false }],
      ['schedule_task', { id: 'a', day: '2026-10-27' }],
    ]);
    expect(res.suggestions[0].taskTitle).toBe('Write report');
    expect(res.suggestions[0].state).toBe('open');
  });

  it('drops unknown tools, unknown / done tasks, bad dates and duplicates', () => {
    const res = parseReportResponse(
      JSON.stringify({
        markdown: 'x',
        suggestions: [
          { tool: 'mark_done', args: { id: 'a' } },
          { tool: 'add_to_today', args: { id: 'missing' } },
          { tool: 'add_to_today', args: { id: 'b' } },
          { tool: 'schedule_task', args: { id: 'a', day: 'tomorrow' } },
          { tool: 'set_quadrant', args: { id: 's', important: true } },
          { tool: 'add_to_today', args: { id: 'a' } },
          { tool: 'add_to_today', args: { id: 'a' } },
        ],
      }),
      tasks,
    );
    expect(res.suggestions.map((s) => `${s.tool}:${s.args.id}`)).toEqual([
      'add_to_today:a',
    ]);
  });

  it('caps memories to three and maps unknown kinds to review', () => {
    const res = parseReportResponse(
      '```json\n' +
        JSON.stringify({
          markdown: 'w',
          memories: [
            { text: 'a', kind: 'habit' },
            { text: 'b', kind: 'weird' },
            { text: ' ' },
            { text: 'c' },
            { text: 'd' },
          ],
        }) +
        '\n```',
      tasks,
    );
    expect(res.memories).toEqual([
      { text: 'a', kind: 'habit' },
      { text: 'b', kind: 'review' },
      { text: 'c', kind: 'review' },
    ]);
  });

  it('throws for non-JSON and returns empty results for a wrong shape', () => {
    expect(() => parseReportResponse('not json', tasks)).toThrow();
    expect(parseReportResponse('{"report":1}', tasks)).toEqual({
      markdown: '',
      suggestions: [],
      memories: [],
    });
  });
});

describe('parseReportResponse create suggestions', () => {
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
    g({ id: 'L', horizon: 'long', title: 'Vision' }),
    g({ id: 'M1', horizon: 'mid', title: 'Has short', parentId: 'L' }),
    g({ id: 'M2', horizon: 'mid', title: 'Needs short', parentId: 'L' }),
    g({ id: 'S1', horizon: 'short', title: 'Short', parentId: 'M1' }),
  ];
  const response = JSON.stringify({
    markdown: 'w',
    suggestions: [
      ...Array.from({ length: 7 }, (_, i) => ({
        tool: 'create_task',
        args: {
          title: `Task ${i}`,
          important: true,
          urgent: false,
          goalId: i ? 'S1' : 'M1',
        },
      })),
      { tool: 'create_goal', args: { title: 'Again under M1', parentId: 'M1' } },
      { tool: 'create_goal', args: { title: 'Under long', parentId: 'L' } },
      { tool: 'create_goal', args: { title: 'Under M2', parentId: 'M2' } },
      { tool: 'create_goal', args: { title: 'Second under M2', parentId: 'M2' } },
    ],
  });

  it('accepts at most 5 tasks and links only to active short-term goals', () => {
    const res = parseReportResponse(response, tasks, { goals, isCreateAllowed: true });
    const created = res.suggestions.filter((s) => s.tool === 'create_task');
    expect(created.length).toBe(5);
    expect(created[0].args).toEqual({ title: 'Task 0', important: true, urgent: false });
    expect(created[1].args['goalId']).toBe('S1');
    expect(created[1].detail).toBe('Q2 · Short');
  });

  it('accepts one new short-term goal, only under a mid-term goal without one', () => {
    const res = parseReportResponse(response, tasks, { goals, isCreateAllowed: true });
    const newGoals = res.suggestions.filter((s) => s.tool === 'create_goal');
    expect(newGoals.map((s) => s.args['parentId'])).toEqual(['M2']);
  });

  it('ignores create suggestions outside the weekly review', () => {
    const res = parseReportResponse(response, tasks, { goals });
    expect(res.suggestions).toEqual([]);
  });
});
