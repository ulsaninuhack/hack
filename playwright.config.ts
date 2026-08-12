import { defineConfig, devices } from '@playwright/test'

const frontendOrigin = 'http://127.0.0.1:4175'
const apiOrigin = 'http://127.0.0.1:18082'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: 'artifacts/playwright',
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]]
    : 'line',
  use: {
    baseURL: frontendOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `PORT=18082 CORS_ORIGINS=${frontendOrigin} CONTACT_OPS_STATE_BACKEND=memory npm --prefix backend start`,
      url: `${apiOrigin}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `VITE_API_BASE_URL=${apiOrigin} npm run build && npm run preview -- --host 127.0.0.1 --port 4175`,
      url: `${frontendOrigin}/ops/surveyor`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
