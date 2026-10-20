import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3012);
export const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  // The same suite runs in Chromium and WebKit (Safari's engine). Each
  // project starts from a freshly reset demo, so the order does not matter.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
          ? {
              executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
              args: ['--no-sandbox', '--disable-gpu'],
            }
          : undefined,
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { APP_MODE: 'demo' },
  },
});
