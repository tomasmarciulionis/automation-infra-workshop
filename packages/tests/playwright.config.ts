import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  globalSetup: './global-setup.ts',

  fullyParallel: true,

  retries: 0,

  timeout: 50_000,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Pinned so that neither is a variable between one attendee's laptop and
    // the next, or between a laptop and a Grid node. Nothing in the suite
    // asserts on a formatted date or currency, and this keeps it that way by
    // construction.
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  projects: [
    {
      name: 'local',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'grid',
      use: { ...devices['Desktop Chrome'] },
      // Identical to `local` on purpose: the only difference between the two
      // is where the browser runs, which global-setup.ts decides from this
      // name. Anything that fails here and passes there is about the
      // environment, never about the test's own options.
    },
  ],
});
