import { inject, Injectable, signal } from '@angular/core';
import { nanoid } from 'nanoid';
import { AiClientService, AiRequestError } from './core/ai-client.service';
import { AiTaskToolsService } from './tools/ai-task-tools.service';
import { AiContextService } from './context/ai-context.service';
import { extractJsonObject } from './core/ai-stream.util';
import { AiAgent } from './agent/ai-agent';
import { AiAgentEvent, AiToolConfirmRequest } from './agent/ai-agent.model';
import {
  AI_ASSISTANT_SYSTEM_PROMPT,
  AI_MICRO_HABIT_BREAKDOWN_PROMPT,
} from './prompts/ai-prompts.const';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { AiMessage } from './core/ai-client.model';

const AiLog = Log.withContext('ai');
const MAX_DRAFT_ITEMS = 12;

export interface AiDraftSubtask {
  uid: string;
  title: string;
  estimateMinutes: number | null;
}

export interface AiBreakdownState {
  taskId: string;
  taskTitle: string;
  status: 'loading' | 'ready' | 'error';
  items: AiDraftSubtask[];
  error?: string;
}

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

export const parseBreakdownResponse = (text: string): AiDraftSubtask[] => {
  const json = extractJsonObject(text) as { subtasks?: unknown };
  const list = Array.isArray(json?.subtasks) ? json.subtasks : [];
  return list
    .map((raw) => {
      const item = (raw || {}) as { title?: unknown; estimateMinutes?: unknown };
      const est = Number(item.estimateMinutes);
      return {
        uid: nanoid(),
        title: typeof item.title === 'string' ? item.title.trim() : '',
        estimateMinutes: Number.isFinite(est) && est > 0 ? Math.round(est) : null,
      };
    })
    .filter((it) => !!it.title)
    .slice(0, MAX_DRAFT_ITEMS);
};

/**
 * Session state of the AI side panel: the micro-habit breakdown draft and the
 * agent chat share one context (focus task, page, today list).
 */
@Injectable({ providedIn: 'root' })
export class AiPanelStateService {
  private readonly _client = inject(AiClientService);
  private readonly _tools = inject(AiTaskToolsService);
  private readonly _context = inject(AiContextService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _snackService = inject(SnackService);

  readonly breakdown = signal<AiBreakdownState | null>(null);
  readonly chatItems = signal<AiChatItem[]>([]);
  readonly isChatRunning = signal(false);
  readonly isAdopting = signal(false);

  private _breakdownAbort: AbortController | null = null;
  private readonly _pendingConfirms = new Map<string, (isOk: boolean) => void>();
  private _streamingItemId: string | null = null;

  private readonly _agent = new AiAgent({
    chat: (req) => this._client.chat(req),
    getSystemPrompt: () =>
      `${AI_ASSISTANT_SYSTEM_PROMPT}\n\n## Current context\n${this._context.buildContextBlock(
        this.breakdown()?.taskId,
      )}`,
    tools: this._tools.buildAgentTools(),
    confirm: (req) => this._requestConfirm(req),
    onEvent: (ev) => this._onAgentEvent(ev),
  });

  // ---------- panel ----------

  open(): void {
    this._layoutService.showAiPanel();
  }

  // ---------- breakdown ----------

  async startBreakdown(taskId: string): Promise<void> {
    this.open();
    await this.generateBreakdown(taskId);
  }

  async generateBreakdown(taskId: string, extraInstruction?: string): Promise<void> {
    const detail = await this._tools.getTaskWithSubtasks(taskId);
    if (!detail) {
      return;
    }
    this._breakdownAbort?.abort();
    const ctrl = new AbortController();
    this._breakdownAbort = ctrl;
    this.breakdown.set({
      taskId,
      taskTitle: detail.title,
      status: 'loading',
      items: this.breakdown()?.taskId === taskId ? this.breakdown()!.items : [],
    });

    const userContent = JSON.stringify({
      task: {
        title: detail.title,
        notes: detail.notes,
        estimateMinutes: detail.estimateMinutes,
        project: detail.project,
      },
      existingSubtasks: detail.subTasks.map((s) => s.title),
      ...(extraInstruction ? { extraInstruction } : {}),
    });
    const messages: AiMessage[] = [
      { role: 'system', content: AI_MICRO_HABIT_BREAKDOWN_PROMPT },
      { role: 'user', content: userContent },
    ];

    try {
      let content: string;
      try {
        content = (
          await this._client.chat({
            messages,
            isJsonResponse: true,
            temperature: 0.4,
            signal: ctrl.signal,
          })
        ).content;
      } catch (e) {
        // Some OpenAI-compatible providers reject response_format; retry plain.
        if (e instanceof AiRequestError && e.status === 400) {
          content = (
            await this._client.chat({ messages, temperature: 0.4, signal: ctrl.signal })
          ).content;
        } else {
          throw e;
        }
      }
      const items = parseBreakdownResponse(content);
      if (!items.length) {
        throw new Error('The AI returned no subtasks');
      }
      if (this._breakdownAbort === ctrl) {
        this.breakdown.set({ taskId, taskTitle: detail.title, status: 'ready', items });
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        return;
      }
      AiLog.err('Breakdown failed', { taskId, status: (e as AiRequestError).status });
      this.breakdown.update((s) =>
        s ? { ...s, status: 'error', error: (e as Error).message } : s,
      );
    } finally {
      if (this._breakdownAbort === ctrl) {
        this._breakdownAbort = null;
      }
    }
  }

  updateDraftItem(uid: string, changes: Partial<Omit<AiDraftSubtask, 'uid'>>): void {
    this.breakdown.update((s) =>
      s
        ? {
            ...s,
            items: s.items.map((it) => (it.uid === uid ? { ...it, ...changes } : it)),
          }
        : s,
    );
  }

  removeDraftItem(uid: string): void {
    this.breakdown.update((s) =>
      s ? { ...s, items: s.items.filter((it) => it.uid !== uid) } : s,
    );
  }

  addDraftItem(): void {
    this.breakdown.update((s) =>
      s
        ? {
            ...s,
            items: [...s.items, { uid: nanoid(), title: '', estimateMinutes: null }],
          }
        : s,
    );
  }

  moveDraftItem(fromIndex: number, toIndex: number): void {
    this.breakdown.update((s) => {
      if (!s) return s;
      const items = [...s.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { ...s, items };
    });
  }

  discardBreakdown(): void {
    this._breakdownAbort?.abort();
    this.breakdown.set(null);
  }

  async adoptBreakdown(): Promise<void> {
    const state = this.breakdown();
    if (!state || state.status !== 'ready' || this.isAdopting()) {
      return;
    }
    const items = state.items.filter((it) => it.title.trim());
    if (!items.length) {
      return;
    }
    this.isAdopting.set(true);
    try {
      const ids = await this._tools.createSubtasks(
        state.taskId,
        items.map((it) => ({
          title: it.title,
          estimateMinutes: it.estimateMinutes ?? undefined,
        })),
      );
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.AI.S.SUBTASKS_ADDED,
        translateParams: { nr: ids.length },
      });
      this.breakdown.set(null);
    } catch (e) {
      this._snackService.open({ type: 'ERROR', msg: (e as Error).message });
    } finally {
      this.isAdopting.set(false);
    }
  }

  // ---------- chat ----------

  async sendChat(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    this._pushItem({ id: nanoid(), kind: 'user', text: trimmed });
    this.isChatRunning.set(true);
    await this._agent.prompt(trimmed);
  }

  abortChat(): void {
    this._agent.abort();
    for (const resolve of this._pendingConfirms.values()) {
      resolve(false);
    }
    this._pendingConfirms.clear();
  }

  resetChat(): void {
    this.abortChat();
    this._agent.reset();
    this.chatItems.set([]);
  }

  resolveToolCall(callId: string, isApproved: boolean): void {
    const resolve = this._pendingConfirms.get(callId);
    if (!resolve) {
      return;
    }
    this._pendingConfirms.delete(callId);
    this._updateToolItem(callId, { status: isApproved ? 'running' : 'rejected' });
    resolve(isApproved);
  }

  private _requestConfirm(req: AiToolConfirmRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._pendingConfirms.set(req.call.id, resolve);
    });
  }

  private _onAgentEvent(ev: AiAgentEvent): void {
    switch (ev.type) {
      case 'assistant_start': {
        const id = nanoid();
        this._streamingItemId = id;
        this._pushItem({ id, kind: 'assistant', text: '', isStreaming: true });
        break;
      }
      case 'text_delta':
        this._updateStreaming((it) => ({ ...it, text: it.text + ev.delta }));
        break;
      case 'assistant_end': {
        const id = this._streamingItemId;
        this._updateStreaming((it) => ({ ...it, isStreaming: false }));
        // Drop empty bubbles of turns that only issued tool calls
        if (id && !ev.content.trim()) {
          this.chatItems.update((items) => items.filter((it) => it.id !== id));
        }
        this._streamingItemId = null;
        break;
      }
      case 'tool_call':
        this._pushItem({
          id: nanoid(),
          kind: 'tool',
          callId: ev.call.id,
          name: ev.call.function.name,
          args: ev.args,
          isWrite: ev.kind === 'write',
          status: ev.kind === 'write' ? 'pending' : 'running',
        });
        break;
      case 'tool_result': {
        const existing = this.chatItems().find(
          (it) => it.kind === 'tool' && it.callId === ev.callId,
        );
        if (existing && existing.kind === 'tool' && existing.status === 'rejected') {
          break;
        }
        this._updateToolItem(ev.callId, {
          status: ev.isError ? 'error' : 'done',
          resultText: JSON.stringify(ev.result).slice(0, 500),
        });
        break;
      }
      case 'error':
        this._updateStreaming((it) => ({ ...it, isStreaming: false }));
        this._pushItem({ id: nanoid(), kind: 'error', text: ev.message });
        break;
      case 'done':
        this._streamingItemId = null;
        this.isChatRunning.set(false);
        break;
    }
  }

  private _pushItem(item: AiChatItem): void {
    this.chatItems.update((items) => [...items, item]);
  }

  private _updateStreaming(
    fn: (it: Extract<AiChatItem, { kind: 'assistant' }>) => AiChatItem,
  ): void {
    const id = this._streamingItemId;
    if (!id) {
      return;
    }
    this.chatItems.update((items) =>
      items.map((it) => (it.id === id && it.kind === 'assistant' ? fn(it) : it)),
    );
  }

  private _updateToolItem(
    callId: string,
    changes: Partial<Extract<AiChatItem, { kind: 'tool' }>>,
  ): void {
    this.chatItems.update((items) =>
      items.map((it) =>
        it.kind === 'tool' && it.callId === callId ? { ...it, ...changes } : it,
      ),
    );
  }
}
