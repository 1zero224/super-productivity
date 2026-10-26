import { AiChatResult, AiMessage, AiToolCall, AiToolDef } from './ai-client.model';

/**
 * Adapter for the OpenAI Responses API (`POST /responses`). The rest of the
 * AI code keeps speaking the Chat Completions message format; this converts
 * requests and responses at the edge.
 */

export const buildResponsesUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
};

type ResponsesInputItem =
  | { role: 'user' | 'assistant'; content: string }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export interface ResponsesInput {
  instructions?: string;
  input: ResponsesInputItem[];
}

/** System messages become `instructions`; tool calls / results become items. */
export const toResponsesInput = (messages: AiMessage[]): ResponsesInput => {
  const instructions: string[] = [];
  const input: ResponsesInputItem[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        instructions.push(m.content);
        break;
      case 'user':
        input.push({ role: 'user', content: m.content });
        break;
      case 'assistant':
        if (m.content) {
          input.push({ role: 'assistant', content: m.content });
        }
        for (const call of m.tool_calls ?? []) {
          input.push({
            type: 'function_call',
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments || '{}',
          });
        }
        break;
      case 'tool':
        input.push({
          type: 'function_call_output',
          call_id: m.tool_call_id,
          output: m.content,
        });
        break;
    }
  }
  return {
    ...(instructions.length ? { instructions: instructions.join('\n\n') } : {}),
    input,
  };
};

/** Responses tools are flat: no nested `function` object. */
export const toResponsesTools = (
  tools: AiToolDef[],
): { type: 'function'; name: string; description: string; parameters: unknown }[] =>
  tools.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));

interface ResponsesOutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
}

export interface ResponsesResponse {
  status?: string;
  output?: ResponsesOutputItem[];
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
}

/** Collects the text and function calls of a (final) response object. */
export const parseResponsesOutput = (res: ResponsesResponse): AiChatResult => {
  let content = '';
  const toolCalls: AiToolCall[] = [];
  for (const item of res.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') {
          content += part.text;
        }
      }
    } else if (item.type === 'function_call' && item.name) {
      toolCalls.push({
        id: item.call_id || item.id || `call_${toolCalls.length}`,
        type: 'function',
        function: { name: item.name, arguments: item.arguments || '' },
      });
    }
  }
  const finishReason =
    res.status === 'incomplete'
      ? res.incomplete_details?.reason || 'incomplete'
      : toolCalls.length
        ? 'tool_calls'
        : res.status === 'completed'
          ? 'stop'
          : (res.status ?? null);
  return { content, toolCalls, finishReason };
};

export interface ResponsesStreamEvent {
  type?: string;
  delta?: string;
  item?: ResponsesOutputItem;
  response?: ResponsesResponse;
  message?: string;
}

/**
 * Consumes Responses SSE events: forwards text deltas and uses the final
 * `response.completed` payload as the source of truth; finished output items
 * are the fallback when a provider never sends it.
 */
export class ResponsesStreamAccumulator {
  private _text = '';
  private readonly _doneItems: ResponsesOutputItem[] = [];
  private _final: ResponsesResponse | null = null;

  /** Returns the text delta of this event, if any. Throws on error events. */
  push(ev: ResponsesStreamEvent): string {
    switch (ev.type) {
      case 'response.output_text.delta':
        if (typeof ev.delta === 'string') {
          this._text += ev.delta;
          return ev.delta;
        }
        return '';
      case 'response.output_item.done':
        if (ev.item) this._doneItems.push(ev.item);
        return '';
      case 'response.completed':
      case 'response.incomplete':
        this._final = ev.response ?? null;
        return '';
      case 'response.failed':
        throw new Error(ev.response?.error?.message || 'AI response failed');
      case 'error':
        throw new Error(ev.message || 'AI response failed');
      default:
        return '';
    }
  }

  result(): AiChatResult {
    if (this._final?.output) {
      return parseResponsesOutput(this._final);
    }
    const fromItems = parseResponsesOutput({
      status: 'completed',
      output: this._doneItems,
    });
    return { ...fromItems, content: fromItems.content || this._text };
  }
}
