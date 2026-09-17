# Browser tests (Playwright + headless Chromium)

The site is static, so the harness serves the repo root over HTTP and drives the real
`index.html` in headless Chromium — no build step, no mocks of the app itself.

## Run

```bash
npm install     # installs @playwright/test only
npm test        # == npx playwright test
```

Useful variants:

```bash
npm test -- tests/merge.spec.js            # one file
npm test -- -g "failure path"              # one test by name
npm run test:headed                        # watch it happen in a real window
PORT=9001 npm test                         # if 8913 is taken
```

Notes for automated/CI runs:

- Chromium must already be installed. In this project's sandbox it is, at
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
  and **do not** run `playwright install`. `@playwright/test` is pinned to the version
  matching those preinstalled browsers — bumping it may require a matching browser build.
- `index.html` loads **pdf.js** and **pdf-lib** from cdnjs. `tests/setup/fetch-vendor.js`
  (Playwright `globalSetup`) downloads them once into `tests/.cache/` (gitignored) and the
  harness fulfils the browser's CDN requests from there, so runs work even when the
  browser itself cannot reach or verify cdnjs. First run needs network; later runs do not.
- Ads, analytics and both error-reporting endpoints (`script.google.com`,
  `docs.google.com`) are blocked in `tests/helpers/app.js`. **A test run never posts a
  real crash report.**

## What is here

| File | Covers |
| --- | --- |
| `merge.spec.js` | Happy path: two generated PDFs merge, result blob is a valid PDF with the expected page count. Failure path: a corrupt PDF produces a graceful user-facing message, the app stays usable, and nothing throws unhandled. |
| `pdf-metadata.spec.js` | `window.PdfSafeMetadata` (see `/pdf-metadata.js`): the safe fields are returned, `/Title`, `/Author`, `/Subject` and `/Keywords` never are, the breadcrumb note and full error payload stay free of user data, malformed input degrades instead of throwing, and large files are not read whole. |
| `helpers/pdf-fixtures.js` | Builds PDFs byte-by-byte in Node (valid xref) — page count, version, producer/creator, info fields, AcroForm, plus deliberately corrupt and non-PDF variants. No binaries committed. |
| `helpers/app.js` | Shared setup: request blocking, CDN cache routing, capture of merge-result blobs (the app revokes its blob URL immediately, so we capture the `Blob` at `createObjectURL` time), and a stub for `window.reportError` that records reports instead of sending them. |

## Adding a regression case for a new bug

The crash reports in the tracking sheet carry a `userNote` breadcrumb, now including
safe per-file PDF metadata, e.g.

```
mode=simple;step=mergePDFs;files=2;kind=corrupt;pdf1=ver:1.4|size:88231|pages:3|enc:0|lin:0|obj:41|form:1|prod:Skia/PDF
```

Turn that into a test:

1. **Rebuild the input from the breadcrumb.** `buildPdf()` in `helpers/pdf-fixtures.js`
   takes `pages`, `version`, `producer`, `creator`, `acroForm`, and the info fields. Add
   a new option there if the report points at a property it cannot yet express (say,
   object streams or an embedded font) — that is the normal way this file grows.
2. **Reproduce the reported step.** `step=mergePDFs` is the simple/expanded merge in
   `merge.spec.js`; `feature=AdvancedPDFMerger.*` means the page-reorder modal
   (`#advancedSortBtn` / `#advancedMergeModal`).
3. **Write the failing expectation**, ideally both halves: the user sees a sane message
   *and* `harness.pageErrors` stays empty.

```js
test('regression: <sheet row id> — <one-line symptom>', async ({ page }) => {
  const harness = await installAppHarness(page);
  await openApp(page);

  await page.setInputFiles('#file1', {
    name: 'a.pdf', mimeType: 'application/pdf',
    buffer: buildPdf({ pages: 3, version: '1.4', producer: 'Skia/PDF', acroForm: true })
  });
  // ...second file, click #simpleMergeBtn, assert on #simpleStatus
  expect(harness.pageErrors).toEqual([]);
});
```

4. **Confirm it fails before the fix and passes after.** A PR that never saw the test go
   red has not proven anything.

If a case genuinely cannot be reproduced headlessly (needs a real print dialog, a
specific mobile Safari quirk, >1GB memory pressure), leave it in with
`test.fixme(...)` **and a comment saying why** rather than deleting it.

## Privacy rule for tests

Never commit a real user PDF, and never add a test that asserts user content
(`/Title`, `/Author`, page text, images) is reported. The metadata boundary is
documented at the top of `/pdf-metadata.js`; the tests exist partly to keep it honest.
