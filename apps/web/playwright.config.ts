import { defineConfig, devices } from '@playwright/test';

/**
 * Four journeys, matching the four things an operator actually does. Playwright covers the paths
 * where a break would be invisible to unit tests: session handling, the drawer, and the
 * round trip from a finding to its resolution.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
