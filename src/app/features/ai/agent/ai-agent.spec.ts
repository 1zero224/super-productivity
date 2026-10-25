import { AiAgent } from './ai-agent';
import { AiAgentEvent, AiAgentTool } from './ai-agent.model';
import { AiChatRequest, AiChatResult, AiToolCall } from '../core/ai-client.model';

const call = (id: string, name: string, args: unknown = {}): AiToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

const reply = (content: string, toolCalls: AiToolCall[] = []): AiChatResult => ({
  content,
  toolCalls,
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
});

describe('AiAgent.load', () => {
  it('replaces the transcript so a stored conversation can continue', () => {
    const agent = new AiAgent({
      chat: async () => ({ content: '', toolCalls: [], finishReason: 'stop' }),
      getSystemPrompt: () => '',
      tools: [],
      confirm: async () => true,
      onEvent: () => undefined,
    });
    agent.messages.push({ role: 'user', content: 'old' });
    agent.load([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
    expect(agent.messages.map((m) => m.content)).toEqual(['a', 'b']);
  });
});

describe('AiAgent', () => {
  let events: AiAgentEvent[];
  let readTool: AiAgentTool;
  let writeTool: AiAgentTool;

  beforeEach(() => {
    events = [];
    readTool = {
      name: 'list_tasks',
      kind: 'read',
      description: '',
      parameters: {},
      execute: jasmine.createSpy('read').and.resolveTo([{ id: 't1' }]),
    };
    writeTool = {
      name: 'mark_done',
      kind: 'write',
      description: '',
      parameters: {},
      execute: jasmine.createSpy('write').and.resolveTo({ ok: true }),
    };
  });

  const createAgent = (
    replies: AiChatResult[],
    confirm: () => Promise<boolean> = () => Promise.resolve(true),
    maxTurns?: number,
  ): { agent: AiAgent; chat: jasmine.Spy } => {
    const chat = jasmine
      .createSpy('chat')
      .and.callFake((_req: AiChatRequest) =>
        Promise.resolve(replies.shift() ?? reply('fallback')),
      );
    const agent = new AiAgent({
      chat,
      getSystemPrompt: () => 'SYS',
      tools: [readTool, writeTool],
      confirm,
      onEvent: (e) => events.push(e),
      maxTurns,
    });
    return { agent, chat };
  };

  it('runs a plain turn and sends the system prompt first', async () => {
    const { agent, chat } = createAgent([reply('hi')]);
    await agent.prompt('hello');
    const req = chat.calls.mostRecent().args[0] as AiChatRequest;
    expect(req.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(req.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(agent.messages.at(-1)).toEqual({ role: 'assistant', content: 'hi' });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('executes read tools without confirmation and loops back to the model', async () => {
    const confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    const { agent, chat } = createAgent(
      [reply('', [call('c1', 'list_tasks', { scope: 'today' })]), reply('done')],
      confirm,
    );
    await agent.prompt('what is today?');
    expect(readTool.execute).toHaveBeenCalledWith({ scope: 'today' });
    expect(confirm).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(2);
    const secondReq = chat.calls.argsFor(1)[0] as AiChatRequest;
    expect(secondReq.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '[{"id":"t1"}]',
    });
  });

  it('asks for confirmation before write tools and reports a rejection', async () => {
    const { agent } = createAgent(
      [reply('', [call('c1', 'mark_done', { id: 't1' })]), reply('ok')],
      () => Promise.resolve(false),
    );
    await agent.prompt('finish t1');
    expect(writeTool.execute).not.toHaveBeenCalled();
    const toolMsg = agent.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('rejected');
  });

  it('runs approved write tools', async () => {
    const { agent } = createAgent([
      reply('', [call('c1', 'mark_done', { id: 't1' })]),
      reply('ok'),
    ]);
    await agent.prompt('finish t1');
    expect(writeTool.execute).toHaveBeenCalledWith({ id: 't1' });
  });

  it('returns an error result for unknown tools and invalid JSON args', async () => {
    const bad: AiToolCall = {
      id: 'c2',
      type: 'function',
      function: { name: 'list_tasks', arguments: '{oops' },
    };
    const { agent } = createAgent([reply('', [call('c1', 'nope'), bad]), reply('ok')]);
    await agent.prompt('x');
    const toolMsgs = agent.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs[0].content).toContain('Unknown tool');
    expect(toolMsgs[1].content).toContain('not valid JSON');
  });

  it('stops after maxTurns of tool calls', async () => {
    const loops = Array.from({ length: 5 }, (_, i) =>
      reply('', [call(`c${i}`, 'list_tasks', { scope: 'today' })]),
    );
    const { agent, chat } = createAgent(loops, undefined, 2);
    await agent.prompt('loop');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('queues messages sent while running and handles them in the next turn', async () => {
    let resolveFirst!: (r: AiChatResult) => void;
    const replies: Promise<AiChatResult>[] = [
      new Promise((r) => (resolveFirst = r)),
      Promise.resolve(reply('second')),
    ];
    const chat = jasmine.createSpy('chat').and.callFake(() => replies.shift()!);
    const agent = new AiAgent({
      chat,
      getSystemPrompt: () => 'SYS',
      tools: [],
      confirm: () => Promise.resolve(true),
      onEvent: () => undefined,
    });
    const run = agent.prompt('first');
    await agent.prompt('steer');
    resolveFirst(reply('first-answer'));
    await run;
    expect(chat).toHaveBeenCalledTimes(2);
    const secondReq = chat.calls.argsFor(1)[0] as AiChatRequest;
    expect(secondReq.messages.at(-1)).toEqual({ role: 'user', content: 'steer' });
  });

  it('emits an Aborted error when aborted mid-request', async () => {
    const chat = jasmine
      .createSpy('chat')
      .and.callFake(
        (req: AiChatRequest) =>
          new Promise((_, reject) =>
            req.signal!.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      );
    const agent = new AiAgent({
      chat,
      getSystemPrompt: () => 'SYS',
      tools: [],
      confirm: () => Promise.resolve(true),
      onEvent: (e) => events.push(e),
    });
    const run = agent.prompt('x');
    agent.abort();
    await run;
    expect(events).toContain({ type: 'error', message: 'Aborted' });
    expect(agent.isRunning).toBe(false);
  });
});
