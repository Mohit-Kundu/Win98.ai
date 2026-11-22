# Functionality

What Win98.ai includes and what it does not. Status is based on `docs/PROGRESS.md`: all feature milestones are implemented, and the E2E suite passes against Mock_Gemini (264 unit tests, 12 browser tests).

## Included

### Desktop shell
- Draggable, resizable windows with minimize, maximize and close.
- Taskbar, Start menu and desktop icons.
- Opening a file launches the matching app by extension: `png`, `jpg`, `jpeg` open Paint; `wpd`, `txt`, `md` open WordPad; `pdf` opens PDF preview.

### Virtual file system
- One shared drive (`C:\`) stored in the browser with IndexedDB (Dexie).
- All apps read and write it through one action layer, so a file saved in one app shows up in the others.
- Uploads up to 20 MB.

### File Explorer
- Folder tree and file list.
- New folder, rename (F2), move, delete (Delete key, with confirmation), properties, open (Enter or double-click).
- Upload files from the host machine, with an overwrite prompt.
- AI metadata for files (title, description, category), with "Retry analysis".
- Natural-language search (for example by topic, type or date) over file names and AI metadata, including PDF text.
- "Organize with AI...": proposes moves from names and metadata only (never file content). You can uncheck or edit rows before applying.

### Paint
- Tools: pencil, brush, eraser, line, rectangle, ellipse.
- Color palette and brush size.
- Undo and redo.
- Save and Save As to PNG, with an overwrite prompt.
- AI image generation into the canvas or a new file.

### WordPad
- Rich text: bold, italic, underline, bullet list.
- Insert images from the file system.
- Undo and redo.
- New, Open, Save, Save As (`.wpd` format).
- Reads and writes `.txt` and `.md` as plain text.
- AI assistant: write from a prompt and rewrite a selection. You accept or reject each AI edit.
- AI output is sanitized before it enters the document.

### CMD
- Built-in commands: `dir`, `cd`, `mkdir`, `cls`, `help`.
- Command history and prompt showing the current path.
- Natural language: `ai <instruction>` for one request, `nl on` / `nl off` to treat every line as an instruction.
- Uses the same file system as the other apps.

### PDF preview
- Read-only view of PDF pages (up to 50 pages) rendered in a sandboxed frame.
- Text extraction from PDFs for search and metadata.

### Clippy assistant
- Animated Clippy with a chat window, bundled locally (no CDN).
- While idle, Clippy plays a random idle animation every 6 to 12 seconds.
- Clippy plays Alert when a step fails or is declined, and Congratulate when a run finishes with at least one successful step and no failures.
- Gets minimal context about the focused app, folder and selection.
- Performs multi-step requests with real tool calls, up to 10 per run.
- Asks for confirmation before destructive actions and reports partial failures honestly.
- Tools (18): `list_folder`, `create_folder`, `read_file_metadata`, `read_document`, `create_document`, `update_document`, `insert_image_into_document`, `generate_image`, `create_drawing`, `update_drawing`, `delete_node`, `rename_node`, `move_node`, `open_file`, `open_application`, `run_command`, `search_files`, `organize_files`.

### AI proxy server
- Express server that holds the Gemini API key and forwards requests. The key never reaches the browser.
- Endpoints: `/api/health`, `/chat`, `/generate-image`, `/metadata`, `/search-query`, `/organize`, `/text-transform`.
- Request validation, 10 MB body limit, 30 second timeout, structured errors.
- Mock_Gemini mode (`MOCK_GEMINI=1`) for offline demos and tests. Disabled in `npm start`.

### Quality tooling
- Vitest unit and component tests, Playwright E2E tests, ESLint, TypeScript.
- A scope check that fails the build if production code contains hardcoded AI replies, placeholders or excluded features.

## Not included

### Out of scope by design
- OS virtualization or emulation.
- Cloud sync, user accounts, authentication, multiplayer.
- Voice input or output (no speech recognition or text-to-speech).
- Long-term memory, background execution, multi-agent frameworks, vector databases.
- CMD scripting, pipes, environment variables, subprocesses, package management.
- CMD commands beyond `dir`, `cd`, `mkdir`, `cls`, `help` (no `copy`, `del`, `type`, `ren`, `move`).
- PDF export, advanced page layout, advanced image editing.

### Limitations
- Paint has no layers, transparency, text tool, fill tool or selection tools. The eraser paints white (TD-2).
- Paint's default window shows only part of the 640x480 canvas, so you need to scroll or resize (TD-7).
- PDF preview text is not selectable, and the PDF library adds about 1 MB when first used (TD-4).
- WordPad AI Rewrite can report "The selection has no text" after a triple-click selection (TD-6).
- Closing Explorer while Paint is open may not work in some cases (TD-5).
- Data is local to one browser profile. Clearing site data deletes the files, and there is no export or backup.
- AI features need a Gemini API key and network access. Without one they report "AI is not available".
- Image generation depends on the configured Gemini image model being available to your key.

### Not yet done
- Property-based tests and optional component tests (TD-10).
- Automated test against the real Gemini API. Tests use Mock_Gemini.
- Final all-milestones checkpoint in `docs/PROGRESS.md`.
