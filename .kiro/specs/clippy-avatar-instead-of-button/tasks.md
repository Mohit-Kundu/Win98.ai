# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Clippy Character Not Visible in Viewport
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Run in Playwright (jsdom does no layout) against the unfixed app, scoped to the concrete failing case: agent assets load, across several viewport sizes (e.g. 1280x720, 1024x768, 1920x1080)
  - Bug Condition from design: `isBugCondition(input)` where `agentAssetsLoad = true AND (NOT isInsideViewport(agent._el.getBoundingClientRect(), viewport) OR NOT isAboveTaskbarAndChat(agent._el))`
  - Assert expected behavior: `[data-testid="clippy-agent"]` rect is fully inside the viewport, `rect.bottom <= innerHeight - 28`, it is in the bottom-right area, `document.elementFromPoint` at its center returns the agent element, and `clippy-toggle` is not rendered
  - Also assert requests to `/clippy/agent.json`, `/clippy/map.png`, `/clippy/sounds.json` return 200 (expected to pass, rules out asset failure as root cause)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g. "agent rect top >= innerHeight while clippy-toggle is visible"; z-index 10001 below taskbar 100000 and chat 99990/99991)
  - If the agent is in view or assets fail to load, re-hypothesize the root cause per design before continuing
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Chat, Animations, Drag, and Assets Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: sending a message runs the orchestrator and shows steps, report, and history; `thinking` plays `Thinking` and `speaking` plays `Explain`, then idle; mousedown/mouseup more than 4px apart does not toggle the chat; chat interaction leaves the focused window unchanged; no network request leaves the origin
  - Write property-based tests from Preservation Requirements in design: for random drag distances, a click toggles the chat only when movement is under 4px; for animation phases, the animation mapping matches the original; for chat inputs, the test ids `clippy-chat`, `clippy-input`, `clippy-send`, `clippy-cancel`, `clippy-step`, `clippy-message`, `clippy-report` remain available
  - Run the existing Vitest suites (`Clippy.test.tsx`, `ClippyAgent.test.tsx`) and record results on unfixed code
  - Run `e2e/clippy-folder.spec.ts` on unfixed code and record the result (it uses `clippy-toggle`, which is expected to pass before the fix)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for Clippy character not visible (agent placed below viewport, button always shown)

  - [x] 3.1 Implement the fix
    - `src/apps/clippy/ClippyAgent.tsx`: extend `AgentLike` with `reposition()`; after `created.show(true)` set `el.style.left = innerWidth - offsetWidth - 8` and `el.style.top = innerHeight - offsetHeight - 28 - 8`, then call `created.reposition()` if available
    - `src/apps/clippy/ClippyAgent.tsx`: set `el.style.zIndex = '99992'` (above `.clippy-chat` 99991, below taskbar 100000)
    - `src/apps/clippy/ClippyAgent.tsx`: add optional `onStatus?: (s: 'ready' | 'failed') => void` prop; call `'ready'` after setup and `'failed'` in the `.catch`, keeping `console.error`
    - `src/apps/clippy/Clippy.tsx`: add `agentStatus` state (`loading` initially), pass `onStatus` to `ClippyAgent`, render the `clippy-toggle` button only when status is `failed`
    - `src/apps/clippy/clippy.css`: raise `.clippy-chat` `bottom` to about 140px so the panel sits above the character; keep `.clippy-toggle` styling for the fallback
    - `e2e/clippy-folder.spec.ts` (and any other spec using `clippy-toggle`): open the chat by clicking `getByTestId('clippy-agent')`, as `clippy-toggle` now renders only as a fallback
    - Add unit tests: placement and z-index with a mocked `_el`; `onStatus('ready')` and `onStatus('failed')` (with `console.error`); `Clippy` hides `clippy-toggle` when ready and shows it when failed
    - Add Playwright test: block `/clippy/agent.json`, assert the fallback `clippy-toggle` appears and opens the chat
    - _Bug_Condition: isBugCondition(input) where agentAssetsLoad = true AND (NOT isInsideViewport(agent._el rect, viewport) OR NOT isAboveTaskbarAndChat(agent._el))_
    - _Expected_Behavior: agent rect inside viewport, bottom <= innerHeight - 28, elementFromPoint(center) = agent element, click without drag toggles chat, clippy-toggle absent when ready and present when failed_
    - _Preservation: Chat/orchestrator behavior, test ids, Thinking/Explain animations, drag-without-toggle (4px threshold), focus behavior, local assets_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Clippy Character Visible and Clickable
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Chat, Animations, Drag, and Assets Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2, plus the updated `e2e/clippy-folder.spec.ts`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
