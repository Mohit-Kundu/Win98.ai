# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Text Tool Is Present
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the Text tool is still reachable
  - **Scoped PBT Approach**: The bug is deterministic and the input space is tiny (one toolbox, one source tree), so scope the property to the concrete cases below
  - Create `e2e/paint-tools.spec.ts` with a "Text tool is gone" `describe` block. Reuse `freshDesktop` from `e2e/helpers.ts` to open Paint
  - Toolbox test: read the accessible names of the buttons in `role="toolbar" name="Tools"` and assert they equal `['Pencil','Brush','Eraser','Line','Rectangle','Ellipse','Fill']` (from expectedBehavior: `toolboxLabels(result)`)
  - No-Text-button test: assert `getByRole('button', { name: 'Text', exact: true })` has count 0
  - Source check, run once by hand (not part of the spec file): `git diff d5c2221 --stat -- src/apps/paint/Paint.tsx src/apps/paint/paint.css README.md FUNCTIONALITY.md` must print nothing, and `grep -nE "IText|textOverlay|textValue|textInputRef|commitText|paint-text-input|TextIcon|=== 'text'" src/apps/paint` must have no matches. Do not grep for the bare word "text", which appears legitimately in the dialog `text` field
  - Run the new spec with `npx playwright test e2e/paint-tools.spec.ts -g "Text tool is gone"` on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bug exists)
  - Document counterexamples found, for example: toolbox lists eight names ending in `Text`, and the `git diff` shows 131 insertions and 7 deletions across 4 files
  - Mark task complete when the tests are written, run, and the failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Behavior Outside the Text Tool
  - **IMPORTANT**: Follow observation-first methodology
  - Record the baseline on the UNFIXED tree first: run `npm run typecheck`, `npm run lint`, `npm test`, and `npx playwright test e2e/paint-persistence.spec.ts e2e/paint-ai-generation.spec.ts`. Note any failures that exist before the change so they are not blamed on the fix
  - Observe: with each of Pencil, Brush, Eraser, Line, Rectangle, and Ellipse, a drag draws pixels (`expectCanvasDrawn`), and with Fill a click draws pixels
  - Observe: after drawing a rectangle, Undo clears it and Redo restores it, and Ctrl+Z works after a canvas pointer-down
  - Observe: for each of the seven tools, a canvas click leaves `.paint-text-input` at count 0, the upper canvas cursor is not `text`, and a canvas pointer-down puts focus on the `.paint` root
  - Add a "Remaining tools are preserved" `describe` block to `e2e/paint-tools.spec.ts` that asserts the observed behavior, reusing `freshDesktop`, `drawLine`, `clickCanvas`, and `expectCanvasDrawn`:
    - For all seven tools: drawing marks the canvas, no overlay appears, no `text` cursor, and focus moves to the `.paint` root on pointer-down (3.1, 3.7)
    - Draw with Line, Rectangle, and Ellipse, then Undo three times and Redo three times, comparing canvas pixels at each step. This runs `loadFromJSON` in a real browser (3.2, 3.4)
  - Property-based coverage for 3.1 to 3.4 comes from the existing fast-check suites `pencilStrokePreservation.test.ts`, `history.test.ts`, and `aiImage.test.ts`. Run them unedited
  - Run `npx playwright test e2e/paint-tools.spec.ts -g "Remaining tools are preserved"` on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 3. Write history snapshot property test (BEFORE implementing fix)
  - **Property 3: Preservation** - History Snapshots Restore Without Text Support
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: on UNFIXED code, snapshots built from `Path`, `Line`, `Rect`, `Ellipse`, and `FabricImage` objects restore through `loadFromJSON` with the same object count and canvas size. `pencilStrokePreservation.test.ts` lines 375, 420, 513, and 527 already show this with a `fabric` import that has no `IText`
  - Create `src/apps/paint/historySnapshot.test.ts` (jsdom, same canvas stub as `pencilStrokePreservation.test.ts`)
  - Unit case: build a canvas with a mix of `Path`, `Line`, `Rect`, `Ellipse`, and `FabricImage`, serialize it, assert every `type` in the JSON resolves with `classRegistry.getClass`, then `loadFromJSON` and assert object count, types, and dimensions match
  - Property-based case with `fast-check`: generate sequences of 1 to 30 operations drawn from {pencil path, line, rectangle, ellipse, image}, push a snapshot after each, then undo and redo through `HistoryStack` and assert each restored snapshot matches the recorded object count and canvas size. Follow the pattern at `pencilStrokePreservation.test.ts` lines 470-530
  - Do not add an `IText` import or a manual `classRegistry.setClass`. The test must pass without them
  - Run `npx vitest --run src/apps/paint/historySnapshot.test.ts` on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the restore path does not depend on `IText`)
  - Mark task complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.2, 3.4_

- [ ] 4. Fix: remove the Paint Text tool

  - [ ] 4.1 Remove the Text tool from `src/apps/paint/Paint.tsx`
    - Edit the file. Do not use `git checkout` or `git restore`, because the working tree has uncommitted Text changes and the edits must stay reviewable. Line numbers below are from the design and shift as you delete, so work from the bottom of the file upward or search by name
    - Imports and types: remove `IText` from the `fabric` import (line 2) and `| 'text'` from the `Tool` union (line 15). Leave the `text` entry in `TOOL_ICONS` for the next step, so the compiler flags it if you forget it
    - Overlay JSX: delete the `{textOverlay && (<input ... />)}` block (lines 694-721). Keep `<canvas ref={hostRef} />`
    - Surface focus handling: replace the multi-line `paint-surface` `<div>` (lines 676-692) with `<div className="paint-surface" style={{ position: 'relative' }} onPointerDown={(e) => e.currentTarget.parentElement?.parentElement?.focus({ preventScroll: true })}>`. This removes `ref={surfaceRef}`, the Text early return, and `onMouseDown`
    - Focus effect: delete the effect that focuses the overlay input (lines 551-554)
    - Cursor: change line 542 to `c.defaultCursor = tool === 'fill' ? 'cell' : 'crosshair';`
    - Canvas handler: delete the `if (t === 'text') { ... }` branch in `mouse:down` (lines 458-475), including the uncommitted `blur()` guard. Leave the Fill and shape branches untouched
    - Commit and cancel logic: delete `commitText` (lines 392-414) and the tool-change cancel effect (lines 415-424)
    - State and refs: delete `textOverlay`, `textValue`, `textInputRef` (lines 286-289) and `surfaceRef` (line 271)
    - Icon and toolbox: delete `TextIcon` (lines 107-112) and the `text` entries in `TOOL_ICONS` (line 122) and `TOOLS` (line 133). Keep the comment "Map each tool to its Win98 MS Paint icon..." directly above `TOOL_ICONS`
    - Leave `onKeyDown` and its `INPUT`/`TEXTAREA` guard, `snapshot`, `record`, `restore`, `undo`, `redo`, `floodFill`, and `placeImage` as they are
    - Run `npm run typecheck` and fix any error that points at a missed Text reference
    - _Bug_Condition: isBugCondition(input) where input.kind = 'open-paint' OR (input.kind = 'select-tool' AND input.tool = 'text') OR (input.kind = 'canvas-pointer-down' AND input.activeTool = 'text') OR input.kind = 'text-commit'_
    - _Expected_Behavior: expectedBehavior(result) from design - seven-tool toolbox, no overlay, no text cursor, no text object, focus on the Paint window on every pointer-down_
    - _Preservation: Preservation Requirements from design - seven remaining tools, history, save and load, AI Automate, `onKeyDown` guard_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.4, 3.7_

  - [ ] 4.2 Remove the Text rule from `src/apps/paint/paint.css`
    - Delete the `.paint-text-input { ... }` rule (lines 22-33) and the blank line before it
    - Confirm `git diff d5c2221 -- src/apps/paint/paint.css` is empty
    - _Bug_Condition: isBugCondition(input) where the Text overlay styling is present_
    - _Expected_Behavior: expectedBehavior(result) from design - no Text tool CSS in the Paint styles_
    - _Preservation: Preservation Requirements from design - all other Paint styles unchanged_
    - _Requirements: 2.3, 3.8_

  - [ ] 4.3 Delete `e2e/paint-text-tool.spec.ts`
    - Delete the file. It is untracked and exists in no commit, so confirm there is nothing in it you still need before deleting
    - Its helpers (`countDarkPixels`, `paintCanvas`, `paintUpper`, `textInput`, `toolButton`, `openPaintWithText`, `isFocused`) are local to it and go with it
    - Do not edit `e2e/helpers.ts`. `clickCanvas` stays because `e2e/paint-tools.spec.ts` uses it
    - Confirm `grep -rn "paint-text-tool" e2e playwright.config.ts package.json` has no matches
    - _Bug_Condition: isBugCondition(input) where input.kind = 'read' AND input.target = e2e/paint-text-tool.spec.ts_
    - _Expected_Behavior: expectedBehavior(result) from design - NOT exists(e2e/paint-text-tool.spec.ts)_
    - _Preservation: Preservation Requirements from design - other e2e specs run unedited_
    - _Requirements: 2.5, 3.8_

  - [ ] 4.4 Remove the Text mentions from `README.md` and `FUNCTIONALITY.md`
    - `README.md` line 98: change "fill (flood fill), text, palette" to "fill (flood fill), palette"
    - `FUNCTIONALITY.md` line 38: change "fill (flood fill), text." to "fill (flood fill)."
    - `FUNCTIONALITY.md` line 39: delete the "Text tool (capital "T" button)..." bullet
    - Confirm `git diff d5c2221 -- README.md FUNCTIONALITY.md` is empty
    - Confirm `grep -nE "Text tool|, text" README.md FUNCTIONALITY.md` has no matches
    - Run `npm run check-docs` to confirm the docs checker still passes
    - _Bug_Condition: isBugCondition(input) where input.kind = 'read' AND input.target IN {FUNCTIONALITY.md "Tools" line and "Text tool" line, README.md Paint line}_
    - _Expected_Behavior: expectedBehavior(result) from design - NOT mentionsTextTool(FUNCTIONALITY.md, README.md)_
    - _Preservation: Preservation Requirements from design - rest of both documents unchanged_
    - _Requirements: 2.5_

  - [ ] 4.5 Add the superseded banner to the six older spec documents
    - Files: `bugfix.md`, `design.md`, and `tasks.md` in both `.kiro/specs/paint-text-tool-win98-behavior/` and `.kiro/specs/add-text-button-not-working/`
    - Insert this banner on the line after the `#` title (line 1 of each file today), with one blank line before and one after:
      `> **Superseded** by [remove-paint-text-tool](../remove-paint-text-tool/bugfix.md). The Paint Text tool described here was removed, so none of this spec applies. Do not implement or run its tasks. It is kept as a record only.`
    - Edit only the banner. Do not change task checkboxes, requirements, or design text. Both older `tasks.md` files have unchecked tasks, and the banner is what stops them being run
    - Do not delete or rename either folder, and do not touch `.config.kiro` or `.agents/tasks/paint-textbox/`
    - Run `validate_spec_format` on each of the six files and fix any error
    - Confirm `grep -L "Superseded" .kiro/specs/paint-text-tool-win98-behavior/*.md .kiro/specs/add-text-button-not-working/*.md` lists no file
    - _Bug_Condition: isBugCondition(input) where input.kind = 'read' AND input.target IN {.kiro/specs/paint-text-tool-win98-behavior/*, .kiro/specs/add-text-button-not-working/*} AND NOT hasSupersededBanner(input.target)_
    - _Expected_Behavior: expectedBehavior(result) from design - hasSupersededBanner(each of the six old spec documents)_
    - _Preservation: Preservation Requirements from design - content of the older specs unchanged apart from the banner_
    - _Requirements: 2.6_

  - [ ] 4.6 Check the four source files against `d5c2221`
    - Run `git diff d5c2221 -- src/apps/paint/Paint.tsx src/apps/paint/paint.css README.md FUNCTIONALITY.md`. The output must be empty
    - If `Paint.tsx` still differs, read the diff. The design expects it to match `d5c2221` exactly, because the four commits since then are all Text tool commits. A leftover hunk is either a missed Text edit or a change that is not part of the Text tool. Do not revert a hunk you cannot tie to the Text tool. Stop and ask the user
    - Run `grep -nE "IText|textOverlay|textValue|textInputRef|commitText|paint-text-input|TextIcon|=== 'text'|surfaceRef" src/apps/paint`. It must have no matches
    - _Bug_Condition: isBugCondition(input) where Text tool code remains in the four files_
    - _Expected_Behavior: expectedBehavior(result) from design - sourceHasNoTextTool(Paint.tsx, paint.css)_
    - _Preservation: Preservation Requirements from design_
    - _Requirements: 2.3, 2.4, 2.5_

  - [ ] 4.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Text Tool Is Gone
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior. When it passes, the expected behavior is satisfied
    - Run `npx playwright test e2e/paint-tools.spec.ts -g "Text tool is gone"` and repeat the source check from task 1
    - **EXPECTED OUTCOME**: Tests PASS and the source check prints nothing (confirms the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 4.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Behavior Outside the Text Tool
    - **Property 3: Preservation** - History Snapshots Restore Without Text Support
    - **IMPORTANT**: Re-run the SAME tests from tasks 2 and 3 - do NOT write new tests
    - Run `npx playwright test e2e/paint-tools.spec.ts -g "Remaining tools are preserved"`
    - Run `npx vitest --run src/apps/paint`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after the fix, with no edits to `pencilStrokePreservation.test.ts`, `pencilStrokeCommitBlur.bug.test.ts`, `history.test.ts`, or `aiImage.test.ts`

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run the final verification in this order and record each result:
    - `npm run typecheck`
    - `npm run lint`
    - `npm test` (includes `check-docs`, `check-scope`, and `vitest --run`)
    - `npm run build` (production bundle with `tsc --noEmit`)
    - `npx playwright test` (full e2e suite, including persistence, AI generation, WordPad, CMD, Explorer, Clippy, Recycle Bin, and desktop drag)
  - Run `git diff d5c2221 --stat -- src/apps/paint/Paint.tsx src/apps/paint/paint.css README.md FUNCTIONALITY.md` once more. It must be empty
  - Run `ls e2e/paint-text-tool.spec.ts`. It must report that the file does not exist
  - Run `grep -L "Superseded" .kiro/specs/paint-text-tool-win98-behavior/*.md .kiro/specs/add-text-button-not-working/*.md`. It must list no file
  - Run `git status --short` and check that the only changes are the four restored files, the new `e2e/paint-tools.spec.ts` and `src/apps/paint/historySnapshot.test.ts`, the six banner edits, and the new `remove-paint-text-tool` spec
  - Ensure all tests pass, ask the user if questions arise.
