import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MarkdownComponent } from 'ngx-markdown';
import { T } from '../../../t.const';
import { AiPanelStateService, AiChatItem } from '../ai-panel-state.service';
import { AiSettingsService } from '../core/ai-settings.service';
import { AiContextService } from '../context/ai-context.service';
import { AiBreakdownCardComponent } from './ai-breakdown-card/ai-breakdown-card.component';
import { AiSettingsFormComponent } from './ai-settings-form/ai-settings-form.component';
import { LayoutService } from '../../../core-ui/layout/layout.service';

type AiToolItem = Extract<AiChatItem, { kind: 'tool' }>;
type AiChatViewItem =
  | Exclude<AiChatItem, { kind: 'tool' }>
  | (AiToolItem & { argLines: string[] });

export const summarizeToolArgs = (item: Pick<AiToolItem, 'name' | 'args'>): string[] => {
  const args = item.args;
  if (item.name === 'create_subtasks' && Array.isArray(args.subtasks)) {
    return (args.subtasks as { title?: string; estimateMinutes?: number }[]).map(
      (s) => `${s?.title ?? ''}${s?.estimateMinutes ? ` (${s.estimateMinutes}m)` : ''}`,
    );
  }
  return Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
};

@Component({
  selector: 'ai-panel',
  imports: [
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    MarkdownComponent,
    AiBreakdownCardComponent,
    AiSettingsFormComponent,
  ],
  templateUrl: './ai-panel.component.html',
  styleUrl: './ai-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPanelComponent implements OnInit {
  readonly state = inject(AiPanelStateService);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _context = inject(AiContextService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _injector = inject(Injector);
  private readonly _translateService = inject(TranslateService);

  protected readonly T = T;
  readonly chips = this._context.chips;
  readonly isConfigured = this._settingsService.isConfigured;
  readonly isSettingsOpen = signal(false);
  readonly isShowSettings = computed(() => this.isSettingsOpen() || !this.isConfigured());
  readonly draft = signal('');

  // Pre-rendered argument lines so the template stays free of function calls
  readonly chatView = computed<AiChatViewItem[]>(() =>
    this.state
      .chatItems()
      .map((it) =>
        it.kind === 'tool' ? { ...it, argLines: summarizeToolArgs(it) } : it,
      ),
  );

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

  ngOnInit(): void {
    this._settingsService.load();
  }

  close(): void {
    this._layoutService.hideAiPanel();
  }

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

  askSuggestion(translationKey: string): void {
    this.draft.set(this._translateService.instant(translationKey));
    this.send();
  }
}
