'use strict';

const { test, expect } = require('@playwright/test');
const { buildPdf, buildCorruptPdf, buildNotAPdf, toBase64 } = require('./helpers/pdf-fixtures');
const { installAppHarness, openApp } = require('./helpers/app');

// Values that must never appear in a crash report. The fixtures below put them in the
// PDF's /Title, /Author, /Subject and /Keywords, which is exactly where real user data
// (names, case numbers, medical or tax details) shows up in the wild.
const SECRET_TITLE = 'Jane Doe 2024 tax return SSN 000-00-0000';
const SECRET_AUTHOR = 'Jane Doe';
const SECRET_SUBJECT = 'Confidential medical records';
const SECRET_KEYWORDS = 'divorce case 1234';

function fixtureOptions(extra = {}) {
  return {
    pages: 4,
    version: '1.5',
    producer: 'freemergepdf test harness 1.0',
    creator: 'Fixture Generator',
    title: SECRET_TITLE,
    author: SECRET_AUTHOR,
    subject: SECRET_SUBJECT,
    keywords: SECRET_KEYWORDS,
    ...extra
  };
}

async function extractInPage(page, buffer, name = 'sample.pdf', options = {}) {
  return page.evaluate(async ({ b64, name: fileName, options: opts }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], fileName, { type: 'application/pdf' });
    return window.PdfSafeMetadata.extractSafePdfMetadata(file, opts);
  }, { b64: toBase64(buffer), name, options });
}

test.describe('safe PDF metadata extraction', () => {
  test.beforeEach(async ({ page }) => {
    await installAppHarness(page);
    await openApp(page);
  });

  test('returns the safe structural fields', async ({ page }) => {
    const buffer = buildPdf(fixtureOptions({ acroForm: true }));
    const meta = await extractInPage(page, buffer);

    expect(meta).not.toBeNull();
    expect(meta.pdfVersion).toBe('1.5');
    expect(meta.fileSize).toBe(buffer.length);
    expect(meta.pageCount).toBe(4);
    expect(meta.isEncrypted).toBe(false);
    expect(meta.isLinearized).toBe(false);
    expect(meta.hasAcroForm).toBe(true);
    expect(meta.objectCount).toBeGreaterThan(5);
    expect(meta.producer).toContain('freemergepdf test harness');
    expect(meta.creator).toContain('Fixture Generator');
  });

  test('never returns Title, Author, Subject or Keywords', async ({ page }) => {
    const meta = await extractInPage(page, buildPdf(fixtureOptions()));

    // No such keys at all...
    for (const forbidden of ['title', 'author', 'subject', 'keywords', 'bytes', 'text', 'data']) {
      expect(Object.keys(meta).map((k) => k.toLowerCase())).not.toContain(forbidden);
    }
    // ...and none of the user data leaks into a value (e.g. via producer/creator).
    const serialized = JSON.stringify(meta);
    for (const secret of [SECRET_TITLE, SECRET_AUTHOR, SECRET_SUBJECT, SECRET_KEYWORDS, 'Jane', 'SSN']) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('breadcrumb note carries the safe fields and no user data', async ({ page }) => {
    const buffer = buildPdf(fixtureOptions({ pages: 2 }));
    const note = await page.evaluate(async ({ b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'a.pdf', { type: 'application/pdf' });
      const list = await window.PdfSafeMetadata.collectSafePdfMetadata([file, file]);
      return window.PdfSafeMetadata.formatPdfMetadataNote(list);
    }, { b64: toBase64(buffer) });

    // Matches the existing userNote convention: key=value pairs joined by ';'.
    expect(note).toMatch(/^pdf1=/);
    expect(note).toContain('pdf2=');
    expect(note).toContain('ver:1.5');
    expect(note).toContain('pages:2');
    expect(note).toContain('enc:0');
    expect(note).toContain('form:0');
    expect(note).toContain(`size:${buffer.length}`);
    expect(note).toContain('prod:freemergepdf test harness 1.0');
    for (const secret of [SECRET_TITLE, SECRET_AUTHOR, SECRET_SUBJECT, 'Jane', 'SSN']) {
      expect(note).not.toContain(secret);
    }
  });

  test('the error report payload includes the metadata note and no user data', async ({ page }) => {
    const buffer = buildPdf(fixtureOptions({ pages: 3 }));
    const payload = await page.evaluate(async ({ b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'user-document.pdf', { type: 'application/pdf' });
      const internals = window.__errorReportingInternals;
      const context = {
        feature: 'pdf_merge',
        userNote: 'mode=simple;step=mergePDFs;files=1;kind=corrupt',
        files: [file]
      };
      const base = internals.buildErrorReportPayload(new Error('boom'), context);
      return internals.appendSafePdfMetadata(base, context);
    }, { b64: toBase64(buffer) });

    expect(payload.userNote).toContain('mode=simple;step=mergePDFs');
    expect(payload.userNote).toContain('pdf1=');
    expect(payload.userNote).toContain('pages:3');

    const serialized = JSON.stringify(payload);
    for (const secret of [SECRET_TITLE, SECRET_AUTHOR, SECRET_SUBJECT, SECRET_KEYWORDS, 'Jane', 'SSN']) {
      expect(serialized).not.toContain(secret);
    }
    // The payload never carries raw file content.
    expect(serialized).not.toContain('stream');
    expect(serialized).not.toContain('%PDF');
  });

  test('malformed input degrades instead of throwing', async ({ page }) => {
    const corrupt = await extractInPage(page, buildCorruptPdf(), 'broken.pdf');
    expect(corrupt).not.toBeNull();
    expect(corrupt.pdfVersion).toBe('1.7');

    const notPdf = await extractInPage(page, buildNotAPdf(), 'not.pdf');
    expect(notPdf).not.toBeNull();
    expect(notPdf.pdfVersion).toBeNull();

    // Empty file, and non-file junk: still no throw.
    const edgeCases = await page.evaluate(async () => {
      const results = [];
      results.push(await window.PdfSafeMetadata.extractSafePdfMetadata(
        new File([new Uint8Array(0)], 'empty.pdf', { type: 'application/pdf' })
      ));
      results.push(await window.PdfSafeMetadata.extractSafePdfMetadata(null));
      results.push(await window.PdfSafeMetadata.extractSafePdfMetadata({ nope: true }));
      results.push(await window.PdfSafeMetadata.collectSafePdfMetadata(null));
      results.push(await window.PdfSafeMetadata.collectSafePdfMetadata('not a list'));
      return results.map((r) => (r === null ? 'null' : typeof r));
    });
    expect(edgeCases).toEqual(['object', 'null', 'null', 'object', 'object']);

    // A reporter that fails while reporting is worse than no metadata: the append step
    // must resolve with the untouched payload even when the extractor is missing.
    const fallback = await page.evaluate(async () => {
      const saved = window.PdfSafeMetadata;
      window.PdfSafeMetadata = undefined;
      try {
        const context = { feature: 'pdf_merge', userNote: 'mode=simple', files: [{ bogus: true }] };
        const base = window.__errorReportingInternals.buildErrorReportPayload(new Error('x'), context);
        const out = await window.__errorReportingInternals.appendSafePdfMetadata(base, context);
        return out.userNote;
      } finally {
        window.PdfSafeMetadata = saved;
      }
    });
    expect(fallback).toBe('mode=simple');
  });

  test('a large file is not read whole (bounded cost)', async ({ page }) => {
    // 12MB > the 8MB full-scan limit, so extraction must fall back to head+tail.
    const result = await page.evaluate(async () => {
      const head = new TextEncoder().encode('%PDF-1.6\n<< /Linearized 1 /N 137 >>\n');
      const filler = new Uint8Array(12 * 1024 * 1024);
      const tail = new TextEncoder().encode('\ntrailer\n<< /Size 4211 /Encrypt 9 0 R >>\n%%EOF\n');
      const file = new File([head, filler, tail], 'big.pdf', { type: 'application/pdf' });
      const started = performance.now();
      const meta = await window.PdfSafeMetadata.extractSafePdfMetadata(file);
      return { meta, durationMs: performance.now() - started, size: file.size };
    });

    expect(result.meta.scan).toBe('head+tail');
    expect(result.meta.pdfVersion).toBe('1.6');
    expect(result.meta.isLinearized).toBe(true);
    expect(result.meta.pageCount).toBe(137);
    expect(result.meta.isEncrypted).toBe(true);
    expect(result.meta.objectCount).toBe(4211);
    expect(result.meta.fileSize).toBe(result.size);
    // Bounded: a 12MB file costs about as much as a small one.
    expect(result.durationMs).toBeLessThan(2000);
  });
});
