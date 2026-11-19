# Requirements Document

## Introduction

Win98_AI_Desktop is a browser-based desktop environment inspired by Windows 98, with integrated AI features. It provides a window-managed desktop and six MVP applications (Desktop, File Explorer, Paint, WordPad, CMD, Clippy) that share one persistent virtual filesystem, one typed action layer, and one AI tool registry. AI behavior uses real Gemini native function calling through a server-side proxy; tools execute client-side against IndexedDB. The scope covers milestones 1-7 and eight end-to-end acceptance tests.

Technology constraints: React, TypeScript, Vite, 98.css (with react-rnd, or OS-GUI.js if evaluation favors it), Zustand, Dexie, TipTap, Fabric.js or Konva, @xterm/xterm, @google/genai, Zod, PDF.js, MiniSearch, chrono-node, DOMPurify, clippyjs assets, Vitest, Playwright. Library reuse is preferred over custom code.

Fixed limits: 10 tool calls per request, 20 MB upload limit, 30 s Gemini timeout, 10 MB proxy request body limit, at least 50 Paint undo steps, minimum window size 200x120 px.

## Glossary

- **Desktop**: The shell providing background, icons, Start menu, taskbar, clock, and window management.
- **Window_Manager**: The Desktop component managing window position, size, state, focus, and z-order.
- **Taskbar**: The bar showing Start button, one button per open window, and the clock.
- **VFS**: The shared persistent virtual filesystem stored in IndexedDB through Dexie.
- **VFS_Node**: A file or folder in the VFS with a stable ID, metadata record, and separately stored content.
- **Action_Layer**: The shared typed set of actions (openApplication, openFile, createDocument, updateDocument, insertImageIntoDocument, createDrawing, updateDrawing, saveFile, searchFiles, organizeFiles, executeCommand) used by UI, Clippy, and CMD.
- **Tool_Registry**: The shared registry of AI tools, each with name, description, Zod input schema, validator, handler, and structured result.
- **Orchestrator**: The single client-side loop shared by Clippy and CMD natural-language mode that calls the model, executes tools, and returns results.
- **AI_Proxy**: The Node/Express server exposing /api endpoints that call Gemini; it holds GEMINI_API_KEY.
- **Gemini**: The Google Gemini model service accessed only through the AI_Proxy.
- **File_Explorer**: The application for browsing and managing VFS_Nodes.
- **Paint**: The bitmap drawing application.
- **WordPad**: The rich-text document application.
- **CMD**: The command-prompt application emulating a limited command set over the VFS.
- **Clippy**: The floating AI assistant character and chat.
- **Context_Provider**: An explicit interface through which an application exposes active-app and selection information to Clippy.
- **AI_Metadata**: Title, description, category, and tags generated for a VFS_Node.
- **Search_Index**: The MiniSearch index over filenames, content, extracted PDF text, AI_Metadata, user notes, and timestamps.
- **Destructive_Operation**: Deleting a VFS_Node or overwriting existing content.
- **Mock_Gemini**: A deterministic test implementation of the AI_Proxy /api endpoints returning scripted tool calls and a stub image.
- **Report_Demo**: The cross-app scenario "Report on AI" described in Requirement 15.

## Requirements

### Requirement 1

**User Story:** As a user, I want a Windows 98 style desktop with managed windows, so that I can run several applications at once.

#### Acceptance Criteria

1. THE Desktop SHALL display a background, desktop icons, a Start menu, a Taskbar, and a clock using Windows 98 visual styling.
2. WHEN the user double-clicks a desktop icon, THE Desktop SHALL launch the associated application in a new window.
3. WHEN the user selects an application from the Start menu, THE Desktop SHALL launch that application in a new window.
4. WHEN the user drags a window title bar, THE Window_Manager SHALL move the window to follow the pointer.
5. WHEN the user drags a window edge or corner, THE Window_Manager SHALL resize the window to a width of at least 200 px and a height of at least 120 px.
6. WHEN the user activates minimize, maximize, restore, or close, THE Window_Manager SHALL apply the corresponding window state change.
7. WHEN the user presses a window, THE Window_Manager SHALL bring that window to the front and mark the window as focused.
8. WHEN a window is opened, minimized, restored, focused, or closed, THE Taskbar SHALL update the window button to reflect the window state and active indicator.
9. WHEN the user selects a Taskbar button for a minimized window, THE Window_Manager SHALL restore and focus that window.
10. WHEN the user closes a window, THE Window_Manager SHALL leave all other windows unchanged.
11. THE Desktop SHALL remain usable at viewport sizes of 1024x768, 1366x768, and 1920x1080 pixels.

### Requirement 2

**User Story:** As a user, I want one persistent filesystem shared by all apps, so that my files are available everywhere and survive refresh.

#### Acceptance Criteria

1. THE VFS SHALL support creating, reading, updating, renaming, moving, deleting, listing, and searching files and folders.
2. THE VFS SHALL assign each VFS_Node a stable ID that remains unchanged across rename and move.
3. THE VFS SHALL store VFS_Node metadata separately from VFS_Node content.
4. THE VFS SHALL store text, structured, and binary (image and PDF) content.
5. THE VFS SHALL support reading and updating VFS_Node metadata.
6. THE VFS SHALL resolve paths to VFS_Nodes, including paths containing spaces.
7. WHEN the VFS is initialized for the first time, THE VFS SHALL create the folders C:\Desktop, C:\My Documents, and C:\My Pictures.
8. THE VFS SHALL map file extensions to associated applications.
9. WHEN a VFS_Node is created, changed, renamed, moved, or deleted by any application, THE VFS SHALL notify all subscribers so that open applications reflect the change without reload.
10. WHEN the page is refreshed, THE VFS SHALL present the same VFS_Nodes and content as before the refresh.
11. THE VFS SHALL perform each multi-record write within a single atomic Dexie transaction.
12. IF a VFS write fails, THEN THE VFS SHALL leave prior content unchanged and return a structured error.
13. IF a path contains traversal segments that resolve outside the VFS root, THEN THE VFS SHALL reject the path with a structured error.

### Requirement 3

**User Story:** As a user, I want a File Explorer, so that I can browse and manage my files.

#### Acceptance Criteria

1. THE File_Explorer SHALL display folder navigation, a file listing with file-type icons, and item selection.
2. THE File_Explorer SHALL support creating, renaming, moving, and deleting files and folders.
3. WHEN the user right-clicks a VFS_Node, THE File_Explorer SHALL display a context menu with Open, Rename, Delete, and Properties.
4. WHEN the user double-clicks a PNG or JPG file, THE File_Explorer SHALL open the file in Paint.
5. WHEN the user double-clicks a WordPad document, TXT file, or MD file, THE File_Explorer SHALL open the file in WordPad.
6. WHEN the user double-clicks a PDF file, THE File_Explorer SHALL open a read-only preview in a sandboxed iframe using the browser PDF viewer.
7. WHEN the user double-clicks a folder, THE File_Explorer SHALL navigate into the folder.
8. IF the user opens a file with an unsupported extension, THEN THE File_Explorer SHALL display a message naming the unsupported file type.
9. WHEN the user uploads a PDF, TXT, MD, PNG, or JPG file of at most 20 MB, THE File_Explorer SHALL store the file in the VFS in the current folder.
10. IF an upload exceeds 20 MB or has an unsupported type, THEN THE File_Explorer SHALL reject the upload and display the reason.
11. WHEN the user selects Delete, THE File_Explorer SHALL request confirmation before deleting.
12. WHEN the user selects Properties, THE File_Explorer SHALL display name, type, size, location, created time, modified time, AI_Metadata, and user notes.

### Requirement 4

**User Story:** As a user, I want AI-generated metadata and organization, so that files are easier to find and arrange.

#### Acceptance Criteria

1. WHEN a file is added or its content changes, THE File_Explorer SHALL request AI_Metadata for the file asynchronously without blocking the UI.
2. WHEN the content hash of a file equals the hash stored with its AI_Metadata, THE VFS SHALL skip metadata regeneration for that file.
3. THE File_Explorer SHALL persist AI_Metadata with the VFS_Node.
4. WHEN the user edits AI title, description, category, tags, or user notes in Properties, THE File_Explorer SHALL persist the edits and update the Search_Index.
5. WHEN the user triggers auto-organize, THE File_Explorer SHALL propose destination folders, reusing existing folders where suitable, and display the proposal.
6. WHEN the user confirms an organize proposal, THE File_Explorer SHALL move the files to the proposed folders.
7. IF the user declines an organize proposal, THEN THE File_Explorer SHALL move no files.
8. IF metadata generation fails, THEN THE File_Explorer SHALL keep the file unchanged and display an error state for that file.

### Requirement 5

**User Story:** As a user, I want natural-language file search, so that I can find files by meaning and attributes.

#### Acceptance Criteria

1. THE Search_Index SHALL cover filenames, text content, PDF text extracted by PDF.js, AI_Metadata, user notes, and created and modified timestamps.
2. WHEN the user enters a search query, THE File_Explorer SHALL display matching results with filename, location, description, type, and an open action.
3. WHERE Gemini is available, THE File_Explorer SHALL convert the natural-language query into structured parameters including text terms, type filter, created range, and modified range.
4. IF Gemini is unavailable, THEN THE File_Explorer SHALL search using the raw query text.
5. WHEN the user applies a type, created, or modified filter, THE File_Explorer SHALL restrict results to matching files.
6. WHEN a VFS_Node changes, THE Search_Index SHALL update the corresponding entry.
7. WHEN the user activates a result open action, THE File_Explorer SHALL open the file with its associated application.

### Requirement 6

**User Story:** As a user, I want Paint, so that I can draw and edit images stored in my filesystem.

#### Acceptance Criteria

1. THE Paint SHALL provide pencil, brush with selectable size, eraser, color palette, line, rectangle, and ellipse tools.
2. THE Paint SHALL provide undo and redo with a history depth of at least 50 steps.
3. WHEN the user saves, THE Paint SHALL write the canvas as a PNG to the VFS.
4. WHEN the user opens a PNG or JPG from the VFS, THE Paint SHALL load the image onto the canvas for editing.
5. WHEN a Paint window opens a file and the user saves, THE Paint SHALL update the same VFS_Node.
6. WHEN the user submits an AI prompt in Automate, THE Paint SHALL request an image from the AI_Proxy and display a loading state.
7. WHEN the AI_Proxy returns an image, THE Paint SHALL load the image onto the canvas as editable content.
8. IF image generation fails or exceeds 30 s, THEN THE Paint SHALL display an error and keep the existing canvas content.

### Requirement 7

**User Story:** As a user, I want WordPad, so that I can write and format documents.

#### Acceptance Criteria

1. THE WordPad SHALL provide bold, italic, underline, headings, bullet lists, undo, redo, and keyboard shortcuts for bold, italic, underline, undo, and redo.
2. WHEN the user saves, THE WordPad SHALL store the document in the VFS as structured JSON or sanitized HTML.
3. WHEN the user opens a document, TXT file, or MD file, THE WordPad SHALL display the content with formatting preserved.
4. WHEN the user inserts an image from the VFS, THE WordPad SHALL reference the image by its stable VFS_Node ID.
5. WHEN the page is refreshed and a document is reopened, THE WordPad SHALL display the same formatting and inserted images.
6. THE WordPad SHALL sanitize any HTML content with DOMPurify before rendering.
7. WHEN the user chooses Generate, Rewrite, Summarize, Proofread, or Expand on a selection or the whole document, THE WordPad SHALL request the result from Gemini and display a preview.
8. WHEN the user accepts a preview, THE WordPad SHALL replace only the originally selected range, or the whole document when no selection was made.
9. WHEN the user rejects a preview, THE WordPad SHALL keep the original document content unchanged.
10. IF an AI request fails, THEN THE WordPad SHALL display an error and keep the document unchanged.

### Requirement 8

**User Story:** As a user, I want a CMD window, so that I can manage files from a command line.

#### Acceptance Criteria

1. THE CMD SHALL display the prompt C:\> and track the current working directory in the prompt.
2. THE CMD SHALL support the commands dir, cd, mkdir, cls, and help against the VFS.
3. WHEN the user presses the up or down arrow, THE CMD SHALL show the previous or next command from history.
4. WHEN the user enters a path containing spaces in quotes, THE CMD SHALL resolve the path correctly.
5. IF the user enters an unknown command, THEN THE CMD SHALL print an error message naming the command.
6. IF a command targets a nonexistent path, THEN THE CMD SHALL print an error message naming the path.
7. WHEN the user enters `ai <instruction>`, THE CMD SHALL send the instruction to the Orchestrator and print the actual results.
8. WHEN the user enters `nl on`, THE CMD SHALL treat subsequent non-built-in input as natural-language instructions until `nl off` is entered.
9. WHEN the user enters `nl off`, THE CMD SHALL treat subsequent input as standard commands.
10. THE CMD SHALL execute VFS operations through the Action_Layer.

### Requirement 9

**User Story:** As a developer, I want a shared typed action layer, so that UI, Clippy, and CMD behave identically.

#### Acceptance Criteria

1. THE Action_Layer SHALL provide the actions openApplication, openFile, createDocument, updateDocument, insertImageIntoDocument, createDrawing, updateDrawing, saveFile, searchFiles, organizeFiles, and executeCommand.
2. THE Action_Layer SHALL type the input and output of each action in TypeScript.
3. THE File_Explorer, Clippy, and CMD SHALL invoke VFS operations through the Action_Layer.
4. WHEN an action fails, THE Action_Layer SHALL return a structured error containing a code and a message.

### Requirement 10

**User Story:** As a developer, I want a shared AI tool registry and server proxy, so that AI features use real tool calling safely.

#### Acceptance Criteria

1. THE Tool_Registry SHALL define each tool with a name, description, Zod input schema, handler, and structured success-or-error result.
2. WHEN Gemini returns a tool call, THE Orchestrator SHALL validate the arguments against the Zod schema before executing the handler.
3. IF Gemini returns a tool name not in the Tool_Registry, THEN THE Orchestrator SHALL return a structured error to Gemini and execute no handler.
4. IF tool arguments fail validation, THEN THE Orchestrator SHALL return a structured validation error to Gemini and execute no handler.
5. THE Tool_Registry SHALL expose tools to Gemini through native function calling.
6. THE Orchestrator SHALL execute tool handlers client-side and return each result to Gemini.
7. THE Orchestrator SHALL support dependent tool calls where a later call uses the result of an earlier call.
8. IF a single request reaches 10 tool calls, THEN THE Orchestrator SHALL stop and report the limit and the actual completed work.
9. WHEN a tool performs a Destructive_Operation, THE Orchestrator SHALL request user confirmation before executing the handler.
10. IF the user declines confirmation, THEN THE Orchestrator SHALL skip the handler and return a structured declined result to Gemini.
11. THE AI_Proxy SHALL call Gemini using @google/genai with the key read from the GEMINI_API_KEY environment variable.
12. THE AI_Proxy SHALL keep GEMINI_API_KEY out of all responses and browser-delivered code.
13. THE AI_Proxy SHALL reject request bodies larger than 10 MB and malformed requests with an error response.
14. IF a Gemini call exceeds 30 s, THEN THE AI_Proxy SHALL return a timeout error.
15. WHILE running in development, THE Vite dev server SHALL proxy /api requests to the AI_Proxy.
16. WHEN the Orchestrator finishes, THE Orchestrator SHALL report only results of tools that completed successfully as successes.
17. IF a tool fails partway through a multi-step request, THEN THE Orchestrator SHALL report the completed steps and the failed step.

### Requirement 11

**User Story:** As a user, I want Clippy, so that I can ask an assistant to perform tasks across apps.

#### Acceptance Criteria

1. THE Clippy SHALL display a floating character with idle, thinking, and speaking animations using existing Clippy assets.
2. THE Clippy SHALL provide a chat interface that keeps message history for the current session.
3. WHEN the user submits a message, THE Clippy SHALL send the message to the Orchestrator and display the final response.
4. THE Clippy SHALL obtain active application and selected content only through Context_Provider interfaces.
5. THE Clippy SHALL send only the context needed for the current request to the AI_Proxy.
6. WHILE Paint is active, THE Clippy SHALL support generating an image, opening an image, and saving an image.
7. WHILE WordPad is active, THE Clippy SHALL support creating, generating, rewriting, summarizing, editing, inserting images into, and saving a document.
8. WHILE File_Explorer is active, THE Clippy SHALL support searching, creating files and folders, organizing, reading metadata, and opening files.
9. WHILE CMD is active, THE Clippy SHALL support natural-language commands.
10. WHEN Clippy plans a Destructive_Operation, THE Clippy SHALL display a confirmation prompt before execution.

### Requirement 12

**User Story:** As a user, I want content safety and data integrity, so that AI and uploads cannot damage my data.

#### Acceptance Criteria

1. THE Tool_Registry SHALL execute only registered tools.
2. THE Orchestrator SHALL treat uploaded file content and AI output as untrusted data and not as instructions.
3. THE WordPad SHALL sanitize HTML with DOMPurify before insertion into the document.
4. WHEN a save would overwrite an existing VFS_Node, THE VFS SHALL request user confirmation before overwriting.
5. IF a save fails, THEN THE application SHALL display a clear error message and preserve the previous content.
6. THE Orchestrator SHALL NOT report an operation as successful unless the corresponding handler returned success.
7. THE AI_Proxy SHALL validate the shape of each request body with Zod before calling Gemini.
8. THE PDF preview SHALL render inside an iframe with the sandbox attribute.

### Requirement 13

**User Story:** As a user, I want a cross-app Report on AI automation, so that Clippy completes a multi-step task end to end.

#### Acceptance Criteria

1. WHEN the user asks Clippy to create a report on AI, THE Clippy SHALL generate report content covering history of LLMs, how LLMs work, applications, implications, and a data centers section.
2. WHEN report content is generated, THE Clippy SHALL create a WordPad document in the VFS and populate the document with the content.
3. WHEN the document is created, THE Clippy SHALL generate a data center image and save the image to the VFS.
4. WHEN the image is saved, THE Clippy SHALL insert the image into the data centers section of the document.
5. WHEN the document is complete, THE Clippy SHALL save the document, open the document in WordPad, and report the saved location and status.
6. WHEN the page is refreshed, THE VFS SHALL retain the report document and the image, and WordPad SHALL display both.

### Requirement 14

**User Story:** As a maintainer, I want project documentation and a library-first approach, so that the codebase stays small and traceable.

#### Acceptance Criteria

1. THE project SHALL maintain documents for architecture decisions, dependencies, a progress checklist, tech debt, interfaces, tool definitions, and test results.
2. THE progress checklist SHALL label each item as Not started, In progress, Implemented, Tested, or Blocked.
3. THE project SHALL record the evaluation result for OS-GUI.js versus 98.css with react-rnd in the architecture decisions document.
4. THE project SHALL deliver milestones 1-7 in order: Desktop foundation; Shared VFS and basic Explorer; Core apps; Shared AI infrastructure; App AI features; Clippy; Integration, polish, and E2E.

### Requirement 15

**User Story:** As a maintainer, I want automated tests, so that every acceptance scenario is verified.

#### Acceptance Criteria

1. THE project SHALL include Vitest unit and integration tests for the VFS, Action_Layer, Tool_Registry, Orchestrator, AI_Proxy, and CMD parser.
2. THE project SHALL include eight Playwright end-to-end tests run against Mock_Gemini.
3. THE Mock_Gemini SHALL return scripted tool calls and a stub image for the /api endpoints.
4. THE Paint persistence test SHALL draw, save drawing.png, locate the file in File_Explorer, open it by double-click in Paint, edit, save, refresh, and verify the edit persists.
5. THE WordPad persistence test SHALL create headings, bold text, and bullets, save, reopen through File_Explorer, verify formatting, refresh, and verify formatting again.
6. THE CMD shared-filesystem test SHALL run mkdir Projects, verify File_Explorer shows Projects, rename Projects in File_Explorer, and verify dir in CMD shows the new name.
7. THE AI file search test SHALL upload a machine-learning document, verify AI_Metadata is generated and persisted, search "the document about machine learning", verify the correct result, and open the result.
8. THE Paint AI generation test SHALL submit a prompt, verify the image on canvas, edit, save, and reopen through File_Explorer.
9. THE WordPad AI editing test SHALL select a paragraph, rewrite, verify the preview, reject and verify the document is unchanged, then repeat with accept and verify only the selection changed.
10. THE Clippy folder test SHALL submit "Create a folder called AI Research in My Documents" and verify the folder exists, appears in File_Explorer, and is reachable with cd in CMD.
11. THE Report_Demo test SHALL verify that the document exists, contains all five required sections, contains the inserted image in the data centers section, is saved in the VFS, opens in WordPad, reports the saved location, and persists after refresh.
12. WHERE GEMINI_API_KEY is configured, THE project SHALL run at least one integration test against the real Gemini provider.
13. WHEN all Vitest and Playwright tests pass, THE project SHALL mark the corresponding checklist items as Tested.

### Requirement 16

**User Story:** As a product owner, I want a defined MVP scope, so that excluded capabilities are not built.

#### Acceptance Criteria

1. THE project SHALL deliver no OS virtualization, cloud sync, accounts or authentication, multiplayer, or voice features.
2. THE project SHALL deliver no long-term memory, background execution, multi-agent frameworks, or vector databases.
3. THE CMD SHALL deliver no scripting, pipes, environment variables, subprocesses, or package management.
4. THE project SHALL deliver no PDF export, advanced page layout, or advanced image editing.
5. THE project SHALL deliver no placeholder UI, hardcoded AI responses, or simulated tool execution in production code.
