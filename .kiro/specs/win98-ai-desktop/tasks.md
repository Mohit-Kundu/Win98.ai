# Implementation Plan: Win98_AI_Desktop

## Overview

Greenfield TypeScript implementation (React, Vite, Zustand, Dexie, Express, @google/genai, Zod) delivered in the seven milestones from Requirement 14.4. Each milestone ends with a checkpoint. Property tests come from the design's Correctness Properties (fast-check in Vitest) and are optional sub-tasks. The eight Playwright E2E tests run against Mock_Gemini in Milestone 7. Layering rules from the design apply throughout: apps use `src/actions`, only `src/actions` imports `src/vfs`, `server/**` never imports `src/**`.

## Tasks

- [x] 1. Milestone 1: Project scaffold and desktop with window manager
  - [x] 1.1 Scaffold the project and tooling
    - Create single `package.json` with scripts dev, build, test, e2e, lint, and typecheck. Add Vite, React, TypeScript (strict), 98.css, react-rnd, Zustand, Dexie, Zod, Vitest, fast-check, fake-indexeddb, React Testing Library, Playwright, ESLint. Install later-milestone libraries (TipTap, Fabric.js, @xterm/xterm, pdfjs-dist, MiniSearch, chrono-node, DOMPurify, Express, supertest, @google/genai, clippyjs) in the task that first uses them and record each in `docs/DEPENDENCIES.md`
    - Create `vite.config.ts` with `/api` proxy to `http://localhost:8787`, `vitest.config.ts`, `playwright.config.ts` (webServer config added in 13.2), server `.env.example` listing `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL=gemini-3.8-flash`, `GEMINI_IMAGE_MODEL=gemini-nano-banana-2.1`, and `MOCK_GEMINI`
    - Create the folder layout from the design, `shared/errors.ts` (AppError, ErrorCode, Result), and ESLint `no-restricted-imports` rules enforcing the layering boundaries
    - Ensure the GEMINI_API_KEY is never referenced under `src/` or `VITE_*`
    - _Requirements: 9.2, 10.12, 10.15, 14.4_

  - [x] 1.2 Implement the Zustand window store
    - Implement `src/store/windows.ts` with open, close, focus, minimize, maximize, restore, move, resize (clamp to MIN_W=200, MIN_H=120)
    - Keep `order` as the z-order source and derive `focusedId` as the topmost non-minimized window
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.9, 1.10_

  - [ ]* 1.3 Write property test for window size lower bound
    - **Property 1: Window size lower bound**
    - **Validates: Requirements 1.5**

  - [ ]* 1.4 Write property test for window manager state machine
    - **Property 2: Window manager state machine invariants**
    - **Validates: Requirements 1.4, 1.6, 1.7, 1.8, 1.9, 1.10**

  - [x] 1.5 Build the desktop shell UI
    - Implement `Desktop`, `Taskbar` (window buttons, active indicator, clock), `StartMenu`, `WindowFrame` (react-rnd, controlled by the store), desktop icons, and `appRegistry`
    - Double-click icon and Start menu launch apps; Taskbar button restores and focuses minimized windows
    - Add app-level and per-window error boundaries; make layout usable at 1024x768, 1366x768, 1920x1080
    - Register placeholder-free app entries only for apps that exist; later milestones add their own registry entries
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9, 1.11_

  - [x] 1.6 Create the project documentation set and progress checklist
    - Create `docs/ARCHITECTURE_DECISIONS.md` (including the OS-GUI.js vs 98.css + react-rnd evaluation result and the Clippy asset license note), `docs/DEPENDENCIES.md`, `docs/PROGRESS.md`, `docs/TECH_DEBT.md`, `docs/INTERFACES.md`, `docs/TOOLS.md`, `docs/TEST_RESULTS.md`
    - `PROGRESS.md` lists every milestone and task with a status label from: Not started, In progress, Implemented, Tested, Blocked
    - Add a small script `scripts/check-docs.ts` that verifies all docs exist and that checklist labels are valid, and wire it into the test script
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 1.7 Write component tests for the desktop shell
    - Test icon launch, Start menu launch, Taskbar button states, minimize and restore through the Taskbar
    - _Requirements: 1.2, 1.3, 1.8, 1.9_

- [x] 2. Checkpoint - Milestone 1 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 3. Milestone 2: Shared Dexie VFS, Action_Layer core, and basic Explorer
  - [x] 3.1 Implement the Dexie schema and VFS primitives
    - Implement `src/vfs/db.ts` (nodes, contents, settings tables with the design's indexes), `paths.ts` (normalize, case-insensitive name key, `.` and `..` handling, `PATH_OUTSIDE_ROOT`), `hash.ts` (SHA-256), `events.ts` (post-commit emitter)
    - Store content as `ArrayBuffer`
    - _Requirements: 2.3, 2.4, 2.6, 2.13_

  - [x] 3.2 Implement the VFS service
    - Implement create, read, write, rename, move, remove (recursive), list, updateMeta, resolve, pathOf, subscribe, with name validation and `INVALID_MOVE` checks
    - Run every multi-record write in a single Dexie transaction, return structured errors on failure, emit events only after commit
    - Run first-time init guarded by `settings.initialized` creating `C:\Desktop`, `C:\My Documents`, `C:\My Pictures`
    - Add `useFolder` and `useNode` hooks for live updates
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 2.9, 2.10, 2.11, 2.12_

  - [ ]* 3.3 Write property test for VFS reference model
    - **Property 3: VFS matches reference model**
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 3.4 Write property test for content and metadata round trip
    - **Property 4: Content and metadata round trip**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.10, 4.3**

  - [ ]* 3.5 Write property test for path resolution
    - **Property 5: Path resolution**
    - **Validates: Requirements 2.6, 2.13**

  - [ ]* 3.6 Write property test for atomic writes under failure
    - **Property 6: Atomic writes under failure**
    - **Validates: Requirements 2.11, 2.12, 4.8, 12.5**

  - [ ]* 3.7 Write property test for change notification
    - **Property 7: Change notification**
    - **Validates: Requirements 2.9**

  - [x] 3.8 Implement extension mapping and upload validation
    - Implement the extension-to-app map (png/jpg/jpeg to paint, wpd/txt/md to wordpad, pdf to pdfPreview) returning `UNSUPPORTED_TYPE` with the extension in the message
    - Implement pure `validateUpload(name, size)` with the 20 MB limit and allowed types
    - _Requirements: 2.8, 3.8, 3.9, 3.10_

  - [ ]* 3.9 Write property test for extension to application mapping
    - **Property 8: Extension to application mapping**
    - **Validates: Requirements 2.8, 3.4, 3.5, 3.6, 3.8**

  - [ ]* 3.10 Write property test for upload validation
    - **Property 9: Upload validation**
    - **Validates: Requirements 3.9, 3.10**

  - [x] 3.11 Implement the Action_Layer core
    - Implement `src/actions/types.ts` and index with typed Result handling; implement openApplication, openFile, saveFile (with `CONFLICT_OVERWRITE` policy), and internal actions listFolder, createFolder, readMetadata, deleteNode, renameNode, moveNode
    - Actions never throw and return `{ ok: false, error: { code, message } }` on failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 12.4_

  - [ ]* 3.12 Write property test for structured action failures
    - **Property 21: Action failures are structured**
    - **Validates: Requirements 9.4**

  - [x] 3.13 Build the basic File Explorer
    - Implement `FolderTree`, `FileList` with file-type icons and selection, `ContextMenu` (Open, Rename, Delete, Properties), `PropertiesDialog` (name, type, size, location, times, AI_Metadata, notes), shared `ConfirmDialog` and message box in `src/ui`
    - Support create, rename, move, delete (with confirmation), and upload using `validateUpload`, all through the Action_Layer
    - Show unsupported-type message on open; register Explorer in `appRegistry`
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 2.9_

  - [ ]* 3.14 Write component tests for Explorer and first-init
    - Test first-init folders, context menu, delete confirmation, upload rejection messages, live refresh on VFS events
    - _Requirements: 2.7, 3.3, 3.10, 3.11, 2.9_

- [x] 4. Checkpoint - Milestone 2 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 5. Milestone 3: Paint, WordPad, and CMD core apps
  - [x] 5.1 Implement document and drawing actions and the WordPad file format
    - Implement createDocument, updateDocument, insertImageIntoDocument, createDrawing, updateDrawing in `src/actions`, with overwrite policy
    - Define `.wpd` format (`{ version: 1, doc }`), custom TipTap Image node with `vfsId` attribute, `htmlToTiptapJson`, `tiptapToPlainText`, `sanitizeHtml` (DOMPurify allow-list from the design), and a `documentBus` for open-editor updates
    - _Requirements: 7.2, 7.4, 7.6, 9.1, 12.3, 12.4_

  - [ ]* 5.2 Write property test for HTML sanitization
    - **Property 16: HTML sanitization**
    - **Validates: Requirements 7.6, 12.3**

  - [x] 5.3 Implement Paint
    - Fabric.js canvas with pencil, brush (selectable size), eraser, palette, line, rectangle, ellipse; `HistoryStack` of JSON snapshots (capacity 100)
    - Open PNG/JPG from the VFS, save PNG through `updateDrawing`/`createDrawing` on the same node, overwrite confirmation, clear error and preserved content on save failure
    - Register a Paint Context_Provider hook point and register the app in `appRegistry`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 12.5_

  - [ ]* 5.4 Write property test for Paint undo/redo depth
    - **Property 13: Paint undo/redo depth**
    - **Validates: Requirements 6.2**

  - [ ]* 5.5 Write property test for Paint PNG save round trip
    - **Property 14: Paint PNG save round trip**
    - **Validates: Requirements 6.3, 6.4, 6.5**

  - [x] 5.6 Implement WordPad
    - TipTap editor with bold, italic, underline, headings, bullet lists, undo, redo, and keyboard shortcuts; toolbar and menu
    - Save and open `.wpd`, open `.txt` and `.md` (sanitized), one-time warning when saving would lose formatting, insert image from VFS by `vfsId` with object-URL NodeView and "Image not found" placeholder
    - Reload from VFS `updated` events with a conflict dialog when local edits exist
    - Register the app in `appRegistry`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.3, 12.5_

  - [ ]* 5.7 Write property test for WordPad document round trip
    - **Property 15: WordPad document round trip**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x] 5.8 Implement CMD pure modules
    - Implement `tokenize` (quoted paths with spaces), `parseCommand`, `formatPrompt`, `historyReducer`, `modeReducer` for `nl on` / `nl off`
    - _Requirements: 8.1, 8.3, 8.4, 8.8, 8.9_

  - [ ]* 5.9 Write property test for CMD tokenizer
    - **Property 18: CMD tokenizer**
    - **Validates: Requirements 8.4**

  - [x] 5.10 Implement the CMD terminal and executeCommand action
    - xterm.js terminal with a `LineEditor` (buffer, backspace, arrow history), fit addon, prompt `C:\>` tracking cwd
    - Implement `executeCommand` in the Action_Layer for dir, cd, mkdir, cls, help with errors naming unknown commands and nonexistent paths; CMD calls it through the Action_Layer only
    - Register a CMD Context_Provider hook point and register the app in `appRegistry`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10, 9.1, 16.3_

  - [ ]* 5.11 Write property test for CMD prompt, history, and mode
    - **Property 19: CMD prompt, history, and mode**
    - **Validates: Requirements 8.1, 8.3, 8.8, 8.9**

  - [ ]* 5.12 Write property test for CMD errors and shared filesystem
    - **Property 20: CMD errors name the offender**
    - **Validates: Requirements 8.2, 8.5, 8.6**

  - [x] 5.13 Wire Explorer file opening to apps
    - Double-click PNG/JPG opens Paint with the node, WordPad documents/TXT/MD open WordPad, PDF opens a read-only preview in an iframe with the `sandbox` attribute (blob URL revoked on unmount; record any fallback in the ADR), folders navigate
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 12.8_

- [x] 6. Checkpoint - Milestone 3 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 7. Milestone 4: Express Gemini proxy, tool registry, orchestrator, context providers, confirmations
  - [x] 7.1 Define shared API contracts
    - Implement `shared/api-contracts.ts` with Zod request and response schemas for health, chat, generate-image, metadata, search-query, organize, text-transform
    - _Requirements: 10.13, 12.7_

  - [x] 7.2 Implement the Express AI_Proxy
    - Implement `server/index.ts` (app factory, `express.json({ limit: '10mb' })`, 413 on oversize), routes for every endpoint, Zod validation returning 400, `AbortSignal.timeout(30000)` mapped to 504 `AI_TIMEOUT`, other errors to 502 `AI_FAILED`, 503 `AI_UNAVAILABLE` when no key
    - Implement `server/gemini.ts` wrapper over @google/genai (function declarations via `parametersJsonSchema`, automatic function calling disabled, model turn parts returned verbatim, first image part extraction)
    - Read the key only from `process.env.GEMINI_API_KEY`; never return SDK errors or the key
    - _Requirements: 10.5, 10.11, 10.12, 10.13, 10.14, 10.15, 12.7_

  - [x] 7.3 Implement Mock_Gemini and fixtures
    - Implement `server/mockGemini.ts` selected by `MOCK_GEMINI=1` replacing only the Gemini call layer; scripted `/api/chat` with `{{stepN.field}}` placeholders resolved from `functionResponse`, deterministic metadata, search-query, organize, text-transform, and `tests/fixtures/stub.png` for generate-image
    - Support the `x-mock-fail: timeout|error|nokey` header
    - Add scripts `tests/fixtures/scripts/` for create-folder, report-on-ai, search-ml, rewrite
    - Ensure the mock is unreachable without `MOCK_GEMINI=1` and is excluded from the production start script
    - _Requirements: 15.2, 15.3_

  - [ ]* 7.4 Write property test for proxy validation and key secrecy
    - **Property 28: Proxy request validation and key secrecy**
    - **Validates: Requirements 10.12, 10.13, 12.7**

  - [ ]* 7.5 Write proxy integration tests with supertest
    - Test health, 400/413/503/504 mappings with fake timers, and mock fault injection
    - _Requirements: 10.11, 10.13, 10.14, 15.1_

  - [x] 7.6 Implement the typed AI client
    - Implement `src/ai/client.ts` fetch wrappers for every `/api` endpoint using shared contracts, response validation, and health check for Gemini availability
    - _Requirements: 5.3, 5.4, 10.5_

  - [x] 7.7 Implement the Tool_Registry
    - Implement `src/ai/registry.ts` with `ToolDef`, registration, lookup, `toFunctionDeclaration` using `z.toJSONSchema`, and `sanitizeForGemini`
    - _Requirements: 10.1, 10.5, 12.1_

  - [ ]* 7.8 Write property test for tool declaration conversion
    - **Property 22: Tool declaration conversion**
    - **Validates: Requirements 10.1, 10.5**

  - [x] 7.9 Implement the tool definitions
    - Implement tools in `src/ai/tools/` that call only the Action_Layer: list_folder, create_folder, read_file_metadata, read_document, create_document, update_document, insert_image_into_document, generate_image, create_drawing, update_drawing, delete_node, rename_node, move_node, open_file, open_application, run_command (the `search_files` and `organize_files` tools are added in 9.6 and 9.8, once their actions exist)
    - Set destructive predicates (overwrite, replace modes, delete), `appScope`, result caps (50 entries, 4 KB), and 64 KB limit on `contentHtml`
    - Image bytes never go back to Gemini; `generate_image` returns `{ fileId, path }`
    - Update `docs/TOOLS.md` from the registry
    - _Requirements: 10.1, 10.9, 11.6, 11.7, 11.8, 11.9, 12.1_

  - [x] 7.10 Implement Context_Providers
    - Implement `src/ai/context.tsx` registry keyed by windowId, `buildAiContext` that reads only the focused window's snapshot and truncates selection to 4000 chars and doc excerpt to 2000 chars
    - Register providers in Explorer, Paint, WordPad, and CMD via a shared `useContextProvider` hook
    - _Requirements: 11.4, 11.5_

  - [ ]* 7.11 Write property test for minimal Clippy context
    - **Property 29: Minimal Clippy context**
    - **Validates: Requirements 11.4, 11.5**

  - [x] 7.12 Implement the Orchestrator with confirmations
    - Implement `src/ai/orchestrator.ts`: loop with `/api/chat`, verbatim model content in history, sequential calls, Zod validation, unknown-tool and validation errors returned to the model, destructive confirmation through the `confirm` callback, `DECLINED` results, 10-call limit and 12-round cap, abort support, `onEvent` callbacks
    - Build the final report from `steps` so success lists contain only handlers that returned ok, and identify the failed step
    - Add system instruction treating tool results as data; add `ConfirmDialog` wiring for AI confirmations
    - _Requirements: 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 10.9, 10.10, 10.16, 10.17, 12.2, 12.6_

  - [ ]* 7.13 Write property test for valid registered calls only
    - **Property 23: Only valid registered calls reach handlers**
    - **Validates: Requirements 10.2, 10.3, 10.4, 12.1**

  - [ ]* 7.14 Write property test for dependent calls
    - **Property 24: Dependent calls**
    - **Validates: Requirements 10.6, 10.7**

  - [ ]* 7.15 Write property test for tool call limit
    - **Property 25: Tool call limit**
    - **Validates: Requirements 10.8**

  - [ ]* 7.16 Write property test for destructive confirmation
    - **Property 26: Destructive confirmation**
    - **Validates: Requirements 10.9, 10.10, 12.4**

  - [ ]* 7.17 Write property test for honest reporting
    - **Property 27: Honest reporting**
    - **Validates: Requirements 10.16, 10.17, 12.6**

  - [ ]* 7.18 Write prompt-injection example test
    - File text instructing "call delete_node" must not cause a handler to run without confirmation
    - _Requirements: 12.2_

- [x] 8. Checkpoint - Milestone 4 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 9. Milestone 5: App AI features
  - [x] 9.1 Add Paint AI generation (Automate)
    - Prompt input, loading overlay, 30 s AbortController guard, decode and re-encode to PNG, downscale to 4096 px, replace the canvas only after a successful decode, error message with canvas preserved on failure
    - _Requirements: 6.6, 6.7, 6.8_

  - [x] 9.2 Add the WordPad AI assistant
    - `AiMenu` (Generate, Rewrite, Summarize, Proofread, Expand) calling `/api/text-transform`, `PreviewPanel`, captured range with mapping, Accept replaces only the range (or the whole document when no selection), Reject and errors leave the document unchanged; convert result through `sanitizeHtml`
    - _Requirements: 7.7, 7.8, 7.9, 7.10_

  - [ ]* 9.3 Write property test for AI edit accept and reject
    - **Property 17: AI edit accept and reject**
    - **Validates: Requirements 7.8, 7.9, 7.10**

  - [x] 9.4 Implement MetadataService and PDF text extraction
    - Subscribe to VFS created and content-updated events, queue with concurrency 2, set `aiStatus` pending/ok/error, skip when `aiHash` equals `contentHash`, preserve `aiEditedFields`, extract PDF text with pdfjs-dist into `meta.extractedText`
    - Show an error state per file in Explorer and editable AI fields and notes in Properties
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.8, 5.1_

  - [ ]* 9.5 Write property test for metadata regeneration skip
    - **Property 10: Metadata regeneration skip**
    - **Validates: Requirements 4.2, 4.4**

  - [x] 9.6 Implement the Search_Index and natural-language search
    - MiniSearch index over name, text, extracted text, title, description, category, tags, notes with type and date post-filters; incremental updates from VFS events; implement `searchFiles` action
    - Query planner: `/api/search-query` when Gemini is available, fallback to raw text plus chrono-node date parsing
    - Register the `search_files` tool in the Tool_Registry and update `docs/TOOLS.md`
    - Explorer `SearchBar`, result view with filename, location, description, type, open action, and type/created/modified filters
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 4.4_

  - [ ]* 9.7 Write property test for search index consistency and filters
    - **Property 12: Search index consistency and filters**
    - **Validates: Requirements 4.4, 5.1, 5.2, 5.5, 5.6**

  - [x] 9.8 Implement auto-organize in Explorer
    - Call `/api/organize`, validate destinations, reuse existing folders, show `OrganizeProposalDialog`, confirm moves files through `organizeFiles`, decline moves nothing
    - Register the `organize_files` tool as destructive with per-move preview text (`describeForConfirm`) and update `docs/TOOLS.md`
    - _Requirements: 4.5, 4.6, 4.7_

  - [ ]* 9.9 Write property test for organize proposal confirm and decline
    - **Property 11: Organize proposal confirm and decline**
    - **Validates: Requirements 4.5, 4.6, 4.7**

  - [x] 9.10 Add CMD natural-language mode
    - `ai <instruction>` and `nl on` / `nl off` route to the Orchestrator with `activeApp: 'cmd'`; print steps and final text from actual results
    - _Requirements: 8.7, 8.8, 8.9, 11.9_

  - [ ]* 9.11 Write integration tests for app AI failure paths
    - Paint generation failure keeps canvas, WordPad failure keeps document, metadata failure sets error state, search fallback with `x-mock-fail: nokey`
    - _Requirements: 4.8, 5.4, 6.8, 7.10_

- [x] 10. Checkpoint - Milestone 5 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 11. Milestone 6: Clippy
  - [x] 11.1 Implement the ClippyAgent
    - Install `clippyjs` pinned exactly to `0.1.0` (no version range), and copy its agent assets into `public/clippy/`
    - Build the `ClippyAgent` React wrapper mapping the idle, thinking, and speaking states to animations, as a floating draggable character. No Text-to-Speech: "speaking" is an animation paired with chat text only
    - Fall back to `@kusainovv/react-clippy` only if `clippyjs` fails under React/Vite, and record the failure and the fallback in `docs/ARCHITECTURE_DECISIONS.md` and `docs/DEPENDENCIES.md`
    - Record the license note and package choice in `docs/ARCHITECTURE_DECISIONS.md` and `docs/DEPENDENCIES.md`
    - _Requirements: 11.1_

  - [x] 11.2 Implement Clippy chat and orchestration wiring
    - `ClippyChat` with session message store, input, per-step status from `onEvent`, final response plus authoritative step summary, confirmation prompt for destructive operations
    - Send messages to the Orchestrator with `buildAiContext`, expose tools per active app through `appScope` (Paint, WordPad, Explorer, CMD) with general tools always available
    - Register Clippy in the shell
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [ ]* 11.3 Write component tests for Clippy
    - Test animation state mapping, chat history, tool exposure per active app, and confirmation prompt before destructive execution
    - _Requirements: 11.1, 11.2, 11.6, 11.7, 11.8, 11.10_

- [x] 12. Checkpoint - Milestone 6 complete
  - Ensure all tests pass, ask the user if questions arise. Update `docs/PROGRESS.md`.

- [x] 13. Milestone 7: Integration, polish, and E2E
  - [x] 13.1 Polish and scope enforcement
    - Verify viewport behavior at 1024x768, 1366x768, 1920x1080 and error boundaries
    - Add `scripts/check-scope.ts` that fails on hardcoded AI responses, `placeholder` markers, and excluded features, and a build test that greps `dist/` for the key value and the string `GEMINI_API_KEY`
    - _Requirements: 1.11, 10.12, 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 13.2 Set up the Playwright harness
    - Configure `webServer` entries to start Vite and Express with `MOCK_GEMINI=1`, IndexedDB reset helper at test start, canvas drawing helpers using `page.mouse` and `toDataURL` pixel checks
    - _Requirements: 15.2, 15.3_

  - [x] 13.3 E2E 1: Paint persistence
    - Draw, save `drawing.png`, find in Explorer, open by double-click, edit, save, refresh, verify the edit persists
    - _Requirements: 15.4_

  - [x] 13.4 E2E 2: WordPad persistence
    - Create headings, bold text, bullets, save, reopen through Explorer, verify formatting, refresh, verify again
    - _Requirements: 15.5_

  - [x] 13.5 E2E 3: CMD shared filesystem
    - `mkdir Projects`, verify in Explorer, rename in Explorer, verify `dir` shows the new name
    - _Requirements: 15.6_

  - [x] 13.6 E2E 4: AI file search
    - Upload a machine-learning document, verify AI_Metadata generated and persisted, search "the document about machine learning", verify and open the result
    - _Requirements: 15.7_

  - [x] 13.7 E2E 5: Paint AI generation
    - Submit a prompt, verify image on canvas, edit, save, reopen through Explorer
    - _Requirements: 15.8_

  - [x] 13.8 E2E 6: WordPad AI editing
    - Select a paragraph, rewrite, verify the preview, reject and verify unchanged, repeat with accept and verify only the selection changed
    - _Requirements: 15.9_

  - [x] 13.9 E2E 7: Clippy folder creation
    - Submit "Create a folder called AI Research in My Documents", verify the folder exists, appears in Explorer, and `cd` works in CMD
    - _Requirements: 15.10_

  - [x] 13.10 E2E 8: Report on AI demo
    - Verify the document exists with all five sections, contains the image in the data centers section, is saved in the VFS, opens in WordPad, the saved location is reported, and everything persists after refresh; also check the PDF iframe `sandbox` attribute where covered
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 15.11, 12.8_

  - [ ]* 13.11 Write the optional real-provider integration test
    - `tests/integration/gemini.real.test.ts` with `describe.skipIf(!process.env.GEMINI_API_KEY)`: one `/api/chat` call with a `create_folder` declaration asserting a valid `functionCall`, and one `/api/generate-image` call asserting a decodable image
    - _Requirements: 15.12_

  - [x] 13.12 Finalize documentation and progress checklist
    - Update all docs in `docs/`: architecture decisions (including PDF sandbox and eraser decisions), dependencies, progress statuses (set Tested only for items covered by passing Vitest and Playwright runs), tech debt, interfaces, tool definitions, and test results
    - Add a script that records test results and updates checklist labels after green runs
    - _Requirements: 14.1, 14.2, 14.3, 15.1, 15.13_

- [x] 14. Final checkpoint - All milestones complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but the eight E2E tests (13.3 to 13.10) are required by Requirement 15.2
- Each task references specific requirements for traceability
- Property tests use fast-check with at least 100 runs and the tag `// Feature: win98-ai-desktop, Property N: <title>`
- Checkpoints end each milestone and update `docs/PROGRESS.md`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.6", "7.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "3.1", "7.2", "7.6"] },
    { "id": 3, "tasks": ["1.7", "3.2", "3.8", "5.8", "7.3"] },
    { "id": 4, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "3.9", "3.10", "3.11", "5.9", "7.4", "7.5"] },
    { "id": 5, "tasks": ["3.12", "3.13", "5.1", "7.7"] },
    { "id": 6, "tasks": ["3.14", "5.2", "5.3", "5.6", "5.10", "7.8", "7.9"] },
    { "id": 7, "tasks": ["5.4", "5.5", "5.7", "5.11", "5.12", "5.13", "7.10", "7.12", "9.1", "9.2", "11.1"] },
    { "id": 8, "tasks": ["7.11", "7.13", "7.14", "7.15", "7.16", "7.17", "7.18", "9.3", "9.4", "9.10"] },
    { "id": 9, "tasks": ["9.5", "9.6", "13.11"] },
    { "id": 10, "tasks": ["9.7", "9.8", "9.11"] },
    { "id": 11, "tasks": ["9.9", "11.2"] },
    { "id": 12, "tasks": ["11.3", "13.1", "13.2"] },
    { "id": 13, "tasks": ["13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10"] },
    { "id": 14, "tasks": ["13.12"] }
  ]
}
```
