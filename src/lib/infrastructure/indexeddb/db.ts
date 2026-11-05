/**
 * IndexedDB connection and schema migrations.
 *
 * Version 1 is the Phase 1 schema. Migration hooks are explicit so a future
 * release can upgrade without losing data. Stores use stable string IDs; no
 * auto-increment keys are used, which makes exports and imports deterministic.
 */
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'doctrack';
export const DB_VERSION = 1;

export const VALUE_STORES = [
  'profiles',
  'organisations',
  'employments',
  'policies',
  'leaves',
  'ledger',
  'duties',
  'pdos',
  'attendance',
  'holidays',
  'events',
  'eventNames',
  'doctors',
  'rosters',
  'versions',
  'logs'
] as const;

export const ALL_STORES = ['settings', 'meta', ...VALUE_STORES] as const;

let connection: Promise<IDBPDatabase<unknown>> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

export function openDatabase(): Promise<IDBPDatabase<unknown>> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(
      new Error('IndexedDB is unavailable in this browser. Private browsing may block it.')
    );
  }
  if (!connection) {
    connection = openDB<unknown>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          if (!database.objectStoreNames.contains('settings')) {
            database.createObjectStore('settings', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('meta')) {
            database.createObjectStore('meta', { keyPath: 'key' });
          }
          for (const store of VALUE_STORES) {
            if (!database.objectStoreNames.contains(store)) {
              database.createObjectStore(store, { keyPath: 'id' });
            }
          }
          const logs = database.objectStoreNames.contains('logs')
            ? null
            : database.createObjectStore('logs', { keyPath: 'id' });
          logs?.createIndex('at', 'at');
        }
        // Future migrations:
        // if (oldVersion < 2) { ... }
      },
      blocked() {
        console.warn('[db] another tab is holding the old database version');
      },
      blocking() {
        console.warn('[db] this tab is blocking a database upgrade');
      }
    });
  }
  return connection;
}

/** Closes the connection; used by tests and when resetting the database. */
export async function closeDatabase(): Promise<void> {
  if (!connection) return;
  const db = await connection;
  db.close();
  connection = null;
}

/** Deletes the local database. Only used by the explicit "reset" developer action. */
export async function deleteDatabase(): Promise<void> {
  await closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other DocTrack tabs and try again.'));
  });
}
