# Add Text Button Not Working Bugfix Design

## Overview

In Paint, the Text tool (the "T" icon in the tool palette) is supposed to open an input at the clicked canvas point and draw the typed text on commit. The user reports that clicking the icon does not let them create a text box and type. The report does not say which step fails, so this design checks three points in the flow against `src/apps/paint/Paint.tsx`:

1. **Tool activation** (requirements 1.4, 2.4, 3.7): clicking the icon makes Text the active tool.
2. **Text box creation** (1.5, 2.5): clicking the canvas with Text active opens the input.
3. **Text box retention** (1.1 to 1.3, 1.6, 2.1 to 2.3, 2.6): the input stays open and focused.

Reading the code, points 1 and 2 have no defect. Point 3 has two confirmed defects that share one mechanism: focus moves from the overlay input to the `.paint` root, and the input's `onBlur` handler treats that blur as a commit of empty text, which closes the overlay.

- **Defect A (opening click)**: the click that opens the overlay is followed by the browser's default mousedown focus change to `.paint` (and by the surface `onPointerDown` root focus), which blurs the new input.
- **Defect B (click inside the input)**: the input is a child of `.paint-surface`, so a click inside it bubbles to the surface `onPointerDown`, which calls `.focus()` on the `.paint` root. This blurs the input and closes it.

The fix stops both focus moves while the Text tool or the overlay input is involved, and adds a short guard in `onBlur` as a backstop. Escape, Enter, tool-button cancel, other tools, and history behavior stay unchanged.

## Glossary

- **Bug_Condition (C)**: A pointer-down on the canvas surface that moves focus off the overlay input before the user can type. It covers the opening click (Text tool, canvas target) and clicks inside the open input.
- **Property (P)**: After such an event, the overlay input exists and has focus until the user commits (Enter, real click-away) or cancels (Escape, tool switch).
- **Preservation**: Escape cancel, tool-button cancel, whitespace-only commit, other tools, tool activation for other icons, undo/redo, and root keyboard shortcuts must behave as before.
- **`Paint`**: Component in `src/apps/paint/Paint.tsx`.
- **`tool` / `setTool`**: `useState<Tool>('pencil')` (line 273). Each palette button calls `setTool(t.id)` from `onClick` (line 659).
- **`live`**: Ref (line 293) holding the latest `tool`, `color`, `size`, `dirty`, `file` for handlers attached once.
- **`textOverlay`**: State `{x, y, canvasX, canvasY} | null` (line 287). Non-null means the overlay input is rendered.
- **`commitText`**: `useCallback` (lines 393-414). Closes the overlay, trims the value, returns early on empty text, otherwise adds an `IText` and calls `record()`.
- **Fabric `mouse:down` text branch**: Lines 458-470. Calls `setTextOverlay` and `setTextValue('')`.
- **Surface `onPointerDown`**: On `.paint-surface` (line 675). Calls `.focus()` on `.paint`, which is the surface's grandparent element.
- **Overlay `onBlur`**: Lines 694-701. Cancels if `relatedTarget` is inside `.paint-tools`, otherwise calls `commitText`.
- **Focus effect**: Lines 548-549. Calls `textInputRef.current?.focus()` when `textOverlay` becomes non-null.
- **`.paint` root**: `<div className="paint" tabIndex={-1}>` (line 639). It is focusable, so it receives default focus on clicks inside it.

## Bug Details

### Bug Condition

The bug manifests in two situations. Both end with focus moving to the `.paint` root and the overlay `onBlur` committing empty text.

- **Opening click (defect A)**: The user clicks the canvas with Text active. The Fabric `mouse:down` handler opens the overlay. The overlay mounts and the focus effect focuses the input. Then the browser's default mousedown action focuses the nearest focusable ancestor of the clicked `upper-canvas`, which is `.paint`. The surface `onPointerDown` also focuses `.paint`. The input blurs with `relatedTarget = .paint`, which is not inside `.paint-tools`, so `onBlur` calls `commitText` with an empty value.
- **Click inside the input (defect B)**: The overlay is open and the user clicks inside the input. The `pointerdown` bubbles from the input to the surface `onPointerDown`, which focuses `.paint`. The input blurs and `onBlur` commits, which closes the overlay and draws whatever was typed so far, so the user cannot place the caret or continue typing.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PointerEvent on the Paint surface
  OUTPUT: boolean

  RETURN input.type = 'pointerdown'
         AND input.button = 0
         AND (
              (currentTool = 'text' AND input.target IS upperCanvas)       // defect A
              OR
              (overlayOpen AND input.target IS overlayInput)               // defect B
         )
         AND focusMovesToPaintRootAfter(input)
         AND overlayClosedWithoutUserCommitOrCancel()
END FUNCTION
```

### Confirmed Analysis of the Three Failure Points

| Point | Code | Finding |
|-------|------|---------|
| Tool activation (1.4, 2.4) | Button `onClick={() => setTool(t.id)}` (line 659); `aria-pressed` and `active` class derive from `tool` (lines 657-658); the tool effect (lines 534-545) sets `isDrawingMode = false` and `defaultCursor = 'text'` | No defect found. Nothing overlays the palette (`.paint-ai-overlay` renders only while `aiLoading`). The `[tool]` cancel effect (lines 417-424) only clears an open overlay. |
| Text box creation (1.5, 2.5) | Canvas is created with `skipTargetFind: true` and `selection: false`; `mouse:down` reads `live.current.tool` (a ref updated every render) and calls `setTextOverlay` for `'text'` | No defect found. `mouse:down` still fires with `skipTargetFind`, and the ref holds the latest tool, so the first click works regardless of the previous tool. |
| Text box retention, opening click (1.1 to 1.3, 2.1 to 2.3) | Default mousedown focus on `.paint` plus surface `onPointerDown` root focus, then `onBlur` commit | **Defect A confirmed by code reading.** |
| Text box retention, click in input (1.6, 2.6) | The input is rendered inside `.paint-surface`, which has `onPointerDown` that focuses `.paint` and does not exclude the input | **Defect B confirmed by code reading.** |

These findings come from reading the code. Neither defect has been reproduced in a browser, and there is no Text-tool test. The exploratory tests below confirm or refute them.

### Examples

- Select Text, click at (50, 60). Expected: input appears at that point with a caret. Actual: the input closes at once and nothing can be typed.
- Select Text, click, type "Hi", press Enter. Expected: "Hi" drawn with one history entry. Actual: nothing drawn and no history entry.
- Select Text, click the canvas, type "Hi", then click inside the input to move the caret. Expected: input stays open and focused with "Hi" intact. Actual: the click commits "Hi" and closes the input (defect B).
- Select Pencil, then click the Text icon, then click the canvas. Expected: Text is pressed, the cursor is the text cursor, and the first canvas click opens the input.
- Edge case: click the canvas, press Escape. Expected: overlay closes and nothing is drawn.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Escape in the input closes it without drawing (3.1).
- Clicking a tool-palette button while the input is open cancels the pending text and switches tools (3.2).
- A whitespace-only commit draws nothing and adds no history entry (3.3).
- Pencil, brush, eraser, line, rectangle, ellipse, and fill behave exactly as before (3.4).
- Undo and Redo after committing text use the existing `HistoryStack` (3.5).
- Clicking the surface with a non-Text tool still focuses the `.paint` root so Ctrl+Z and Ctrl+Y work (3.6).
- Clicking any tool icon other than Text activates it and updates the pressed state and cursor as before (3.7).

**Scope:**
All inputs where the Text tool is not active and the overlay is not open, or where the event is not a primary-button pointer-down on the canvas or overlay input, are unaffected. This includes:
- Pointer events with any other tool.
- Keyboard input inside the overlay (Enter, Escape, typing).
- Clicks on the toolbar, tool palette, palette colours, and dialogs.

## Hypothesized Root Cause

1. **Default focus change after the overlay mounts (defect A, primary)**: The overlay opens during `pointerdown`. The browser's default `mousedown` focus action then targets `.paint` (`tabIndex={-1}`), after the input has mounted and been focused. The input blurs with `relatedTarget = .paint`.
   - Fabric 6.9.1 does not call `preventDefault` on this path (no match in `node_modules/fabric/dist/src/canvas/Canvas.mjs`).
   - Paint has no `preventDefault` on mousedown or pointerdown.
2. **Surface `onPointerDown` does not exclude the overlay input (defect A and B)**: The handler focuses `.paint` for every pointer-down inside the surface. This includes the opening click when Text is active and every click inside the child input.
3. **Over-eager blur handler**: `onBlur` commits on every blur whose `relatedTarget` is not in `.paint-tools`. A blur caused by a focus move that the user did not intend is indistinguishable from a real click-away. Commit `0c2dcb1` added only the tool-switch case.
4. **Missing tests**: No test covers the Text tool, so commits `2a394be`, `2feeff5`, and `0c2dcb1` did not catch the regression.

Refuted: tool activation failure (button handler and state are correct) and creation failure (the `mouse:down` text branch runs and sets state). A focus effect that runs too early is also not the cause, because the later default focus move is what blurs the input.

Side observation, out of scope: the overlay position uses `offsetX - scrollLeft`, but the input is absolutely positioned inside the scrolling surface, so it scrolls with the canvas and the subtraction misplaces it when the surface is scrolled. The surface also has `padding: 2px`, which the code comment ignores. Neither prevents typing. They are not part of this fix, but the integration test should click with no scroll to avoid depending on them.

## Correctness Properties

Property 1: Bug Condition - Text tool activates, opens an input, and keeps it open and focused

_For any_ pointer-down where the bug condition holds (isBugCondition returns true), that is a primary-button pointer-down on the canvas while Text is active, or inside the open overlay input, the fixed `Paint` SHALL leave the overlay input rendered at the clicked point and focused, without committing or cancelling, until the user presses Enter, presses Escape, clicks elsewhere on the canvas or window, or switches tools. Clicking the Text icon SHALL make Text active with `aria-pressed="true"` and a text cursor, and the first canvas click afterwards SHALL open the input regardless of the previous tool. Typed text followed by Enter SHALL be drawn at the clicked scene point in the current colour with exactly one history entry.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Non-bug-condition behavior is unchanged

_For any_ input where the bug condition does NOT hold (other tools, Escape, tool-button cancel, whitespace commit, undo/redo, root shortcut focus, activation of non-Text icons), the fixed `Paint` SHALL produce the same result as the original, preserving cancel and commit semantics, history recording, tool activation behavior, and keyboard shortcuts.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct:

**File**: `src/apps/paint/Paint.tsx`

**Function**: `Paint` component (surface handlers, overlay `onBlur`, focus effect)

**Specific Changes**:
1. **Surface `onPointerDown` guard (fixes defect B and part of A)**: Replace the inline handler with one that returns early, without focusing `.paint`, when the event target is inside `.paint-text-input` or when `live.current.tool === 'text'`. For every other tool and target it still focuses `.paint` with `preventScroll: true` (3.6).
2. **Surface `onMouseDown` default-focus suppression (fixes defect A)**: Add `onMouseDown` on `.paint-surface` that calls `e.preventDefault()` only when `live.current.tool === 'text'` and the target is not the overlay input. This stops the browser moving focus to `.paint` after the overlay mounts. The input is excluded so the browser can still place the caret on a click inside it (2.6). It must be `mousedown`, not `pointerdown`, because cancelling `pointerdown` does not reliably stop the default focus action.
3. **Blur backstop**: Keep `onBlur` as is for the `.paint-tools` cancel and real click-away commit. Add a guard that ignores a blur whose `relatedTarget` is the `.paint` root while the overlay is open: refocus the input with `preventScroll: true` and return without committing. Real click-aways land on other targets or on `null`, so Enter, click-away commit, and tool-button cancel are unaffected.
4. **Deterministic focus (only if tests need it)**: If the exploratory test shows the focus effect races with the opening click, focus from `requestAnimationFrame` with `preventScroll: true` in the existing focus effect.
5. **No change to tool activation or creation**: `setTool`, the tool effects, the `mouse:down` text branch, and `commitText` stay as they are, because the analysis found no defect there. Tests for 2.4 and 2.5 are added to lock the behavior.

If tests show changes 1 and 2 are sufficient, drop changes 3 and 4 to keep the fix minimal.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. The repo has Playwright e2e specs in `e2e/` (for example `e2e/paint-persistence.spec.ts`) and unit tests beside the Paint code. Browser focus behavior must be tested with Playwright, because jsdom does not model default mousedown focus.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write Playwright tests that open Paint and exercise each of the three failure points in order. Log blur events and `relatedTarget`. Run them on the UNFIXED code.

**Test Cases**:
1. **Tool activation**: From the default Pencil tool, click the Text icon, assert `aria-pressed="true"`, the `active` class, and a `text` cursor over the canvas (expected to pass on unfixed code, which refutes a point 1 defect).
2. **Box creation on first click**: After activating Text, click the canvas once and assert `.paint-text-input` was rendered at the clicked point (expected to pass at the moment of mount, which refutes a point 2 defect).
3. **Overlay persists after opening click**: Click the canvas with Text active and assert `.paint-text-input` is visible and is `document.activeElement` after 300 ms (will fail on unfixed code).
4. **Type and commit**: Click, type "Hi", press Enter, and assert an `IText` with "Hi" exists and history grew by one (will fail on unfixed code).
5. **Blur target**: Capture `relatedTarget` of the first blur and assert it is the `.paint` root (confirms defect A).
6. **Click inside the input**: With the overlay open and focus held (use a synthetic focus call if test 3 fails), click inside the input and assert it remains open and focused (will fail on unfixed code, confirms defect B).
7. **Slow click**: Use `mouse.down`, a delay, then `mouse.up`, to check whether the blur depends on timing (may fail on unfixed code).

**Expected Counterexamples**:
- The input is absent shortly after the click, or it blurs once with `relatedTarget = .paint`.
- A click inside the open input closes it.
- Possible causes: default mousedown focus on `.paint`, the surface `onPointerDown` root focus, or `onBlur` committing empty text.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := Paint_fixed(input)
  ASSERT overlayVisible(result) AND overlayFocused(result)
         AND noCommitOrCancelOccurred(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT Paint_original(input) = Paint_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-Text tools, Escape, tool switching, whitespace commits, and non-Text icon activation, then write tests capturing that behavior. The existing `pencilStrokePreservation.test.ts` is the model for the non-Text tool cases.

**Test Cases**:
1. **Other tools**: For each non-Text tool, a drag on the canvas produces the same object and history count as before.
2. **Other icon activation**: Clicking each non-Text icon sets `aria-pressed`, the `active` class, and the cursor as before (3.7).
3. **Escape and tool switch**: Escape and tool-button click close the overlay and draw nothing.
4. **Whitespace commit**: Enter with "   " draws nothing and adds no history entry.
5. **Root focus**: Clicking the surface with a non-Text tool focuses `.paint` and Ctrl+Z still undoes.

### Unit Tests

- Surface `onPointerDown`: does not focus `.paint` when the tool is `text` or the target is inside `.paint-text-input`; focuses it for other tools.
- Surface `onMouseDown`: calls `preventDefault` only when the tool is `text` and the target is not the overlay input.
- Blur handler: blur with `relatedTarget = .paint` refocuses and does not commit; blur to `.paint-tools` cancels; blur to another target or `null` commits.
- `commitText` with empty and whitespace values draws nothing and records no history.

### Property-Based Tests

- Generate random click points and colours with the Text tool, and verify the overlay opens at the point and the committed `IText` lands at the matching scene coordinates in that colour.
- Generate random strings (including whitespace-only) and verify that only non-empty trimmed strings create exactly one object and one history entry.
- Generate random sequences of clicks inside the open input and verify the overlay stays open with its value unchanged.
- Generate random non-Text tool sequences and verify behavior matches the original.

### Integration Tests

- Playwright: from Pencil, click the Text icon, click the canvas, type, press Enter, then Undo and Redo restore the canvas.
- Playwright: open the overlay, type, click inside the input to move the caret, keep typing, and commit with Enter.
- Playwright: click the canvas, type, click elsewhere on the canvas, and verify commit.
- Playwright: switch tools mid-entry and verify cancel with no drawing.
