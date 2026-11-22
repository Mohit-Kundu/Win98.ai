# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Desktop Icons Do Not Move or Persist
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: layouts with more than one icon, and drags of 4 px or more
  - Bug Condition from design: `isBugCondition(X)` is `(X.kind = Drag AND X.distance >= 4 px) OR (X.kind = ResolveLayout AND count(X.icons) > 1)`
  - Render `Desktop` with several icons. Assert `getComputedStyle(icon).position === 'absolute'`
  - Seed storage with `{A:(0,0), B:(2,1), C:(3,0)}` and assert each icon's `left`/`top` matches its saved cell
  - Simulate a pointer drag of several cells and assert the stored cell equals `nearestFreeCell(snap(dropPoint))` and that all cells are pairwise distinct
  - Drop an icon on an occupied cell and assert it lands in a different, nearest free cell
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., icon position is `static`, only A's saved cell is kept, drop returns the occupied target cell)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Drag and Non-Layout Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: double-click and Enter launch the app
  - Observe on UNFIXED code: click selects an icon, and clicking empty desktop clears the selection
  - Observe on UNFIXED code: press and release with a move under 4 px leaves the cell unchanged and saves nothing
  - Observe on UNFIXED code: missing or malformed storage gives column-major layout without crashing
  - Observe on UNFIXED code: apps with `desktopIcon: false` are omitted, and single-icon layouts are unchanged
  - Write property-based tests: for random pointer deltas under 4 px nothing is saved, and for random missing or malformed storage the layout is column-major (from Preservation Requirements in design)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 3. Fix for desktop icons not moving or persisting

  - [ ] 3.1 Implement the fix
    - In `src/desktop/desktop.css`, add `position: absolute;` to the `.desktop-icon` rule
    - In `src/desktop/Desktop.tsx`, add a module-level `const cellKey = (c: Cell) => \`${c.col},${c.row}\`;`
    - In `resolveCells`, replace the local `key` with `cellKey`
    - In `nearestFreeCell`, use `taken.has(cellKey({ col, row }))`
    - In `endDrag`, build `taken` with `.map(([, c]) => cellKey(c))`
    - Leave the drag threshold, pointer capture, storage format, and `gridSize` unchanged
    - _Bug_Condition: isBugCondition(input) where (input.kind = Drag AND input.distance >= 4px) OR (input.kind = ResolveLayout AND count(input.icons) > 1)_
    - _Expected_Behavior: icon follows pointer, lands in nearestFreeCell(snap(dropPoint)), cells are pairwise distinct, saved cells are restored on reload_
    - _Preservation: Launch, selection, click-without-move, default layout, resize handling, desktopIcon:false filtering, and window/taskbar/Start/Clippy behavior unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Desktop Icons Move, Snap to Free Cells, and Persist
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Drag and Non-Layout Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
