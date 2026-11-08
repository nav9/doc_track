import type { AuditFields, ISODate, ValidationIssue } from '../common/types';
import { isISODate } from '../common/types';

export const NAME_PREFIXES = ['Dr.', 'Mr.', 'Ms.', 'Mrs.', 'Other'] as const;
export type NamePrefixOption = (typeof NAME_PREFIXES)[number];

export const USER_ROLES = ['doctor', 'hod', 'hr', 'clerk', 'nurse', 'other'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface DoctorProfile extends AuditFields {
  id: string;
  prefix: string;
  name: string;
  employeeId: string;
  department: string;
  designation: string;
  speciality: string;
  unit: string;
  hospitalName: string;
  role: UserRole;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}

export interface ProfileDraft {
  prefix: string;
  name: string;
  employeeId: string;
  department: string;
  designation?: string;
  speciality?: string;
  unit?: string;
  hospitalName?: string;
  role?: UserRole;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}

/** Fields the specification makes compulsory. */
export const COMPULSORY_PROFILE_FIELDS = [
  'prefix',
  'name',
  'employeeId',
  'department',
  'designation'
] as const;

export function emptyProfileDraft(): ProfileDraft {
  return {
    prefix: 'Dr.',
    name: '',
    employeeId: '',
    department: '',
    designation: '',
    speciality: '',
    unit: '',
    hospitalName: '',
    role: 'doctor',
    contactEmail: '',
    contactPhone: '',
    notes: ''
  };
}

/**
 * Validates the compulsory profile fields. Prefix "Other" requires the custom
 * prefix to be supplied separately in `resolvedPrefix`.
 */
export function validateProfileDraft(
  draft: ProfileDraft,
  resolvedPrefix?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const prefix = (resolvedPrefix ?? draft.prefix).trim();

  if (!prefix) {
    issues.push({
      code: 'PROFILE_PREFIX_REQUIRED',
      severity: 'error',
      field: 'prefix',
      message: 'Select a name prefix.'
    });
  }
  if (prefix.length > 24) {
    issues.push({
      code: 'PROFILE_PREFIX_TOO_LONG',
      severity: 'error',
      field: 'prefix',
      message: 'The name prefix must be 24 characters or fewer.'
    });
  }
  if (!draft.name.trim()) {
    issues.push({
      code: 'PROFILE_NAME_REQUIRED',
      severity: 'error',
      field: 'name',
      message: 'Enter the doctor’s name.'
    });
  }
  if (!draft.employeeId.trim()) {
    issues.push({
      code: 'PROFILE_EMPLOYEE_ID_REQUIRED',
      severity: 'error',
      field: 'employeeId',
      message: 'Enter the employee ID.'
    });
  }
  if (!draft.department.trim()) {
    issues.push({
      code: 'PROFILE_DEPARTMENT_REQUIRED',
      severity: 'error',
      field: 'department',
      message: 'Enter the department.'
    });
  }
  if (!draft.designation?.trim()) {
    issues.push({
      code: 'PROFILE_DESIGNATION_REQUIRED',
      severity: 'error',
      field: 'designation',
      message: 'Enter the designation.'
    });
  }
  if (draft.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.contactEmail.trim())) {
    issues.push({
      code: 'PROFILE_EMAIL_INVALID',
      severity: 'error',
      field: 'contactEmail',
      message: 'Enter a valid email address, or leave the field empty.'
    });
  }
  return issues;
}

export function displayName(profile: Pick<DoctorProfile, 'prefix' | 'name'>): string {
  return `${profile.prefix} ${profile.name}`.replace(/\s+/g, ' ').trim();
}

export function initials(profile: Pick<DoctorProfile, 'name'>): string {
  const parts = profile.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return `${parts[0][0] ?? ''}${parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''}`.toUpperCase();
}

export interface EmploymentRecord extends AuditFields {
  id: string;
  profileId: string;
  organisationId: string;
  department: string;
  designation: string;
  unit: string;
  employmentType: 'permanent' | 'temporary' | 'visiting' | 'contract';
  startDate: ISODate;
  endDate: ISODate | null;
  policyId: string | null;
  isPrimary: boolean;
  notes: string;
}

export interface Organisation extends AuditFields {
  id: string;
  name: string;
  kind: 'medical-college' | 'hospital' | 'clinic' | 'other';
  address: string;
  notes: string;
}

export function validateEmployment(record: EmploymentRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!record.organisationId) {
    issues.push({
      code: 'EMPLOYMENT_ORGANISATION_REQUIRED',
      severity: 'error',
      field: 'organisationId',
      message: 'An employment record must belong to an organisation.'
    });
  }
  if (!isISODate(record.startDate)) {
    issues.push({
      code: 'EMPLOYMENT_START_INVALID',
      severity: 'error',
      field: 'startDate',
      message: 'Enter a valid employment start date.'
    });
  }
  if (record.endDate && record.endDate < record.startDate) {
    issues.push({
      code: 'EMPLOYMENT_END_BEFORE_START',
      severity: 'error',
      field: 'endDate',
      message: 'The employment end date cannot be before the start date.'
    });
  }
  return issues;
}

/** True when `date` falls inside the employment period. */
export function isEmployedOn(
  record: Pick<EmploymentRecord, 'startDate' | 'endDate'>,
  date: ISODate
): boolean {
  return date >= record.startDate && (!record.endDate || date <= record.endDate);
}
