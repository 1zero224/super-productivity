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

export interface AiAutomationSettings {
  isDailyEnabled: boolean;
  // Local time "HH:mm"
  dailyTime: string;
  // End-of-day review
  isEveningEnabled: boolean;
  eveningTime: string;
  isWeeklyEnabled: boolean;
  // 0 = Sunday … 6 = Saturday
  weeklyDay: number;
  weeklyTime: string;
  // Open the AI panel when a scheduled report is ready
  isAutoOpen: boolean;
  // Give newly created tasks a quadrant tag automatically
  isAutoQuadrant: boolean;
}

export interface AiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  automation: AiAutomationSettings;
}

export const DEFAULT_AI_AUTOMATION_SETTINGS: AiAutomationSettings = {
  isDailyEnabled: true,
  dailyTime: '08:30',
  isEveningEnabled: true,
  eveningTime: '21:30',
  isWeeklyEnabled: true,
  weeklyDay: 0,
  weeklyTime: '20:00',
  isAutoOpen: true,
  isAutoQuadrant: true,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  automation: DEFAULT_AI_AUTOMATION_SETTINGS,
};
