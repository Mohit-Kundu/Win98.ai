# Win98.ai

A Windows 98 style desktop that runs in the browser, with an AI assistant (Clippy) that can operate the apps for you. Paint, WordPad, a command prompt and a file explorer share one virtual file system stored in your browser (IndexedDB). Google Gemini powers the AI features through a small local proxy server.

## What it is

- A retro desktop built with React and 98.css: draggable and resizable windows, taskbar, Start menu and desktop icons (drag to rearrange).
- Four apps (File Explorer, Paint, WordPad, CMD) plus a PDF preview, all reading and writing the same virtual drive (`C:\`).
- Clippy, a chat assistant that calls real tools to create folders, write documents, generate images, search, organize and delete files. Destructive actions ask for confirmation first.
- Everything is stored locally in the browser. The only network traffic is from the proxy server to Gemini.

See [FUNCTIONALITY.md](FUNCTIONALITY.md) for the full list of what is and is not included.

## How to run

### Requirements

- Node.js 20 or newer
- npm
- A Gemini API key (optional, only needed for AI features)

### Steps

```
npm install
```

Open two terminals in the project folder.

Terminal 1, the AI proxy (port 8787):

```
npm run server
```

Terminal 2, the desktop (port 5173):

```
npm run dev
```

Open http://localhost:5173.

### Enabling AI

Without a key the desktop works, but AI features reply "AI is not available". The server reads `GEMINI_API_KEY` from the environment. It does not load `.env` by itself, so set the variable in the terminal before starting the server.

PowerShell:

```
$env:GEMINI_API_KEY = "your-key"
npm run server
```

macOS / Linux:

```
GEMINI_API_KEY=your-key npm run server
```

To try the AI offline with scripted replies, set `MOCK_GEMINI=1` the same way. Mock mode is ignored by `npm start`.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Gemini key. Stays on the server and is never sent to the browser. |
| `GEMINI_TEXT_MODEL` | `gemini-3.8-flash` | Model for chat, search, metadata and text tasks. |
| `GEMINI_IMAGE_MODEL` | `gemini-nano-banana-2.1` | Model for image generation. |
| `MOCK_GEMINI` | unset | Set to `1` to use scripted Mock_Gemini (development and tests). |
| `PORT` | `8787` | Proxy server port. |

### Production build

```
npm run build
npm start
```

`npm run build` type checks and writes the bundle to `dist/`. `npm start` runs the proxy in production mode (mock disabled).

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Docs check, scope check and Vitest unit tests |
| `npm run e2e` | Playwright browser tests (stop running servers first so ports 5173 and 8787 are free) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |

## Functionality at a glance

- **File Explorer:** folder tree, create, rename, move, delete, properties, upload, AI natural-language search, AI auto-organize.
- **Paint:** pencil, brush, eraser, line, rectangle, ellipse, palette, undo/redo, PNG save, AI image generation.
- **WordPad:** rich text (bold, italic, underline, bullet list), images, undo/redo, AI write and rewrite.
- **CMD:** `dir`, `cd`, `mkdir`, `cls`, `help`, plus `ai <instruction>` and `nl on` for natural-language commands.
- **PDF preview:** read-only page rendering.
- **Clippy:** chat with 18 tools across the file system and apps, multi-step requests (up to 10 tool calls per run), confirmation for destructive actions.

## Not currently supported

- Voice input or output, user accounts, cloud sync, multiplayer, and OS virtualization.
- Long-term memory, background tasks, multi-agent setups, and vector databases.
- CMD scripting, pipes, environment variables, subprocesses and package management. Only the five built-in commands exist.
- PDF export, advanced page layout, and advanced image editing (no layers, transparency or selection tools in Paint).
- Selectable text in PDF preview.
- Real-provider (live Gemini) automated test. Tests use Mock_Gemini.

Known issues are listed in [docs/TECH_DEBT.md](docs/TECH_DEBT.md), for example a small default Paint window and a WordPad AI Rewrite problem after triple-click selection.

## Project layout

| Path | Contents |
| --- | --- |
| `src/desktop` | Desktop shell, window frames, taskbar, Start menu |
| `src/apps` | Explorer, Paint, WordPad, CMD, Clippy, PDF preview |
| `src/actions` | Action layer, the only code that touches the file system |
| `src/vfs` | Dexie (IndexedDB) virtual file system |
| `src/ai` | AI client, tool registry, orchestrator, context providers |
| `server` | Express proxy to Gemini |
| `shared` | API contracts shared by client and server |
| `e2e` | Playwright tests |
| `docs` | Architecture decisions, tools, progress, tech debt, test results |

## Notes

- Clippy sprites and animations derive from Microsoft Agent assets, which the package's MIT license does not cover. They are used here for a non-commercial demo. Confirm the terms before redistributing or using commercially.
- Data lives in your browser's IndexedDB (`win98-ai-vfs`). Clearing site data deletes your files.
