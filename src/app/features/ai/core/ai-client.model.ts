// OpenAI-compatible chat completion wire types (subset we use).

export interface AiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    // JSON-encoded arguments, exactly as streamed by the model
    arguments: string;
  };
}

export type AiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: AiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiChatRequest {
  messages: AiMessage[];
  tools?: AiToolDef[];
  isJsonResponse?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  // When set, the request is streamed and every content chunk is passed here.
  onTextDelta?: (delta: string) => void;
}

export interface AiChatResult {
  content: string;
  toolCalls: AiToolCall[];
  finishReason: string | null;
}

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
};
