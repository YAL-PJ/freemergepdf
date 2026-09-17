/**
 * Shared page setup for the browser tests.
 *
 * Two things every test needs:
 *  1. Third-party noise (ads, analytics) and the error-reporting endpoints blocked, so
 *     tests are fast, offline-tolerant, and never post a real crash report.
 *  2. Instrumentation for the merge result. The app hands the merged PDF to the user
 *     via `URL.createObjectURL(blob)` + a synthetic anchor click, then revokes the URL
 *     immediately — so we capture the Blob itself at creation time instead of racing
 *     the download.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { VENDOR, CACHE_DIR } = require('../setup/fetch-vendor');

// Hosts that are irrelevant to the PDF flows; blocked to keep runs fast and hermetic.
const BLOCKED_HOST_PATTERNS = [
  /googletagmanager\.com/,
  /google-analytics\.com/,
  /doubleclick\.net/,
  /faves\.grow\.me/,
  /scriptwrapper\.com/,
  /journeymv\.com/,
  /amazon-adsystem\.com/,
  /script\.google\.com/,      // error-reporting endpoint
  /docs\.google\.com/,        // error-reporting Google Form fallback
  /fonts\.gstatic\.com/
];

async function installAppHarness(page) {
  const consoleErrors = [];
  const pageErrors = [];

  page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (BLOCKED_HOST_PATTERNS.some((re) => re.test(url))) return route.abort();

    // Serve pdf.js / pdf-lib from the local cache (see tests/setup/fetch-vendor.js)
    // so the merge flows work without reaching cdnjs from inside the browser.
    const vendor = VENDOR.find((entry) => url.includes(entry.match));
    if (vendor) {
      const file = path.join(CACHE_DIR, vendor.file);
      if (fs.existsSync(file)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: fs.readFileSync(file)
        });
      }
    }
    return route.continue();
  });

  await page.addInitScript(() => {
    window.__mergeResults = [];
    window.__reportedErrors = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
      try {
        if (obj && obj.type === 'application/pdf') window.__mergeResults.push(obj);
      } catch (_) { /* never let instrumentation break the app */ }
      return originalCreate(obj);
    };
    // Record what the app would have reported, without sending anything.
    window.addEventListener('DOMContentLoaded', () => {
      const real = window.reportError;
      window.reportError = function (err, context) {
        window.__reportedErrors.push({
          message: String(err && err.message ? err.message : err),
          feature: context && context.feature,
          userNote: context && context.userNote
        });
        return Promise.resolve({ ok: true, stubbed: true });
      };
      window.__realReportError = real;
    });
  });

  return { consoleErrors, pageErrors };
}

/** Load the merger homepage and wait until the inline app script has wired up. */
async function openApp(page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.mergePDFs === 'function', null, { timeout: 15000 });
  await page.waitForFunction(() => !!window.PdfSafeMetadata, null, { timeout: 15000 });
  return page;
}

/** True once pdf-lib is available in the page (it is loaded from a CDN). */
async function pdfLibAvailable(page) {
  return page.evaluate(() => typeof window.PDFLib !== 'undefined' && !!window.PDFLib.PDFDocument);
}

/**
 * Inspect the last merged PDF blob. The merged file is normally written with compressed
 * object streams, so the page count is read back with pdf-lib (already loaded in the
 * page) rather than by grepping the raw bytes.
 */
async function lastMergeResult(page) {
  return page.evaluate(async () => {
    const blob = window.__mergeResults[window.__mergeResults.length - 1];
    if (!blob) return null;
    const buf = await blob.arrayBuffer();
    const head = new TextDecoder('latin1').decode(new Uint8Array(buf.slice(0, 16)));
    let pageCount = null;
    try {
      const doc = await window.PDFLib.PDFDocument.load(buf);
      pageCount = doc.getPageCount();
    } catch (err) {
      pageCount = `error: ${err && err.message}`;
    }
    return { size: blob.size, head, pageCount };
  });
}

module.exports = { installAppHarness, openApp, pdfLibAvailable, lastMergeResult, BLOCKED_HOST_PATTERNS };
