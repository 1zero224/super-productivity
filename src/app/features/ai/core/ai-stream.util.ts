import { AiChatResult, AiToolCall } from './ai-client.model';

interface ToolCallDelta {
  index?: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string | null; tool_calls?: ToolCallDelta[] };
    finish_reason?: string | null;
  }[];
}

/**
 * Accumulates OpenAI-style streamed chunks into one result. Tool calls arrive
 * as fragments keyed by `index`; the first fragment carries id + name, later
 * ones append to `arguments`.
 */
export class AiStreamAccumulator {
  private _content = '';
  private _finishReason: string | null = null;
  private readonly _toolCalls: AiToolCall[] = [];

  /** Returns the content delta of this chunk (empty string if none). */
  push(chunk: StreamChunk): string {
    const choice = chunk.choices?.[0];
    if (!choice) {
      return '';
    }
    if (choice.finish_reason) {
      this._finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (!delta) {
      return '';
    }
    for (const tcDelta of delta.tool_calls || []) {
      const index = tcDelta.index ?? this._toolCalls.length;
      let tc = this._toolCalls[index];
      if (!tc) {
        tc = {
          id: tcDelta.id || `call_${index}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        this._toolCalls[index] = tc;
      }
      if (tcDelta.id) {
        tc.id = tcDelta.id;
      }
      if (tcDelta.function?.name) {
        tc.function.name += tcDelta.function.name;
      }
      if (tcDelta.function?.arguments) {
        tc.function.arguments += tcDelta.function.arguments;
      }
    }
    const text = delta.content || '';
    this._content += text;
    return text;
  }

  result(): AiChatResult {
    return {
      content: this._content,
      toolCalls: this._toolCalls.filter((tc) => !!tc && !!tc.function.name),
      finishReason: this._finishReason,
    };
  }
}

/**
 * Splits an SSE byte stream into `data:` payloads. Yields raw payload strings,
 * stops at `[DONE]`.
 */
export async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          return;
        }
        if (data) {
          yield data;
        }
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) {
      const data = rest.slice(5).trim();
      if (data && data !== '[DONE]') {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extracts a JSON object from model output: plain JSON, a ```json fenced
 * block, or the outermost {...} span.
 */
export const extractJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidates.push(fenced[1].trim());
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next candidate
    }
  }
  throw new Error('AI response did not contain valid JSON');
};
