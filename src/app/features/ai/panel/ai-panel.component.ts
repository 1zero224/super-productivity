import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AiPanelStateService } from '../ai-panel-state.service';
import { AiSettingsService } from '../core/ai-settings.service';
import { AiContextService } from '../context/ai-context.service';
import { AiBreakdownCardComponent } from './ai-breakdown-card/ai-breakdown-card.component';
import { AiSettingsFormComponent } from './ai-settings-form/ai-settings-form.component';
import { AiChatComponent } from './ai-chat/ai-chat.component';
import { AiReportsViewComponent } from '../reports/ai-reports-view/ai-reports-view.component';
import { AiReportService } from '../reports/ai-report.service';
import { AiGoalsService } from '../goals/ai-goals.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';

@Component({
  selector: 'ai-panel',
  imports: [
    MatIconButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    AiBreakdownCardComponent,
    AiSettingsFormComponent,
    AiChatComponent,
    AiReportsViewComponent,
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
  private readonly _reportService = inject(AiReportService);
  private readonly _goalsService = inject(AiGoalsService);
  private readonly _router = inject(Router);

  protected readonly T = T;
  readonly chips = this._context.chips;
  readonly isConfigured = this._settingsService.isConfigured;
  readonly isSettingsOpen = signal(false);
  readonly isShowSettings = computed(() => this.isSettingsOpen() || !this.isConfigured());
  readonly unreadCount = this._reportService.unreadCount;
  readonly activeGoalCount = computed(() => this._goalsService.activeGoals().length);

  ngOnInit(): void {
    this._settingsService.load();
    this._reportService.load();
  }

  close(): void {
    this._layoutService.hideAiPanel();
  }

  openFullPage(): void {
    this._layoutService.hideAiPanel();
    this._router.navigate(['/ai']);
  }
}
