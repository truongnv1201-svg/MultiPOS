import { defineConfig, devices } from '@playwright/test';

// E2E chạy với backend Supabase live (.env.local) + seed từ scripts/seed-users.mjs.
// workers: 1 để các test live không giẫm dữ liệu nhau. Không tạo đơn thật:
// flow checkout/hủy/trả đã có scripts/verify-*.mjs phủ ở tầng RPC.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
