import { parseReportResponse, REPORT_CREATE_LIMITS } from './ai-report.service';
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
    g({ id: 'L2', horizon: 'long', title: 'Second vision' }),
    g({ id: 'M1', horizon: 'mid', title: 'Has short', parentId: 'L' }),
    g({ id: 'M2', horizon: 'mid', title: 'Needs short', parentId: 'L' }),
    g({ id: 'S1', horizon: 'short', title: 'Short', parentId: 'M1' }),
  ];
  const createTask = (title: string, goalId?: string): object => ({
    tool: 'create_task',
    args: { title, important: true, urgent: false, ...(goalId ? { goalId } : {}) },
  });
  const response = JSON.stringify({
    markdown: 'w',
    suggestions: [
      ...['a', 'b', 'c', 'd'].map((t) => createTask(`S1 ${t}`, 'S1')),
      // A mid-term goal id is not a valid task goal: counts as "no goal"
      createTask('No goal 1', 'M1'),
      createTask('No goal 2'),
      { tool: 'create_goal', args: { title: 'Again under M1', parentId: 'M1' } },
      { tool: 'create_goal', args: { title: 'Under L (has mids)', parentId: 'L' } },
      { tool: 'create_goal', args: { title: 'Short under M2', parentId: 'M2' } },
      { tool: 'create_goal', args: { title: 'Mid under L2', parentId: 'L2' } },
      { tool: 'create_goal', args: { title: 'Second mid', parentId: 'L2' } },
    ],
  });

  it('caps new tasks per short-term goal in the weekly review', () => {
    const res = parseReportResponse(response, tasks, {
      goals,
      ...REPORT_CREATE_LIMITS.weekly,
    });
    const created = res.suggestions.filter((s) => s.tool === 'create_task');
    expect(created.map((s) => s.taskTitle)).toEqual([
      'S1 a',
      'S1 b',
      'S1 c',
      'No goal 1',
      'No goal 2',
    ]);
    expect(created[0].detail).toBe('Q2 · Short');
    expect(created[3].args).toEqual({
      title: 'No goal 1',
      important: true,
      urgent: false,
    });
  });

  it('fills one gap per level: short under mid, mid under long', () => {
    const res = parseReportResponse(response, tasks, {
      goals,
      ...REPORT_CREATE_LIMITS.weekly,
    });
    const newGoals = res.suggestions.filter((s) => s.tool === 'create_goal');
    expect(newGoals.map((s) => [s.args['parentId'], s.args['horizon']])).toEqual([
      ['M2', 'short'],
      ['L2', 'mid'],
    ]);
  });

  it('allows a single future-me task in the evening review and nothing in the morning', () => {
    const evening = parseReportResponse(response, tasks, {
      goals,
      ...REPORT_CREATE_LIMITS.evening,
    });
    expect(evening.suggestions.map((s) => s.tool)).toEqual(['create_task']);
    const daily = parseReportResponse(response, tasks, {
      goals,
      ...REPORT_CREATE_LIMITS.daily,
    });
    expect(daily.suggestions).toEqual([]);
  });
});
