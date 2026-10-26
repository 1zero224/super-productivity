import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { nanoid } from 'nanoid';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { AiSettingsService } from '../../core/ai-settings.service';
import { AiClientService } from '../../core/ai-client.service';
import {
  AiAutomationSettings,
  AiFeature,
  AiProvider,
  AiSettings,
  resolveProvider,
} from '../../core/ai-client.model';

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

const FEATURE_LABELS: { id: AiFeature; label: string }[] = [
  { id: 'chat', label: T.F.AI.PROVIDERS.F_CHAT },
  { id: 'breakdown', label: T.F.AI.PROVIDERS.F_BREAKDOWN },
  { id: 'daily', label: T.F.AI.PROVIDERS.F_DAILY },
  { id: 'evening', label: T.F.AI.PROVIDERS.F_EVENING },
  { id: 'weekly', label: T.F.AI.PROVIDERS.F_WEEKLY },
  { id: 'classify', label: T.F.AI.PROVIDERS.F_CLASSIFY },
];

type ProviderTestState = { state: 'testing' | 'ok' | 'fail'; error?: string };

@Component({
  selector: 'ai-settings-form',
  imports: [
    FormsModule,
    MatButton,
    MatIconButton,
    MatIcon,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatSelect,
    MatOption,
    MatSlideToggle,
    MatTooltip,
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
  readonly FEATURES = FEATURE_LABELS;
  readonly saved = output<void>();

  readonly model = signal<AiSettings>(structuredClone(this._settingsService.settings()));
  readonly testStates = signal<Record<string, ProviderTestState>>({});
  readonly defaultProviderName = computed(
    () => resolveProvider(this.model())?.name ?? '',
  );

  async ngOnInit(): Promise<void> {
    this.model.set(structuredClone(await this._settingsService.load()));
  }

  setProvider<K extends keyof Omit<AiProvider, 'id'>>(
    id: string,
    key: K,
    value: AiProvider[K],
  ): void {
    this.model.update((m) => ({
      ...m,
      providers: m.providers.map((p) => (p.id === id ? { ...p, [key]: value } : p)),
    }));
    // An edited provider needs a fresh connection test
    this.testStates.update((s) =>
      Object.fromEntries(Object.entries(s).filter(([pid]) => pid !== id)),
    );
  }

  addProvider(): void {
    const provider: AiProvider = {
      id: nanoid(8),
      name: '',
      apiType: 'chat',
      baseUrl: '',
      model: '',
      apiKey: '',
    };
    this.model.update((m) => ({ ...m, providers: [...m.providers, provider] }));
  }

  removeProvider(id: string): void {
    this.model.update((m) => {
      const providers = m.providers.filter((p) => p.id !== id);
      if (!providers.length) {
        return m;
      }
      const featureProviders = Object.fromEntries(
        Object.entries(m.featureProviders).filter(([, pid]) => pid !== id),
      );
      return {
        ...m,
        providers,
        featureProviders,
        defaultProviderId:
          m.defaultProviderId === id ? providers[0].id : m.defaultProviderId,
      };
    });
  }

  setDefault(id: string): void {
    this.model.update((m) => ({ ...m, defaultProviderId: id }));
  }

  setFeatureProvider(feature: AiFeature, id: string | null): void {
    this.model.update((m) => {
      const featureProviders = { ...m.featureProviders };
      if (id) {
        featureProviders[feature] = id;
      } else {
        delete featureProviders[feature];
      }
      return { ...m, featureProviders };
    });
  }

  setAutomation<K extends keyof AiAutomationSettings>(
    key: K,
    value: AiAutomationSettings[K],
  ): void {
    this.model.update((m) => ({ ...m, automation: { ...m.automation, [key]: value } }));
  }

  async test(id: string): Promise<void> {
    const provider = this.model().providers.find((p) => p.id === id);
    if (!provider) {
      return;
    }
    this._setTest(id, { state: 'testing' });
    try {
      await this._client.chatWithProvider(
        {
          ...provider,
          baseUrl: provider.baseUrl.trim(),
          model: provider.model.trim(),
          apiKey: provider.apiKey.trim(),
        },
        { messages: [{ role: 'user', content: 'Reply with: ok' }] },
      );
      this._setTest(id, { state: 'ok' });
    } catch (e) {
      this._setTest(id, { state: 'fail', error: (e as Error).message });
    }
  }

  async save(): Promise<void> {
    await this._settingsService.save(this.model());
    this.model.set(structuredClone(this._settingsService.settings()));
    this.saved.emit();
  }

  private _setTest(id: string, state: ProviderTestState): void {
    this.testStates.update((s) => ({ ...s, [id]: state }));
  }
}
