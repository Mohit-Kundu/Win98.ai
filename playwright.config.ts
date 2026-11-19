import { defineConfig } from '@playwright/test';

// webServer config (Vite + Express with MOCK_GEMINI=1) is added in task 13.2.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
});
