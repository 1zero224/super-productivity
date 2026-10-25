import { parseClassifyResponse } from './ai-quadrant-classify.service';
import { findTasksToAutoClassify } from './ai-auto-quadrant.service';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';

describe('parseClassifyResponse', () => {
  it('keeps one valid entry per requested id', () => {
    const res = parseClassifyResponse(
      JSON.stringify({
        summary: ' Mostly q2 ',
        items: [
          { id: 'a', quadrant: 'q2', reason: 'goal' },
          { id: 'a', quadrant: 'q1' },
          { id: 'b', quadrant: 'q9' },
          { id: 'x', quadrant: 'q1' },
          { id: 'c', quadrant: 'q4' },
        ],
      }),
      new Set(['a', 'b', 'c']),
    );
    expect(res.summary).toBe('Mostly q2');
    expect(res.items).toEqual([
      { id: 'a', quadrant: 'q2', reason: 'goal' },
      { id: 'c', quadrant: 'q4', reason: '' },
    ]);
  });
});

describe('findTasksToAutoClassify', () => {
  const task = (over: Partial<Task>): Task =>
    ({ ...DEFAULT_TASK, id: 'x', title: 'X', created: 2000, ...over }) as Task;
  const map = { q1: 'tQ1', q2: 'tQ2', q3: 'tQ3', q4: 'tQ4' };

  it('only picks new, undone, unclassified parent tasks not tried before', () => {
    const tasks = [
      task({ id: 'new' }),
      task({ id: 'old', created: 500 }),
      task({ id: 'done', isDone: true }),
      task({ id: 'sub', parentId: 'new' }),
      task({ id: 'tagged', tagIds: ['tQ3'] }),
      task({ id: 'tried' }),
      undefined,
    ];
    expect(
      findTasksToAutoClassify(tasks, map, 1000, new Set(['tried'])).map((t) => t.id),
    ).toEqual(['new']);
  });
});
