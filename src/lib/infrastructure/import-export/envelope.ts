/**
 * Clipboard / file exchange format.
 *
 * A payload is wrapped in markers so a user can paste a whole WhatsApp message
 * ("Hi, this is my leave data … <data>") and the app extracts only the data.
 * Multiple marked chunks in one message are all parsed.
 *
 * The data is gzip-compressed and base64-encoded when the browser supports
 * CompressionStream; otherwise it falls back to plain base64. Nothing leaves the
 * device — this is only a text format.
 */
import type { DataSnapshot } from '../../application/dto/snapshot';
import { emptySnapshot, SNAPSHOT_COLLECTIONS, countSnapshot } from '../../application/dto/snapshot';
import type {
  ExportKind,
  ImportConflict,
  ImportPreview,
  ImportSummaryLine
} from '../../application/dto/version';
import { isISODate } from '../../domain/common/types';
import type { AppSettings } from '../../domain/settings/types';
import type { DoctorProfile } from '../../domain/profile/profile';

export const MARKER_START = '-----BEGIN DOCTRACK DATA-----';
export const MARKER_END = '-----END DOCTRACK DATA-----';
export const APP_TAG = 'DocTrack';
export const FORMAT = 'doctrack/v1';

export type EnvelopeEncoding = 'gzip+base64' | 'base64';

export interface Envelope {
  app: typeof APP_TAG;
  format: string;
  kind: ExportKind;
  label: string;
  createdAt: string;
  appVersion: string;
  encoding: EnvelopeEncoding;
  counts: ReturnType<typeof countSnapshot>;
  data: Record<string, unknown>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

export async function encodeEnvelope(
  envelope: Omit<Envelope, 'app' | 'format' | 'encoding' | 'createdAt'> & { createdAt?: string }
): Promise<string> {
  const header: Omit<Envelope, 'data'> = {
    app: APP_TAG,
    format: FORMAT,
    kind: envelope.kind,
    label: envelope.label,
    createdAt: envelope.createdAt ?? new Date().toISOString(),
    appVersion: envelope.appVersion,
    counts: envelope.counts,
    encoding: 'base64'
  };

  const json = JSON.stringify({ ...header, data: envelope.data });
  const compressed = await gzip(json);
  let body: string;
  let encoding: EnvelopeEncoding;
  if (compressed) {
    body = bytesToBase64(compressed);
    encoding = 'gzip+base64';
  } else {
    body = bytesToBase64(new TextEncoder().encode(json));
    encoding = 'base64';
  }

  const finalHeader = { ...header, encoding };
  const wrapped = `${JSON.stringify(finalHeader)}\n${body}`;
  return `${MARKER_START}\n${wrapped}\n${MARKER_END}`;
}

export function extractChunks(text: string): string[] {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(MARKER_START, cursor);
    if (start === -1) break;
    const end = text.indexOf(MARKER_END, start + MARKER_START.length);
    if (end === -1) break;
    chunks.push(text.slice(start + MARKER_START.length, end).trim());
    cursor = end + MARKER_END.length;
  }
  return chunks;
}

async function decodeChunk(chunk: string): Promise<Envelope> {
  const newline = chunk.indexOf('\n');
  if (newline === -1) throw new Error('The data block has no header.');
  const headerRaw = chunk.slice(0, newline).trim();
  const body = chunk.slice(newline + 1).trim();

  let header: Partial<Envelope>;
  try {
    header = JSON.parse(headerRaw) as Partial<Envelope>;
  } catch {
    throw new Error('The data block header is not readable.');
  }
  if (header.app !== APP_TAG) {
    throw new Error('This text was not created by DocTrack.');
  }
  if (
    !header.kind ||
    !['full', 'leave', 'policy', 'roster', 'holidays', 'multiuser'].includes(header.kind)
  ) {
    throw new Error('The data block does not declare a supported data kind.');
  }
  if (typeof header.createdAt !== 'string') {
    throw new Error('The data block is missing its creation date.');
  }

  const bytes = base64ToBytes(body);
  let json: string;
  if (header.encoding === 'gzip+base64') {
    const decompressed = await gunzip(bytes);
    if (decompressed === null) {
      throw new Error('This browser cannot decompress the data. Use a current browser.');
    }
    json = decompressed;
  } else {
    json = new TextDecoder().decode(bytes);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The data block is corrupted and could not be read.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The data block does not contain an object.');
  }
  return {
    ...(header as Envelope),
    data: (parsed as { data?: Record<string, unknown> }).data ?? (parsed as Record<string, unknown>)
  };
}

export async function parseEnvelopes(text: string): Promise<Envelope[]> {
  const chunks = extractChunks(text);
  if (chunks.length === 0) {
    throw new Error(
      'No DocTrack data was found. Paste the text exactly as it was exported, including the BEGIN and END marker lines.'
    );
  }
  const results: Envelope[] = [];
  const errors: string[] = [];
  for (const chunk of chunks) {
    try {
      results.push(await decodeChunk(chunk));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unreadable block');
    }
  }
  if (results.length === 0) {
    throw new Error(errors[0] ?? 'The pasted text could not be recognised.');
  }
  return results;
}

// ---------------------------------------------------------------------------
// Normalisation. Imported data is untrusted: only known fields are kept and
// records without the minimum required shape are rejected.
// ---------------------------------------------------------------------------

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
  );
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function recordId(record: Record<string, unknown>, prefix: string): string | null {
  const id = str(record.id);
  if (!id) return null;
  if (id.length > 200) return null;
  return id.startsWith(prefix) || prefix === '' ? id : id;
}

export interface NormalizeResult {
  snapshot: DataSnapshot;
  invalid: number;
  conflicts: ImportConflict[];
}

/**
 * Converts a raw envelope payload to a safe snapshot. Unknown properties are
 * dropped; invalid records are counted so the preview can report them.
 */
export function normalizeSnapshotData(
  data: Record<string, unknown>,
  kind: ExportKind
): NormalizeResult {
  const snapshot = emptySnapshot();
  let invalid = 0;
  const conflicts: ImportConflict[] = [];

  const take = <T>(key: string, mapper: (record: Record<string, unknown>) => T | null) => {
    const records = asArray(data[key]);
    for (const record of records) {
      if (!recordId(record, '')) {
        invalid += 1;
        continue;
      }
      const mapped = mapper(record);
      if (!mapped) {
        invalid += 1;
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (snapshot as any)[key].push(mapped);
    }
  };

  if (kind === 'full' || kind === 'leave') {
    take('profiles', (record) => {
      const id = recordId(record, 'profile');
      if (!id) return null;
      return {
        id,
        prefix: str(record.prefix, 'Dr.'),
        name: str(record.name),
        employeeId: str(record.employeeId),
        department: str(record.department),
        designation: str(record.designation),
        speciality: str(record.speciality),
        unit: str(record.unit),
        hospitalName: str(record.hospitalName),
        role: (['doctor', 'hod', 'hr', 'clerk', 'nurse', 'other'].includes(str(record.role))
          ? str(record.role)
          : 'doctor') as DoctorProfile['role'],
        contactEmail: str(record.contactEmail),
        contactPhone: str(record.contactPhone),
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full') {
    take('organisations', (record) => {
      const id = recordId(record, 'org');
      if (!id) return null;
      return {
        id,
        name: str(record.name, 'Imported organisation'),
        kind: 'other' as const,
        address: str(record.address),
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
    take('employments', (record) => {
      const id = recordId(record, 'emp');
      if (!id) return null;
      if (!isISODate(str(record.startDate))) return null;
      return {
        id,
        profileId: str(record.profileId),
        organisationId: str(record.organisationId),
        department: str(record.department),
        designation: str(record.designation),
        unit: str(record.unit),
        employmentType: (['permanent', 'temporary', 'visiting', 'contract'].includes(
          str(record.employmentType)
        )
          ? str(record.employmentType)
          : 'permanent') as 'permanent' | 'temporary' | 'visiting' | 'contract',
        startDate: str(record.startDate),
        endDate: isISODate(str(record.endDate)) ? str(record.endDate) : null,
        policyId: str(record.policyId) || null,
        isPrimary: bool(record.isPrimary),
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
    take('attendance', (record) => {
      const id = recordId(record, 'att');
      if (!id || !isISODate(str(record.date))) return null;
      return {
        id,
        profileId: str(record.profileId),
        date: str(record.date),
        state: str(record.state) === 'absent' ? ('absent' as const) : ('confirmed' as const),
        source: 'import' as const,
        note: str(record.note),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
    take('eventNames', (record) => {
      const id = recordId(record, 'evname');
      if (!id) return null;
      return {
        id,
        name: str(record.name),
        useCount: num(record.useCount, 1),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full' || kind === 'multiuser') {
    take('doctors', (record) => {
      const id = recordId(record, 'doctor');
      if (!id) return null;
      return {
        id,
        name: str(record.name),
        employeeId: str(record.employeeId),
        department: str(record.department),
        unit: str(record.unit),
        designation: str(record.designation),
        speciality: str(record.speciality),
        contactPhone: str(record.contactPhone),
        profileId: str(record.profileId) || null,
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });

    take('sharedLeaves', (record) => {
      const id = recordId(record, 'sharedleave');
      if (!id || !isISODate(str(record.startDate)) || !isISODate(str(record.endDate))) {
        return null;
      }
      return {
        id,
        doctorId: str(record.doctorId),
        doctorName: str(record.doctorName),
        employeeId: str(record.employeeId),
        department: str(record.department),
        startDate: str(record.startDate),
        endDate: str(record.endDate),
        category: str(record.category, 'CL').toUpperCase(),
        status: (['planned', 'pending', 'approved', 'rejected', 'cancelled'].includes(
          str(record.status)
        )
          ? str(record.status)
          : 'planned') as 'planned' | 'pending' | 'approved' | 'rejected' | 'cancelled',
        source: 'import' as const,
        reason: str(record.reason),
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full' || kind === 'leave') {
    take('leaves', (record) => {
      const id = recordId(record, 'leave');
      if (!id || !isISODate(str(record.startDate)) || !isISODate(str(record.endDate))) {
        return null;
      }
      return {
        id,
        profileId: str(record.profileId),
        employmentId: str(record.employmentId),
        policyId: str(record.policyId),
        policyVersionId: str(record.policyVersionId),
        category: str(record.category, 'CL').toUpperCase(),
        startDate: str(record.startDate),
        endDate: str(record.endDate),
        halfDay:
          record.halfDay === 'first' || record.halfDay === 'second' ? record.halfDay : null,
        calendarDays: num(record.calendarDays, 1),
        leaveDays: num(record.leaveDays, 1),
        status: (['planned', 'pending', 'approved', 'rejected', 'cancelled'].includes(
          str(record.status)
        )
          ? str(record.status)
          : 'planned') as 'planned' | 'pending' | 'approved' | 'rejected' | 'cancelled',
        approvalRequired: bool(record.approvalRequired, true),
        approvalState: (['not-required', 'pending', 'approved', 'rejected'].includes(
          str(record.approvalState)
        )
          ? str(record.approvalState)
          : 'pending') as 'not-required' | 'pending' | 'approved' | 'rejected',
        approvalNote: str(record.approvalNote),
        reason: str(record.reason),
        notes: str(record.notes),
        source: 'import' as const,
        plannedWithPolicyVersionId: null,
        ledgerTransactionIds: Array.isArray(record.ledgerTransactionIds)
          ? record.ledgerTransactionIds.filter((item): item is string => typeof item === 'string')
          : [],
        cancelledAt: str(record.cancelledAt) || null,
        cancellationReason: str(record.cancellationReason),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });

    take('ledger', (record) => {
      const id = recordId(record, '');
      if (!id || !isISODate(str(record.effectiveDate))) return null;
      const direction = str(record.direction);
      if (direction !== 'credit' && direction !== 'debit') return null;
      if (typeof record.amount !== 'number' || record.amount < 0) return null;
      return {
        id,
        profileId: str(record.profileId),
        employmentId: str(record.employmentId),
        category: str(record.category, 'CL').toUpperCase(),
        direction,
        amount: num(record.amount),
        unit: 'days' as const,
        effectiveDate: str(record.effectiveDate),
        transactionDate: str(record.transactionDate, new Date().toISOString()),
        source: 'import' as const,
        reason: str(record.reason),
        notes: str(record.notes),
        approvalStatus: (['not-required', 'pending', 'approved', 'rejected'].includes(
          str(record.approvalStatus)
        )
          ? str(record.approvalStatus)
          : 'approved') as 'not-required' | 'pending' | 'approved' | 'rejected',
        expiryDate: isISODate(str(record.expiryDate)) ? str(record.expiryDate) : null,
        relatedTransactionId: str(record.relatedTransactionId) || null,
        leaveRequestId: str(record.leaveRequestId) || null,
        reversalOf: str(record.reversalOf) || null,
        allocations: null,
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });

    take('pdos', (record) => {
      const id = recordId(record, 'pdo');
      if (!id || !isISODate(str(record.date))) return null;
      return {
        id,
        profileId: str(record.profileId),
        employmentId: str(record.employmentId),
        dutyId: str(record.dutyId),
        date: str(record.date),
        status: (['scheduled', 'converted-holiday', 'converted-worked', 'converted-unused', 'cancelled'].includes(
          str(record.status)
        )
          ? str(record.status)
          : 'scheduled') as
          | 'scheduled'
          | 'converted-holiday'
          | 'converted-worked'
          | 'converted-unused'
          | 'cancelled',
        punchOutAt: str(record.punchOutAt) || null,
        cclTransactionId: str(record.cclTransactionId) || null,
        approvalRequired: bool(record.approvalRequired),
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });

    take('duties', (record) => {
      const id = recordId(record, 'duty');
      if (!id || !isISODate(str(record.date))) return null;
      return {
        id,
        profileId: str(record.profileId),
        employmentId: str(record.employmentId),
        date: str(record.date),
        shiftId: str(record.shiftId, 'shift_night_24h'),
        shiftName: str(record.shiftName, 'Duty'),
        startTime: str(record.startTime, '09:00'),
        endTime: str(record.endTime, '09:00'),
        crossesMidnight: bool(record.crossesMidnight, true),
        durationHours: num(record.durationHours, 24),
        status: (['planned', 'completed', 'cancelled'].includes(str(record.status))
          ? str(record.status)
          : 'planned') as 'planned' | 'completed' | 'cancelled',
        qualifyingDay: bool(record.qualifyingDay),
        remarks: str(record.remarks),
        swap: null,
        rosterEntryId: str(record.rosterEntryId) || null,
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full' || kind === 'policy') {
    take('policies', (record) => {
      const id = recordId(record, 'policyver');
      if (!id || !isISODate(str(record.effectiveFrom))) return null;
      if (!Array.isArray(record.categories) || !Array.isArray(record.rules)) return null;
      if (typeof record.work !== 'object' || record.work === null) return null;
      if (!Array.isArray(record.shifts)) return null;
      return {
        id,
        policyId: str(record.policyId, 'policy_imported'),
        version: num(record.version, 1),
        status: (['draft', 'published', 'archived'].includes(str(record.status))
          ? str(record.status)
          : 'draft') as 'draft' | 'published' | 'archived',
        name: str(record.name, 'Imported policy'),
        description: str(record.description),
        organisationId: str(record.organisationId) || null,
        department: str(record.department) || null,
        designation: str(record.designation) || null,
        employmentType: str(record.employmentType) || null,
        effectiveFrom: str(record.effectiveFrom),
        effectiveTo: isISODate(str(record.effectiveTo)) ? str(record.effectiveTo) : null,
        categories: record.categories as never,
        rules: record.rules as never,
        work: record.work as never,
        shifts: record.shifts as never,
        changeSummary: str(record.changeSummary),
        source: str(record.source, 'Imported'),
        notes: str(record.notes),
        publishedAt: str(record.publishedAt) || null,
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full' || kind === 'holidays') {
    take('holidays', (record) => {
      const id = recordId(record, '');
      if (!id || !isISODate(str(record.date))) return null;
      const holidayKind = str(record.kind);
      if (holidayKind !== 'GH' && holidayKind !== 'RH') return null;
      return {
        id,
        year: num(record.year, Number(str(record.date).slice(0, 4))),
        date: str(record.date),
        name: str(record.name, 'Holiday'),
        kind: holidayKind,
        source: 'imported' as const,
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full' || kind === 'roster') {
    take('rosters', (record) => {
      const id = recordId(record, 'roster');
      if (!id) return null;
      if (!Array.isArray(record.entries)) return null;
      const year = num(record.year);
      const month = num(record.month);
      if (year < 1990 || year > 2200 || month < 1 || month > 12) return null;
      return {
        id,
        profileId: str(record.profileId),
        year,
        month,
        title: str(record.title, 'Duty roster'),
        department: str(record.department),
        unit: str(record.unit),
        hospitalName: str(record.hospitalName),
        entries: record.entries as never,
        notes: str(record.notes),
        unitCount: num(record.unitCount, 4),
        unitStyle: (['roman', 'number', 'word'].includes(str(record.unitStyle))
          ? str(record.unitStyle)
          : 'roman') as 'roman' | 'number' | 'word',
        dateFormat: str(record.dateFormat, 'dd MMM yyyy') as
          | 'dd MMM yyyy'
          | 'dd/MM/yyyy'
          | 'MM/dd/yyyy'
          | 'yyyy-MM-dd'
          | 'EEE, dd MMM yyyy'
          | 'dd MMM yyyy (EEE)'
          | 'dd-MM-yyyy',
        showLeaveWarnings: record.showLeaveWarnings !== false,
        leaveWarningStatuses: (Array.isArray(record.leaveWarningStatuses)
          ? record.leaveWarningStatuses
          : ['planned', 'pending', 'approved']) as never,
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });
  }

  if (kind === 'full') {
    take('events', (record) => {
      const id = recordId(record, 'event');
      if (!id || !isISODate(str(record.date))) return null;
      return {
        id,
        profileId: str(record.profileId),
        title: str(record.title, 'Event'),
        date: str(record.date),
        endDate: isISODate(str(record.endDate)) ? str(record.endDate) : null,
        type: str(record.type, 'other') as
          | 'academic'
          | 'exam'
          | 'invigilation'
          | 'meeting'
          | 'conference'
          | 'personal'
          | 'other',
        allDay: bool(record.allDay, true),
        startTime: str(record.startTime) || null,
        endTime: str(record.endTime) || null,
        notes: str(record.notes),
        createdAt: str(record.createdAt, new Date().toISOString()),
        updatedAt: str(record.updatedAt, new Date().toISOString())
      };
    });

    const settingsRecord = asArray(data.settings)[0];
    if (settingsRecord && typeof settingsRecord === 'object') {
      snapshot.settings = [settingsRecord as unknown as AppSettings];
    }
  }

  // Sanity: duplicate IDs within a collection are a conflict, not a merge.
  for (const key of SNAPSHOT_COLLECTIONS) {
    const seen = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (snapshot as any)[key] as { id: string }[];
    for (const item of list) {
      if (seen.has(item.id)) {
        conflicts.push({
          collection: key,
          id: item.id,
          message: 'The imported data contains this record more than once.'
        });
      }
      seen.add(item.id);
    }
  }

  return { snapshot, invalid, conflicts };
}

export function mergeSnapshots(parts: DataSnapshot[]): DataSnapshot {
  const merged = emptySnapshot();
  for (const key of SNAPSHOT_COLLECTIONS) {
    const seen = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = (merged as any)[key] as { id: string }[];
    for (const part of parts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of (part as any)[key] as { id: string }[]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        target.push(item);
      }
    }
  }
  merged.settings = parts.flatMap((part) => part.settings).slice(0, 1);
  return merged;
}

export function summaryLines(env: Envelope, snapshot: DataSnapshot): ImportSummaryLine[] {
  const lines: ImportSummaryLine[] = [];
  const profile = snapshot.profiles[0];
  if (profile) {
    lines.push({
      label: 'Doctor',
      detail: `${profile.prefix} ${profile.name} · ${profile.employeeId || 'no employee ID'} · ${profile.department || 'no department'}`
    });
  }
  const names = [...new Set(snapshot.policies.map((policy) => `${policy.name} v${policy.version}`))];
  if (names.length) {
    lines.push({ label: 'Policies', detail: names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '') });
  }
  if (snapshot.leaves.length) {
    const dates = snapshot.leaves.map((leave) => leave.startDate).sort();
    lines.push({
      label: 'Leave records',
      detail: `${snapshot.leaves.length} request(s), ${dates[0]} to ${dates[dates.length - 1]}`
    });
  }
  if (snapshot.ledger.length) {
    lines.push({ label: 'Ledger entries', detail: `${snapshot.ledger.length} credit/debit entries` });
  }
  if (snapshot.duties.length) {
    lines.push({ label: 'Duties', detail: `${snapshot.duties.length} duty record(s)` });
  }
  if (snapshot.holidays.length) {
    const years = [...new Set(snapshot.holidays.map((holiday) => holiday.year))].sort();
    lines.push({
      label: 'Holidays',
      detail: `${snapshot.holidays.length} holiday(s) for ${years.join(', ')}`
    });
  }
  if (snapshot.rosters.length) {
    lines.push({
      label: 'Rosters',
      detail: snapshot.rosters.map((roster) => `${roster.month}/${roster.year}`).join(', ')
    });
  }
  if (snapshot.sharedLeaves.length) {
    lines.push({
      label: 'Shared leave',
      detail: `${snapshot.sharedLeaves.length} shared leave record(s) for ${snapshot.doctors.length} known doctor(s)`
    });
  }
  if (snapshot.events.length) {
    lines.push({ label: 'Events', detail: `${snapshot.events.length} calendar event(s)` });
  }
  return lines;
}

export function buildPreview(env: Envelope, snapshot: DataSnapshot, invalid: number, conflicts: ImportConflict[], rawChunks: number): ImportPreview {
  return {
    kind: env.kind,
    label: env.label,
    createdAt: env.createdAt,
    counts: countSnapshot(snapshot),
    lines: summaryLines(env, snapshot),
    conflicts,
    invalidCount: invalid,
    snapshot,
    rawChunks
  };
}
