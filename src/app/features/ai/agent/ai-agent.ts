import {
  AiChatRequest,
  AiChatResult,
  AiMessage,
  AiToolCall,
  AiToolDef,
} from '../core/ai-client.model';
import { AiAgentEvent, AiAgentTool, AiToolConfirmRequest } from './ai-agent.model';

export const DEFAULT_MAX_TURNS = 8;
const MAX_TOOL_RESULT_CHARS = 12_000;

export interface AiAgentCfg {
  chat: (req: AiChatRequest) => Promise<AiChatResult>;
  // Rebuilt on every turn so the model always sees fresh app state
  getSystemPrompt: () => string;
  tools: AiAgentTool[];
  // Resolves true when the user approves a write tool call
  confirm: (req: AiToolConfirmRequest) => Promise<boolean>;
  onEvent: (event: AiAgentEvent) => void;
  maxTurns?: number;
}

const parseArgs = (call: AiToolCall): Record<string, unknown> => {
  if (!call.function.arguments?.trim()) {
    return {};
  }
  const parsed = JSON.parse(call.function.arguments);
  return parsed && typeof parsed === 'object' ? parsed : {};
};

const stringifyResult = (result: unknown): string => {
  const str = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  return str.length > MAX_TOOL_RESULT_CHARS
    ? str.slice(0, MAX_TOOL_RESULT_CHARS) + '…[truncated]'
    : str;
};

/**
 * Minimal agent loop in the spirit of pi-agent: one transcript, a tool loop
 * (LLM → tool calls → results → LLM …) bounded by `maxTurns`, an event stream
 * for the UI, abort, and a steering queue for messages sent mid-run.
 */
export class AiAgent {
  readonly messages: AiMessage[] = [];
  private _abortCtrl: AbortController | null = null;
  private readonly _steeringQueue: string[] = [];

  constructor(private readonly _cfg: AiAgentCfg) {}

  get isRunning(): boolean {
    return !!this._abortCtrl;
  }

  /** Queue a user message; if idle it starts a run, else it joins the next turn. */
  async prompt(text: string): Promise<void> {
    if (this.isRunning) {
      this._steeringQueue.push(text);
      return;
    }
    this.messages.push({ role: 'user', content: text });
    await this._run();
  }

  abort(): void {
    this._abortCtrl?.abort();
  }

  reset(): void {
    this.abort();
    this.messages.length = 0;
    this._steeringQueue.length = 0;
  }

  /** Replaces the transcript, e.g. to continue a stored conversation. */
  load(messages: AiMessage[]): void {
    this.reset();
    this.messages.push(...messages);
  }

  private _toolDefs(): AiToolDef[] {
    return this._cfg.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  private async _run(): Promise<void> {
    const ctrl = new AbortController();
    this._abortCtrl = ctrl;
    const maxTurns = this._cfg.maxTurns ?? DEFAULT_MAX_TURNS;
    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        while (this._steeringQueue.length) {
          this.messages.push({ role: 'user', content: this._steeringQueue.shift()! });
        }

        this._cfg.onEvent({ type: 'assistant_start' });
        const result = await this._cfg.chat({
          messages: [
            { role: 'system', content: this._cfg.getSystemPrompt() },
            ...this.messages,
          ],
          tools: this._toolDefs(),
          signal: ctrl.signal,
          onTextDelta: (delta) => this._cfg.onEvent({ type: 'text_delta', delta }),
        });
        this.messages.push({
          role: 'assistant',
          content: result.content || null,
          ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
        });
        this._cfg.onEvent({ type: 'assistant_end', content: result.content });

        if (!result.toolCalls.length) {
          if (this._steeringQueue.length) {
            continue;
          }
          return;
        }

        for (const call of result.toolCalls) {
          if (ctrl.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: stringifyResult(await this._executeToolCall(call)),
          });
        }
      }
      this._cfg.onEvent({ type: 'error', message: 'Stopped: too many tool turns' });
    } catch (e) {
      if (ctrl.signal.aborted) {
        this._cfg.onEvent({ type: 'error', message: 'Aborted' });
      } else {
        this._cfg.onEvent({ type: 'error', message: (e as Error).message || String(e) });
      }
    } finally {
      this._abortCtrl = null;
      this._cfg.onEvent({ type: 'done' });
    }
  }

  private async _executeToolCall(call: AiToolCall): Promise<unknown> {
    const tool = this._cfg.tools.find((t) => t.name === call.function.name);
    if (!tool) {
      const result = { error: `Unknown tool: ${call.function.name}` };
      this._cfg.onEvent({ type: 'tool_result', callId: call.id, result, isError: true });
      return result;
    }

    let args: Record<string, unknown>;
    try {
      args = parseArgs(call);
    } catch {
      const result = { error: 'Arguments were not valid JSON' };
      this._cfg.onEvent({ type: 'tool_result', callId: call.id, result, isError: true });
      return result;
    }

    this._cfg.onEvent({ type: 'tool_call', call, args, kind: tool.kind });

    if (tool.kind === 'write') {
      const isApproved = await this._cfg.confirm({ call, tool, args });
      if (!isApproved) {
        const result = { error: 'The user rejected this action.' };
        this._cfg.onEvent({
          type: 'tool_result',
          callId: call.id,
          result,
          isError: true,
        });
        return result;
      }
    }

    try {
      const result = await tool.execute(args);
      this._cfg.onEvent({ type: 'tool_result', callId: call.id, result, isError: false });
      return result;
    } catch (e) {
      const result = { error: (e as Error).message || String(e) };
      this._cfg.onEvent({ type: 'tool_result', callId: call.id, result, isError: true });
      return result;
    }
  }
}
