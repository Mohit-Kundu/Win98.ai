# Clippy Avatar Instead of Button Bugfix Design

## Overview

The desktop shows only the "Ask Clippy" button. The clippyjs agent is created and "shown" by `ClippyAgent`, but it is never given a position. clippyjs appends its element to `document.body` as `position: fixed` with no `top` or `left`, so the browser places it at its static position: after `#root`. `#root` is `height: 100%` and `html, body` use `overflow: hidden`, so that static position is directly below the viewport and the character is clipped out of view.

The fix is to position the agent explicitly in the bottom-right corner above the taskbar, give it a z-index that sits above windows and the chat button/panel, make the plain button a fallback that appears only when the agent fails to load, and move the chat panel so it does not cover the character. Chat logic, test ids, animations, drag behavior, and local asset serving are not touched.

## Glossary

- **Bug_Condition (C)**: The desktop loads, the agent loads successfully, and the character is not visible inside the viewport.
- **Property (P)**: The character is visible, inside the viewport, bottom-right, above the taskbar, and clicking it toggles the chat.
- **Preservation**: Chat/orchestrator behavior, test ids, Thinking/Explain animations, drag-without-toggle, and local asset serving.
- **ClippyAgent**: Component in `src/apps/clippy/ClippyAgent.tsx` that creates the clippyjs agent via `initAgent` and maps chat phase to animations. It renders `null`; the character lives in a DOM node owned by clippyjs.
- **Clippy**: Component in `src/apps/clippy/Clippy.tsx` that renders `ClippyAgent`, the `clippy-toggle` button, and the chat panel.
- **agent._el**: The `position: fixed` div clippyjs appends to `document.body` (frame size 124x93 for the Clippy agent).
- **agentStatus**: New state in `Clippy` with values `loading | ready | failed`, reported by `ClippyAgent`.

## Bug Details

### Bug Condition

Inspection of the code shows the following chain:

- `ClippyAgent.tsx` calls `created.show(true)`. In `node_modules/clippyjs/dist/index.mjs`, `Agent.show(fast)` with `fast === true` only sets `display: block`, then resumes the animator. The positioning code (default `window.innerWidth * 0.8`, `window.innerHeight * 0.8`) is in the non-fast branch only.
- The `Agent` constructor creates the element with `position: fixed; z-index: 10001; display: none` and appends it to `document.body`, with no `top` or `left`.
- With `top`/`left` as `auto`, a fixed element sits at its static position, which is after `#root` (100vh tall). The element therefore starts at about y = viewport height. `desktop.css` sets `overflow: hidden` on `html, body, #root`, so it cannot be scrolled to.
- Drag and `reposition()` only run on user interaction or window resize, so nothing corrects the position. `reposition()` would clamp it into view, but it is called only on `resize` and after a drag.

Secondary issues that would hide or block the character even once positioned:

- The agent `z-index` is 10001. `.taskbar` is 100000, `.clippy-toggle` is 99990 and `.clippy-chat` is 99991, so all of them stack above the character.
- `.clippy-toggle` (`right: 8px; bottom: 34px`) and `.clippy-chat` (`right: 8px; bottom: 62px`) occupy the bottom-right corner where the character belongs.
- Failure to load is only `console.error`'d and the button is always rendered, so the button is never a deliberate fallback.

Assets are not the cause. `public/clippy/agent.json`, `map.png`, and `sounds.json` exist, `BASE = '/clippy/'` resolves from Vite's public dir in dev and from `dist/clippy/` in a build, and `vite.config.ts` has no `base` override. A failed `fetch` would reach the `.catch`, but the code gives no sign this happens. This should still be confirmed in the exploration test (see Testing Strategy).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type DesktopLoad { agentAssetsLoad: boolean, viewport: Size }
  OUTPUT: boolean

  RETURN input.agentAssetsLoad = true
         AND ( NOT isInsideViewport(agent._el.getBoundingClientRect(), input.viewport)
               OR NOT isAboveTaskbarAndChat(agent._el) )
END FUNCTION
```

### Examples

- Load the desktop at 1280x720. Expected: Clippy visible near (1140, 600), above the taskbar. Actual: `agent._el.getBoundingClientRect().top` is about 720 or more, so it is off-screen, and only the grey button shows.
- Open the chat. Expected: the panel sits above the character and does not hide it. Actual (if the character were positioned): the panel at `bottom: 62px` covers it.
- Resize the window smaller. Expected: character stays in view. Actual: `reposition()` clamps it, but only after the initial position is set.
- Edge case: agent assets fail to load (`fetch` rejects). Expected: the `clippy-toggle` button appears and the error is logged. Actual: the button is always shown and nothing is distinguished.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Sending a message runs the orchestrator, shows tool steps and the report, and keeps session history (`chatStore`).
- Test ids `clippy-toggle`, `clippy-chat`, `clippy-input`, `clippy-send`, `clippy-cancel`, `clippy-step`, `clippy-message`, `clippy-report` stay available. `clippy-toggle` renders when the agent has failed to load.
- Thinking and Explain animations play on `thinking` and `speaking` and return to idle.
- The chat panel stays a plain fixed-position element and does not change the focused app window.
- Dragging the character moves it without toggling the chat (the 4px threshold in `onUp`).
- Assets are served locally from `public/clippy`, with no CDN and no TTS.

**Scope:**
All inputs that do not involve the initial placement, stacking, or fallback of the character are unaffected. This includes:
- Chat sending, cancelling, and rendering
- Window management, taskbar, and start menu behavior
- The clippyjs drag, double-click (`ClickedOn`), and resize reposition logic

## Hypothesized Root Cause

1. **Missing initial position (confirmed by code reading)**: `show(true)` skips the placement logic, and the element has no `top`/`left`, so it renders below the viewport inside an `overflow: hidden` page.
2. **Stacking order (confirmed)**: agent z-index 10001 is below the taskbar (100000) and the chat button/panel (99990/99991), so even an in-view agent could be covered.
3. **Overlapping UI (confirmed)**: the toggle button and chat panel are anchored to the same bottom-right corner.
4. **No load-failure signal (confirmed)**: `.catch` only logs, and the toggle is unconditional, so the button cannot act as a fallback.
5. **Asset fetch failure (not supported by evidence)**: files and `BASE` look correct. The exploration test checks this and, if it fails, root cause 5 replaces 1.

## Correctness Properties

Property 1: Bug Condition - Clippy character is visible and clickable

_For any_ desktop load where the agent assets load (isBugCondition returns true), the fixed `ClippyAgent` SHALL place `agent._el` fully inside the viewport in the bottom-right area above the taskbar, with a z-index above the chat panel and windows, and a click without drag SHALL toggle the chat panel. The plain "Ask Clippy" button SHALL NOT be rendered while the agent is ready, and SHALL be rendered when loading fails, with the error logged.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Chat, animations, drag, and assets unchanged

_For any_ input where the bug condition does NOT hold (chat messages, animation phases, drag gestures, asset requests), the fixed code SHALL produce the same result as the original code, preserving orchestrator runs, step and report display, the listed test ids, Thinking/Explain animations, drag-without-toggle, focus behavior, and local asset serving.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `src/apps/clippy/ClippyAgent.tsx`

**Function**: `ClippyAgent` (mount effect)

**Specific Changes**:
1. **Place the agent**: after `created.show(true)`, set `el.style.left` and `el.style.top` from `window.innerWidth - el.offsetWidth - MARGIN` and `window.innerHeight - el.offsetHeight - TASKBAR_H - MARGIN` (TASKBAR_H = 28, MARGIN = 8), then call `created.reposition()` if available to clamp. Extend `AgentLike` with `reposition()`.
2. **Set stacking**: set `el.style.zIndex = '99992'`, above `.clippy-chat` (99991) and windows, below the taskbar (100000) and modal dialogs (100000).
3. **Report status**: add an optional `onStatus?: (s: 'ready' | 'failed') => void` prop, called with `'ready'` after setup and `'failed'` in the `.catch` (keeping `console.error`).

**File**: `src/apps/clippy/Clippy.tsx`

**Function**: `Clippy`

**Specific Changes**:
4. **Fallback button**: keep `agentStatus` state (`loading` initially). Render the `clippy-toggle` button only when it is `failed`. Pass `onStatus` to `ClippyAgent`.

**File**: `src/apps/clippy/clippy.css`

5. **Chat panel position**: raise `.clippy-chat` `bottom` to about 140px (taskbar 28 + margin 8 + character 93 + gap 8) so it sits above the character. Keep `.clippy-toggle` styling for the fallback.

**File**: `e2e/clippy-folder.spec.ts` (and any other spec using `clippy-toggle`)

6. **Open the chat via the agent**: use `getByTestId('clippy-agent')` (already set on `agent._el`) with a click, with `clippy-toggle` as a fallback. This follows from 2.3 and is the only test change.

## Testing Strategy

### Validation Approach

First surface counterexamples on the unfixed code, then verify the fix and preservation.

### Exploratory Bug Condition Checking

**Goal**: Confirm that the missing position and stacking cause the invisibility. If the Playwright check shows the element is positioned in view, or the asset fetch fails, re-hypothesize.

**Test Plan**: Run in a real browser (Playwright, since jsdom does no layout) against the unfixed app. Read `getBoundingClientRect()` and `getComputedStyle` of `[data-testid="clippy-agent"]`.

**Test Cases**:
1. **Placement Test**: the agent rect is inside `window.innerWidth/innerHeight` (will fail on unfixed code; top is about the viewport height).
2. **Stacking Test**: `document.elementFromPoint` at the character center returns the agent element (will fail on unfixed code or when covered by the chat panel).
3. **Asset Test**: requests to `/clippy/agent.json`, `/clippy/map.png`, `/clippy/sounds.json` return 200 (expected to pass, ruling out root cause 5).
4. **Load Failure Test**: block `/clippy/agent.json` and assert the `clippy-toggle` button appears (will fail on unfixed code in the sense that it is always shown; after the fix it appears only on failure).

**Expected Counterexamples**:
- `top >= innerHeight` for `clippy-agent` while the toggle button is visible.
- Possible causes: `show(true)` without position, z-index below the taskbar and panel.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code gives the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := loadDesktop_fixed(input)
  ASSERT isInsideViewport(result.agentRect, input.viewport)
         AND result.agentRect.bottom <= input.viewport.height - TASKBAR_H
         AND elementFromPoint(center(result.agentRect)) = result.agentEl
         AND NOT exists(clippy-toggle)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, behavior is unchanged.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT original(input) = fixed(input)
END FOR
```

**Testing Approach**: Property-based testing fits the placement logic, since it generates many viewport sizes. The existing Vitest suites cover chat and animation behavior.

**Test Plan**: Run `Clippy.test.tsx`, `ClippyAgent.test.tsx`, and `e2e/clippy-folder.spec.ts` on the unfixed code first and record results, then rerun after the fix.

**Test Cases**:
1. **Chat Flow Preservation**: sending a message still shows steps, report, and history.
2. **Animation Preservation**: `thinking` plays `Thinking`, `speaking` plays `Explain`, as in the existing test.
3. **Drag Preservation**: mousedown/mouseup more than 4px apart does not toggle the chat.
4. **Asset Preservation**: no network request leaves the origin.

### Unit Tests

- Placement: with a mocked `_el` (set `offsetWidth`/`offsetHeight`) and a given `innerWidth/innerHeight`, `left`/`top` and `zIndex` are set as specified.
- `onStatus('ready')` after a successful init and `onStatus('failed')` when `initAgent` rejects, with `console.error` called.
- `Clippy` hides `clippy-toggle` when ready and shows it when failed.

### Property-Based Tests

- For random viewport sizes (at least the agent size plus margins), the computed `left/top` keeps the rect inside the viewport and above the taskbar.
- For random drag distances, a click toggles the chat only when movement is under 4px.

### Integration Tests

- Playwright: load the desktop, assert `clippy-agent` is visible, in the bottom-right, and not covered; click it and assert `clippy-chat` opens above it.
- Playwright: block `/clippy/agent.json`, assert the fallback button shows and opens the chat.
- Run `e2e/clippy-folder.spec.ts` with the agent click path to confirm the chat flow is unchanged.
