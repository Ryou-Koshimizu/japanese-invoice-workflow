import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3012',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
          args: ['--no-sandbox', '--disable-gpu'],
        }
      : undefined,
  },
  webServer: {
    command: 'npm run build && npm run start -- --port 3012',
    url: 'http://127.0.0.1:3012/login',
    reuseExistingServer: false,
    timeout: 240_000,
    env: { APP_MODE: 'demo' },
  },
});
