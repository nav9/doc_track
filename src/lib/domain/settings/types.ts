import type { AuditFields, ISODate, ISODateTime } from '../common/types';
import type { DateFormat } from '../common/dates';

export type ThemeMode = 'light' | 'dark' | 'system';
export type CalendarDensity = 'compact' | 'comfortable';
export type TimeFormat = '12h' | '24h';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export const LOG_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export interface AppSettings extends AuditFields {
  id: 'app';
  onboarded: boolean;
  greetingDismissed: boolean;
  storageWarningDismissed: boolean;
  theme: ThemeMode;
  colorblind: boolean;
  calendarDensity: CalendarDensity;
  weekStartsOn: 0 | 1;
  defaultYear: number | null;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  rosterDateFormat: DateFormat;
  manualNowEnabled: boolean;
  manualNow: ISODateTime | null;
  defaultEmploymentId: string | null;
  defaultPolicyId: string | null;
  dutyRosterEnabled: boolean;
  backupReminderEnabled: boolean;
  backupReminderDays: number;
  autoBackupEnabled: boolean;
  autoBackupFrequencyDays: number;
  autoBackupFolderName: string;
  lastBackupAt: ISODateTime | null;
  versioningEnabled: boolean;
  versionRetention: number;
  logRetentionDays: number;
  logLevels: Record<LogLevel, boolean>;
  showEngineLab: boolean;
}

export function defaultSettings(now: string): AppSettings {
  return {
    id: 'app',
    createdAt: now,
    updatedAt: now,
    onboarded: false,
    greetingDismissed: false,
    storageWarningDismissed: false,
    theme: 'light',
    colorblind: false,
    calendarDensity: 'compact',
    weekStartsOn: 1,
    defaultYear: null,
    dateFormat: 'dd MMM yyyy',
    timeFormat: '24h',
    rosterDateFormat: 'dd MMM yyyy',
    manualNowEnabled: false,
    manualNow: null,
    defaultEmploymentId: null,
    defaultPolicyId: null,
    dutyRosterEnabled: true,
    backupReminderEnabled: true,
    backupReminderDays: 14,
    autoBackupEnabled: false,
    autoBackupFrequencyDays: 7,
    autoBackupFolderName: '',
    lastBackupAt: null,
    versioningEnabled: true,
    versionRetention: 20,
    logRetentionDays: 30,
    logLevels: { DEBUG: false, INFO: true, WARN: true, ERROR: true },
    showEngineLab: false
  };
}

export interface LogEntry {
  id: string;
  at: ISODateTime;
  level: LogLevel;
  category: string;
  message: string;
  context: string;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as string[]).includes(value);
}

export function backupDue(
  settings: Pick<
    AppSettings,
    'backupReminderEnabled' | 'backupReminderDays' | 'lastBackupAt'
  >,
  now: ISODate
): boolean {
  if (!settings.backupReminderEnabled) return false;
  if (!settings.lastBackupAt) return true;
  const last = settings.lastBackupAt.slice(0, 10);
  const days = Math.floor(
    (new Date(`${now}T00:00:00Z`).getTime() - new Date(`${last}T00:00:00Z`).getTime()) / 86400000
  );
  return days >= settings.backupReminderDays;
}

/** Before the first backup, wait one full reminder interval after onboarding. */
export function backupReminderDue(
  settings: Pick<
    AppSettings,
    'backupReminderEnabled' | 'backupReminderDays' | 'lastBackupAt' | 'createdAt'
  >,
  now: ISODate
): boolean {
  if (!settings.backupReminderEnabled) return false;
  if (settings.lastBackupAt) return backupDue(settings, now);
  const baseline = settings.createdAt.slice(0, 10);
  if (!baseline) return false;
  const days = Math.floor(
    (new Date(`${now}T00:00:00Z`).getTime() - new Date(`${baseline}T00:00:00Z`).getTime()) /
      86400000
  );
  return days >= settings.backupReminderDays;
}
