import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { T } from '../../../../t.const';
import { AiPanelStateService } from '../../ai-panel-state.service';
import { AiChatItem } from '../../ai-chat.model';
import { AiSettingsService } from '../../core/ai-settings.service';
import { resolveProvider } from '../../core/ai-client.model';
import { MatOption, MatSelect } from '@angular/material/select';

type AiToolItem = Extract<AiChatItem, { kind: 'tool' }>;
type AiToolViewItem = AiToolItem & { argLines: string[] };
export interface AiToolGroupViewItem {
  id: string;
  kind: 'toolGroup';
  tools: AiToolViewItem[];
  // e.g. "get_task ×16 · update_task"
  summary: string;
  status: 'running' | 'done' | 'error';
  // Needs the user (approval) or shows a failure, so it never hides
  isForcedOpen: boolean;
}
type AiChatViewItem =
  | Exclude<AiChatItem, { kind: 'tool' }>
  | AiToolViewItem
  | AiToolGroupViewItem;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const summarizeToolArgs = (item: Pick<AiToolItem, 'name' | 'args'>): string[] => {
  const args = item.args;
  if (item.name === 'create_subtasks' && Array.isArray(args.subtasks)) {
    return (args.subtasks as { title?: string; estimateMinutes?: number }[]).map(
      (s) => `${s?.title ?? ''}${s?.estimateMinutes ? ` (${s.estimateMinutes}m)` : ''}`,
    );
  }
  if (item.name === 'schedule_task') {
    return [`id: ${args.id}`, `→ ${args.day ?? ''}${args.time ? ` ${args.time}` : ''}`];
  }
  if (item.name === 'create_repeat_task') {
    const days = Array.isArray(args.weekdays)
      ? ` (${(args.weekdays as number[]).map((d) => WEEKDAY_NAMES[d] ?? d).join(', ')})`
      : '';
    return [
      String(args.title ?? ''),
      `${args.repeatCycle ?? ''} ×${args.repeatEvery ?? 1}${days}` +
        (args.startTime ? ` @ ${args.startTime}` : ''),
    ];
  }
  return Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
};

const summarizeToolNames = (tools: AiToolItem[]): string => {
  const counts = new Map<string, number>();
  for (const t of tools) {
    counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  }
  return [...counts].map(([name, nr]) => (nr > 1 ? `${name} ×${nr}` : name)).join(' · ');
};

const toToolGroup = (tools: AiToolViewItem[]): AiToolGroupViewItem => {
  const isRunning = tools.some((t) => t.status === 'running' || t.status === 'pending');
  const isError = tools.some((t) => t.status === 'error');
  return {
    id: `group-${tools[0].id}`,
    kind: 'toolGroup',
    tools,
    summary: summarizeToolNames(tools),
    status: isRunning ? 'running' : isError ? 'error' : 'done',
    isForcedOpen: tools.some((t) => t.status === 'pending' || t.status === 'error'),
  };
};

/**
 * Folds every run of two or more consecutive tool calls into one collapsible
 * group, so an agent that reads 20 tasks shows one row instead of 20 cards.
 */
export const groupToolRuns = (items: AiChatItem[]): AiChatViewItem[] => {
  const out: AiChatViewItem[] = [];
  let run: AiToolViewItem[] = [];
  const flush = (): void => {
    if (run.length === 1) {
      out.push(run[0]);
    } else if (run.length > 1) {
      out.push(toToolGroup(run));
    }
    run = [];
  };
  for (const it of items) {
    if (it.kind === 'tool') {
      run.push({ ...it, argLines: summarizeToolArgs(it) });
    } else {
      flush();
      out.push(it);
    }
  }
  flush();
  return out;
};

/**
 * The agent chat (messages, tool confirmation cards, composer). Shared by the
 * right-side AI panel and the full AI page; both show the same conversation.
 * Content projected into it renders above the messages, inside the scroller.
 */
@Component({
  selector: 'ai-chat',
  imports: [
    NgTemplateOutlet,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MarkdownComponent,
    MatSelect,
    MatOption,
  ],
  templateUrl: './ai-chat.component.html',
  styleUrl: './ai-chat.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiChatComponent {
  readonly state = inject(AiPanelStateService);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _injector = inject(Injector);
  private readonly _translateService = inject(TranslateService);

  protected readonly T = T;
  readonly isConfigured = this._settingsService.isConfigured;
  readonly providers = this._settingsService.configuredProviders;
  // Shown on the "default" option: the provider the chat feature routes to
  readonly chatDefaultProvider = computed(() =>
    resolveProvider(this._settingsService.settings(), undefined, 'chat'),
  );
  readonly draft = signal('');

  // Pre-rendered argument lines and tool groups so the template stays free of
  // function calls
  readonly chatView = computed<AiChatViewItem[]>(() =>
    groupToolRuns(this.state.chatItems()),
  );
  // Rewinding to the last item would change nothing
  readonly lastItemId = computed(() => this.state.chatItems().at(-1)?.id);
  // Tool groups the user opened; collapsed is the default
  readonly openToolGroups = signal<ReadonlySet<string>>(new Set());

  private readonly _scrollEl = viewChild<ElementRef<HTMLElement>>('scrollEl');

  private readonly _autoScroll = effect(() => {
    this.state.chatItems();
    afterNextRender(
      () => {
        const el = this._scrollEl()?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      },
      { injector: this._injector },
    );
  });

  onDraftInput(ev: Event): void {
    this.draft.set((ev.target as HTMLTextAreaElement).value);
  }

  onDraftKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      this.send();
    }
  }

  send(): void {
    const text = this.draft().trim();
    if (!text || !this.isConfigured()) {
      return;
    }
    this.draft.set('');
    this.state.sendChat(text);
  }

  toggleToolGroup(id: string): void {
    this.openToolGroups.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  askSuggestion(translationKey: string): void {
    this.draft.set(this._translateService.instant(translationKey));
    this.send();
  }
}
