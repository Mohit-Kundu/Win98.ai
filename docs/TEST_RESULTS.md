# Test Results

Record results from green runs only. Mark an item "Tested" in `PROGRESS.md` only when it is covered here.

| Date | Suite | Command | Result | Notes |
|---|---|---|---|---|
| 2026-11-19 | Vitest | `npm test` | Pass | 34 files, 264 tests, 0 failures (docs and scope checks included) |
| 2026-11-19 | Playwright | `npm run e2e` | Pass | 12 tests, 0 failures, 1 worker, Mock_Gemini |

Not run: optional real-provider test (13.11, needs `GEMINI_API_KEY`). Append new rows with `npm run record-results`, which only writes after green Vitest and Playwright runs.