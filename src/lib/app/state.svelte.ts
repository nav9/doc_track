/**
 * Reactive application store.
 *
 * It owns the single in-memory snapshot, the persisted settings and the derived
 * balances. Every mutation goes through `perform`, which calls an application
 * service, reloads the snapshot and reports the outcome. Components never talk
 * to IndexedDB or the engines directly.
 */
import { AppServices } from '../application/services/appServices';
import { messageOf } from '../application/services/errors';
import type { DataSnapshot } from '../application/dto/snapshot';
import { emptySnapshot } from '../application/dto/snapshot';
import type { AppSettings } from '../domain/settings/types';
import type { CategoryBalance } from '../domain/ledger/types';
import type { PolicyVersion } from '../domain/policy/types';
import type { DoctorProfile, EmploymentRecord } from '../domain/profile/profile';
import { createRepositories } from '../infrastructure/repositories/idbRepositories';
import { downloadText } from '../infrastructure/files/files';
import { todayLocal } from '../domain/common/dates';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

export interface ActionError {
  message: string;
  reasons: string[];
}

class AppStore {
  services = $state<AppServices | null>(null);
  snapshot = $state<DataSnapshot>(emptySnapshot());
  settings = $state<AppSettings | null>(null);
  balances = $state<Record<string, CategoryBalance>>({});
  loading = $state(true);
  fatal = $state('');
  busy = $state(false);
  toasts = $state<Toast[]>([]);
  lastError = $state<ActionError | null>(null);
  storage = $state<{ usage: number; quota: number } | null>(null);

  private toastSequence = 0;

  get profile(): DoctorProfile | null {
    return this.snapshot.profiles[0] ?? null;
  }

  get employment(): EmploymentRecord | null {
    if (!this.services) return null;
    return this.services.primaryEmployment(this.snapshot);
  }

  get today(): string {
    if (this.services) return this.services.clock.today();
    return todayLocal();
  }

  get activePolicy(): PolicyVersion | null {
    if (!this.services) return null;
    return this.services.policyFor(this.snapshot, this.today, this.employment);
  }

  get categories() {
    return this.activePolicy?.categories.filter((category) => category.enabled) ?? [];
  }

  get isSimulated(): boolean {
    return Boolean(this.services?.clock.isSimulated());
  }

  get effectiveTheme(): 'light' | 'dark' {
    const theme = this.settings?.theme ?? 'light';
    if (theme !== 'system') return theme;
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  async init(): Promise<void> {
    this.loading = true;
    this.fatal = '';
    try {
      const repositories = await createRepositories();
      const services = new AppServices(repositories);
      this.services = services;
      this.snapshot = await services.init();
      this.settings = await services.getSettings();
      this.balances = await services.balances(this.snapshot);
      await this.readStorageEstimate();
    } catch (error) {
      this.fatal = messageOf(error);
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    if (!this.services) return;
    this.snapshot = await this.services.snapshot();
    this.settings = await this.services.getSettings();
    this.balances = await this.services.balances(this.snapshot);
  }

  /**
   * Runs a mutation, then reloads derived state. Errors are reported in a toast
   * and kept in `lastError` so a form can show the blocking reasons inline.
   */
  async perform<T>(
    work: (services: AppServices) => Promise<T>,
    successMessage?: string
  ): Promise<T | null> {
    const services = this.services;
    if (!services) return null;
    this.busy = true;
    this.lastError = null;
    try {
      const result = await work(services);
      await this.refresh();
      if (successMessage) this.notify('success', successMessage);
      return result;
    } catch (error) {
      const reasons =
        error && typeof error === 'object' && 'reasons' in error
          ? ((error as { reasons?: { message: string }[] }).reasons ?? []).map(
              (reason) => reason.message
            )
          : [];
      const message = messageOf(error);
      this.lastError = { message, reasons };
      this.notify('error', message);
      return null;
    } finally {
      this.busy = false;
    }
  }

  notify(tone: ToastTone, message: string): void {
    const id = (this.toastSequence += 1);
    this.toasts = [...this.toasts, { id, tone, message }];
    if (typeof window !== 'undefined') {
      window.setTimeout(() => this.dismissToast(id), tone === 'error' ? 8000 : 4500);
    }
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  async backupNow(): Promise<void> {
    await this.perform(async (services) => {
      const { text, filename } = await services.backupData();
      downloadText(filename, text);
    }, 'Backup downloaded. Keep the file outside the browser.');
  }

  async readStorageEstimate(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    try {
      const estimate = await navigator.storage.estimate();
      this.storage = { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    } catch {
      this.storage = null;
    }
  }
}

export const app = new AppStore();
