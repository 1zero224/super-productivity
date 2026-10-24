import { AiToolCall } from '../core/ai-client.model';

export type AiToolKind = 'read' | 'write';

export interface AiAgentTool {
  name: string;
  description: string;
  // JSON schema of the arguments object
  parameters: Record<string, unknown>;
  // `write` tools need user confirmation before they run
  kind: AiToolKind;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export type AiAgentEvent =
  | { type: 'assistant_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'assistant_end'; content: string }
  | {
      type: 'tool_call';
      call: AiToolCall;
      args: Record<string, unknown>;
      kind: AiToolKind;
    }
  | { type: 'tool_result'; callId: string; result: unknown; isError: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AiToolConfirmRequest {
  call: AiToolCall;
  tool: AiAgentTool;
  args: Record<string, unknown>;
}
