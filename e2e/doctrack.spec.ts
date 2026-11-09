import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function onboard(page: Page) {
  await page.goto('./');
  await page.getByLabel(/Full name/).fill('Asha Rao');
  await page.getByLabel(/Employee ID/).fill('MC-101');
  await page.getByLabel(/Department/).fill('General Medicine');
  await page.getByLabel(/Designation/).fill('Senior Resident');
  await page.getByLabel(/Medical college \/ hospital/).fill('Medical College Hospital');
  await page.getByLabel(/Joining date/).fill('2020-01-01');
  await page.getByRole('button', { name: 'Create profile' }).click();
  await expect(page.getByRole('link', { name: 'Planner' })).toBeVisible();
}

async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('doctrack');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(name)) {
            resolve(0);
            return;
          }
          const count = db.transaction(name, 'readonly').objectStore(name).count();
          count.onerror = () => reject(count.error);
          count.onsuccess = () => resolve(count.result);
        };
      }),
    store
  );
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousWeekday(): string {
  const date = new Date();
  do {
    date.setDate(date.getDate() - 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function attendanceState(page: Page, date: string): Promise<string | null> {
  return page.evaluate(
    (target) =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open('doctrack');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('attendance', 'readonly').objectStore('attendance').getAll();
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            const record = read.result.find((item: { date: string }) => item.date === target);
            resolve(record?.state ?? null);
          };
        };
      }),
    date
  );
}

async function pickCalendarDate(page: Page, date: string) {
  const selector = `[data-value="${date}"]:not([data-outside-month])`;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const cell = page.locator(selector);
    if ((await cell.count()) > 0) {
      await cell.first().click();
      return;
    }
    await page.getByRole('button', { name: 'Next month' }).click();
  }
  throw new Error(`Could not find ${date} in the date range calendar.`);
}

async function pickPlannerDate(page: Page, offset: number) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const date = dateOffset(offset + attempt);
    const cell = page.locator(`[data-planner-date="${date}"]`);
    if ((await cell.count()) === 0) continue;
    if (await cell.evaluate((element) => element.classList.contains('eligible'))) {
      await cell.click();
      return;
    }
  }
  throw new Error(`Could not find an eligible planner date near offset ${offset}.`);
}

async function addLeave(page: Page, startOffset: number, endOffset: number) {
  await page.goto('./#/planner');
  await page.getByRole('button', { name: /^\d+(?:\.\d+)? CL$/ }).click();
  await expect(page.locator('.planner-day.eligible').first()).toBeVisible();
  for (const offset of new Set([startOffset, endOffset])) {
    await pickPlannerDate(page, offset);
  }
  await page.getByRole('button', { name: 'Confirm leaves' }).click();
  await page.getByLabel('Purpose of leave').fill('Playwright journey');
  await page.getByLabel('Covering doctor').fill('Dr. Meera Iyer');
  const save = page.getByRole('button', { name: 'Confirm', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Leaves added to the ledger.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function downloadText(page: Page, trigger: () => Promise<void>): Promise<string> {
  const pending = page.waitForEvent('download');
  await trigger();
  const download: Download = await pending;
  const path = await download.path();
  if (!path) throw new Error('The browser did not expose the downloaded file.');
  return readFile(path, 'utf8');
}

test('onboarding persists a profile across reloads', async ({ page }) => {
  await onboard(page);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Planner' })).toBeVisible();
  await expect(page.getByText('Asha Rao').first()).toBeVisible();
  expect(await countStore(page, 'profiles')).toBe(1);
});

test('leave planning records a validated leave in the ledger', async ({ page }) => {
  await onboard(page);
  await addLeave(page, 10, 11);
  await expect.poll(() => countStore(page, 'leaves')).toBe(1);
  await expect.poll(() => countStore(page, 'ledger')).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'View ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Leave ledger' })).toBeVisible();
  await expect(page.getByText('Leave history')).toBeVisible();
});

test('attendance calendar toggles NMC punches without a dialog', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/attendance');
  await expect(page.locator('.topbar-title')).toHaveText('NMC attendance');

  const target = previousWeekday();
  if (target.slice(0, 7) !== dateOffset(0).slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }

  const cell = page.getByRole('button', { name: target, exact: true });
  const assumedChip = cell.getByText('NMC', { exact: true });
  await expect(assumedChip).toBeVisible();
  const cellBox = await cell.boundingBox();
  const chipBox = await assumedChip.boundingBox();
  expect(cellBox).not.toBeNull();
  expect(chipBox).not.toBeNull();
  if (cellBox && chipBox) expect(chipBox.width).toBeLessThanOrEqual(cellBox.width);
  expect(await assumedChip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true
  );

  await cell.click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(assumedChip).toBeHidden();
  await expect(cell.getByText('NMC', { exact: true })).toBeHidden();
  await expect(cell.getByText('Absent', { exact: true })).toBeHidden();
  await expect.poll(() => attendanceState(page, target)).toBe('absent');

  await cell.click();
  await expect(cell.getByText('NMC', { exact: true })).toBeVisible();
  await expect.poll(() => attendanceState(page, target)).toBe('confirmed');
});

test('leave planner toggles types and opens the full ledger', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/planner');
  await expect(page.getByText('Click a leave type and tap on a date')).toBeVisible();

  const cl = page.getByRole('button', { name: /^\d+(?:\.\d+)? CL$/ });
  await expect(cl).toHaveAttribute('aria-pressed', 'false');
  await cl.click();
  await expect(cl).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.planner-day.eligible').first()).toBeVisible();

  await page.getByRole('button', { name: 'Show more leave types' }).click();
  await expect(page.getByRole('button', { name: /^\d+(?:\.\d+)? PL$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'LOP', exact: true })).toBeEnabled();

  await cl.click();
  await expect(page.locator('.planner-day.eligible')).toHaveCount(0);

  await page.getByRole('button', { name: 'View ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Leave ledger' })).toBeVisible();
  await expect(page.getByText('Leave history', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close leave ledger' }).click();
  await expect(page.getByRole('heading', { name: 'Leave ledger' })).toBeHidden();
});

test('a pending planner leave can be altered and reapplied', async ({ page }) => {
  await onboard(page);
  await addLeave(page, 10, 10);

  const leaveChip = page.locator('.planner-chip-cl').first();
  await expect(leaveChip).toBeVisible();
  await leaveChip.click();
  await expect(page.getByRole('heading', { name: 'Day actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Alter this leave' }).click();

  await expect(page.getByRole('button', { name: 'Confirm leaves' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm leaves' }).click();
  await expect(page.getByLabel('Purpose of leave')).toHaveValue('Playwright journey');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Leaves added to the ledger.').first()).toBeVisible();
  await expect.poll(() => countStore(page, 'leaves')).toBe(2);
  await expect.poll(() => countStore(page, 'ledger')).toBeGreaterThan(1);
});

test('a downloaded backup imports and restores through version history', async ({ page }) => {
  await onboard(page);
  await addLeave(page, 10, 10);
  await addLeave(page, 14, 14);
  await expect.poll(() => countStore(page, 'leaves')).toBe(2);

  await page.goto('./#/settings');
  const backup = await downloadText(page, () =>
    page.getByRole('button', { name: 'Download full backup' }).click()
  );
  expect(backup).toContain('-----BEGIN DOCTRACK DATA-----');
  expect(backup).toContain('-----END DOCTRACK DATA-----');

  await addLeave(page, 20, 20);
  await expect.poll(() => countStore(page, 'leaves')).toBe(3);

  await page.goto('./#/settings');
  await page.getByLabel('Paste an exported block').fill(backup);
  await page.getByRole('button', { name: 'Preview import' }).click();
  await page.getByRole('button', { name: 'Apply import' }).click();
  await expect.poll(() => countStore(page, 'leaves')).toBe(2);

  await page.goto('./#/versions');
  await expect(page.locator('.topbar-title')).toHaveText('Version history');
  await expect(page.getByText(/Before import/i).first()).toBeVisible();
  await page.getByRole('button', { name: /Restore/ }).first().click();
  await page.getByRole('button', { name: 'Restore snapshot' }).click();
  await expect.poll(() => countStore(page, 'leaves')).toBe(3);
});

test('roster PDF downloads as a real PDF', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/roster');
  await expect(page.getByText('Central doctor list')).toHaveCount(0);
  await page.getByRole('button', { name: 'Doctor names list' }).click();
  const doctorDialog = page.getByRole('dialog', { name: 'Doctor names list' });
  await expect(doctorDialog).toBeVisible();
  await expect(doctorDialog.getByText(/No doctors in the central list yet/)).toBeVisible();
  await doctorDialog.getByRole('button', { name: 'Close' }).click();
  await expect(doctorDialog).toBeHidden();

  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await expect.poll(() => countStore(page, 'rosters')).toBe(1);

  const downloadButton = page.getByRole('button', { name: 'Download as PDF' });
  await expect(downloadButton).toBeEnabled();
  const pending = page.waitForEvent('download');
  await downloadButton.click();
  const download = await pending;
  await expect(page.getByText('PDF generated and downloaded successfully.')).toBeVisible();
  const path = await download.path();
  if (!path) throw new Error('The browser did not expose the PDF download.');
  const pdf = await readFile(path);

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(1_000);
});

test('roster doctor prefixes and roster transfers keep doctor metadata', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await onboard(page);
  await page.goto('./#/roster');

  await page.getByRole('button', { name: 'Doctor names list' }).click();
  const doctorDialog = page.getByRole('dialog', { name: 'Doctor names list' });
  await doctorDialog.getByLabel('Prefix').fill('Dr. ');
  await doctorDialog.getByLabel("Doctor's name").fill('Meera Nair');
  await doctorDialog.getByLabel('Employee ID').fill('MC-777');
  await doctorDialog.getByLabel('Department').fill('General Medicine');
  await doctorDialog.getByRole('button', { name: 'Add doctor' }).click();
  await expect(page.getByText('Dr. Meera Nair added to the doctor list.')).toBeVisible();
  await expect(doctorDialog.getByLabel("Doctor's name")).toBeFocused();
  await expect(doctorDialog.getByLabel("Doctor's name")).toHaveValue('');

  const readDoctors = () =>
    page.evaluate(
      () =>
        new Promise<{ prefix: string; name: string; employeeId: string }[]>((resolve, reject) => {
          const request = indexedDB.open('doctrack');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const read = request.result
              .transaction('doctors', 'readonly')
              .objectStore('doctors')
              .getAll();
            read.onerror = () => reject(read.error);
            read.onsuccess = () => resolve(read.result);
          };
        })
    );
  expect(await readDoctors()).toContainEqual(
    expect.objectContaining({ prefix: 'Dr.', name: 'Dr. Meera Nair', employeeId: 'MC-777' })
  );
  await doctorDialog.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await expect.poll(() => countStore(page, 'rosters')).toBe(1);
  await page.getByRole('button', { name: 'Export roster' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export roster' });
  await expect(exportDialog.getByText('Dr. Meera Nair').first()).toBeVisible();
  await exportDialog.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(page.getByText('Roster export copied to the clipboard.')).toBeVisible();
  const exported = await page.evaluate(() => navigator.clipboard.readText());
  expect(exported).toContain('-----BEGIN DOCTRACK DATA-----');
  expect(exported).toContain('"section":"roster"');
  await exportDialog.getByRole('button', { name: 'Close' }).last().click();

  await page.getByRole('button', { name: 'Doctor names list' }).click();
  const doctorDialogAgain = page.getByRole('dialog', { name: 'Doctor names list' });
  page.once('dialog', (dialog) => void dialog.accept());
  await doctorDialogAgain.getByRole('button', { name: 'Remove' }).last().click();
  await expect(doctorDialogAgain.getByText('Dr. Meera Nair')).toHaveCount(0);
  await doctorDialogAgain.getByRole('button', { name: 'Close' }).click();

  await page.evaluate((text) => navigator.clipboard.writeText(text), exported);
  await page.getByRole('button', { name: 'Import roster' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import roster' });
  await importDialog.getByRole('button', { name: 'Paste from clipboard' }).click();
  await expect(importDialog.getByText('This replaces the existing roster.')).toBeVisible();
  await expect(importDialog.getByText('Dr. Meera Nair').first()).toBeVisible();
  await importDialog.getByRole('button', { name: 'Use this data' }).click();
  await expect(page.getByText('Roster imported. New doctors were added and existing doctor details were kept.')).toBeVisible();
  expect(await readDoctors()).toContainEqual(
    expect.objectContaining({ prefix: 'Dr.', name: 'Dr. Meera Nair', employeeId: 'MC-777' })
  );
  await expect(page.locator('.duty-table')).toBeVisible();
});

test('holiday prefill, suggestions and import restore the holiday list', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await onboard(page);
  await page.goto('./#/holidays');

  await page.getByRole('button', { name: 'Prefill' }).click();
  await expect(page.getByText('4 fixed holidays added.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Republic Day' })).toBeVisible();

  const pdfPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create PDF' }).click();
  const pdfDownload = await pdfPending;
  await expect(page.getByText(/Holiday list PDF for \d{4} downloaded/)).toBeVisible();
  const pdfPath = await pdfDownload.path();
  if (!pdfPath) throw new Error('The browser did not expose the holiday PDF download.');
  const pdf = await readFile(pdfPath);
  expect(pdfDownload.suggestedFilename()).toMatch(/^DocTrack_Holidays_\d{4}\.pdf$/);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(1_000);

  const nameInput = page.getByLabel('Holiday name');
  await nameInput.fill('Repulic');
  await expect(page.locator('.holiday-suggestion').filter({ hasText: 'Republic Day' })).toBeVisible();
  await nameInput.fill('');

  const holidayYear = await page.getByLabel('Year').inputValue();
  await page.getByRole('button', { name: `Export ${holidayYear}` }).click();
  const exportDialog = page.getByRole('dialog', { name: `Export holidays ${holidayYear}` });
  await exportDialog.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(page.getByText('Holiday list copied to the clipboard.')).toBeVisible();
  const exported = await page.evaluate(() => navigator.clipboard.readText());
  expect(exported).toContain('"section":"holidays"');
  await exportDialog.getByRole('button', { name: 'Close' }).last().click();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove Republic Day' }).click();
  await expect(page.getByRole('button', { name: 'Remove Republic Day' })).toHaveCount(0);

  await page.evaluate((text) => navigator.clipboard.writeText(text), exported);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import holiday list' });
  await importDialog.getByRole('button', { name: 'Paste from clipboard' }).click();
  await expect(importDialog.getByText(/Some dates already exist/)).toBeVisible();
  await importDialog.getByRole('button', { name: 'Use this data' }).click();
  await expect(page.getByText('Holidays imported into the calendar.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Republic Day' })).toBeVisible();
});

test('previous month action appears only when an earlier roster is saved', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/roster');
  const usePrevious = page.getByRole('button', { name: 'Use previous month' });
  await expect(usePrevious).toHaveCount(0);

  const monthSelect = page.getByRole('combobox', { name: 'Month', exact: true });
  const yearInput = page.getByRole('spinbutton', { name: 'Year', exact: true });
  const initialMonth = Number(await monthSelect.inputValue());
  const initialYear = Number(await yearInput.inputValue());
  const previousMonth = initialMonth === 1 ? 12 : initialMonth - 1;
  const previousYear = initialMonth === 1 ? initialYear - 1 : initialYear;

  if (previousYear !== initialYear) {
    await yearInput.fill(String(previousYear));
    await yearInput.press('Tab');
  }
  await monthSelect.selectOption(String(previousMonth));
  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await expect.poll(() => countStore(page, 'rosters')).toBe(1);
  await expect(page.getByRole('button', { name: 'Download as PDF' })).toBeEnabled();

  if (previousYear !== initialYear) {
    await yearInput.fill(String(initialYear));
    await yearInput.press('Tab');
  }
  await monthSelect.selectOption(String(initialMonth));
  await expect(usePrevious).toBeVisible();
});

test('multi user saves a known doctor and shared leave', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/multi-user');
  await expect(page.locator('.topbar-title')).toHaveText('Multi User');

  await page.getByRole('button', { name: 'Add doctor', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a known doctor' });
  await dialog.getByLabel("Doctor's name").fill('Dr. Meera Nair');
  await dialog.getByLabel('Employee ID').fill('MC-900');
  await dialog.getByLabel('Department').fill('Orthopaedics');
  await dialog.getByLabel('Designation').fill('Senior Resident');
  await dialog.getByLabel('Speciality').fill('Joint Replacement');
  await dialog.getByRole('button', { name: 'Save doctor' }).click();

  await expect(page.getByText('Dr. Meera Nair').first()).toBeVisible();
  const dutyDate = await page.getByLabel('Duty date').inputValue();
  await page.getByRole('combobox', { name: 'Doctor', exact: true }).selectOption({
    label: 'Dr. Meera Nair · MC-900'
  });
  await page.getByRole('button', { name: /^Leave dates/ }).click();
  await pickCalendarDate(page, dutyDate);
  await pickCalendarDate(page, dutyDate);
  await page.getByRole('button', { name: 'Add temporary leave' }).click();
  await expect.poll(() => countStore(page, 'sharedLeaves')).toBe(1);
  await expect(page.getByText('On leave').first()).toBeVisible();
});

test('leave approvals exports selected rows and imports reviewed applications', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await onboard(page);
  await page.goto('./#/multi-user');

  await page.getByRole('button', { name: 'Add doctor', exact: true }).click();
  const doctorDialog = page.getByRole('dialog', { name: 'Add a known doctor' });
  await doctorDialog.getByLabel("Doctor's name").fill('Dr. Meera Nair');
  await doctorDialog.getByLabel('Employee ID').fill('MC-900');
  await doctorDialog.getByLabel('Department').fill('Orthopaedics');
  await doctorDialog.getByLabel('Designation').fill('Senior Resident');
  await doctorDialog.getByRole('button', { name: 'Save doctor' }).click();

  const dutyDate = await page.getByLabel('Duty date').inputValue();
  await page.getByRole('combobox', { name: 'Doctor', exact: true }).selectOption({
    label: 'Dr. Meera Nair · MC-900'
  });
  await page.getByRole('button', { name: /^Leave dates/ }).click();
  await pickCalendarDate(page, dutyDate);
  await pickCalendarDate(page, dutyDate);
  await page.getByRole('button', { name: 'Add temporary leave' }).click();
  await expect.poll(() => countStore(page, 'sharedLeaves')).toBe(1);

  await page.getByRole('link', { name: 'Leave approvals' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Leave approvals');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.getByLabel('Approval status').selectOption('all');
  await expect(page.locator('.application-row').filter({ hasText: 'Dr. Meera Nair' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByRole('button', { name: 'Select none' })).toBeVisible();
  await page.getByRole('button', { name: 'Select none' }).click();
  await expect(page.getByRole('button', { name: 'Select all' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select all' }).click();
  const exported = await downloadText(page, () =>
    page.getByRole('button', { name: 'Export', exact: true }).click()
  );
  expect(exported).toContain('-----BEGIN DOCTRACK DATA-----');
  expect(exported).toContain('"section":"multiuser"');

  await page.evaluate((text) => navigator.clipboard.writeText(text), exported);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import leave applications' });
  await importDialog.getByRole('button', { name: 'Paste from clipboard' }).click();
  await expect(importDialog.getByText('Dr. Meera Nair').first()).toBeVisible();
  await expect(importDialog.getByText(/Some leave records are already in this app/)).toBeVisible();
  await importDialog.getByRole('button', { name: 'Proceed' }).click();
  await expect(page.getByText('Leave applications imported and ready for review.')).toBeVisible();
  await expect(page.getByLabel('Approval status')).toHaveValue('all');
  await expect(page.locator('.application-row').filter({ hasText: 'Dr. Meera Nair' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await expect.poll(() => countStore(page, 'sharedLeaves')).toBe(1);
});

test('academic events import through the header dialog', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await onboard(page);
  await page.goto('./#/events');

  await expect(page.getByText('Import events', { exact: true })).toHaveCount(0);
  await page.getByLabel('Event name').fill('Annual academic conference');
  await page.getByRole('checkbox', { name: 'Asha Rao' }).check();
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByText('Annual academic conference').first()).toBeVisible();

  const exported = await downloadText(page, () =>
    page.getByRole('button', { name: 'Export events' }).click()
  );
  expect(exported).toContain('"section":"events"');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove Annual academic conference' }).click();
  await expect(page.getByText('Annual academic conference')).toHaveCount(0);

  await page.evaluate((text) => navigator.clipboard.writeText(text), exported);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import events' });
  await importDialog.getByRole('button', { name: 'Paste from clipboard' }).click();
  await expect(importDialog.getByText('Annual academic conference').first()).toBeVisible();
  await expect(importDialog.getByText('Asha Rao').first()).toBeVisible();
  await importDialog.getByRole('button', { name: 'Apply import' }).click();
  await expect(page.getByText('Events imported and visible on the calendar.')).toBeVisible();
  await expect(importDialog).toBeHidden();
  await expect(page.getByText('Annual academic conference').first()).toBeVisible();
});
