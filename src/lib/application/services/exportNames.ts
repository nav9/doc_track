import type { ExportKind } from '../dto/version';
import { filenameTimestamp } from '../../infrastructure/files/files';

const PREFIX: Record<ExportKind, string> = {
  full: 'DocTrack_Backup',
  leave: 'DocTrack_LeaveHistory',
  policy: 'DocTrack_Policy',
  roster: 'DocTrack_DutyRoster',
  holidays: 'DocTrack_Holidays',
  multiuser: 'DocTrack_MultiUser',
  events: 'DocTrack_Events'
};

export function fileNameForExport(kind: ExportKind, date: Date): string {
  return `${PREFIX[kind]}_${filenameTimestamp(date)}.txt`;
}
