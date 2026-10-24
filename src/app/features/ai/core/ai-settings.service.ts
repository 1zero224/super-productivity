import { computed, Injectable, signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { AiSettings, DEFAULT_AI_SETTINGS } from './ai-client.model';
import { Log } from '../../../core/log';

/**
 * Device-local AI settings (endpoint, model, API key).
 *
 * Lives in its own IndexedDB database, outside op-log sync, exports and
 * backups — like the plugin secret store. The key is plaintext at rest.
 */

const DB_NAME = 'sup-ai';
const DB_STORE_NAME = 'kv';
const DB_VERSION = 1;
const SETTINGS_KEY = 'settings';

interface AiDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: unknown;
  };
}

const AiLog = Log.withContext('ai');

let initPromise: Promise<IDBPDatabase<AiDb>> | undefined;

export const ensureAiDb = (): Promise<IDBPDatabase<AiDb>> => {
  if (!initPromise) {
    initPromise = openDB<AiDb>(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
          database.createObjectStore(DB_STORE_NAME);
        }
      },
    });
    initPromise.catch(() => {
      initPromise = undefined;
    });
  }
  return initPromise;
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
          const db = await ensureAiDb();
          const stored = (await db.get(DB_STORE_NAME, SETTINGS_KEY)) as
            | Partial<AiSettings>
            | undefined;
          const merged = { ...DEFAULT_AI_SETTINGS, ...(stored || {}) };
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
    const cleaned: AiSettings = {
      baseUrl: settings.baseUrl.trim(),
      model: settings.model.trim(),
      apiKey: settings.apiKey.trim(),
    };
    const db = await ensureAiDb();
    await db.put(DB_STORE_NAME, cleaned, SETTINGS_KEY);
    this._settings.set(cleaned);
    this._loadPromise = Promise.resolve(cleaned);
  }
}
