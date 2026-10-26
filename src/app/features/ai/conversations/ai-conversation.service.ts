import { computed, Injectable, signal } from '@angular/core';
import { AiEntityStore } from '../core/ai-db';
import { AiChatItem, AiConversation } from '../ai-chat.model';
import { AiMessage } from '../core/ai-client.model';
import { Log } from '../../../core/log';

const AiLog = Log.withContext('ai');
const MAX_TITLE_CHARS = 60;
const MAX_CONVERSATIONS = 200;

export const conversationTitle = (items: AiChatItem[]): string => {
  const first = items.find((it) => it.kind === 'user');
  const text =
    first && first.kind === 'user' ? first.text.replace(/\s+/g, ' ').trim() : '';
  return text.length > MAX_TITLE_CHARS ? `${text.slice(0, MAX_TITLE_CHARS)}…` : text;
};

/** Makes items safe to persist: nothing can still be streaming or waiting. */
export const settleChatItems = (items: AiChatItem[]): AiChatItem[] =>
  items.map((it) => {
    if (it.kind === 'assistant' && it.isStreaming) {
      return { ...it, isStreaming: false };
    }
    if (it.kind === 'tool' && (it.status === 'pending' || it.status === 'running')) {
      return { ...it, status: 'rejected' };
    }
    return it;
  });

@Injectable({ providedIn: 'root' })
export class AiConversationService {
  private readonly _db = new AiEntityStore<AiConversation>('conversations');
  private readonly _conversations = signal<AiConversation[]>([]);
  private _loadPromise?: Promise<void>;

  readonly conversations = computed(() =>
    [...this._conversations()].sort((a, b) => b.updated - a.updated),
  );

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._db
        .list()
        .then((list) => this._conversations.set(list))
        .catch((e) => {
          AiLog.err('AiConversationService: load failed', e);
          this._loadPromise = undefined;
        });
    }
    return this._loadPromise;
  }

  get(id: string): AiConversation | undefined {
    return this._conversations().find((c) => c.id === id);
  }

  async save(
    id: string,
    items: AiChatItem[],
    messages: AiMessage[],
    providerId: string | null = null,
  ): Promise<void> {
    await this.load();
    if (!items.length) {
      return;
    }
    const existing = this.get(id);
    const now = Date.now();
    const settled = settleChatItems(items);
    const conversation: AiConversation = {
      id,
      title: conversationTitle(settled) || existing?.title || '…',
      created: existing?.created ?? now,
      updated: now,
      items: settled,
      messages: [...messages],
      providerId,
    };
    await this._db.put(conversation);
    this._conversations.update((list) => [
      ...list.filter((c) => c.id !== id),
      conversation,
    ]);
    await this._prune();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    await this._db.delete(id);
    this._conversations.update((list) => list.filter((c) => c.id !== id));
  }

  private async _prune(): Promise<void> {
    const sorted = this.conversations();
    if (sorted.length <= MAX_CONVERSATIONS) {
      return;
    }
    const dropped = sorted.slice(MAX_CONVERSATIONS);
    for (const c of dropped) {
      await this._db.delete(c.id);
    }
    const droppedIds = new Set(dropped.map((c) => c.id));
    this._conversations.update((list) => list.filter((c) => !droppedIds.has(c.id)));
  }
}
