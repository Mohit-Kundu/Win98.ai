# Dependencies

Libraries are installed in the task that first uses them. Each entry records the library, purpose, and the task that added it.

## Installed in task 1.1

| Package | Purpose |
|---|---|
| vite, @vitejs/plugin-react | Build tool and dev server (proxies `/api` to `http://localhost:8787`) |
| react, react-dom | UI |
| typescript | Strict type checking |
| 98.css | Windows 98 styling |
| react-rnd | Window drag and resize |
| zustand | Window and settings stores |
| dexie | IndexedDB access for the VFS |
| zod | Validation and tool schemas |
| vitest, jsdom | Unit and integration tests |
| fast-check | Property-based tests |
| fake-indexeddb | IndexedDB in Node tests |
| @testing-library/react, @testing-library/dom, @testing-library/jest-dom | Component tests |
| @playwright/test | End-to-end tests |
| eslint, @eslint/js, typescript-eslint, globals | Linting and layering rules |

## Added in later tasks

| Package | Purpose | Added in task |
|---|---|---|
| express | AI_Proxy HTTP server | 7.2 |
| @google/genai | Gemini SDK (server only) | 7.2 |
| tsx | Runs the TypeScript server (
pm run server, port 8787) | 7.2 |
| @types/express | Express types | 7.2 |
| supertest, @types/supertest | HTTP tests for the proxy (used in 7.2, extended in 7.5) | 7.2 |

Task 1.5: no new dependency. Desktop icons are a small local inline-SVG set in `src/desktop/icons.tsx`.

Planned: TipTap, Fabric.js, @xterm/xterm, pdfjs-dist, MiniSearch, chrono-node, DOMPurify, Express, supertest, @google/genai, clippyjs (pinned 0.1.0).

## Selection summary and decisions

| Feature | Selected | Rejected alternatives | Notes |
|---|---|---|---|
| Windows 98 look | 98.css | OS-GUI.js | No behavior in the CSS. Menus and dialogs are custom. |
| Window manager | react-rnd + Zustand | OS-GUI.js | See ADR-3 in `ARCHITECTURE_DECISIONS.md`. |
| Canvas | Fabric.js | Konva | Eraser is a separate package in v6. See TD-2. |
| Clippy | `clippyjs` pinned exactly to `0.1.0` (MIT) | `@kusainovv/react-clippy` (fallback), `clippyjsreworked`, `@xeserv/clippyjs`, `react-clippy` | Assets bundled in `public/clippy/`. Microsoft Agent asset license note in ADR-4. |
| Gemini | `@google/genai` | `@google/generative-ai` (deprecated) | Server only. |
| Text model | `gemini-3.8-flash` (env `GEMINI_TEXT_MODEL`) | | ID stays configurable. |
| Image model | `gemini-nano-banana-2.1` (env `GEMINI_IMAGE_MODEL`) | Imagen | Output may be JPEG, re-encode to PNG. |
| Rich text | TipTap (StarterKit, Underline, Image) | Lexical, Slate | Pin versions. |
| HTML sanitize | DOMPurify | sanitize-html | Run before any `setContent`. |
| Terminal | @xterm/xterm + @xterm/addon-fit | Custom console | Own line editor. |
| PDF text | pdfjs-dist | pdf-parse | Worker via `?url` import. |
| Search | MiniSearch | Lunr, FlexSearch | |
| Date parsing | chrono-node | Gemini only | Fallback when AI is down. |
| Server | Express | Fastify | |
| Server tests | supertest | | |

## Installed in task 5.1

| Package | Version | Use |
|---|---|---|
| @tiptap/core, @tiptap/pm, @tiptap/starter-kit (includes Underline), @tiptap/extension-image, @tiptap/extension-underline, @tiptap/html | 3.34.0 | WordPad schema, \.wpd\ JSON, HTML to JSON, headless doc edits in \src/actions\ |
| @tiptap/react | 3.34.0 | WordPad editor component and image NodeView (`src/apps/wordpad`) |
| dompurify | 3.4.18 | \sanitizeHtml\ allow-list (design: WordPad document representation) |

## Installed in task 5.10

| Package | Use |
|---|---|
| @xterm/xterm, @xterm/addon-fit | CMD terminal rendering and fit-to-window. The line editor (`src/apps/cmd/lineEditor.ts`) is our own since xterm has none. |

## Installed in task 5.3

| Package | Version | Use |
|---|---|---|
| fabric | 6.9.1 | Paint canvas: free drawing (PencilBrush), line/rect/ellipse objects, JSON snapshots for undo/redo, PNG export |

clippyjs 0.1.0 (task 11.1): installed with an exact pin, works under React 19/Vite, no jQuery. Assets extracted to public/clippy/ by scripts/copy-clippy-assets.mjs. The @kusainovv/react-clippy fallback was not needed.
## Installed in task 9.6
| Package | Version | Use |
|---|---|---|
| minisearch | 7.2.0 | Search_Index (`src/actions/searchIndex.ts`): prefix and fuzzy (0.2) matching, OR combination, field boosts. Rebuilt from the VFS on start and never persisted. |
| chrono-node | 2.10.3 | Date phrases ("yesterday", "last week", "since last friday") in the no-AI query fallback (`planWithoutAi` in `src/actions/search.ts`). |
