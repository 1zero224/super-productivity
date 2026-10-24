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
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiClientService } from '../../core/ai-client.service';
import { AiSettings } from '../../core/ai-client.model';

@Component({
  selector: 'ai-settings-form',
  imports: [
    FormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
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
  readonly saved = output<void>();

  readonly model = signal<AiSettings>({ ...this._settingsService.settings() });
  readonly testState = signal<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  readonly testError = signal('');

  async ngOnInit(): Promise<void> {
    this.model.set({ ...(await this._settingsService.load()) });
  }

  setField(key: keyof AiSettings, value: string): void {
    this.model.update((m) => ({ ...m, [key]: value }));
    this.testState.set('idle');
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
