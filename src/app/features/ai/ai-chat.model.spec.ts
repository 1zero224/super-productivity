import { AiChatItem, chatToMarkdown, cutChatAt } from './ai-chat.model';
import { AiMessage } from './core/ai-client.model';

const items: AiChatItem[] = [
  { id: 'u1', kind: 'user', text: 'Plan my day' },
  {
    id: 't1',
    kind: 'tool',
    callId: 'c1',
    name: 'list_tasks',
    args: {},
    isWrite: false,
    status: 'done',
  },
  { id: 'a1', kind: 'assistant', text: 'Start with X.', isStreaming: false, msgCount: 4 },
  { id: 'u2', kind: 'user', text: 'And then?' },
  { id: 'a2', kind: 'assistant', text: 'Then Y.', isStreaming: false, msgCount: 6 },
  { id: 'a3', kind: 'assistant', text: 'old', isStreaming: false },
];

const messages: AiMessage[] = [
  { role: 'user', content: 'Plan my day' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } },
    ],
  },
  { role: 'tool', tool_call_id: 'c1', content: '[]' },
  { role: 'assistant', content: 'Start with X.' },
  { role: 'user', content: 'And then?' },
  { role: 'assistant', content: 'Then Y.' },
];

describe('cutChatAt', () => {
  it('keeps everything up to and including a final answer', () => {
    const cut = cutChatAt(items, messages, 'a1')!;
    expect(cut.items.map((it) => it.id)).toEqual(['u1', 't1', 'a1']);
    expect(cut.messages).toEqual(messages.slice(0, 4));
  });

  it('refuses items that are no cut point', () => {
    expect(cutChatAt(items, messages, 'u2')).toBeNull();
    expect(cutChatAt(items, messages, 'a3')).toBeNull();
    expect(cutChatAt(items, messages, 'missing')).toBeNull();
    expect(cutChatAt(items, messages.slice(0, 2), 'a1')).toBeNull();
  });
});

describe('chatToMarkdown', () => {
  it('renders user and AI turns with tool calls as quotes', () => {
    expect(chatToMarkdown(items.slice(0, 3), { user: 'Me', assistant: 'AI' })).toBe(
      '**Me:**\n\nPlan my day\n\n> `list_tasks` (done)\n\n**AI:**\n\nStart with X.',
    );
  });
});
