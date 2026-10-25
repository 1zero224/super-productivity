// daily = morning recommendation, evening = end-of-day review,
// classify = one-click quadrant fill for tasks without a quadrant tag
export type AiReportType = 'daily' | 'evening' | 'weekly' | 'classify';

export type AiSuggestionTool =
  | 'set_quadrant'
  | 'add_to_today'
  | 'schedule_task'
  | 'create_task'
  | 'create_goal';
export const AI_TASK_SUGGESTION_TOOLS: AiSuggestionTool[] = [
  'set_quadrant',
  'add_to_today',
  'schedule_task',
];
// Only the weekly review may propose new tasks / short-term goals
export const AI_CREATE_SUGGESTION_TOOLS: AiSuggestionTool[] = [
  'create_task',
  'create_goal',
];

export type AiSuggestionState = 'open' | 'applied' | 'failed';

/** One proposed task change; applied only after the user ticks and confirms it. */
export interface AiSuggestion {
  uid: string;
  tool: AiSuggestionTool;
  args: Record<string, unknown>;
  // Task (or new task / goal) title at generation time, for display only
  taskTitle: string;
  // Extra display info, e.g. the quadrant and goal of a task to create
  detail?: string;
  reason: string;
  state: AiSuggestionState;
  error?: string;
}

/** A generated daily / weekly report. Local-only (sup-ai IndexedDB). */
export interface AiReport {
  id: string;
  type: AiReportType;
  // daily / evening: the logical day; weekly: the last day of the covered 7 days
  periodKey: string;
  created: number;
  markdown: string;
  suggestions: AiSuggestion[];
  // Conclusions written to long-term memory (weekly only)
  memoryIds: string[];
  isRead: boolean;
}
