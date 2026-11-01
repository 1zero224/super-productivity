import { AiChatItem } from '../../ai-chat.model';
import { groupToolRuns } from './ai-chat.component';

const tool = (
  id: string,
  name: string,
  status: 'pending' | 'running' | 'done' | 'rejected' | 'error' = 'done',
): AiChatItem => ({
  id,
  kind: 'tool',
  callId: `c-${id}`,
  name,
  args: {},
  isWrite: false,
  status,
});

describe('groupToolRuns', () => {
  it('keeps a single tool call as its own card', () => {
    const view = groupToolRuns([
      { id: 'u', kind: 'user', text: 'hi' },
      tool('t1', 'get_task'),
      { id: 'a', kind: 'assistant', text: 'ok', isStreaming: false },
    ]);
    expect(view.map((v) => v.kind)).toEqual(['user', 'tool', 'assistant']);
  });

  it('folds consecutive tool calls into one group with name counts', () => {
    const view = groupToolRuns([
      tool('t1', 'get_task'),
      tool('t2', 'get_task'),
      tool('t3', 'list_projects'),
      { id: 'a', kind: 'assistant', text: 'ok', isStreaming: false },
      tool('t4', 'get_task'),
      tool('t5', 'get_task'),
    ]);
    expect(view.map((v) => v.kind)).toEqual(['toolGroup', 'assistant', 'toolGroup']);
    const first = view[0];
    if (first.kind !== 'toolGroup') {
      throw new Error('expected a group');
    }
    expect(first.id).toBe('group-t1');
    expect(first.tools.length).toBe(3);
    expect(first.summary).toBe('get_task ×2 · list_projects');
    expect(first.status).toBe('done');
    expect(first.isForcedOpen).toBe(false);
  });

  it('keeps a group open while a call waits for approval or failed', () => {
    const pending = groupToolRuns([
      tool('t1', 'get_task'),
      tool('t2', 'add_task', 'pending'),
    ]);
    const failed = groupToolRuns([
      tool('t1', 'get_task'),
      tool('t2', 'get_task', 'error'),
    ]);
    expect(pending[0]).toEqual(
      jasmine.objectContaining({ status: 'running', isForcedOpen: true }),
    );
    expect(failed[0]).toEqual(
      jasmine.objectContaining({ status: 'error', isForcedOpen: true }),
    );
  });
});
