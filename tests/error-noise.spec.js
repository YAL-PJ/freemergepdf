'use strict';

const { test, expect } = require('@playwright/test');
const { installAppHarness, openApp } = require('./helpers/app');

// Each case is a pending row from the Errors tab (Jul-Sep 2026), reduced to the
// message, stack and feature the reporter actually saw. None can come from this
// app: its fetches are all caught, and it never uses XMLHttpRequest,
// WebAssembly or media playback.
const THIRD_PARTY = [
  {
    name: 'ad script rejecting with an XMLHttpRequest object (5 reports)',
    reason: 'xhr',
    feature: 'unhandledrejection'
  },
  {
    name: 'prebid connector fetch failure (3 reports)',
    message: 'Failed to fetch',
    stack: 'TypeError: Failed to fetch\n    at U (https://api.receptivity.io/v1/prebid/x/connector/rxConnector.js?tl=true:10:16122)',
    feature: 'unhandledrejection'
  },
  {
    name: 'aborted WebAssembly download (2 reports)',
    message: 'WebAssembly compilation aborted: Network error: Response body loading was aborted',
    stack: '',
    feature: 'unhandledrejection'
  },
  {
    name: 'video ad play/pause race',
    message: 'The play() request was interrupted by a call to pause().',
    stack: '',
    feature: 'unhandledrejection'
  },
  {
    name: 'Firefox stackless fetch failure',
    message: 'NetworkError when attempting to fetch resource.',
    stack: '',
    feature: 'unhandledrejection'
  },
  {
    name: 'browser extension messaging',
    message: 'Error: Invalid call to runtime.sendMessage(). Tab not found.',
    stack: '',
    feature: 'unhandledrejection'
  }
];

// Must still be reported: the filters above are narrow on purpose.
const APP_ERRORS = [
  { name: 'a merge failure', message: 'Failed to parse PDF document', stack: 'Error\n    at mergePDFs (https://freemergepdf.com/index-page.js?v=16:1:1)', feature: 'pdf_merge' },
  { name: 'a fetch failure with an app stack', message: 'Failed to fetch', stack: 'TypeError: Failed to fetch\n    at submitFeedback (https://freemergepdf.com/feedback.js:91:27)', feature: 'unhandledrejection' },
  { name: 'an app error that happens to be stackless', message: 'Cannot read properties of null (reading \'files\')', stack: '', feature: 'unhandledrejection' }
];

test.describe('error reporter noise filter', () => {
  test.beforeEach(async ({ page }) => {
    await installAppHarness(page);
    await openApp(page);
  });

  for (const c of THIRD_PARTY) {
    test(`ignores ${c.name}`, async ({ page }) => {
      const ignored = await page.evaluate((c) => {
        const { shouldIgnoreKnownNoise } = window.__errorReportingInternals;
        // Mirror the unhandledrejection handler: non-Error reasons are wrapped.
        const err = c.reason === 'xhr'
          ? new Error(String(new XMLHttpRequest()))
          : Object.assign(new Error(c.message), { stack: c.stack });
        return shouldIgnoreKnownNoise(err, { feature: c.feature, url: '/' });
      }, c);
      expect(ignored).toBe(true);
    });
  }

  for (const c of APP_ERRORS) {
    test(`still reports ${c.name}`, async ({ page }) => {
      const ignored = await page.evaluate((c) => {
        const err = Object.assign(new Error(c.message), { stack: c.stack });
        return window.__errorReportingInternals.shouldIgnoreKnownNoise(err, { feature: c.feature, url: '/' });
      }, c);
      expect(ignored).toBe(false);
    });
  }
});
