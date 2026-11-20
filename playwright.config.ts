import { defineConfig } from '@playwright/test';

const API_PORT = 8787;
const WEB_PORT = 5173;

// Vite (UI, proxies /api to Express) and Express (AI proxy) both start with MOCK_GEMINI=1,
// so E2E runs never reach a real provider and need no GEMINI_API_KEY.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run server',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { MOCK_GEMINI: '1', PORT: String(API_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: `http://localhost:${WEB_PORT}`,
      env: { MOCK_GEMINI: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
