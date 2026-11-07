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

async function addLeave(page: Page, startOffset: number, endOffset: number) {
  await page.goto('./#/planner');
  await page.getByRole('tab', { name: 'Record leave' }).click();
  await page.getByRole('textbox', { name: 'From*', exact: true }).fill(dateOffset(startOffset));
  await page.getByRole('textbox', { name: 'To*', exact: true }).fill(dateOffset(endOffset));
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

test('quick planner proposes options and clears them', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/planner');
  await expect(page.getByRole('heading', { name: 'Quick planner' })).toBeVisible();

  const planNow = page.getByRole('button', { name: 'Plan now' });
  await expect(planNow).toBeEnabled();
  for (const category of ['CL', 'EL', 'CCL', 'SpCL']) {
    await expect(page.getByRole('checkbox', { name: category })).toBeChecked();
  }

  await planNow.click();
  await expect(page.getByText('Option 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Leave', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('Option 1', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Clear' })).toBeHidden();

  for (const category of ['CL', 'EL', 'CCL', 'SpCL']) {
    await page.getByRole('checkbox', { name: category }).uncheck();
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
  await page.getByRole('button', { name: 'Fill all days' }).first().click();
  await page.getByRole('button', { name: 'Auto assign doctors' }).click();
  await page.getByRole('button', { name: 'Save roster' }).click();
  await expect(page.getByRole('button', { name: 'PDF preview' })).toBeEnabled();

  await page.getByRole('button', { name: 'PDF preview' }).click();
  await expect(page.getByRole('dialog', { name: 'A4 roster PDF' })).toBeVisible();
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
  await page.getByLabel('From', { exact: true }).fill(dutyDate);
  await page.getByLabel('To', { exact: true }).fill(dutyDate);
  await page.getByRole('button', { name: 'Add temporary leave' }).click();
  await expect.poll(() => countStore(page, 'sharedLeaves')).toBe(1);
  await expect(page.getByText('On leave').first()).toBeVisible();
});
