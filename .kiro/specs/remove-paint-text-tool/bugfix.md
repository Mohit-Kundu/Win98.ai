# Bugfix Requirements Document

## Introduction

Paint has a Text tool, shown as the "T" button in the toolbox. Clicking the canvas with it opens a single-line web-style input, and committing the input adds the text to the drawing. The user does not want this feature. They asked to "remove the textbox feature" and confirmed that the whole Text tool is to be removed, not only the web-style textbox.

This spec supersedes `paint-text-tool-win98-behavior`, which planned to rebuild the Text tool to match Windows 98 Paint. None of that spec's requirements apply. It also supersedes the earlier `add-text-button-not-working` spec, which fixed the tool that is now being removed.

The Text tool is present in the Paint source, the Paint styles, an end-to-end test file, `FUNCTIONALITY.md`, and `README.md`. A search of `docs/` and `QUICKSTART.md` found no Text tool references.

Saved Paint files are flat PNG images (ADR-6), and loading a file places the PNG on the canvas as an image. Text drawn with the tool is therefore baked into the PNG on save and is not stored as a text object. Text objects exist only in the in-memory undo and redo history of an open Paint window. No saved file can contain one, so there is nothing to migrate.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user opens Paint THEN the system shows a "T" (Text) button in the toolbox and lets the user select it.

1.2 WHEN the Text tool is selected and the user clicks the canvas THEN the system opens a single-line input overlay (`.paint-text-input`) at the click point, moves keyboard focus into it, and shows a text cursor over the canvas.

1.3 WHEN the user types in the overlay and presses Enter, clicks elsewhere, or otherwise blurs it THEN the system adds the typed text to the drawing as a text object, and records an Undo step for it.

1.4 WHEN the Text tool is selected THEN the system changes how Paint handles pointer and focus events on the canvas surface, so that focus stays with the overlay instead of moving to the Paint window.

1.5 WHEN a developer or user reads the project's documentation and tests THEN the system describes the Text tool as a Paint feature in `FUNCTIONALITY.md` and `README.md`. It also ships an end-to-end test file, `e2e/paint-text-tool.spec.ts`, that requires the Text tool to exist.

1.6 WHEN a developer reads the specs folder THEN the system contains `paint-text-tool-win98-behavior` and `add-text-button-not-working`, which describe the Text tool as current or planned behavior.

### Expected Behavior (Correct)

2.1 WHEN the user opens Paint THEN the system SHALL show no "T" (Text) button in the toolbox. The toolbox SHALL offer only Pencil, Brush, Eraser, Line, Rectangle, Ellipse, and Fill.

2.2 WHEN the user clicks the canvas with any remaining tool THEN the system SHALL NOT open a text input overlay, and SHALL NOT show a text cursor over the canvas.

2.3 WHEN the user draws, undoes, redoes, saves, or loads in Paint THEN the system SHALL NOT create any text object. The Text tool's overlay, commit logic, state, tool type, icon, CSS, and canvas-surface focus handling SHALL NOT exist in the Paint source or styles.

2.4 WHEN a remaining tool is used on the canvas surface THEN the system SHALL give focus to the Paint window on pointer down, as it does for all non-Text tools today, with no Text-tool-specific branch left in the focus or pointer handling.

2.5 WHEN a developer or user reads the project's documentation and tests THEN the system SHALL describe Paint's tools as pencil, brush, eraser, line, rectangle, ellipse, and fill (flood fill) in `FUNCTIONALITY.md` and `README.md`, with no mention of a Text tool. The end-to-end test file `e2e/paint-text-tool.spec.ts` SHALL be removed. Any helper used only by that file SHALL be removed too.

2.6 WHEN a developer reads the specs folder THEN the system SHALL mark `paint-text-tool-win98-behavior` and `add-text-button-not-working` as superseded by this spec, so that they are no longer read as current or planned behavior.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user draws with the Pencil, Brush, Eraser, Line, Rectangle, Ellipse, or Fill tool THEN the system SHALL CONTINUE TO draw exactly as it does today, including the selected color and brush size.

3.2 WHEN the user clicks Undo or Redo, or presses Ctrl+Z, Ctrl+Y, or Ctrl+Shift+Z THEN the system SHALL CONTINUE TO step through the drawing history as it does today, including the history capacity.

3.3 WHEN the user saves a drawing or reopens one THEN the system SHALL CONTINUE TO store and load flat PNG files in the same way. A reopened drawing SHALL display and export identically to before this change.

3.4 WHEN Paint has undo or redo history that contains only non-text content THEN the system SHALL CONTINUE TO restore each snapshot without error.

3.5 WHEN the user uses AI Automate THEN the system SHALL CONTINUE TO generate an image and place it on the canvas as it does today, and the AI Automate dialog's own text area SHALL CONTINUE TO accept typing.

3.6 WHEN the user uses New, Save, Save As..., the overwrite confirmation, the palette, or the brush size selector THEN the system SHALL CONTINUE TO behave as it does today.

3.7 WHEN the user presses a keyboard shortcut in Paint while focus is in an input or text area, such as the AI Automate prompt, THEN the system SHALL CONTINUE TO leave editing to the browser.

3.8 WHEN other Paint end-to-end and unit tests run (persistence, AI generation, history, pencil stroke quality) THEN the system SHALL CONTINUE TO pass without edits other than removing the Text tool.

3.9 WHEN other apps run (Explorer, WordPad, CMD, Clippy, Recycle Bin, desktop) THEN the system SHALL CONTINUE TO behave as they do today. This includes WordPad's own text editing and the AI context that Paint reports to the assistant.
