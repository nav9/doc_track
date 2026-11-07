import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function onboard(page: Page) {
  await page.goto('./');
  await page.getByLabel(/Full name/).fill('Asha Rao');
  await page.getByLabel(/Employee ID/).fill('MC-101');
  await page.getByLabel(/Department/).fill('General Medicine');
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
  return date.toISOString().slice(0, 10);
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

async function addLeave(page: Page, startOffset: number, endOffset: number) {
  await page.goto('./#/planner');
  await page.getByRole('tab', { name: 'Record leave' }).click();
  await page.getByRole('button', { name: /^Leave dates/ }).click();
  await pickCalendarDate(page, dateOffset(startOffset));
  await pickCalendarDate(page, dateOffset(endOffset));
  await page.getByLabel('Reason', { exact: true }).fill('Playwright journey');
  const save = page.getByRole('button', { name: 'Save as planned leave' });
  await expect(save).toBeEnabled();
  await save.click();
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
  await expect(page.getByRole('heading', { name: 'Recent leave records' })).toBeVisible();
});

test('attendance calendar toggles NMC punches without a dialog', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/attendance');
  await expect(page.getByRole('heading', { name: 'NMC attendance' })).toBeVisible();

  const target = previousWeekday();
  if (target.slice(0, 7) !== dateOffset(0).slice(0, 7)) {
    await page.getByRole('button', { name: 'Previous month' }).click();
  }

  const cell = page.getByRole('button', { name: target, exact: true });
  const assumedChip = cell.getByText('NMC punch', { exact: true });
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

test('quick planner proposes options and clears them', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/planner');
  await expect(page.getByRole('heading', { name: 'Quick planner' })).toBeVisible();

  const planNow = page.getByRole('button', { name: 'Plan now' });
  await expect(planNow).toBeEnabled();
  for (const category of ['CL', 'EL', 'CCL', 'SpCL']) {
    await expect(page.getByRole('checkbox', { name: category, exact: true })).toBeChecked();
  }

  await planNow.click();
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Leave', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('Option 1', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();

  for (const category of ['CL', 'EL', 'CCL', 'SpCL']) {
    await page.getByRole('checkbox', { name: category, exact: true }).uncheck();
  }
  await expect(planNow).toBeDisabled();
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
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
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

  await page.getByRole('button', { name: 'Fill all days' }).first().click();
  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await page.getByRole('button', { name: 'Save roster' }).click();
  await expect(page.getByRole('button', { name: 'PDF preview' })).toBeEnabled();

  await page.getByRole('button', { name: 'PDF preview' }).click();
  const previewDialog = page.getByRole('dialog', { name: 'A4 roster PDF' });
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.getByText('DEPARTMENT OF GENERAL MEDICINE')).toBeVisible();
  await expect(previewDialog.getByText(/DOCTOR'S DUTY ROSTER FOR THE MONTH OF/)).toBeVisible();
  await expect(
    previewDialog.getByText('Note: No alteration to be made without the permission of the undersigned')
  ).toBeVisible();
  const preview = previewDialog.locator('.roster-preview-scroll');
  await expect(preview).toBeVisible();
  const previewMetrics = await preview.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    rows: element.querySelectorAll('tbody tr').length
  }));
  expect(previewMetrics.rows).toBeGreaterThan(10);
  expect(previewMetrics.overflowY).toBe('auto');
  expect(previewMetrics.scrollHeight).toBeGreaterThan(previewMetrics.clientHeight);
  await preview.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const downloadButton = page.getByRole('button', { name: 'Download PDF' });
  await expect(downloadButton).toBeEnabled();
  const pending = page.waitForEvent('download');
  await downloadButton.click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error('The browser did not expose the PDF download.');
  const pdf = await readFile(path);

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.byteLength).toBeGreaterThan(1_000);
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
  await page.getByRole('button', { name: 'Fill all days' }).first().click();
  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await page.getByRole('button', { name: 'Save roster' }).click();
  await expect(page.getByRole('button', { name: 'PDF preview' })).toBeEnabled();

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
  await expect(page.getByRole('heading', { name: 'Multi User', exact: true }).first()).toBeVisible();

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
