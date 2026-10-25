import { parseReportResponse } from './ai-report.service';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

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
