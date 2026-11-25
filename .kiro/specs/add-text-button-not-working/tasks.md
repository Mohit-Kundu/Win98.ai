# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Text Overlay Blurred by Focus Move to Paint Root
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate defects A and B exist
  - **Scoped PBT Approach**: Scope the property to the deterministic failing cases: (A) primary-button pointer-down on the canvas with the Text tool active, over random click points and colours; (B) primary-button pointer-down inside the open `.paint-text-input`
  - Add a Playwright spec (for example `e2e/paint-text-tool.spec.ts`, modelled on `e2e/paint-persistence.spec.ts`), because jsdom does not model default mousedown focus
  - Bug Condition from design: `isBugCondition(input)` where `input.type = 'pointerdown'`, `button = 0`, and either (`currentTool = 'text'` AND target is the upper canvas) or (overlay open AND target is the overlay input), AND focus moves to the `.paint` root AND the overlay closes without user commit or cancel
  - Defect A test: open Paint, select Text, click the canvas, wait 300 ms, and assert `.paint-text-input` is visible and is `document.activeElement`
  - Defect A test: click, type "Hi", press Enter, and assert the canvas contains an `IText` "Hi" at the clicked scene point in the current colour and exactly one history entry
  - Defect B test: with the overlay open, click inside the input and assert it stays open, focused, and its value is unchanged (use a synthetic focus call first if the defect A test fails, so B is isolated)
  - Record the first blur event and its `relatedTarget` to confirm the root cause (expected `.paint`)
  - Include a slow-click variant (`mouse.down`, delay, `mouse.up`) to check whether the blur depends on timing
  - Add lock-in tests for the points the design found defect-free (expected to PASS on unfixed code): clicking the Text icon from Pencil sets `aria-pressed="true"`, the `active` class, and a `text` cursor; the first canvas click afterwards renders `.paint-text-input` at the clicked point
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: The defect A and B tests FAIL (this is correct - it proves the bug exists); the activation and creation lock-in tests PASS
  - Document counterexamples found (for example "input absent after click; first blur relatedTarget = .paint")
  - Mark task complete when tests are written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.6_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Bug-Condition Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: for each non-Text tool (pencil, brush, eraser, line, rectangle, ellipse, fill), a canvas drag produces a given object and history count (use `pencilStrokePreservation.test.ts` as the model)
  - Observe on UNFIXED code: clicking each non-Text icon sets `aria-pressed`, the `active` class, and the cursor (3.7)
  - Observe on UNFIXED code: Escape in the overlay closes it and draws nothing
  - Observe on UNFIXED code: clicking a tool-palette button while the overlay is open cancels the text and switches tools
  - Observe on UNFIXED code: committing whitespace-only text draws nothing and adds no history entry
  - Observe on UNFIXED code: clicking the surface with a non-Text tool focuses `.paint`, and Ctrl+Z / Ctrl+Y still work
  - Observe on UNFIXED code: Undo and Redo restore canvas state through `HistoryStack`
  - Write property-based tests asserting these observed outputs across generated inputs (random non-Text tool sequences, random whitespace-only strings, random drag points)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 3. Fix for Paint Text tool overlay blurred by focus moving to the Paint root

  - [ ] 3.1 Implement the fix
    - In `src/apps/paint/Paint.tsx`, change the `.paint-surface` `onPointerDown` so it returns early, without focusing `.paint`, when `live.current.tool === 'text'` or the event target is inside `.paint-text-input`; for every other tool and target it still focuses `.paint` with `preventScroll: true`
    - Add `onMouseDown` on `.paint-surface` that calls `e.preventDefault()` only when `live.current.tool === 'text'` and the target is not inside `.paint-text-input`, so the browser does not move focus to `.paint` after the overlay mounts and the caret can still be placed inside the input
    - Optional backstop: in the overlay `onBlur`, when `relatedTarget` is the `.paint` root and the overlay is open, refocus the input with `preventScroll: true` and return without committing
    - Keep the `.paint-tools` `relatedTarget` cancel, Escape, Enter, click-away commit, and `commitText` unchanged
    - Do not change tool activation (`setTool`, tool effects) or the Fabric `mouse:down` text branch; the design found no defect there
    - If tests show the `onPointerDown` and `onMouseDown` changes are sufficient, drop the `onBlur` backstop to keep the fix minimal
    - _Bug_Condition: isBugCondition(input) where input.type = 'pointerdown' AND input.button = 0 AND ((currentTool = 'text' AND target is upper canvas) OR (overlay open AND target is overlay input)) AND focus moves to the Paint root AND the overlay closes without user commit or cancel_
    - _Expected_Behavior: overlay input is visible and focused after the click and after clicks inside it, with no commit or cancel; typed text plus Enter draws one IText at the clicked scene point in the current colour with one history entry_
    - _Preservation: Escape cancel, tool-button cancel, whitespace-only commit, non-Text tools, non-Text icon activation, Undo/Redo, and root keyboard-shortcut focus behave as before_
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Text Overlay Stays Open and Focused
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the expected behavior is satisfied (including the activation and first-click creation lock-in tests, which cover 2.4 and 2.5)
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Bug-Condition Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after the fix
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
