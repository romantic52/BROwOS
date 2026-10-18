import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/e2e.xml' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: 'reduce' },
    locale: 'ru-RU',
    timezoneId: 'UTC',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.BROWOS_TEST_BROWSER_PATH
      ? { executablePath: process.env.BROWOS_TEST_BROWSER_PATH }
      : {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command:
      'node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
    cwd: './apps/web',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
