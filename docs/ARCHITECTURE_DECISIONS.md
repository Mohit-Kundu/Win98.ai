# Architecture Decisions

Source of truth: `.kiro/specs/win98-ai-desktop/design.md`. Each entry records a decision, the reason, and known consequences.

## ADR-1: One VFS, accessed only through the Action_Layer

A single Dexie VFS is the source of truth for every app. Apps call `src/actions`. Only `src/actions` imports `src/vfs`. ESLint `no-restricted-imports` enforces this. `server/**` never imports `src/**`.

## ADR-2: One AI path with real tool calling

Clippy and CMD natural-language mode share one Orchestrator. The server forwards function declarations to Gemini and never executes tools. The client validates arguments with Zod, asks for confirmation on destructive calls, runs handlers against IndexedDB, and returns `functionResponse` parts. Model turn parts are replayed verbatim to preserve thought signatures. Tool calls are capped at 10 per run.

## ADR-3: Window manager library choice (OS-GUI.js vs 98.css + react-rnd)

Result: use 98.css for styling and react-rnd for drag and resize. Window state lives in Zustand.

- OS-GUI.js is an imperative, jQuery-style DOM library. Combined with React-owned DOM and a Zustand store it creates two sources of truth, and its window objects do not map onto React children.
- 98.css + react-rnd in controlled mode keeps one state source and is directly testable.
- Cost: about 300 lines for the window store and frame. Menu styling fidelity is lower than OS-GUI.js. CSS may be borrowed later.
- Revisit only if window fidelity blocks acceptance.

## ADR-4: Clippy package and asset license

Use `clippyjs` pinned exactly to `0.1.0` (MIT, repository github.com/pi0/clippyjs). Assets are bundled under `public/clippy/` and served locally, so there is no third-party CDN and it works offline and in Playwright. No Text-to-Speech.

Fallback if `clippyjs` fails under React/Vite: `@kusainovv/react-clippy`. Record any switch here and in `DEPENDENCIES.md`.

Status (task 11.1): `clippyjs@0.1.0` works under React 19/Vite, so the fallback was not needed. The package inlines its assets as data URLs. `scripts/copy-clippy-assets.mjs` extracts them to `public/clippy/` (agent.json, map.png, sounds.json), and `ClippyAgent` passes custom loaders that fetch from `/clippy/`. Sound effects are animation cues only, with no speech.

License note: the package code is MIT. The Clippy sprites and animations are derived from Microsoft Agent assets, which are not covered by the MIT license of the package. They are used here for a non-commercial demo. Confirm the terms before any redistribution or commercial use.

## ADR-5: Gemini models and access

`@google/genai` on the server only. Models are env-configured: `GEMINI_TEXT_MODEL` (default `gemini-3.8-flash`) and `GEMINI_IMAGE_MODEL` (default `gemini-nano-banana-2.1`). Tool schemas go through `parametersJsonSchema` after `sanitizeForGemini` strips keywords Gemini rejects. Image output may be JPEG, so the client re-encodes to PNG.

## ADR-6: Document and drawing storage formats

WordPad stores TipTap JSON (`.wpd`, `{ version: 1, doc }`). Images are referenced by `vfsId`, never `src`. AI-produced HTML is sanitized with a DOMPurify allow-list. Paint stores flat PNG. Content is stored as `ArrayBuffer` for Safari compatibility.

## ADR-7: Paint eraser

Fabric v6 ships the eraser in a separate package. For the MVP the eraser is a white free-drawing brush. See `TECH_DEBT.md`.

## ADR-8: PDF preview sandbox

Evaluated (task 5.13). In Chromium (Playwright chromium-1187, headless), a blob-URL PDF in an iframe renders a blocked/sad-face frame with `sandbox=""`, `sandbox="allow-same-origin"` and `sandbox="allow-scripts allow-same-origin"`. It only loads without a `sandbox` attribute, so the built-in viewer cannot be used under Req 12.8. Decision: render pages with `pdfjs-dist` (lazy import, worker via Vite `?url`, max 50 pages, no eval) into PNG data URLs and show them as `<img>` tags in `<iframe sandbox="" srcdoc>`. The frame has no scripts, no same-origin access, and no blob URLs to revoke. `pdfjs-dist` is also reused for text extraction in task 9.4. Cost: about 1 MB extra lazy chunk and non-selectable text in the preview.

## ADR-10: Playwright harness
`playwright.config.ts` starts Vite and Express (`MOCK_GEMINI=1`) as web servers and runs one worker so tests do not share the IndexedDB origin. Each test resets IndexedDB first. Specs live in `e2e/` and assert persisted bytes and VFS state, not only visible text. `npm test` runs `check-docs` and `check-scope` before Vitest. `npm run record-results` runs Vitest then Playwright and, only when both are green, writes `TEST_RESULTS.md` and promotes covered `PROGRESS.md` items to Tested.
## ADR-9: Mock_Gemini

`server/mockGemini.ts`, enabled only with `MOCK_GEMINI=1`, replaces only the Gemini call layer. Routes, validation, limits, and error mapping are the real code. It is excluded from the production start script.

## Risk register

See the "Critical Risks and Decisions" section of `design.md` (tool-call loop and thought signatures, JSON Schema subset, large tool arguments, image model availability, Fabric eraser, IndexedDB blobs on Safari, PDF sandbox, Clippy assets, concurrent edits, prompt injection, mock fidelity, no hardcoded AI responses, storage quota).

## Apps may import src/ai/context
The design lists `src/ai/client` as the only AI import for apps. Apps also import `useContextProvider` from `src/ai/context` to register Context_Providers. The ESLint rule only forbids `src/vfs` in apps, so no rule change was needed. `src/ai/context` imports only `src/store` and `src/ai/types`.

