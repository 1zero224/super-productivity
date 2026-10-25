import { Injectable, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { AiEntityStore } from '../core/ai-db';
import { wrapUntrusted } from '../core/ai-untrusted.util';
import { Log } from '../../../core/log';

export type AiMemoryKind = 'preference' | 'habit' | 'review' | 'fact';
export type AiMemorySource = 'chat' | 'weekly' | 'user';

export const AI_MEMORY_KINDS: AiMemoryKind[] = ['preference', 'habit', 'review', 'fact'];

/** A long-term memory entry. Local-only (sup-ai IndexedDB), never synced. */
export interface AiMemory {
  id: string;
  text: string;
  kind: AiMemoryKind;
  source: AiMemorySource;
  created: number;
  lastUsed: number;
}

const AiLog = Log.withContext('ai');
const MAX_MEMORY_CHARS = 500;
const MAX_MEMORIES = 300;
export const DEFAULT_RECALL_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENCY_WINDOW_DAYS = 30;
const KIND_WEIGHT: Record<AiMemoryKind, number> = {
  preference: 1,
  habit: 1,
  review: 0.5,
  fact: 0,
};

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;

/** Latin words (>= 2 chars) plus CJK character bigrams. */
export const tokenizeForRecall = (text: string): Set<string> => {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    if (CJK_RE.test(word)) {
      const chars = [...word].filter((c) => CJK_RE.test(c));
      if (chars.length === 1) tokens.add(chars[0]);
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.add(chars[i] + chars[i + 1]);
      }
    } else if (word.length >= 2) {
      tokens.add(word);
    }
  }
  return tokens;
};

/** Ranks memories by keyword overlap with `query`, then kind and recency. */
export const scoreMemories = (
  memories: AiMemory[],
  query: string,
  limit: number,
  now: number = Date.now(),
): AiMemory[] => {
  const queryTokens = tokenizeForRecall(query);
  return memories
    .map((m) => {
      let overlap = 0;
      for (const t of tokenizeForRecall(m.text)) {
        if (queryTokens.has(t)) overlap++;
      }
      const ageMs = now - Math.max(m.lastUsed, m.created);
      const ageRatio = ageMs / DAY_MS / RECENCY_WINDOW_DAYS;
      const recency = Math.max(0, 1 - ageRatio);
      const overlapScore = overlap * 3;
      return { m, score: overlapScore + KIND_WEIGHT[m.kind] + recency };
    })
    .sort((a, b) => b.score - a.score || b.m.created - a.m.created)
    .slice(0, Math.max(0, limit))
    .map((x) => x.m);
};

const normalizeText = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_CHARS);

@Injectable({ providedIn: 'root' })
export class AiMemoryService {
  private readonly _store = new AiEntityStore<AiMemory>('memories');
  private readonly _memories = signal<AiMemory[]>([]);
  private _loadPromise?: Promise<void>;

  readonly memories = this._memories.asReadonly();

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._store
        .list()
        .then((list) => this._memories.set(list.sort((a, b) => b.created - a.created)))
        .catch((e) => {
          AiLog.err('AiMemoryService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  /** Stores a memory; an identical text only refreshes the existing entry. */
  async remember(
    text: string,
    kind: AiMemoryKind = 'fact',
    source: AiMemorySource = 'chat',
  ): Promise<AiMemory> {
    await this.load();
    const cleaned = normalizeText(text);
    if (!cleaned) {
      throw new Error('Memory text is empty');
    }
    const now = Date.now();
    const existing = this._memories().find(
      (m) => m.text.toLowerCase() === cleaned.toLowerCase(),
    );
    const memory: AiMemory = existing
      ? { ...existing, kind, lastUsed: now }
      : { id: nanoid(), text: cleaned, kind, source, created: now, lastUsed: now };
    await this._store.put(memory);
    this._memories.update((list) => [memory, ...list.filter((m) => m.id !== memory.id)]);
    await this._prune();
    return memory;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    await this._store.delete(id);
    this._memories.update((list) => list.filter((m) => m.id !== id));
  }

  recall(query: string, limit = DEFAULT_RECALL_LIMIT): AiMemory[] {
    return scoreMemories(this._memories(), query, limit);
  }

  /** Model-facing block with the most relevant memories for `query`. */
  buildMemoryBlock(query: string, limit = DEFAULT_RECALL_LIMIT): string {
    const list = this.recall(query, limit);
    if (!list.length) {
      return 'Memory: empty';
    }
    return [
      'Long-term memory about the user (most relevant first):',
      ...list.map((m) => `- id=${m.id} [${m.kind}] ${wrapUntrusted(m.text)}`),
    ].join('\n');
  }

  private async _prune(): Promise<void> {
    const list = this._memories();
    if (list.length <= MAX_MEMORIES) {
      return;
    }
    const dropped = [...list]
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, list.length - MAX_MEMORIES);
    for (const m of dropped) {
      await this._store.delete(m.id);
    }
    const droppedIds = new Set(dropped.map((m) => m.id));
    this._memories.update((l) => l.filter((m) => !droppedIds.has(m.id)));
  }
}
