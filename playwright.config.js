import { defineConfig, devices } from '@playwright/test';

// The web server builds before it previews, so a reused server can serve a dist built from other
// sources. Reuse therefore stays opt-in for local iteration and never applies in CI.
const reuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.js$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  // Rendered behavior is asserted once under desktop; the mobile project only replays the
  // layout and navigation assertions that actually depend on a phone viewport.
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.e2e\.js$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.e2e\.js$/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer,
  },
});
