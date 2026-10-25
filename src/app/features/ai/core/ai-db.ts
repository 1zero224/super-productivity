import { DBSchema, IDBPDatabase, openDB } from 'idb';

/**
 * The device-local `sup-ai` IndexedDB database. It lives outside op-log sync,
 * exports and backups: settings, goals, memory, reports and conversations
 * never leave this device.
 */

const DB_NAME = 'sup-ai';
const DB_VERSION = 2;

export const AI_KV_STORE = 'kv';
export const AI_ENTITY_STORES = [
  'goals',
  'memories',
  'reports',
  'conversations',
] as const;
export type AiEntityStoreName = (typeof AI_ENTITY_STORES)[number];

export interface AiEntity {
  id: string;
}

type EntityStores = {
  [K in AiEntityStoreName]: { key: string; value: AiEntity };
};

export interface AiDb extends DBSchema, EntityStores {
  [AI_KV_STORE]: {
    key: string;
    value: unknown;
  };
}

let initPromise: Promise<IDBPDatabase<AiDb>> | undefined;

export const ensureAiDb = (): Promise<IDBPDatabase<AiDb>> => {
  if (!initPromise) {
    initPromise = openDB<AiDb>(DB_NAME, DB_VERSION, {
      upgrade: (database) => {
        if (!database.objectStoreNames.contains(AI_KV_STORE)) {
          database.createObjectStore(AI_KV_STORE);
        }
        for (const name of AI_ENTITY_STORES) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, { keyPath: 'id' });
          }
        }
      },
    });
    initPromise.catch(() => {
      initPromise = undefined;
    });
  }
  return initPromise;
};

export const getAiKv = async <T>(key: string): Promise<T | undefined> =>
  (await (await ensureAiDb()).get(AI_KV_STORE, key)) as T | undefined;

export const setAiKv = async (key: string, value: unknown): Promise<void> => {
  await (await ensureAiDb()).put(AI_KV_STORE, value, key);
};

/** Minimal typed CRUD over one entity store. */
export class AiEntityStore<T extends AiEntity> {
  constructor(private readonly _name: AiEntityStoreName) {}

  async list(): Promise<T[]> {
    return (await (await ensureAiDb()).getAll(this._name)) as T[];
  }

  async put(entity: T): Promise<void> {
    await (await ensureAiDb()).put(this._name, entity);
  }

  async delete(id: string): Promise<void> {
    await (await ensureAiDb()).delete(this._name, id);
  }
}
