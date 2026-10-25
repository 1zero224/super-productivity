import { computed, Injectable, signal } from '@angular/core';
import {
  AiSettings,
  DEFAULT_AI_AUTOMATION_SETTINGS,
  DEFAULT_AI_SETTINGS,
} from './ai-client.model';
import { getAiKv, setAiKv } from './ai-db';
import { Log } from '../../../core/log';

/**
 * Device-local AI settings (endpoint, model, API key, automation).
 *
 * Lives in the `sup-ai` IndexedDB database, outside op-log sync, exports and
 * backups — like the plugin secret store. The key is plaintext at rest.
 */

const SETTINGS_KEY = 'settings';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const AiLog = Log.withContext('ai');

export const normalizeAiSettings = (raw: Partial<AiSettings> | undefined): AiSettings => {
  const a = { ...DEFAULT_AI_AUTOMATION_SETTINGS, ...(raw?.automation || {}) };
  return {
    baseUrl: (raw?.baseUrl ?? DEFAULT_AI_SETTINGS.baseUrl).trim(),
    model: (raw?.model ?? DEFAULT_AI_SETTINGS.model).trim(),
    apiKey: (raw?.apiKey ?? DEFAULT_AI_SETTINGS.apiKey).trim(),
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
    },
  };
};

@Injectable({ providedIn: 'root' })
export class AiSettingsService {
  private readonly _settings = signal<AiSettings>(DEFAULT_AI_SETTINGS);
  private _loadPromise?: Promise<AiSettings>;

  readonly settings = this._settings.asReadonly();
  readonly isConfigured = computed(() => {
    const s = this._settings();
    return !!s.baseUrl.trim() && !!s.model.trim() && !!s.apiKey.trim();
  });

  load(): Promise<AiSettings> {
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        try {
          const stored = await getAiKv<Partial<AiSettings>>(SETTINGS_KEY);
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
