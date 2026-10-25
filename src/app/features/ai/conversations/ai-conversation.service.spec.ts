import { TestBed } from '@angular/core/testing';
import {
  AiConversationService,
  conversationTitle,
  settleChatItems,
} from './ai-conversation.service';
import { AiChatItem, AiConversation } from '../ai-chat.model';
import { AiEntityStore } from '../core/ai-db';

const items: AiChatItem[] = [
  { id: '1', kind: 'user', text: '  Plan   my day ' },
  { id: '2', kind: 'assistant', text: 'Sure', isStreaming: true },
  {
    id: '3',
    kind: 'tool',
    callId: 'c',
    name: 'add_to_today',
    args: {},
    isWrite: true,
    status: 'pending',
  },
];

describe('conversation helpers', () => {
  it('derives the title from the first user message', () => {
    expect(conversationTitle(items)).toBe('Plan my day');
    expect(conversationTitle([{ id: 'u', kind: 'user', text: 'x'.repeat(80) }])).toBe(
      'x'.repeat(60) + '…',
    );
    expect(conversationTitle([])).toBe('');
  });

  it('settles streaming and pending items before saving', () => {
    const settled = settleChatItems(items);
    expect((settled[1] as { isStreaming: boolean }).isStreaming).toBe(false);
    expect((settled[2] as { status: string }).status).toBe('rejected');
  });
});

describe('AiConversationService', () => {
  let service: AiConversationService;
  let stored: AiConversation[];

  beforeEach(() => {
    stored = [];
    spyOn(AiEntityStore.prototype, 'list').and.callFake(async () => [...stored]);
    spyOn(AiEntityStore.prototype, 'put').and.callFake(async (e) => {
      stored = [...stored.filter((c) => c.id !== e.id), e as AiConversation];
    });
    spyOn(AiEntityStore.prototype, 'delete').and.callFake(async (id) => {
      stored = stored.filter((c) => c.id !== id);
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiConversationService);
  });

  it('saves, updates and removes conversations', async () => {
    await service.save('c1', items, [{ role: 'user', content: 'Plan my day' }]);
    expect(service.conversations().length).toBe(1);
    const created = service.get('c1')!.created;

    await service.save('c1', items.slice(0, 1), []);
    expect(service.conversations().length).toBe(1);
    expect(service.get('c1')!.created).toBe(created);
    expect(service.get('c1')!.items.length).toBe(1);

    await service.remove('c1');
    expect(service.conversations()).toEqual([]);
  });

  it('does not store empty conversations', async () => {
    await service.save('empty', [], []);
    expect(stored).toEqual([]);
  });
});
