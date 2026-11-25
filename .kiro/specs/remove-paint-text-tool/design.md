# Remove Paint Text Tool Bugfix Design

## Overview

Paint has a Text tool (the "T" button). Clicking the canvas with it opens a single-line `<input>` overlay, and committing the input adds a Fabric `IText` object to the drawing. The user does not want the feature and confirmed that the whole tool is to be removed.

This is a removal, so the "bug" is the presence of the tool and of everything that describes or tests it. The fix deletes the tool from five artifacts and marks two older specs as superseded:

- `src/apps/paint/Paint.tsx`: the tool type, icon, toolbox entry, overlay state, commit logic, canvas branch, cursor, focus effect, surface focus handlers, and overlay JSX.
- `src/apps/paint/paint.css`: the `.paint-text-input` rule.
- `e2e/paint-text-tool.spec.ts`: deleted.
- `README.md` and `FUNCTIONALITY.md`: the Text tool mentions.
- `paint-text-tool-win98-behavior` and `add-text-button-not-working`: a "Superseded" banner on each of their three documents.

Git history shows that only four commits touched the Paint source, the Paint CSS, `README.md` and `FUNCTIONALITY.md` since the Fill tool commit `d5c2221`, and all four are Text tool commits. The target state of those four files is therefore exactly their content at `d5c2221`. That gives the fix an exact check: after the edits, `git diff d5c2221 -- <the four files>` must be empty.

Two questions from the request are answered in [Fix Implementation](#fix-implementation):

- Removing the `IText` import does not affect `loadFromJSON` for undo and redo snapshots. No snapshot can contain an `IText` after the change, and the class stays registered in the bundle anyway.
- The two older specs get a banner under their title and are kept for history. They are not deleted or renamed.

## Glossary

- **Bug_Condition (C)**: An input that reaches the Text tool or its documentation: opening Paint (the toolbox shows "T"), selecting Text, a canvas pointer-down while Text is active, a text commit, or reading the Text tool in docs, tests, or specs.
- **Property (P)**: The behavior after the fix. Paint offers seven tools, never opens a text overlay, never creates a text object, and sends focus to the Paint window on every canvas pointer-down.
- **Preservation**: Behavior outside the Text tool that must stay unchanged: the seven remaining tools, history, save and load, AI Automate, palette, brush size, and all other apps.
- **Text tool**: The tool with id `'text'` and label "Text" in the Paint toolbox.
- **Text overlay**: The `<input className="paint-text-input">` rendered over the canvas while `textOverlay` is non-null.
- **`IText`**: The Fabric.js class (`fabric` 6.9.1) that `commitText` instantiates. It is the only text object type Paint ever creates.
- **Snapshot**: A `{ json, width, height }` record. `json` is `JSON.stringify(canvas.toJSON())`. `HistoryStack` holds snapshots in memory, and `restore` replays them with `canvas.loadFromJSON`.
- **`classRegistry`**: Fabric's map from a serialized object `type` to its class. `loadFromJSON` fails with `No class registered for <type>` (`fabric/src/ClassRegistry.ts:34`) when a type is missing.
- **`live`**: The ref in `Paint` that holds the latest `tool`, `color`, `size`, `dirty`, `file` for handlers attached once.
- **Superseded banner**: A one-line blockquote under a spec document's title that says another spec replaces it.
- **`d5c2221`**: The commit `feat(paint): add fill colour tool with flood-fill and Win98 bucket icon`, the last commit before the Text tool.

## Bug Details

### Bug Condition

The bug manifests whenever the Text tool, or an artifact that describes or tests it, is reachable. `Paint` renders a `Text` entry from the `TOOLS` array, `setTool('text')` activates it, the Fabric `mouse:down` handler opens the overlay, and `commitText` turns the typed value into an `IText`. `FUNCTIONALITY.md`, `README.md`, `e2e/paint-text-tool.spec.ts`, and two spec folders describe the tool as current or planned behavior.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PaintInteraction | ProjectArtifactRead
  OUTPUT: boolean

  RETURN input.kind = 'open-paint'                                          // toolbox shows "T" (1.1)
      OR (input.kind = 'select-tool'         AND input.tool = 'text')       // 1.1
      OR (input.kind = 'canvas-pointer-down' AND input.activeTool = 'text') // 1.2, 1.4
      OR (input.kind = 'text-commit')                                       // 1.3
      OR (input.kind = 'read' AND input.target IN {
            FUNCTIONALITY.md "Tools" line and "Text tool" line,
            README.md Paint line,
            e2e/paint-text-tool.spec.ts })                                  // 1.5
      OR (input.kind = 'read' AND input.target IN {
            .kiro/specs/paint-text-tool-win98-behavior/*,
            .kiro/specs/add-text-button-not-working/* }
          AND NOT hasSupersededBanner(input.target))                        // 1.6
END FUNCTION
```

`open-paint` is a bug input only for the toolbox contents. Every other observable result of opening Paint (palette, brush size, empty canvas, status bar) is outside the Text surface and falls under Property 2.

### Examples

- Open Paint. The toolbox shows eight buttons: Pencil, Brush, Eraser, Line, Rectangle, Ellipse, Fill, Text. Expected: seven buttons, no Text.
- Select Text and click the canvas at (100, 100). A dashed `.paint-text-input` opens at the click point and takes focus, and the pointer shows a text cursor. Expected: Text cannot be selected, so no overlay and no text cursor.
- Type "Hello" and press Enter. An `IText` object is added and Undo becomes enabled. Expected: no text object is ever created.
- With Text active, pointer-down on the canvas skips the focus move to the Paint window, and `onMouseDown` calls `preventDefault()`. Expected: for every remaining tool, pointer-down focuses the `.paint` root.
- Edge case, not a bug input: select Pencil, press Ctrl+Z while focus is in the AI Automate textarea. The browser handles the keys. Expected: unchanged.
- Read `FUNCTIONALITY.md`. It lists "text" among the tools and has a separate "Text tool" bullet. Expected: neither.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The Pencil, Brush, Eraser, Line, Rectangle, Ellipse, and Fill tools draw exactly as before, with the selected color and brush size (3.1).
- Undo, Redo, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, and the history capacity of 100 behave as before (3.2).
- Saving writes a flat PNG, and loading places a PNG on the canvas as an image. A reopened drawing displays and exports as before (3.3).
- Snapshots that contain only non-text objects restore without error (3.4).
- AI Automate generates and places an image, and its textarea accepts typing (3.5).
- New, Save, Save As..., the overwrite confirmation, the palette, and the brush size selector behave as before (3.6).
- The `onKeyDown` guard that leaves shortcuts to the browser when focus is in an `INPUT` or `TEXTAREA` stays. The AI Automate textarea still depends on it (3.7).
- The other Paint unit and e2e tests pass unedited (3.8).
- Explorer, WordPad (including its own text editing), CMD, Clippy, the Recycle Bin, the desktop, and the AI context Paint reports are untouched (3.9).

**Scope:**
All inputs that do NOT involve the Text tool or its documentation should be completely unaffected by this fix. This includes:
- Pointer input on the canvas with any of the seven remaining tools
- Keyboard input, including undo and redo shortcuts
- File, AI, and dialog flows, and every other application

## Hypothesized Root Cause

The cause is known from git history and a search of the working tree, so it is confirmed here and not hypothesized.

**Why the tool exists.** Commit `2a394be feat: add text tool (T) to Paint` added it as a new feature on top of the Fill tool commit `d5c2221`. Three more commits built on it: `6533a1d` (README and FUNCTIONALITY), `2feeff5` (review findings), and `0c2dcb1` (cancel on tool switch). The `add-text-button-not-working` spec then fixed focus problems in it, and `paint-text-tool-win98-behavior` planned a Windows 98 style rebuild. The user has now decided the tool is not wanted.

**Where it lives.** The working tree holds the Text tool in these places. Line numbers are for the current working tree and include the uncommitted focus changes.

| File | Lines | What is there |
|---|---|---|
| `src/apps/paint/Paint.tsx` | 2 | `IText` in the `fabric` import |
| | 15 | `'text'` in the `Tool` union |
| | 106-113 | `TextIcon` component (line 106 is the comment that belongs to `TOOL_ICONS`) |
| | 122, 133 | `text` entries in `TOOL_ICONS` and `TOOLS` |
| | 271, 681 | `surfaceRef` and its `ref=`. Only the text branch at line 468 reads it. |
| | 286-289 | `textOverlay`, `textValue`, `textInputRef` |
| | 392-414 | `commitText`, which creates the `IText` |
| | 415-424 | Effect that closes the overlay on tool change |
| | 458-475 | `mouse:down` branch for `t === 'text'` |
| | 542 | `tool === 'text' ? 'text'` in the cursor choice |
| | 551-554 | Effect that focuses the overlay input |
| | 676-692 | Surface `onPointerDown` and `onMouseDown` with Text-specific branches (uncommitted) |
| | 694-721 | Overlay `<input>` JSX |
| `src/apps/paint/paint.css` | 22-33 | `.paint-text-input` rule |
| `e2e/paint-text-tool.spec.ts` | whole file (untracked) | Seven tests that need the Text tool, plus the local `countDarkPixels`, `paintCanvas`, `paintUpper`, `textInput`, `toolButton`, `openPaintWithText`, `isFocused` helpers |
| `README.md` | 98 | "..., fill (flood fill), text, palette, ..." |
| `FUNCTIONALITY.md` | 38, 39 | "..., fill (flood fill), text." and the "Text tool (capital "T" button)" bullet (line 39 is uncommitted) |
| `.kiro/specs/paint-text-tool-win98-behavior/` | `bugfix.md`, `design.md`, `tasks.md` | Planned rebuild of the tool |
| `.kiro/specs/add-text-button-not-working/` | `bugfix.md`, `design.md`, `tasks.md` | Fix of the tool being removed |

**Nothing else depends on it.** A search found `IText` only in `Paint.tsx`. `docs/` and `QUICKSTART.md` have no Text tool reference. `e2e/helpers.ts` is not modified by the Text commits. Its `clickCanvas` helper is used only by the Text spec today, but it comes from the original e2e suite (`b39fdfc`), so the fix keeps it and the new guard spec uses it (see Testing Strategy).

**The Text feature is separable from the rest of Paint.** The only code outside the Text paths that the Text tool touched is the shared `mouse:down` handler, the cursor line, and the surface focus handler. Each of those goes back to its `d5c2221` form.

## Correctness Properties

Property 1: Bug Condition - Text tool is gone

_For any_ input where the bug condition holds (isBugCondition returns true), the fixed code SHALL show a toolbox with exactly Pencil, Brush, Eraser, Line, Rectangle, Ellipse and Fill, SHALL NOT open a text overlay or show a text cursor, SHALL NOT create a text object, SHALL move focus to the Paint window on every canvas pointer-down, SHALL contain no Text tool code or CSS in the Paint source and styles, SHALL describe Paint's tools without Text in `FUNCTIONALITY.md` and `README.md`, SHALL NOT ship `e2e/paint-text-tool.spec.ts`, and SHALL mark both older specs as superseded.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Behavior outside the Text tool

_For any_ input where the bug condition does NOT hold (isBugCondition returns false), the fixed code SHALL produce the same result as the original code, preserving drawing with the seven remaining tools, undo and redo, PNG save and load, AI Automate, the palette, brush size, dialogs, keyboard handling in inputs, and every other application.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6, 3.7, 3.8, 3.9**

Property 3: Preservation - History snapshots restore without Text support

_For any_ sequence of drawing operations with the seven remaining tools, every snapshot recorded in Paint's history SHALL contain only object types that are registered in Fabric's `classRegistry`, and `loadFromJSON` SHALL restore each snapshot to a canvas with the same objects and dimensions, in the production bundle that no longer imports `IText`.

**Validates: Requirements 3.2, 3.4**

## Fix Implementation

### Changes Required

Assuming the root cause analysis above is correct, the fix is a set of deletions with two small restorations. Apply them by editing the files. Do not use `git checkout` or `git restore` on them, because the working tree has uncommitted Text tool changes that the edits are meant to replace and the edits should stay reviewable.

**File**: `src/apps/paint/Paint.tsx`

**Function**: `Paint` and module scope

**Specific Changes**:
1. **Imports and types**: Remove `IText` from the `fabric` import (line 2). Remove `| 'text'` from `Tool` (line 15). `TOOL_ICONS: Record<Tool, ...>` then fails to compile if the `text` entry is left behind, which guards the next step.
2. **Icon and toolbox**: Delete `TextIcon` (lines 107-112). Keep the comment "Map each tool to its Win98 MS Paint icon..." directly above `TOOL_ICONS`, as it was at `d5c2221`. Delete the `text` entries from `TOOL_ICONS` (line 122) and `TOOLS` (line 133).
3. **State and refs**: Delete the "Text overlay state" block (`textOverlay`, `textValue`, `textInputRef`, lines 286-289) and `surfaceRef` (line 271). `surfaceRef` exists only for the scroll-offset math in the text branch.
4. **Commit and effects**: Delete `commitText` (lines 392-414), the tool-change cancel effect (lines 415-424), and the overlay focus effect (lines 551-554).
5. **Canvas handler**: Delete the `if (t === 'text') { ... }` branch in `mouse:down` (lines 458-475), including the uncommitted `blur()` guard. The Fill branch and the shape branch are untouched.
6. **Cursor**: Change line 542 to `c.defaultCursor = tool === 'fill' ? 'cell' : 'crosshair';`.
7. **Surface focus handling**: Replace the multi-line `paint-surface` `<div>` (lines 676-692) with the single-line form `<div className="paint-surface" style={{ position: 'relative' }} onPointerDown={(e) => e.currentTarget.parentElement?.parentElement?.focus({ preventScroll: true })}>`. This removes `ref={surfaceRef}`, the Text early return, and `onMouseDown`. Requirement 2.4 is met because the handler no longer has a branch.
8. **Overlay JSX**: Delete the `{textOverlay && (<input ... />)}` block (lines 694-721). Keep `<canvas ref={hostRef} />`.

Leave `onKeyDown` as is, including the `INPUT`/`TEXTAREA` guard. Leave `snapshot`, `record`, `restore`, `undo`, `redo`, `floodFill`, and `placeImage` as is.

**File**: `src/apps/paint/paint.css`

**Specific Changes**:
1. Delete the `.paint-text-input { ... }` rule (lines 22-33) and the blank line before it, so the file matches `d5c2221`.

**File**: `e2e/paint-text-tool.spec.ts`

**Specific Changes**:
1. Delete the file. It is untracked, so it exists in no commit. Its helpers (`countDarkPixels`, `paintCanvas`, `paintUpper`, `textInput`, `toolButton`, `openPaintWithText`, `isFocused`) are local to it and go with it. No shared helper is removed, because `clickCanvas` gets a new user in the guard spec below.

**File**: `e2e/paint-tools.spec.ts` (new)

**Specific Changes**:
1. Add the guard and preservation spec described in Testing Strategy. It reuses `freshDesktop`, `drawLine`, `clickCanvas`, and `expectCanvasDrawn` from `e2e/helpers.ts`.

**File**: `src/apps/paint/historySnapshot.test.ts` (new)

**Specific Changes**:
1. Add the Property 3 test described in Testing Strategy.

**Files**: `README.md`, `FUNCTIONALITY.md`

**Specific Changes**:
1. `README.md` line 98: change "fill (flood fill), text, palette" to "fill (flood fill), palette".
2. `FUNCTIONALITY.md` line 38: change "fill (flood fill), text." to "fill (flood fill)."
3. `FUNCTIONALITY.md` line 39: delete the "Text tool (capital "T" button)..." bullet.
4. After these edits, both files match `d5c2221`.

**Files**: the six spec documents of the two older specs

**Specific Changes**:
1. Insert the banner described in [Marking the older specs as superseded](#marking-the-older-specs-as-superseded).

### Removing the `IText` import does not affect `loadFromJSON`

Confirmed. There are two independent reasons, and an observed bundle check.

1. **No snapshot can contain an `IText` after the change.**
   - `loadFromJSON` looks up each object's `type` in `classRegistry` and throws `No class registered for <type>` when it is missing. The question is therefore whether any snapshot holds a type that has no registered class.
   - The only code that creates an `IText` is `commitText`, and it is deleted. After the change, snapshots contain `Path` (Pencil, Brush, Eraser through `path:created`), `Line`, `Rect`, `Ellipse`, and `FabricImage` (Fill, `placeImage`, AI Automate). Each of these classes registers itself at module load in `fabric/dist/index.mjs`: `Rect` at line 11066, `Path` at 16880, `Line` at 17949, `Ellipse` at 18131, `FabricImage` at 24964. None needs `IText`.
   - Snapshots are not persisted. `HistoryStack` lives in a React ref, and Paint writes only PNG bytes to the file system (ADR-6). Opening a file calls `placeImage`, which resets history to a single image snapshot. A code change needs a page reload, which empties history, so an old `IText` snapshot cannot meet new code.
2. **`IText` stays registered in the bundle even without the import.** I bundled two minimal entries with Vite (`vite build`, library mode, real `exports` resolution to `fabric/dist/index.min.mjs`). One imported `Canvas, Ellipse, FabricImage, IText, Line, PencilBrush, Rect`, the other the same names without `IText`. Both outputs contain the `i-text` registration, and their sizes are 374,303 and 374,297 bytes. The 6-byte difference is the import specifier. An esbuild bundle of the same two entries gave the same registrations. Fabric ships as one flat file whose `classRegistry.setClass(...)` calls are top-level statements (about 50 of them), and both bundlers keep all of them. The package declares `"sideEffects": false`, but that flag only lets a bundler drop whole files, and there is only one.
3. **Existing tests already cover the restore path.** `src/apps/paint/pencilStrokePreservation.test.ts` calls `loadFromJSON` on snapshots at lines 375, 420, 513, and 527 with a `fabric` import that has no `IText`. These run in Node, where nothing is tree-shaken, so they show the restore logic and not the bundle. The bundle check above and the new e2e undo/redo test cover the bundle.

No code is needed to keep `loadFromJSON` working. Do not add a side-effect import of `IText` or a manual `classRegistry.setClass`. If Fabric is later upgraded to a build that splits modules, the Property 3 test still passes only if every type Paint produces is registered by what Paint imports, and the production-bundle e2e test would catch a miss.

### Marking the older specs as superseded

**Decision**: Add a banner under the title of `bugfix.md`, `design.md`, and `tasks.md` in both older spec folders, and keep the folders and their content.

| Option | Verdict |
|---|---|
| Banner in each document (chosen) | Satisfies 2.6 directly. Anyone who opens any of the six files sees the status first. The history stays available. |
| Delete the two folders | Loses the record of why the tool was built and how it was reviewed. Deleting is hard to undo for untracked files, and neither folder is committed. |
| Rename the folders (for example a `superseded-` prefix) | Breaks the references inside `remove-paint-text-tool/bugfix.md` and in the spec files themselves, and Kiro keys specs by folder name. |
| Add a status field to `.config.kiro` | The config format belongs to Kiro and extra fields are untested. The field would also be invisible to a reader of the documents. |

Banner text, placed on the line after the `#` title, with one blank line before and after:

```
> **Superseded** by [remove-paint-text-tool](../remove-paint-text-tool/bugfix.md). The Paint Text tool described here was removed, so none of this spec applies. Do not implement or run its tasks. It is kept as a record only.
```

Rules for applying it:
- Edit only the banner. Do not change the task checkboxes, requirements, or design text in the old specs.
- Both older `tasks.md` files have unchecked tasks. The banner is what stops them being run.
- Run `validate_spec_format` on each of the six files after editing.
- Leave `.agents/tasks/paint-textbox/` alone. It holds a review of the original Text tool change, lives outside `.kiro/specs`, and requirement 2.6 does not cover it.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. For a removal, the "bug" tests assert that the Text tool is absent, so the only tests that fail on unfixed code are the toolbox and source checks. Tests for the seven remaining tools pass on both versions and serve as the preservation baseline.

Write and run the new tests first, record the unfixed results, then remove the tool.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write `e2e/paint-tools.spec.ts` against the current code, plus a one-time source check with `git diff` and `grep`. Run them on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Toolbox contents**: Open Paint and read the accessible names of the buttons in `role="toolbar" name="Tools"`. Assert they equal `['Pencil','Brush','Eraser','Line','Rectangle','Ellipse','Fill']` (will fail on unfixed code)
2. **No Text button**: Assert `getByRole('button', { name: 'Text', exact: true })` has count 0 (will fail on unfixed code)
3. **Source check**: Run `git diff d5c2221 --stat -- src/apps/paint/Paint.tsx src/apps/paint/paint.css README.md FUNCTIONALITY.md` and `grep -nE "IText|textOverlay|textValue|textInputRef|commitText|paint-text-input|TextIcon|=== 'text'" src/apps/paint`. The diff must be empty and the grep must have no matches (will fail on unfixed code: the diff shows 131 insertions and 7 deletions across 4 files). The grep avoids the bare word "text", which legitimately appears in the dialog `text` field.
4. **No overlay with any remaining tool**: For each of the seven tools, click the canvas and assert `.paint-text-input` has count 0 and the upper canvas cursor is not `text` (may pass on unfixed code, since the overlay needs the Text tool)

**Expected Counterexamples**:
- The toolbox lists eight names ending in `Text`, and `Paint.tsx` and `paint.css` differ from `d5c2221`.
- Possible causes: the Text commits `2a394be`, `2feeff5`, `0c2dcb1` and the uncommitted focus changes are all still in the tree, which confirms the root cause.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FUNCTION expectedBehavior(result)
  RETURN toolboxLabels(result) = [Pencil, Brush, Eraser, Line, Rectangle, Ellipse, Fill]
     AND count(result.dom, '.paint-text-input') = 0
     AND result.upperCanvasCursor != 'text'
     AND count(result.canvasObjects WHERE type IN {IText, i-text}) = 0
     AND (input.kind != 'canvas-pointer-down' OR result.activeElement = result.paintRoot)
     AND sourceHasNoTextTool(Paint.tsx, paint.css)
     AND NOT mentionsTextTool(FUNCTIONALITY.md, README.md)
     AND NOT exists(e2e/paint-text-tool.spec.ts)
     AND hasSupersededBanner(each of the six old spec documents)
END FUNCTION

FOR ALL input WHERE isBugCondition(input) DO
  result := fixedPaint(input)
  ASSERT expectedBehavior(result)
END FOR
```

The seven-tool toolbox, the no-overlay checks, and the focus check run in Playwright. The `git diff d5c2221` and grep checks cover the source, CSS, README, and FUNCTIONALITY. A grep for "Text tool" and for `, text` in the two docs and a `ls` for the deleted spec cover the rest. A grep for `Superseded` over the six old spec files covers 2.6, followed by `validate_spec_format` on each.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalPaint(input) = fixedPaint(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for the seven remaining tools, history, save and load, and AI Automate, then write property-based tests capturing that behavior.

Before editing, run the existing suites on the unfixed tree and record the results: `npm run typecheck`, `npm run lint`, `npm test`, and `npx playwright test e2e/paint-persistence.spec.ts e2e/paint-ai-generation.spec.ts`. These are the 3.8 baseline. The existing `pencilStrokePreservation.test.ts` (fast-check) already covers shape JSON round trips, canvas dimensions, and undo and redo depth for 3.1 to 3.4. `history.test.ts` covers the history capacity. `aiImage.test.ts` covers 3.5.

**Test Cases**:
1. **Drawing tools**: Observe that a drag with each of Pencil, Brush, Eraser, Line, Rectangle, Ellipse and a click with Fill draws pixels (`expectCanvasDrawn`) on unfixed code, then assert the same after the fix.
2. **Undo, Redo, and shortcuts**: Observe that after drawing a rectangle, Undo clears it, Redo restores it, and Ctrl+Z works when focus was last placed by a canvas pointer-down. Assert the same after the fix. This also covers 2.4 and `loadFromJSON` in the dev bundle.
3. **Save and reopen**: The existing `paint-persistence.spec.ts` covers it.
4. **AI Automate**: The existing `paint-ai-generation.spec.ts` covers it, including typing in the dialog textarea (3.5, 3.7).
5. **Other apps**: The rest of the e2e suite (WordPad, CMD, Explorer, Clippy, Recycle Bin, desktop drag) runs unedited (3.9).

### Unit Tests

- `src/apps/paint/historySnapshot.test.ts` (new, jsdom with the same canvas stub as `pencilStrokePreservation.test.ts`): build a canvas with a mix of `Path`, `Line`, `Rect`, `Ellipse`, and `FabricImage` objects, serialize it, assert every `type` in the JSON resolves with `classRegistry.getClass`, then `loadFromJSON` and assert object count, types, and dimensions match.
- Existing `history.test.ts`, `aiImage.test.ts`, `pencilStrokePreservation.test.ts`, and `pencilStrokeCommitBlur.bug.test.ts` run unedited.

### Property-Based Tests

- Property 3, in `historySnapshot.test.ts` with `fast-check`: generate sequences of 1 to 30 operations drawn from {pencil path, line, rectangle, ellipse, image}, push a snapshot after each, then undo and redo through the `HistoryStack` and assert each restored snapshot matches the recorded object count and canvas size. This follows the pattern at `pencilStrokePreservation.test.ts` lines 470-530.
- Property 2 relies on the existing fast-check preservation tests, run before and after the change with no edits.

### Integration Tests

- `e2e/paint-tools.spec.ts` (new), run with `npx playwright test e2e/paint-tools.spec.ts`:
  - Toolbox lists exactly seven tools and has no Text button (Property 1).
  - For each of the seven tools, a canvas click leaves no `.paint-text-input` and no `text` cursor (Property 1).
  - For each of the seven tools, a canvas pointer-down puts focus on the `.paint` root (2.4).
  - Draw with Line, Rectangle, and Ellipse, then Undo three times and Redo three times and compare canvas pixels at each step. This runs `loadFromJSON` in a real browser (Property 3, 3.2, 3.4).
- Full verification after the removal: `npm run typecheck`, `npm run lint`, `npm test` (includes `check-scope` and `check-docs`), `npm run build` (production bundle), and `npx playwright test`.
