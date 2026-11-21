# Paint Pencil Quality Degradation Bugfix Design

## Overview

The pencil tool in Paint degrades from sharp to blurry during a single continuous stroke. The bug lives in `src/apps/paint/Paint.tsx`, specifically in the `useEffect` that creates a `PencilBrush`. The brush is configured with an opaque solid color and no shadow. Under this configuration, `BaseBrush.needsFullRender()` returns `false`, so `PencilBrush.onMouseMove()` takes the incremental render path: it calls `ctx.stroke()` on the existing `contextTop` canvas **without clearing it first**. Each new segment is painted on top of previously anti-aliased pixels, causing alpha compositing buildup that makes the line progressively blurrier.

The fix is a one-line change: override `needsFullRender()` on the brush instance to always return `true`. This forces the full-redraw path on every mouse move: `contextTop` is cleared and the entire accumulated path is re-rendered from all recorded points, eliminating the overdraw buildup.

## Glossary

- **Bug_Condition (C)**: Any pointer-move event during a pencil stroke when the brush has `needsFullRender() === false` (opaque color, no shadow)
- **Property (P)**: The line segment rendered on `contextTop` at any point during the stroke SHALL be visually identical in thickness and sharpness to the first segment drawn
- **Preservation**: All existing behaviors — brush/eraser rendering, shape drawing, undo/redo, save/export — must be unaffected by the fix
- **PencilBrush**: Fabric.js class in `node_modules/fabric/src/brushes/PencilBrush.ts` that handles free drawing; uses `contextTop` as a live preview canvas during a stroke
- **contextTop**: The upper HTML Canvas element in Fabric.js used for live previews; cleared and replaced when a stroke is finalized
- **needsFullRender()**: Method on `BaseBrush` that returns `true` when a full clear-and-redraw of `contextTop` is needed on each mouse move (e.g. for transparent colors or shadows); returns `false` for fully-opaque solid colors, triggering the incremental overdraw path
- **incrementalPath**: The `else` branch in `PencilBrush.onMouseMove()` that appends one segment via `ctx.stroke()` without clearing `contextTop` first
- **enableRetinaScaling**: Fabric.js Canvas option; set to `false` in the app, which means the canvas is not scaled for HiDPI displays

## Bug Details

### Bug Condition

The bug manifests on every pointer-move event during a pencil stroke when the brush is in incremental mode. `PencilBrush.onMouseMove()` only takes the full-redraw path when `this.needsFullRender()` returns `true`. For a plain opaque color with no shadow (the normal pencil configuration), `BaseBrush.needsFullRender()` returns `false`. This puts every move event into the incremental path, where `ctx.stroke()` repaints anti-aliased edges over existing anti-aliased pixels.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input — a pointer-move event during an active pencil stroke
  OUTPUT: boolean

  brush := canvas.freeDrawingBrush
  RETURN brush.needsFullRender() === false
         AND pointerIsMoving(input)
         AND strokeIsActive()
END FUNCTION
```

### Examples

- **Normal stroke start**: User begins drawing — first segment painted on clean `contextTop`. Line looks sharp. ✓
- **Stroke at ~10 points**: Ten incremental `ctx.stroke()` calls have painted over the same starting pixels. Anti-aliased edges from each call compound. Line appears blurry and slightly thicker than intended. ✗
- **Long stroke**: After 50+ points the overdraw is severe. The line looks like a blurry smear rather than a crisp stroke. ✗
- **Stroke with shadow**: Shadow causes `needsFullRender()` to return `true`, so full-redraw path is taken and there is no degradation. ✓ (this confirms the incremental path is the culprit)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mouse clicks and pointer interactions for brush and eraser tools must continue to render as before
- Shape drawing (line, rectangle, ellipse) on `mouse:down` / `mouse:move` / `mouse:up` must continue to work
- Undo and redo must continue to restore snapshots correctly
- Save and Save As must continue to export the canvas contents faithfully
- Stroke finalization — converting the `contextTop` preview into a Fabric.js `Path` on `path:created` — must be unaffected
- Smooth quadratic bezier rendering of recorded points must be preserved

**Scope:**
All inputs that do NOT involve an incremental pencil/brush stroke on `contextTop` are completely unaffected by this fix. The change touches only the brush instance configuration, not the Canvas, shape, history, or file-I/O logic.

## Hypothesized Root Cause

Based on reading `PencilBrush.ts` and `BaseBrush.ts` from the installed Fabric.js 6.9.1:

1. **`needsFullRender()` returns `false` for opaque colors**: `BaseBrush.needsFullRender()` checks `color.getAlpha() < 1 || !!this.shadow`. For solid opaque hex colors like `#000000`, alpha is 1 and shadow is null, so the method returns `false`. `PencilBrush.needsFullRender()` only adds a check for `this._hasStraightLine` (Shift-key straight line), leaving the base behavior in place.

2. **Incremental render path compounds anti-aliasing**: When `needsFullRender()` returns `false`, `onMouseMove()` calls `ctx.stroke()` without calling `canvas.clearContext(contextTop)` first. Each `ctx.stroke()` call renders anti-aliased edges. Because the edges from previous calls are already on `contextTop`, each new call blends its anti-aliased pixels on top of existing ones, cumulatively darkening and blurring the line boundary.

3. **`enableRetinaScaling: false` is a secondary concern**: The canvas is initialized with `enableRetinaScaling: false`. On HiDPI displays this means the backing store is at screen-resolution instead of physical-pixel resolution, which causes general blurriness across all drawing. However, this is independent of the progressive degradation described above and should be corrected separately if desired.

## Correctness Properties

Property 1: Bug Condition - Consistent Line Quality Throughout Stroke

_For any_ pointer-move event during a pencil stroke where `isBugCondition` holds (the brush is in incremental mode), the fixed `PencilBrush` instance SHALL clear `contextTop` and redraw the entire accumulated path before each new segment, so the visible stroke quality at point N is identical to the quality at point 1.

**Validates: Requirements 2.2, 2.3**

Property 2: Preservation - Non-Bug Inputs Unchanged

_For any_ input where the bug condition does NOT hold (brush tool, eraser tool, shape tools, undo/redo, save, mouse clicks on already-finalized strokes), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `src/apps/paint/Paint.tsx`

**Location**: The `useEffect` that creates and configures the `PencilBrush` (the effect with `[tool, color, size]` dependencies, approximately lines 302–315)

**Specific Changes**:

1. **Override `needsFullRender` on the brush instance**: After creating `new PencilBrush(c)`, add:
   ```typescript
   brush.needsFullRender = () => true;
   ```
   This forces `PencilBrush.onMouseMove()` to always take the full-redraw path: it calls `canvas.clearContext(canvas.contextTop)` then `this._render()`, which re-draws the entire accumulated path from scratch on each move event. The incremental overdraw path is never taken.

**No other files need to change.** The fix is a single line added to an existing block.

**Before (current code):**
```typescript
if (freehand) {
  const brush = new PencilBrush(c);
  brush.color = tool === 'eraser' ? '#ffffff' : color;
  brush.width = tool === 'pencil' ? 1 : tool === 'eraser' ? size * 2 : size;
  c.freeDrawingBrush = brush;
}
```

**After (fixed code):**
```typescript
if (freehand) {
  const brush = new PencilBrush(c);
  brush.color = tool === 'eraser' ? '#ffffff' : color;
  brush.width = tool === 'pencil' ? 1 : tool === 'eraser' ? size * 2 : size;
  // Force full-redraw on every mouse move to prevent anti-aliasing overdraw
  // buildup. Without this, PencilBrush uses an incremental ctx.stroke() path
  // that compounds anti-aliased pixels and makes the line progressively blurry.
  brush.needsFullRender = () => true;
  c.freeDrawingBrush = brush;
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the overdraw bug on the unfixed code, then verify the fix produces consistent line quality and preserves all other behaviors.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the progressive quality degradation BEFORE implementing the fix. Confirm the root cause: `needsFullRender()` returning `false` causes incremental overdraw.

**Test Plan**: Write tests that create a `PencilBrush` on a Fabric.js `Canvas`, simulate a sequence of `onMouseMove` calls (10–50 points), and inspect `contextTop` pixel data at the stroke center after each call. On unfixed code, pixel alpha values at the stroke edge will increase with each move, confirming overdraw.

**Test Cases**:
1. **Full-redraw path test**: Assert that a brush with `needsFullRender() === true` calls `canvas.clearContext(contextTop)` before each `_render()` call (should pass on unfixed code for brushes with shadows)
2. **Incremental path test**: Assert that a standard opaque-color brush (unfixed) does NOT clear `contextTop` between move events — this will pass on unfixed code, confirming the bug path
3. **Pixel accumulation test**: After 20 move events on unfixed code, assert that edge pixels on `contextTop` have higher alpha than after 1 move event (confirms overdraw buildup)
4. **Out-of-bounds move test**: Simulate a move event outside canvas bounds — assert it is ignored regardless of fix

**Expected Counterexamples**:
- Edge pixel alpha values increase monotonically with stroke length on unfixed code
- `clearContext` is never called during a normal opaque stroke on unfixed code

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed brush produces consistent line quality.

**Pseudocode:**
```
FOR ALL pointerMoveEvent WHERE isBugCondition(pointerMoveEvent) DO
  pixelsAfter1Move  := getEdgePixels(contextTop, after 1 move)
  pixelsAfter20Moves := getEdgePixels(contextTop, after 20 moves)
  ASSERT pixelsAfter1Move ≈ pixelsAfter20Moves   // no progressive darkening
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code behaves identically to the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT original_behavior(input) = fixed_behavior(input)
END FOR
```

**Testing Approach**: Property-based testing is well-suited here because:
- It generates many random brush widths, colors, and point sequences automatically
- It catches edge cases around alpha values near 1.0, brush size extremes, and very short or very long strokes
- It provides strong guarantees that preservation holds across the whole input domain

**Test Plan**: Observe behavior on unfixed code for brush, eraser, and shape tools, then write property-based tests that verify the same outcomes after the fix.

**Test Cases**:
1. **Brush tool preservation**: Verify brush tool strokes render identically before and after fix (brush already uses the same `PencilBrush` with same `needsFullRender` override)
2. **Eraser tool preservation**: Verify eraser strokes render white correctly after fix
3. **Shape drawing preservation**: Verify line, rect, ellipse drawing is not affected
4. **Undo/redo preservation**: Verify that history snapshots round-trip correctly after fix

### Unit Tests

- Test that `brush.needsFullRender()` returns `true` on the fixed brush instance
- Test that `contextTop` is cleared on each `onMouseMove` call (spy on `canvas.clearContext`)
- Test edge cases: single-point stroke (dot), two identical points, move outside canvas bounds
- Test that `path:created` fires correctly and the resulting `Path` has correct stroke properties after fix

### Property-Based Tests

- Generate random sequences of pointer positions and verify that pixel data at stroke edges is consistent from first to last point (no alpha accumulation)
- Generate random opaque colors and verify `needsFullRender()` override holds regardless of color value
- Generate random brush widths and verify that the finalized `Path` object has the expected `strokeWidth`
- Test preservation: for all non-pencil-move inputs, assert fixed and original code produce the same canvas state

### Integration Tests

- Full draw-and-inspect: draw a 100-point stroke in the Paint app, export as PNG, and verify that pixel samples along the stroke have uniform opacity
- Stroke then undo: draw a stroke, undo, verify canvas is back to previous state
- Color change between strokes: draw stroke A in black, change color, draw stroke B in red, verify both strokes have correct independent colors
- Save after draw: draw a stroke, save as PNG, verify exported file contains the stroke at expected location
