import { AiMessage } from './core/ai-client.model';

export type AiToolCallStatus = 'pending' | 'running' | 'done' | 'rejected' | 'error';

export type AiChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; isStreaming: boolean }
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
}
