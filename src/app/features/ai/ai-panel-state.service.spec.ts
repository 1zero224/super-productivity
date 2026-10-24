import { parseBreakdownResponse } from './ai-panel-state.service';

describe('parseBreakdownResponse', () => {
  it('maps subtasks, rounds estimates and drops empty titles', () => {
    const items = parseBreakdownResponse(
      JSON.stringify({
        subtasks: [
          { title: ' Open the doc ', estimateMinutes: 1.6 },
          { title: '', estimateMinutes: 5 },
          { title: 'Write outline', estimateMinutes: 'abc' },
        ],
      }),
    );
    expect(items.map((i) => [i.title, i.estimateMinutes])).toEqual([
      ['Open the doc', 2],
      ['Write outline', null],
    ]);
    expect(items[0].uid).toBeTruthy();
  });

  it('accepts fenced JSON and caps the number of items', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `s${i}` }));
    const items = parseBreakdownResponse(
      '```json\n' + JSON.stringify({ subtasks: many }) + '\n```',
    );
    expect(items.length).toBe(12);
  });

  it('returns an empty list when the shape is wrong', () => {
    expect(parseBreakdownResponse('{"steps":[]}')).toEqual([]);
  });
});
