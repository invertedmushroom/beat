import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  timeout: 30_000,
  workers: 1,
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
});
