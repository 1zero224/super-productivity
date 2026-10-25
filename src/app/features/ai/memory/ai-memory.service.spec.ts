import { TestBed } from '@angular/core/testing';
import {
  AiMemory,
  AiMemoryService,
  scoreMemories,
  tokenizeForRecall,
} from './ai-memory.service';
import { AiEntityStore } from '../core/ai-db';

const NOW = new Date(2026, 9, 25).getTime();
const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

const mem = (over: Partial<AiMemory>): AiMemory => ({
  id: 'm',
  text: '',
  kind: 'fact',
  source: 'chat',
  created: NOW - SIXTY_DAYS,
  lastUsed: NOW - SIXTY_DAYS,
  ...over,
});

describe('tokenizeForRecall', () => {
  it('splits latin words and CJK bigrams', () => {
    const tokens = tokenizeForRecall('Deep work 上午专注');
    expect(tokens.has('deep')).toBe(true);
    expect(tokens.has('work')).toBe(true);
    expect(tokens.has('上午')).toBe(true);
    expect(tokens.has('午专')).toBe(true);
    expect(tokens.has('专注')).toBe(true);
  });
});

describe('scoreMemories', () => {
  it('ranks keyword overlap above kind and recency', () => {
    const list = [
      mem({ id: 'recent-pref', text: 'Likes tea', kind: 'preference', lastUsed: NOW }),
      mem({ id: 'match', text: '上午适合写作' }),
    ];
    expect(scoreMemories(list, '今天上午写作', 2, NOW).map((m) => m.id)).toEqual([
      'match',
      'recent-pref',
    ]);
  });

  it('falls back to kind and recency without a query and respects the limit', () => {
    const list = [
      mem({ id: 'old-fact' }),
      mem({ id: 'habit', kind: 'habit' }),
      mem({ id: 'fresh-fact', lastUsed: NOW }),
    ];
    expect(scoreMemories(list, '', 2, NOW).map((m) => m.id)).toEqual([
      'habit',
      'fresh-fact',
    ]);
  });
});

describe('AiMemoryService', () => {
  let service: AiMemoryService;
  let stored: AiMemory[];

  beforeEach(() => {
    stored = [];
    spyOn(AiEntityStore.prototype, 'list').and.callFake(async () => [...stored]);
    spyOn(AiEntityStore.prototype, 'put').and.callFake(async (e) => {
      stored = [...stored.filter((m) => m.id !== e.id), e as AiMemory];
    });
    spyOn(AiEntityStore.prototype, 'delete').and.callFake(async (id) => {
      stored = stored.filter((m) => m.id !== id);
    });
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiMemoryService);
  });

  it('stores memories and de-duplicates identical text', async () => {
    const a = await service.remember('  Focus best   before noon ', 'habit');
    const b = await service.remember('focus best before noon', 'preference');
    expect(a.text).toBe('Focus best before noon');
    expect(b.id).toBe(a.id);
    expect(b.kind).toBe('preference');
    expect(service.memories().length).toBe(1);
  });

  it('rejects empty text and deletes entries', async () => {
    await expectAsync(service.remember('   ')).toBeRejected();
    const m = await service.remember('x y');
    await service.remove(m.id);
    expect(service.memories()).toEqual([]);
    expect(stored).toEqual([]);
  });

  it('builds a wrapped context block', async () => {
    await service.remember('Prefers short tasks', 'preference');
    const block = service.buildMemoryBlock('tasks');
    expect(block).toContain('[preference]');
    expect(block).toContain('<untrusted_user_content>Prefers short tasks');
  });
});
