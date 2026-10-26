import { computed, Injectable, signal } from '@angular/core';
import {
  AI_FEATURES,
  AiFeature,
  AiProvider,
  AiSettings,
  DEFAULT_AI_AUTOMATION_SETTINGS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_SETTINGS,
  isProviderConfigured,
  resolveProvider,
} from './ai-client.model';
import { getAiKv, setAiKv } from './ai-db';
import { Log } from '../../../core/log';

/**
 * Device-local AI settings (providers, feature routing, automation).
 *
 * Lives in the `sup-ai` IndexedDB database, outside op-log sync, exports and
 * backups — like the plugin secret store. The key is plaintext at rest.
 */

const SETTINGS_KEY = 'settings';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const AiLog = Log.withContext('ai');

// Settings stored before providers existed held a single endpoint
interface LegacyAiSettings {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const hostName = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^api./, '') || 'AI';
  } catch {
    return 'AI';
  }
};

const normalizeProvider = (raw: Partial<AiProvider>, index: number): AiProvider => {
  const baseUrl = (raw.baseUrl ?? '').trim();
  return {
    id: (raw.id ?? '').trim() || `provider-${index + 1}`,
    name: (raw.name ?? '').trim() || hostName(baseUrl),
    apiType: raw.apiType === 'responses' ? 'responses' : 'chat',
    baseUrl,
    model: (raw.model ?? '').trim(),
    apiKey: (raw.apiKey ?? '').trim(),
  };
};

export const normalizeAiSettings = (
  raw: (Partial<AiSettings> & LegacyAiSettings) | undefined,
): AiSettings => {
  const a = { ...DEFAULT_AI_AUTOMATION_SETTINGS, ...(raw?.automation || {}) };
  let providers: AiProvider[];
  if (Array.isArray(raw?.providers) && raw!.providers.length) {
    providers = raw!.providers.map(normalizeProvider);
  } else if (raw?.baseUrl !== undefined || raw?.apiKey !== undefined) {
    // Migrate the single pre-provider endpoint
    providers = [
      normalizeProvider(
        {
          id: DEFAULT_AI_PROVIDER.id,
          baseUrl: raw.baseUrl ?? DEFAULT_AI_PROVIDER.baseUrl,
          model: raw.model ?? DEFAULT_AI_PROVIDER.model,
          apiKey: raw.apiKey ?? '',
        },
        0,
      ),
    ];
  } else {
    providers = [{ ...DEFAULT_AI_PROVIDER }];
  }
  // Ids must be unique for routing
  const seen = new Set<string>();
  providers = providers.map((p, i) => {
    const id = seen.has(p.id) ? `${p.id}-${i + 1}` : p.id;
    seen.add(id);
    return { ...p, id };
  });
  const ids = new Set(providers.map((p) => p.id));
  const featureProviders: Partial<Record<AiFeature, string>> = {};
  for (const f of AI_FEATURES) {
    const id = raw?.featureProviders?.[f];
    if (id && ids.has(id)) {
      featureProviders[f] = id;
    }
  }
  return {
    providers,
    defaultProviderId:
      raw?.defaultProviderId && ids.has(raw.defaultProviderId)
        ? raw.defaultProviderId
        : providers[0].id,
    featureProviders,
    automation: {
      isDailyEnabled: !!a.isDailyEnabled,
      dailyTime: TIME_RE.test(a.dailyTime)
        ? a.dailyTime
        : DEFAULT_AI_AUTOMATION_SETTINGS.dailyTime,
      isEveningEnabled: !!a.isEveningEnabled,
      eveningTime: TIME_RE.test(a.eveningTime)
        ? a.eveningTime
        : DEFAULT_AI_AUTOMATION_SETTINGS.eveningTime,
      isWeeklyEnabled: !!a.isWeeklyEnabled,
      weeklyDay:
        Number.isInteger(a.weeklyDay) && a.weeklyDay >= 0 && a.weeklyDay <= 6
          ? a.weeklyDay
          : DEFAULT_AI_AUTOMATION_SETTINGS.weeklyDay,
      weeklyTime: TIME_RE.test(a.weeklyTime)
        ? a.weeklyTime
        : DEFAULT_AI_AUTOMATION_SETTINGS.weeklyTime,
      isAutoOpen: !!a.isAutoOpen,
      isAutoQuadrant: !!a.isAutoQuadrant,
    },
  };
};

@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  private readonly _settings = signal<AiSettings>(DEFAULT_AI_SETTINGS);
  private _loadPromise?: Promise<AiSettings>;

  readonly settings = this._settings.asReadonly();
  // The default provider is usable (local endpoints may run without a key)
  readonly isConfigured = computed(() =>
    isProviderConfigured(resolveProvider(this._settings())),
  );
  readonly configuredProviders = computed(() =>
    this._settings().providers.filter(isProviderConfigured),
  );

  load(): Promise<AiSettings> {
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        try {
          const stored = await getAiKv<Partial<AiSettings> & LegacyAiSettings>(
            SETTINGS_KEY,
          );
          const merged = normalizeAiSettings(stored);
          this._settings.set(merged);
          return merged;
        } catch (e) {
          AiLog.err('AiSettingsService: failed to load settings', e);
          this._loadPromise = undefined;
          return this._settings();
        }
      })();
    }
    return this._loadPromise;
  }

  async save(settings: AiSettings): Promise<void> {
    const cleaned = normalizeAiSettings(settings);
    await setAiKv(SETTINGS_KEY, cleaned);
    this._settings.set(cleaned);
    this._loadPromise = Promise.resolve(cleaned);
  }
}
