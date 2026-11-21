# Implementation Plan

## Overview

Fix the pencil tool quality degradation in the Paint application. The bug is caused by `PencilBrush.needsFullRender()` returning `false` for opaque colors, which causes Fabric.js to use an incremental `ctx.stroke()` path that compounds anti-aliased pixels on every pointer-move event. The fix overrides `needsFullRender` to always return `true`, forcing a full clear-and-redraw of `contextTop` on each move.

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Incremental Overdraw on Pencil Stroke
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples showing that anti-aliased edge pixels accumulate alpha during a continuous pencil stroke
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — an opaque hex color (e.g. `#000000`) with no shadow, simulating 20 consecutive `onMouseMove` events, then asserting that the maximum edge-pixel alpha after move 20 equals the maximum edge-pixel alpha after move 1 (they will differ on unfixed code)
  - Create a Fabric.js `Canvas` in a jsdom/offscreen context, attach a `PencilBrush` with an opaque color and no shadow
  - Simulate `onMouseDown` to start a stroke, then fire 20 `onMouseMove` events along a straight horizontal path
  - After move 1, read the edge pixels on `contextTop` and record the maximum alpha value
  - After move 20, read the edge pixels on `contextTop` and record the maximum alpha value
  - Assert that `maxAlphaAfter20 === maxAlphaAfter1` — on unfixed code this FAILS because each `ctx.stroke()` repaints anti-aliased edges over existing pixels, monotonically increasing alpha
  - Document the counterexample found (e.g. "after 1 move: maxAlpha=200; after 20 moves: maxAlpha=255 — overdraw confirmed")
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves `needsFullRender() === false` causes incremental overdraw)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.2, 1.3_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Bug Inputs Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: on unfixed code, brush tool (`tool === 'brush'`) and eraser tool (`tool === 'eraser'`) strokes complete and fire `path:created` without error — record their `contextTop` pixel data as baseline
  - Observe: on unfixed code, shape drawing (`mouse:down` → `mouse:move` → `mouse:up` for line/rect/ellipse) produces correct Fabric objects — record shape coordinates as baseline
  - Observe: on unfixed code, `HistoryStack.undo()` / `redo()` restore snapshots correctly — record JSON output as baseline
  - Observe: on unfixed code, `canvas.toDataURL({ format: 'png' })` after a finalized stroke returns a non-empty data URL
  - Write property-based tests covering all non-bug-condition inputs: for a range of tool types (`brush`, `eraser`), random opaque colors, and random brush widths (2–20), assert the finalized `Path` object has the expected `stroke` and `strokeWidth` and that `path:created` fires exactly once per stroke
  - Write example-based tests for shape tools: assert Line, Rect, Ellipse objects are added to the canvas after `mouse:up` with correct geometry
  - Write example-based tests for undo/redo: push two snapshots, undo to first, verify JSON matches, redo to second, verify JSON matches
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Fix pencil line quality degradation during continuous stroke

  - [ ] 3.1 Implement the fix in Paint.tsx
    - Open `src/apps/paint/Paint.tsx`
    - Locate the `useEffect` with `[tool, color, size]` dependencies (approximately line 302)
    - In the `if (freehand)` block, after `const brush = new PencilBrush(c)`, add the single line: `brush.needsFullRender = () => true;`
    - Place it before `c.freeDrawingBrush = brush;` for clarity
    - Add an inline comment explaining why: `// Force full-redraw on every mouse move to prevent anti-aliasing overdraw buildup`
    - _Bug_Condition: isBugCondition(input) — brush.needsFullRender() === false AND pointerIsMoving(input) AND strokeIsActive()_
    - _Expected_Behavior: contextTop is cleared and entire accumulated path is re-rendered from all recorded points on each move event, so stroke quality at point N equals quality at point 1_
    - _Preservation: brush/eraser rendering, shape drawing, undo/redo, save/export are all unaffected — only the brush instance configuration changes_
    - _Requirements: 2.2, 2.3_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Consistent Line Quality Throughout Stroke
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 asserts `maxAlphaAfter20 === maxAlphaAfter1`; on fixed code this passes because `clearContext` runs before each `_render()` call
    - Run the bug condition exploration test from step 1 on the FIXED code
    - **EXPECTED OUTCOME**: Test PASSES (confirms `needsFullRender() === true` override eliminates incremental overdraw)
    - _Requirements: 2.2, 2.3_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Bug Inputs Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation property tests and example-based tests from step 2 on the FIXED code
    - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions in brush, eraser, shape, undo/redo, and save)
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`npm test` or `vitest --run`) and confirm zero failures
  - Verify task 1 test now passes (bug is fixed)
  - Verify task 2 tests still pass (no regressions)
  - If any test fails, resolve the issue before marking this task complete
  - Ask the user if any questions arise

## Notes

- The fix is a single-line change in `src/apps/paint/Paint.tsx` inside the `useEffect` that configures the `PencilBrush`.
- No other files need to change. The Canvas initialization, shape tools, history, and file I/O logic are completely unaffected.
- The `enableRetinaScaling: false` setting causes general canvas blurriness on HiDPI displays but is a separate concern from the progressive stroke degradation and is out of scope for this fix.
- Tests should use Fabric.js directly in a jsdom/offscreen context; no browser or Playwright required for unit/property tests.
