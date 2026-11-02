import { AiMessage } from './core/ai-client.model';

export type AiToolCallStatus = 'pending' | 'running' | 'done' | 'rejected' | 'error';

export type AiChatItem =
  | { id: string; kind: 'user'; text: string }
  | {
      id: string;
      kind: 'assistant';
      text: string;
      isStreaming: boolean;
      // Transcript length right after this answer. Only set on final answers
      // (no tool calls): the points a chat can be rewound to or branched from.
      msgCount?: number;
    }
  | {
      id: string;
      kind: 'tool';
      callId: string;
      name: string;
      args: Record<string, unknown>;
      isWrite: boolean;
      status: AiToolCallStatus;
      resultText?: string;
    }
  | { id: string; kind: 'error'; text: string };

/** A persisted chat. Local-only (sup-ai IndexedDB), never synced. */
export interface AiConversation {
  id: string;
  title: string;
  created: number;
  updated: number;
  // What the UI shows
  items: AiChatItem[];
  // The agent transcript, so a conversation can be continued
  messages: AiMessage[];
  // Provider picked for this chat; missing = the chat feature's provider
  providerId?: string | null;
  // The conversation this one was branched off
  branchOf?: string | null;
}

export interface AiChatMarkdownLabels {
  user: string;
  assistant: string;
}

/** The whole chat as markdown, for "copy conversation". */
export const chatToMarkdown = (
  items: AiChatItem[],
  labels: AiChatMarkdownLabels,
): string =>
  items
    .map((it) => {
      switch (it.kind) {
        case 'user':
          return `**${labels.user}:**\n\n${it.text}`;
        case 'assistant':
          return it.text.trim() ? `**${labels.assistant}:**\n\n${it.text.trim()}` : '';
        case 'tool':
          return `> \`${it.name}\` (${it.status})`;
        case 'error':
          return `> ⚠ ${it.text}`;
      }
    })
    .filter((part) => !!part)
    .join('\n\n');

/**
 * Cuts a chat right after a final answer. Returns null when the item is not a
 * cut point (not a final answer, or stored before cut points existed).
 */
export const cutChatAt = (
  items: AiChatItem[],
  messages: AiMessage[],
  itemId: string,
): { items: AiChatItem[]; messages: AiMessage[] } | null => {
  const idx = items.findIndex((it) => it.id === itemId);
  const item = items[idx];
  if (
    !item ||
    item.kind !== 'assistant' ||
    item.msgCount === undefined ||
    item.msgCount > messages.length
  ) {
    return null;
  }
  return {
    items: items.slice(0, idx + 1),
    messages: messages.slice(0, item.msgCount),
  };
};
