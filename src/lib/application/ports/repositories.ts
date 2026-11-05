/**
 * Repository ports.
 *
 * The domain and application layers depend only on these interfaces. The
 * IndexedDB implementation lives in `infrastructure`; a SQL implementation can
 * be substituted without touching the engines or the UI.
 */
import type { AppSettings } from '../../domain/settings/types';
import type { DoctorProfile } from '../../domain/profile/profile';
import type { Organisation, EmploymentRecord } from '../../domain/profile/profile';
import type { PolicyVersion } from '../../domain/policy/types';
import type { LeaveRequest } from '../../domain/leave/types';
import type { LedgerTransaction } from '../../domain/ledger/types';
import type { Duty, PdoRecord } from '../../domain/duty/types';
import type { AttendanceRecord } from '../../domain/attendance/types';
import type { CalendarEvent, EventName, Holiday } from '../../domain/calendar/holidays';
import type { DutyRoster, RosterDoctor } from '../../domain/roster/types';
import type { LogEntry } from '../../domain/settings/types';
import type { DataSnapshot } from '../dto/snapshot';
import type { DataVersion } from '../dto/version';

export interface CollectionRepository<T extends { id: string }> {
  all(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(value: T): Promise<void>;
  bulkPut(values: T[]): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export interface SettingsRepository {
  get(): Promise<AppSettings | undefined>;
  put(settings: AppSettings): Promise<void>;
}

export interface MetaRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SnapshotRepository {
  readAll(): Promise<DataSnapshot>;
  /** Atomically replaces application data with a snapshot. */
  replaceAll(snapshot: DataSnapshot): Promise<void>;
}

export interface Repositories {
  settings: SettingsRepository;
  meta: MetaRepository;
  snapshot: SnapshotRepository;
  profiles: CollectionRepository<DoctorProfile>;
  organisations: CollectionRepository<Organisation>;
  employments: CollectionRepository<EmploymentRecord>;
  policies: CollectionRepository<PolicyVersion>;
  leaves: CollectionRepository<LeaveRequest>;
  ledger: CollectionRepository<LedgerTransaction>;
  duties: CollectionRepository<Duty>;
  pdos: CollectionRepository<PdoRecord>;
  attendance: CollectionRepository<AttendanceRecord>;
  holidays: CollectionRepository<Holiday>;
  events: CollectionRepository<CalendarEvent>;
  eventNames: CollectionRepository<EventName>;
  doctors: CollectionRepository<RosterDoctor>;
  rosters: CollectionRepository<DutyRoster>;
  versions: CollectionRepository<DataVersion>;
  logs: CollectionRepository<LogEntry>;
  /** Closes the underlying connection (used by tests). */
  close(): Promise<void>;
}
