export type AiReportType = 'daily' | 'weekly';

export type AiSuggestionTool = 'set_quadrant' | 'add_to_today' | 'schedule_task';
export const AI_SUGGESTION_TOOLS: AiSuggestionTool[] = [
  'set_quadrant',
  'add_to_today',
  'schedule_task',
];

export type AiSuggestionState = 'open' | 'applied' | 'failed';

/** One proposed task change; applied only after the user ticks and confirms it. */
export interface AiSuggestion {
  uid: string;
  tool: AiSuggestionTool;
  args: Record<string, unknown>;
  // Task title at generation time, for display only
  taskTitle: string;
  reason: string;
  state: AiSuggestionState;
  error?: string;
}

/** A generated daily / weekly report. Local-only (sup-ai IndexedDB). */
export interface AiReport {
  id: string;
  type: AiReportType;
  // daily: the logical day; weekly: the last day of the covered 7 days
  periodKey: string;
  created: number;
  markdown: string;
  suggestions: AiSuggestion[];
  // Conclusions written to long-term memory (weekly only)
  memoryIds: string[];
  isRead: boolean;
}
