# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Committed Pencil Stroke Sharpness on HiDPI
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate stroke blur on commit
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — a pencil stroke committed on a canvas with `enableRetinaScaling: false` and `window.devicePixelRatio = 2`
  - Create a Fabric.js `Canvas` with `enableRetinaScaling: false` (unfixed) and mock `window.devicePixelRatio = 2`
  - Simulate a pencil stroke sequence: mousedown → mousemove → mouseup
  - After `path:created` fires, inspect committed pixel data at the stroke boundary
  - Assert that boundary pixels are either fully opaque (255) or fully transparent (0) — no sub-pixel interpolated values — per the Expected Behavior in design Property 1
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS — boundary pixels show fractional-opacity anti-alias values, confirming the 1× downscale/upscale blur
  - Document counterexamples found (e.g., "pixel alpha at stroke edge is 128 instead of 0 or 255")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Pencil-Commit Behaviors
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `exportPng()` on a 640×480 canvas (unfixed code) produces a PNG whose decoded dimensions equal 640×480 CSS pixels
  - Observe: on `devicePixelRatio = 1`, committed pencil stroke pixel data is sharp (no fractional-alpha boundary pixels)
  - Observe: shape tool (line, rect, ellipse) canvas JSON state is identical before and after any retina-scaling change
  - Observe: after N undo/redo cycles, `c.getWidth()` and `c.getHeight()` match the last explicitly set CSS dimensions
  - Write property-based test: for all canvas sizes (random width ∈ [100, 800], height ∈ [100, 600]), `toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false })` decoded dimensions equal CSS canvas dimensions (Preservation Requirement 3.4)
  - Write property-based test: for `devicePixelRatio = 1`, committed stroke boundary pixels have alpha values of only 0 or 255 (Preservation Requirement 3.1)
  - Write property-based test: for randomly generated shape strokes, canvas JSON state round-trips correctly and dimensions match CSS pixels (Preservation Requirements 3.2, 3.3)
  - Write property-based test: for random sequences of strokes, undos, and redos, `getWidth()` and `getHeight()` always return the originally set CSS dimensions (Preservation Requirement 3.5)
  - Verify all preservation tests PASS on UNFIXED code before implementing the fix
  - **EXPECTED OUTCOME**: Tests PASS — confirms the preservation baseline
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix pencil stroke commit blur on HiDPI displays

  - [x] 3.1 Implement the fix
    - In `src/apps/paint/Paint.tsx`, locate the `Canvas` constructor (approximately line 196–203)
    - Change `enableRetinaScaling: false` to `enableRetinaScaling: true`
    - Leave all other constructor options unchanged (`selection`, `skipTargetFind`, `preserveObjectStacking`, etc.)
    - Confirm that `exportPng` (approximately line 230) still passes `{ format: 'png', multiplier: 1, enableRetinaScaling: false }` to `toDataURL` — no change required there
    - Confirm that all `c.setDimensions({ width, height })` calls pass CSS-pixel values — no change required, Fabric.js recalculates the backing-store size automatically
    - _Bug_Condition: isBugCondition(input) where input.canvas.enableRetinaScaling = false AND window.devicePixelRatio > 1 AND canvas.isDrawingMode = true AND event.type = 'mouseup'_
    - _Expected_Behavior: committed stroke backing store is allocated at width × DPR by height × DPR physical pixels; CSS display size remains width × height; committed stroke is visually identical in sharpness to the in-progress stroke_
    - _Preservation: canvas logical dimensions from getWidth()/getHeight() remain CSS pixel values; toDataURL with enableRetinaScaling: false still produces CSS-pixel-dimensioned PNG; shape tools, brush, eraser, undo/redo, and 1× display rendering are all unaffected_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Committed Pencil Stroke Sharpness on HiDPI
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (sharp boundary pixels at the committed stroke edge)
    - Run bug condition exploration test from step 1 against the FIXED code
    - **EXPECTED OUTCOME**: Test PASSES — confirms that with `enableRetinaScaling: true` the committed stroke backing store matches DPR, eliminating the blur
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Pencil-Commit Behaviors
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation property tests from step 2 against the FIXED code
    - **EXPECTED OUTCOME**: Tests PASS — confirms no regressions in export dimensions, 1× rendering, shape tools, brush/eraser, and undo/redo

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite (`npm test` or equivalent) and confirm that the exploration test (Property 1) and all preservation tests (Property 2) pass
  - Confirm there are no TypeScript or lint errors introduced by the change
  - Ask the user if any questions arise
