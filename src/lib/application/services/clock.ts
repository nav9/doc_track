import type { ISODate } from '../../domain/common/types';
import { todayLocal, localTime } from '../../domain/common/dates';
import type { AppSettings } from '../../domain/settings/types';

/**
 * All date-dependent operations use this clock so that the manual time override
 * in Settings is applied consistently. Simulated time is always shown in the UI
 * so it can never be mistaken for the device clock.
 */
export class Clock {
  constructor(private readonly readSettings: () => AppSettings | undefined) {}

  now(): Date {
    const settings = this.readSettings();
    if (settings?.manualNowEnabled && settings.manualNow) {
      const parsed = new Date(settings.manualNow);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  nowISO(): string {
    return this.now().toISOString();
  }

  today(): ISODate {
    return todayLocal(this.now());
  }

  time(): string {
    return localTime(this.now());
  }

  isSimulated(): boolean {
    const settings = this.readSettings();
    return Boolean(settings?.manualNowEnabled && settings.manualNow);
  }

  deviceNowISO(): string {
    return new Date().toISOString();
  }
}
