import {
  ChangeDetectionStrategy,
  Component,
  computed,
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

  protected readonly T = T;
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
}
