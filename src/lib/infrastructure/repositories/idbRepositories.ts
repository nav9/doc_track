import type { IDBPDatabase } from 'idb';
import { openDatabase, VALUE_STORES } from '../indexeddb/db';
import type {
  CollectionRepository,
  MetaRepository,
  Repositories,
  SettingsRepository,
  SnapshotRepository
} from '../../application/ports/repositories';
import type { AppSettings } from '../../domain/settings/types';
import type { DoctorProfile } from '../../domain/profile/profile';
import type { PolicyVersion } from '../../domain/policy/types';
import type { LeaveRequest } from '../../domain/leave/types';
import type { LedgerTransaction } from '../../domain/ledger/types';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import type { AttendanceRecord } from '../../domain/attendance/types';
import type { CalendarEvent, EventName, Holiday, HolidayName } from '../../domain/calendar/holidays';
import type { DutyRoster, RosterDoctor } from '../../domain/roster/types';
import type { SharedLeave } from '../../domain/multiuser/types';
import type { LogEntry } from '../../domain/settings/types';
import type { DataSnapshot } from '../../application/dto/snapshot';
import { SNAPSHOT_COLLECTIONS } from '../../application/dto/snapshot';
import type { DataVersion } from '../../application/dto/version';
import { clonePlain } from '../../domain/common/clone';

function collection<T extends { id: string }>(
  db: IDBPDatabase<unknown>,
  store: string
): CollectionRepository<T> {
  return {
    async all() {
      return (await db.getAll(store)) as T[];
    },
    async get(id) {
      return (await db.get(store, id)) as T | undefined;
    },
    async put(value) {
      // Svelte $state objects are proxies; IndexedDB cannot structured-clone
      // proxies. Persist a JSON-safe plain copy at the storage boundary.
      await db.put(store, clonePlain(value));
    },
    async bulkPut(values) {
      if (values.length === 0) return;
      const transaction = db.transaction(store, 'readwrite');
      await Promise.all([
        ...values.map((value) => transaction.store.put(clonePlain(value))),
        transaction.done
      ]);
    },
    async remove(id) {
      await db.delete(store, id);
    },
    async clear() {
      await db.clear(store);
    },
    async count() {
      return db.count(store);
    }
  };
}

export function createIndexedDbRepositories(db: IDBPDatabase<unknown>): Repositories {
  const settings: SettingsRepository = {
    async get() {
      return (await db.get('settings', 'app')) as AppSettings | undefined;
    },
    async put(value) {
      await db.put('settings', clonePlain(value));
    }
  };

  const meta: MetaRepository = {
    async get<T>(key: string) {
      const record = (await db.get('meta', key)) as { key: string; value: T } | undefined;
      return record?.value;
    },
    async set<T>(key: string, value: T) {
      await db.put('meta', { key, value });
    },
    async remove(key: string) {
      await db.delete('meta', key);
    }
  };

  const snapshot: SnapshotRepository = {
    async readAll() {
      const result = {
        profiles: [],
        organisations: [],
        employments: [],
        policies: [],
        leaves: [],
        ledger: [],
        duties: [],
        pdos: [],
        attendance: [],
        holidays: [],
        events: [],
        eventNames: [],
        holidayNames: [],
        doctors: [],
        rosters: [],
        sharedLeaves: [],
        settings: []
      } as DataSnapshot;
      // Snapshot collections only: version history and logs must survive an
      // import or a rollback, otherwise the safety snapshot destroys itself.
      const stores = [...SNAPSHOT_COLLECTIONS, 'settings'];
      const transaction = db.transaction(stores, 'readonly');
      await Promise.all(
        stores.map(async (store) => {
          const values = await transaction.objectStore(store).getAll();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (result as any)[store] = values;
        })
      );
      await transaction.done;
      return result;
    },
    async replaceAll(value) {
      const stores = [...SNAPSHOT_COLLECTIONS, 'settings'];
      const transaction = db.transaction(stores, 'readwrite');
      await Promise.all(
        stores.map(async (store) => {
          const objectStore = transaction.objectStore(store);
          await objectStore.clear();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const items = ((value as any)[store] as { id?: string }[]) ?? [];
          await Promise.all(items.map((item) => objectStore.put(clonePlain(item))));
        })
      );
      await transaction.done;
    }
  };

  return {
    settings,
    meta,
    snapshot,
    profiles: collection<DoctorProfile>(db, 'profiles'),
    organisations: collection(db, 'organisations'),
    employments: collection(db, 'employments'),
    policies: collection<PolicyVersion>(db, 'policies'),
    leaves: collection<LeaveRequest>(db, 'leaves'),
    ledger: collection<LedgerTransaction>(db, 'ledger'),
    duties: collection<Duty>(db, 'duties'),
    pdos: collection<PdoRecord>(db, 'pdos'),
    attendance: collection<AttendanceRecord>(db, 'attendance'),
    holidays: collection<Holiday>(db, 'holidays'),
    events: collection<CalendarEvent>(db, 'events'),
    eventNames: collection<EventName>(db, 'eventNames'),
    holidayNames: collection<HolidayName>(db, 'holidayNames'),
    doctors: collection<RosterDoctor>(db, 'doctors'),
    rosters: collection<DutyRoster>(db, 'rosters'),
    sharedLeaves: collection<SharedLeave>(db, 'sharedLeaves'),
    versions: collection<DataVersion>(db, 'versions'),
    logs: collection<LogEntry>(db, 'logs'),
    async close() {
      db.close();
    }
  };
}

export async function createRepositories(): Promise<Repositories> {
  const db = await openDatabase();
  return createIndexedDbRepositories(db);
}
