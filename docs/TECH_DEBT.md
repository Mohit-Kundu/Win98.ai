# Tech Debt

| ID | Item | Reason | Revisit when |
|---|---|---|---|
| TD-1 | Vite build uses `build.cssMinify: 'esbuild'` | Vite 8 defaults to lightningcss, which rejects a media query in 98.css. | A 98.css or lightningcss release fixes the parse error. |
| TD-2 | Paint eraser is a white free-drawing brush on the flattened background | Fabric v6 ships the eraser in a separate package. See ADR-7. | Layers or transparency are needed. |
| TD-3 | Window menu styling is less faithful than OS-GUI.js | See ADR-3. | Fidelity blocks acceptance. |
| TD-4 | PDF preview renders pages as images with pdfjs-dist instead of the browser's PDF viewer. Text in the preview is not selectable and the lazy chunk adds about 1 MB. | Chromium refuses to render a PDF in a fully sandboxed iframe (verified in 5.13, resolved by ADR-8). E2E 8 asserts the iframe is `sandbox=""`. | A sandbox-compatible native viewer exists. |
| TD-5 | Paint persistence E2E (13.3): the Explorer window's Close button did not close the window while Paint was open. Possible window focus or z-order bug. Not investigated. | Noted by the E2E author. The test works around it. | Before release; reproduce with Explorer and Paint open and click Explorer's Close. |
| TD-6 | WordPad AI Rewrite after a triple-click selection reported "The selection has no text". Not investigated. | Noted by the E2E author. Triple-click selects a whole block, which the selection capture may map to an empty range. The E2E selects text another way. | Before release; reproduce with a triple-click on a paragraph, then AI Rewrite. |
| TD-7 | The default Paint window shows only about 190 px of the 640x480 canvas. The canvas needs scrolling or a larger window. | Noted by the E2E author. The default window size is too small for the canvas. | When polishing Paint, for example a larger default size or fit-to-window zoom. |
| TD-8 | Vitest reports that jsdom is created once per test file (about 135 s of tracked time). | Default per-file isolation. | Suite time becomes a problem; consider `pool: 'vmThreads'`. |
| TD-9 | The Playwright run logs a Vite console warning "Another connection wants to delete database 'win98-ai-vfs'". | The harness deletes IndexedDB while the previous page still holds a connection. Tests pass. | If it causes flakiness; close the Dexie connection before the reset. |
| TD-10 | Property tests marked optional in `tasks.md` (Properties 1 to 21 and others) and optional component tests are not written. 13.11 (real-provider test) is also skipped. | Optional tasks, deferred. | Before claiming full property coverage. |
