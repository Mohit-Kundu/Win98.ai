# Tech Debt

| ID | Item | Reason | Revisit when |
|---|---|---|---|
| TD-1 | Vite build uses `build.cssMinify: 'esbuild'` | Vite 8 defaults to lightningcss, which rejects a media query in 98.css. | A 98.css or lightningcss release fixes the parse error. |
| TD-2 | Paint eraser is a white brush on the flattened background (planned) | Fabric v6 eraser is a separate package. | Layers or transparency are needed. |
| TD-3 | Window menu styling is less faithful than OS-GUI.js (planned) | See ADR-3. | Fidelity blocks acceptance. |
| TD-4 | PDF iframe sandbox may need `allow-same-origin` (to verify) | Chromium PDF viewer can refuse fully sandboxed frames. | Task 5.13 and E2E 8. |
