'use strict';

const { test, expect } = require('@playwright/test');
const { buildPdf, buildCorruptPdf, buildTruncatedPdf } = require('./helpers/pdf-fixtures');
const { installAppHarness, openApp, pdfLibAvailable, lastMergeResult } = require('./helpers/app');

test.describe('simple merge flow', () => {
  test('happy path: two generated PDFs merge into one downloadable result', async ({ page }) => {
    const harness = await installAppHarness(page);
    await openApp(page);

    expect(
      await pdfLibAvailable(page),
      'pdf-lib is loaded from cdnjs; this test needs network access to that CDN'
    ).toBe(true);

    await page.setInputFiles('#file1', {
      name: 'first.pdf',
      mimeType: 'application/pdf',
      buffer: buildPdf({ pages: 2, label: 'first', producer: 'freemergepdf-tests' })
    });
    await page.setInputFiles('#file2', {
      name: 'second.pdf',
      mimeType: 'application/pdf',
      buffer: buildPdf({ pages: 3, label: 'second', producer: 'freemergepdf-tests' })
    });

    const mergeBtn = page.locator('#simpleMergeBtn');
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();

    await expect(page.locator('#simpleStatus')).toContainText(/success/i);

    const result = await lastMergeResult(page);
    expect(result, 'the app should have produced a PDF blob').not.toBeNull();
    expect(result.size).toBeGreaterThan(0);
    expect(result.head.startsWith('%PDF-')).toBe(true);
    // 2 + 3 input pages should survive into the merged document.
    expect(result.pageCount).toBe(5);

    expect(harness.pageErrors, 'no unhandled page errors during a successful merge').toEqual([]);
  });

  test('failure path: a corrupt PDF shows a graceful message and leaves the app usable', async ({ page }) => {
    const harness = await installAppHarness(page);
    await openApp(page);

    // The app asks "skip this file?" via window.confirm when a file cannot be read.
    // Answer "cancel" so we exercise the hard-failure branch rather than the skip branch.
    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });

    await page.setInputFiles('#file1', {
      name: 'good.pdf',
      mimeType: 'application/pdf',
      buffer: buildPdf({ pages: 1, label: 'good' })
    });
    await page.setInputFiles('#file2', {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: buildCorruptPdf()
    });

    const mergeBtn = page.locator('#simpleMergeBtn');
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();

    // A user-facing explanation appears...
    const status = page.locator('#simpleStatus');
    await expect(status).toHaveClass(/status-error/, { timeout: 30_000 });
    const statusText = (await status.innerText()).trim();
    expect(statusText.length).toBeGreaterThan(5);
    // ...and it must not be raw internal noise leaking into the UI.
    expect(statusText).not.toMatch(/undefined|\[object Object\]|TypeError/);

    // The app is not hung: the merge button is re-enabled and the page still responds.
    await expect(mergeBtn).toBeEnabled();
    await expect(mergeBtn).not.toHaveClass(/loading/);
    expect(await page.evaluate(() => window.mergeInProgress === true)).toBe(false);
    expect(await page.title()).toContain('PDF');

    // The failure is reported through the app's own reporter (stubbed in the harness),
    // not thrown as an unhandled error.
    expect(harness.pageErrors).toEqual([]);
    const reported = await page.evaluate(() => window.__reportedErrors);
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.some((r) => (r.feature || '').includes('merge'))).toBe(true);
  });
});

test.describe('damaged PDFs', () => {
  // Real report (Errors tab, Jun 2026): a merge failed with pdf-lib's
  // "Failed to parse invalid PDF object" on a file of exactly 1,048,576 bytes,
  // i.e. a download or upload cut off at 1 MiB. Neither pdf-lib nor pdf.js can
  // open a file that lost its cross-reference table, but the user was told
  // "Not a valid PDF", which sends them looking for the wrong problem.
  test('a truncated PDF is named and explained as cut off, not "not a valid PDF"', async ({ page }) => {
    const harness = await installAppHarness(page);
    await openApp(page);

    const dialogs = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });

    await page.setInputFiles('#file1', {
      name: 'good.pdf',
      mimeType: 'application/pdf',
      buffer: buildPdf({ pages: 2, label: 'good' })
    });
    await page.setInputFiles('#file2', {
      name: 'cut-off.pdf',
      mimeType: 'application/pdf',
      buffer: buildTruncatedPdf({ pages: 3, label: 'cut' })
    });

    await page.locator('#simpleMergeBtn').click();

    const status = page.locator('#simpleStatus');
    await expect(status).toHaveClass(/status-error/, { timeout: 30_000 });
    await expect(status).toContainText(/incomplete/i);
    await expect(status).toContainText(/re-download/i);

    // The skip prompt names the file and gives the same reason.
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('cut-off.pdf');
    expect(dialogs[0]).toMatch(/incomplete/i);

    // The report says what happened, for triage.
    const reported = await page.evaluate(() => window.__reportedErrors);
    expect(reported.some((r) => /kind=truncated/.test(r.userNote || ''))).toBe(true);
    expect(harness.pageErrors).toEqual([]);
  });

  test('a PDF that is damaged but complete still gets the generic message', async ({ page }) => {
    await installAppHarness(page);
    await openApp(page);
    page.on('dialog', (dialog) => dialog.dismiss());

    await page.setInputFiles('#file1', { name: 'good.pdf', mimeType: 'application/pdf', buffer: buildPdf({ pages: 1 }) });
    await page.setInputFiles('#file2', { name: 'broken.pdf', mimeType: 'application/pdf', buffer: buildCorruptPdf() });
    await page.locator('#simpleMergeBtn').click();

    const status = page.locator('#simpleStatus');
    await expect(status).toHaveClass(/status-error/, { timeout: 30_000 });
    await expect(status).not.toContainText(/incomplete/i);
  });
});
