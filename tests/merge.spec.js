'use strict';

const { test, expect } = require('@playwright/test');
const { buildPdf, buildCorruptPdf } = require('./helpers/pdf-fixtures');
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
