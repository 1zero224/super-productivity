import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AiPanelStateService } from '../ai-panel-state.service';
import { AiConversationService } from '../conversations/ai-conversation.service';
import { AiSettingsService } from '../core/ai-settings.service';
import { AiReportService } from '../reports/ai-report.service';
import { AiChatComponent } from '../panel/ai-chat/ai-chat.component';
import { AiBreakdownCardComponent } from '../panel/ai-breakdown-card/ai-breakdown-card.component';
import { AiReportsViewComponent } from '../reports/ai-reports-view/ai-reports-view.component';
import { AiMemoryListComponent } from '../memory/ai-memory-list/ai-memory-list.component';
import { AiSettingsFormComponent } from '../panel/ai-settings-form/ai-settings-form.component';
import { LayoutService } from '../../../core-ui/layout/layout.service';

type AiPageTab = 'chat' | 'reports' | 'memory' | 'settings';

const HISTORY_WIDTH_KEY = 'SUP_AI_PAGE_HISTORY_WIDTH';
const HISTORY_DEFAULT_WIDTH = 260;
const HISTORY_MIN_WIDTH = 180;
const HISTORY_MAX_WIDTH = 520;
const HISTORY_KEY_STEP = 20;

const clampHistoryWidth = (w: number): number =>
  Math.round(Math.min(HISTORY_MAX_WIDTH, Math.max(HISTORY_MIN_WIDTH, w)));

// A per-device layout preference, so plain localStorage is enough
const loadHistoryWidth = (): number => {
  try {
    const stored = Number(localStorage.getItem(HISTORY_WIDTH_KEY));
    return stored ? clampHistoryWidth(stored) : HISTORY_DEFAULT_WIDTH;
  } catch {
    return HISTORY_DEFAULT_WIDTH;
  }
};

/**
 * Full-page AI assistant: conversation history, chat, reports with
 * suggestions, long-term memory and settings. Shares the current
 * conversation with the right-side AI panel.
 */
@Component({
  selector: 'ai-page',
  imports: [
    DatePipe,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    AiChatComponent,
    AiBreakdownCardComponent,
    AiReportsViewComponent,
    AiMemoryListComponent,
    AiSettingsFormComponent,
  ],
  templateUrl: './ai-page.component.html',
  styleUrl: './ai-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiPageComponent implements OnInit {
  readonly state = inject(AiPanelStateService);
  readonly conversationService = inject(AiConversationService);
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _reportService = inject(AiReportService);
  private readonly _layoutService = inject(LayoutService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly T = T;
  protected readonly HISTORY_MIN_WIDTH = HISTORY_MIN_WIDTH;
  protected readonly HISTORY_MAX_WIDTH = HISTORY_MAX_WIDTH;
  readonly historyWidth = signal(loadHistoryWidth());
  readonly isResizing = signal(false);
  private _stopResize?: () => void;
  readonly isConfigured = this._settingsService.isConfigured;
  readonly unreadCount = this._reportService.unreadCount;
  readonly tab = signal<AiPageTab>('chat');
  readonly effectiveTab = computed<AiPageTab>(() =>
    this.isConfigured() ? this.tab() : 'settings',
  );
  readonly TABS: { id: AiPageTab; icon: string; label: string }[] = [
    { id: 'chat', icon: 'forum', label: T.F.AI.PAGE.TAB_CHAT },
    { id: 'reports', icon: 'tips_and_updates', label: T.F.AI.PAGE.TAB_REPORTS },
    { id: 'memory', icon: 'psychology', label: T.F.AI.PAGE.TAB_MEMORY },
    { id: 'settings', icon: 'tune', label: T.F.AI.SETTINGS.TITLE },
  ];

  constructor() {
    this._destroyRef.onDestroy(() => this._stopResize?.());
  }

  ngOnInit(): void {
    this._settingsService.load();
    this.conversationService.load();
    this._reportService.load();
    // The page replaces the side panel; both would show the same chat
    this._layoutService.hideAiPanel();
    if (this.state.panelView() === 'reports') {
      this.tab.set('reports');
      this.state.panelView.set('chat');
    }
  }

  newChat(): void {
    this.state.newConversation();
    this.tab.set('chat');
  }

  openConversation(id: string): void {
    this.state.openConversation(id);
    this.tab.set('chat');
  }

  deleteConversation(ev: Event, id: string): void {
    ev.stopPropagation();
    this.state.deleteConversation(id);
  }

  startResize(ev: PointerEvent): void {
    if (ev.button !== 0) {
      return;
    }
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = this.historyWidth();
    const onMove = (e: PointerEvent): void => {
      this.historyWidth.set(clampHistoryWidth(startWidth + e.clientX - startX));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      this._stopResize = undefined;
      this.isResizing.set(false);
      this._saveHistoryWidth();
    };
    this._stopResize?.();
    this._stopResize = stop;
    this.isResizing.set(true);
    // Keep the resize cursor and avoid selecting text while dragging fast
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  onResizeKeydown(ev: KeyboardEvent): void {
    const delta =
      ev.key === 'ArrowLeft'
        ? -HISTORY_KEY_STEP
        : ev.key === 'ArrowRight'
          ? HISTORY_KEY_STEP
          : 0;
    if (!delta) {
      return;
    }
    ev.preventDefault();
    this.historyWidth.set(clampHistoryWidth(this.historyWidth() + delta));
    this._saveHistoryWidth();
  }

  resetHistoryWidth(): void {
    this.historyWidth.set(HISTORY_DEFAULT_WIDTH);
    this._saveHistoryWidth();
  }

  private _saveHistoryWidth(): void {
    try {
      localStorage.setItem(HISTORY_WIDTH_KEY, String(this.historyWidth()));
    } catch {
      // Storage can be unavailable; the width then lasts for this view only
    }
  }
}
