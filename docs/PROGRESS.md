# Progress

Status labels: Not started, In progress, Implemented, Tested, Blocked.
"Tested" is set only for items covered by passing Vitest and Playwright runs. `scripts/check-docs.ts` validates the labels.

| ID | Item | Status |
|---|---|---|
| M1 | Milestone 1: Project scaffold and desktop with window manager | Implemented |
| 1.1 | Scaffold the project and tooling | Implemented |
| 1.2 | Implement the Zustand window store | Tested |
| 1.3 | Property test: window size lower bound (optional) | Not started |
| 1.4 | Property test: window manager state machine (optional) | Not started |
| 1.5 | Build the desktop shell UI | Tested |
| 1.6 | Create the project documentation set and progress checklist | Implemented |
| 1.7 | Component tests for the desktop shell (optional) | Not started |
| 2 | Checkpoint: Milestone 1 complete | Not started |
| M2 | Milestone 2: Shared Dexie VFS, Action_Layer core, basic Explorer | Implemented |
| 3.1 | Dexie schema and VFS primitives | Tested |
| 3.2 | VFS service | Tested |
| 3.3 | Property test: VFS matches reference model (optional) | Not started |
| 3.4 | Property test: content and metadata round trip (optional) | Not started |
| 3.5 | Property test: path resolution (optional) | Not started |
| 3.6 | Property test: atomic writes under failure (optional) | Not started |
| 3.7 | Property test: change notification (optional) | Not started |
| 3.8 | Extension mapping and upload validation | Tested |
| 3.9 | Property test: extension to application mapping (optional) | Not started |
| 3.10 | Property test: upload validation (optional) | Not started |
| 3.11 | Action_Layer core | Tested |
| 3.12 | Property test: structured action failures (optional) | Not started |
| 3.13 | Basic File Explorer | Tested |
| 3.14 | Component tests for Explorer and first-init (optional) | Not started |
| 4 | Checkpoint: Milestone 2 complete | Implemented |
| M3 | Milestone 3: Paint, WordPad, and CMD core apps | Implemented |
| 5.1 | Document and drawing actions, WordPad file format | Tested |
| 5.2 | Property test: HTML sanitization (optional) | Not started |
| 5.3 | Paint | Tested |
| 5.4 | Property test: Paint undo/redo depth (optional) | Not started |
| 5.5 | Property test: Paint PNG save round trip (optional) | Not started |
| 5.6 | WordPad | Tested |
| 5.7 | Property test: WordPad document round trip (optional) | Not started |
| 5.8 | CMD pure modules | Tested |
| 5.9 | Property test: CMD tokenizer (optional) | Not started |
| 5.10 | CMD terminal and executeCommand action | Tested |
| 5.11 | Property test: CMD prompt, history, and mode (optional) | Not started |
| 5.12 | Property test: CMD errors and shared filesystem (optional) | Not started |
| 5.13 | Wire Explorer file opening to apps | Tested |
| 6 | Checkpoint: Milestone 3 complete | Implemented |
| M4 | Milestone 4: Proxy, tool registry, orchestrator, context providers | Implemented |
| 7.1 | Define shared API contracts | Tested |
| 7.2 | Express AI_Proxy | Tested |
| 7.3 | Mock_Gemini and fixtures | Tested |
| 7.4 | Property test: proxy validation and key secrecy (optional) | Not started |
| 7.5 | Proxy integration tests (optional) | Not started |
| 7.6 | Typed AI client | Tested |
| 7.7 | Tool_Registry | Tested |
| 7.8 | Property test: tool declaration conversion (optional) | Not started |
| 7.9 | Tool definitions | Tested |
| 7.10 | Context_Providers | Tested |
| 7.11 | Property test: minimal Clippy context (optional) | Not started |
| 7.12 | Orchestrator with confirmations | Tested |
| 7.13 | Property test: valid registered calls only (optional) | Not started |
| 7.14 | Property test: dependent calls (optional) | Not started |
| 7.15 | Property test: tool call limit (optional) | Not started |
| 7.16 | Property test: destructive confirmation (optional) | Not started |
| 7.17 | Property test: honest reporting (optional) | Not started |
| 7.18 | Prompt-injection example test (optional) | Not started |
| 8 | Checkpoint: Milestone 4 complete | Implemented |
| M5 | Milestone 5: App AI features | Implemented |
| 9.1 | Paint AI generation | Tested |
| 9.2 | WordPad AI assistant | Tested |
| 9.3 | Property test: AI edit accept and reject (optional) | Not started |
| 9.4 | MetadataService and PDF text extraction | Tested |
| 9.5 | Property test: metadata regeneration skip (optional) | Not started |
| 9.6 | Search_Index and natural-language search | Tested |
| 9.7 | Property test: search index consistency (optional) | Not started |
| 9.8 | Auto-organize in Explorer | Tested |
| 9.9 | Property test: organize confirm and decline (optional) | Not started |
| 9.10 | CMD natural-language mode | Tested |
| 9.11 | Integration tests for app AI failure paths (optional) | Not started |
| 10 | Checkpoint: Milestone 5 complete | Implemented |
| M6 | Milestone 6: Clippy | Implemented |
| 11.1 | ClippyAgent | Tested |
| 11.2 | Clippy chat and orchestration wiring | Tested |
| 11.3 | Component tests for Clippy (optional) | Not started |
| 12 | Checkpoint: Milestone 6 complete | Implemented |
| M7 | Milestone 7: Integration, polish, and E2E | In progress |
| 13.1 | Polish and scope enforcement | Tested |
| 13.2 | Playwright harness | Tested |
| 13.3 | E2E 1: Paint persistence | Tested |
| 13.4 | E2E 2: WordPad persistence | Tested |
| 13.5 | E2E 3: CMD shared filesystem | Tested |
| 13.6 | E2E 4: AI file search | Tested |
| 13.7 | E2E 5: Paint AI generation | Tested |
| 13.8 | E2E 6: WordPad AI editing | Tested |
| 13.9 | E2E 7: Clippy folder creation | Tested |
| 13.10 | E2E 8: Report on AI demo | Tested |
| 13.11 | Real-provider integration test (optional) | Not started |
| 13.12 | Finalize documentation and progress checklist | Implemented |
| 14 | Final checkpoint: all milestones complete | Not started |
