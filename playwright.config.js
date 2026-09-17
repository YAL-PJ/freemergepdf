// Playwright config for the freemergepdf browser tests.
//
// The site is a static bundle, so the harness just serves the repo root over HTTP and
// drives index.html in headless Chromium. Chromium is expected to be preinstalled
// (PLAYWRIGHT_BROWSERS_PATH); `npm test` never downloads a browser.

const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT || 8913);

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./tests/setup/fetch-vendor'),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    // Always start our own server: a reused server on this port might be serving a
    // different project's files.
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
