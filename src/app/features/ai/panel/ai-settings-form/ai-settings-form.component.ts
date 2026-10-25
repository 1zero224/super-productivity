import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiClientService } from '../../core/ai-client.service';
import { AiAutomationSettings, AiSettings } from '../../core/ai-client.model';

// Index = JS weekday (0 = Sunday)
const WEEKDAY_LABELS = [
  T.F.AI.SETTINGS.AUTOMATION.SUN,
  T.F.AI.SETTINGS.AUTOMATION.MON,
  T.F.AI.SETTINGS.AUTOMATION.TUE,
  T.F.AI.SETTINGS.AUTOMATION.WED,
  T.F.AI.SETTINGS.AUTOMATION.THU,
  T.F.AI.SETTINGS.AUTOMATION.FRI,
  T.F.AI.SETTINGS.AUTOMATION.SAT,
];

@Component({
  selector: 'ai-settings-form',
  imports: [
    FormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatSelect,
    MatOption,
    MatSlideToggle,
    TranslatePipe,
  ],
  templateUrl: './ai-settings-form.component.html',
  styleUrl: './ai-settings-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsFormComponent implements OnInit {
  private readonly _settingsService = inject(AiSettingsService);
  private readonly _client = inject(AiClientService);

  protected readonly T = T;
  readonly WEEKDAYS = WEEKDAY_LABELS.map((label, value) => ({ label, value }));
  readonly saved = output<void>();

  readonly model = signal<AiSettings>({ ...this._settingsService.settings() });
  readonly testState = signal<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  readonly testError = signal('');

  async ngOnInit(): Promise<void> {
    this.model.set({ ...(await this._settingsService.load()) });
  }

  setField(key: 'baseUrl' | 'model' | 'apiKey', value: string): void {
    this.model.update((m) => ({ ...m, [key]: value }));
    this.testState.set('idle');
  }

  setAutomation<K extends keyof AiAutomationSettings>(
    key: K,
    value: AiAutomationSettings[K],
  ): void {
    this.model.update((m) => ({ ...m, automation: { ...m.automation, [key]: value } }));
  }

  async test(): Promise<void> {
    this.testState.set('testing');
    try {
      await this._client.chatWithSettings(this.model(), {
        messages: [{ role: 'user', content: 'Reply with: ok' }],
      });
      this.testState.set('ok');
    } catch (e) {
      this.testError.set((e as Error).message);
      this.testState.set('fail');
    }
  }

  async save(): Promise<void> {
    await this._settingsService.save(this.model());
    this.saved.emit();
  }
}
