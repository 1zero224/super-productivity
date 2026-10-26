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
  // Explicit provider (e.g. picked in the chat); wins over the feature routing
  providerId?: string;
  // Which feature asks; selects the provider configured for it
  feature?: AiFeature;
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

// chat = /chat/completions (OpenAI-compatible), responses = OpenAI Responses API
export type AiApiType = 'chat' | 'responses';

export interface AiProvider {
  id: string;
  name: string;
  apiType: AiApiType;
  baseUrl: string;
  model: string;
  // Optional for local endpoints such as Ollama
  apiKey: string;
}

export type AiFeature =
  | 'chat'
  | 'breakdown'
  | 'daily'
  | 'evening'
  | 'weekly'
  | 'classify';
export const AI_FEATURES: AiFeature[] = [
  'chat',
  'breakdown',
  'daily',
  'evening',
  'weekly',
  'classify',
];

export interface AiSettings {
  providers: AiProvider[];
  defaultProviderId: string;
  // Missing entry = default provider
  featureProviders: Partial<Record<AiFeature, string>>;
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

export const DEFAULT_AI_PROVIDER: AiProvider = {
  id: 'default',
  name: 'OpenAI',
  apiType: 'chat',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  providers: [DEFAULT_AI_PROVIDER],
  defaultProviderId: DEFAULT_AI_PROVIDER.id,
  featureProviders: {},
  automation: DEFAULT_AI_AUTOMATION_SETTINGS,
};

const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

/** Needs an endpoint and a model, plus a key unless it is a local endpoint (Ollama…). */
export const isProviderConfigured = (p: AiProvider | undefined): boolean =>
  !!p &&
  !!p.baseUrl.trim() &&
  !!p.model.trim() &&
  (!!p.apiKey.trim() || LOCAL_HOST_RE.test(p.baseUrl.trim()));

/** Explicit provider → feature routing → default provider → first one. */
export const resolveProvider = (
  settings: AiSettings,
  providerId?: string,
  feature?: AiFeature,
): AiProvider | undefined => {
  const byId = (id?: string): AiProvider | undefined =>
    id ? settings.providers.find((p) => p.id === id) : undefined;
  return (
    byId(providerId) ??
    byId(feature && settings.featureProviders[feature]) ??
    byId(settings.defaultProviderId) ??
    settings.providers[0]
  );
};
