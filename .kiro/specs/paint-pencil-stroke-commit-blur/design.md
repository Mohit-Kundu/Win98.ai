# Paint Pencil Stroke Commit Blur Bugfix Design

## Overview

When a user draws with the pencil tool on a HiDPI/retina display, the stroke looks sharp while the mouse button is held down because Fabric.js renders it on `contextTop` which tracks the display's device pixel ratio. The moment the mouse is released, Fabric.js commits the stroke to the main canvas backing store. Because the main canvas is initialized with `enableRetinaScaling: false`, its backing store is at 1× CSS pixel resolution — lower than the physical display resolution. The committed stroke is downsampled into the 1× buffer and then stretched back to fill its display area, producing a blurry result.

The fix is to change `enableRetinaScaling` from `false` to `true` in the `Canvas` constructor in `Paint.tsx`. This aligns the main canvas backing store with the device pixel ratio, eliminating the resolution mismatch on commit. The `exportPng` function already passes `enableRetinaScaling: false` to `toDataURL`, so export dimensions are unaffected. Canvas logical dimensions reported by `getWidth()`/`getHeight()` remain in CSS pixels, so history snapshots, undo/redo, and image placement are all unaffected.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a pencil stroke is committed to the main canvas on a HiDPI display while `enableRetinaScaling: false`.
- **Property (P)**: The desired behavior — the committed stroke is visually identical (crisp, full-resolution) to the stroke as rendered during the draw phase.
- **Preservation**: Existing behaviors that must not change — shape tool rendering, brush/eraser rendering, PNG export dimensions, undo/redo correctness, and 1× display rendering.
- **Canvas**: The Fabric.js `Canvas` instance initialized in `src/apps/paint/Paint.tsx`.
- **contextTop**: Fabric.js's temporary upper canvas overlay used to render an in-progress free-draw stroke before committing it.
- **enableRetinaScaling**: A Fabric.js canvas option that, when `true`, scales the canvas backing store by `window.devicePixelRatio` so physical pixels match CSS pixels on HiDPI displays.
- **devicePixelRatio (DPR)**: The ratio of physical device pixels to CSS logical pixels (e.g., 2 on a typical retina display).
- **stroke commit**: The moment Fabric.js copies the completed stroke from `contextTop` onto the main canvas backing store when the user releases the mouse button.
- **exportPng**: The `exportPng` function in `Paint.tsx` that calls `canvas.toDataURL` with `enableRetinaScaling: false` and `multiplier: 1`.

## Bug Details

### Bug Condition

The bug manifests when a user completes a pencil stroke (releases the mouse button) on a device where `window.devicePixelRatio > 1`. The Fabric.js `PencilBrush` finalizes the stroke by copying pixel data from `contextTop` — which Fabric.js always scales to DPR for rendering quality — to the main canvas, which is locked at 1× due to `enableRetinaScaling: false`. The resolution mismatch causes the committed stroke to appear blurry.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input = { event: MouseUpEvent, canvas: FabricCanvas }
  OUTPUT: boolean

  RETURN event.type = 'mouseup'
         AND canvas.isDrawingMode = true
         AND canvas.freeDrawingBrush IS PencilBrush
         AND canvas.enableRetinaScaling = false
         AND window.devicePixelRatio > 1
END FUNCTION
```

### Examples

- **Retina MacBook, pencil stroke**: User draws a diagonal line. During drawing the line is crisp at 2× resolution. On mouse-up, the committed path renders blurry because it was written into a 1× backing store (actual bug).
- **Retina display, short dot**: User clicks without dragging. The resulting dot is blurry after commit — the same 1× downsampling occurs (actual bug).
- **1× display, any stroke**: `window.devicePixelRatio = 1`, so the backing store resolution already matches; no blur occurs (not a bug, must be preserved).
- **Retina display, shape tool**: Shape tools add Fabric.js vector objects, not rasterized pixels from `contextTop`, so blur does not occur via the same mechanism (not a bug, must be preserved).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mouse clicks and shape drawing (line, rectangle, ellipse) must continue to render and commit correctly without distortion.
- The PNG export via `exportPng` must continue to produce an image at CSS pixel dimensions (not scaled by DPR), maintaining the same file size and content as before.
- Undo and redo must continue to restore canvas state without introducing additional blur or visual artifacts.
- Drawing on standard 1× displays must be visually unchanged.
- Brush and eraser tools must continue to render and commit strokes correctly.

**Scope:**
All inputs where `window.devicePixelRatio = 1`, or where the interaction does not involve a free-draw stroke commit (e.g., shape tools, mouse clicks on toolbar, file open/save), must be completely unaffected by this fix.

## Hypothesized Root Cause

Based on the bug description and source inspection, the most likely cause is:

1. **Canvas initialized with `enableRetinaScaling: false`**: In `Paint.tsx` lines 196–203, the `Canvas` constructor sets `enableRetinaScaling: false`. Fabric.js then sets the HTML canvas element's CSS size to the logical dimensions but its backing-store pixel size to 1×, regardless of DPR.

2. **`contextTop` renders at DPR resolution**: Fabric.js always sizes the upper overlay canvas (used for active free-draw rendering) relative to the device pixel ratio, so an in-progress stroke at 2× DPR looks sharp.

3. **Commit copies high-res pixels into low-res buffer**: On `path:created`, Fabric.js transfers the stroke from `contextTop` to the main canvas. Because the main canvas backing store is 1× while the source was 2×, the pixels are downsampled, then the browser stretches the 1× canvas back to its CSS display size — causing blur.

4. **`exportPng` explicitly opts out of retina scaling**: The `toDataURL` call passes `enableRetinaScaling: false` and `multiplier: 1`, so enabling retina scaling on the canvas itself will not affect export dimensions.

## Correctness Properties

Property 1: Bug Condition - Committed Pencil Stroke Sharpness

_For any_ pencil stroke completed (mouse released) on a display with `devicePixelRatio > 1`, the fixed canvas initialization SHALL commit the stroke to a backing store that matches the physical display resolution, producing a committed stroke that is visually identical in sharpness to the stroke rendered during the mouse-down phase.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - Non-Pencil-Commit Behaviors

_For any_ interaction that does NOT involve committing a pencil stroke on a HiDPI display (1× displays, shape tools, brush/eraser tools, PNG export, undo/redo), the fixed canvas SHALL produce exactly the same behavior as the original canvas, preserving all existing visual output, export dimensions, and canvas state management.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct — that `enableRetinaScaling: false` is the direct cause of the backing-store resolution mismatch:

**File**: `src/apps/paint/Paint.tsx`

**Specific Changes**:

1. **Enable retina scaling on canvas initialization** (the core fix): Change `enableRetinaScaling: false` to `enableRetinaScaling: true` in the `Canvas` constructor (approximately line 199). This causes Fabric.js to allocate the backing store at `width * DPR` × `height * DPR` physical pixels and to set the CSS display size to `width` × `height`, matching what the browser composites.

2. **Keep export unscaled**: The `exportPng` function (line 230) already passes `{ format: 'png', multiplier: 1, enableRetinaScaling: false }` to `toDataURL`. No change is needed here — the export will continue to produce a CSS-pixel-dimensioned PNG.

3. **Verify `setDimensions` calls are unaffected**: All `c.setDimensions({ width, height })` calls pass CSS-pixel values. Fabric.js recalculates the backing-store size automatically when retina scaling is enabled, so these calls require no changes.

4. **Verify history snapshot compatibility**: `c.getWidth()` and `c.getHeight()` return CSS pixel values regardless of `enableRetinaScaling`. Snapshots store these values and pass them back to `setDimensions`, so undo/redo remains correct.

5. **No CSS sizing changes needed**: The `.paint-surface` and `<canvas>` element have no explicit pixel sizes set in CSS or in JSX — Fabric.js manages the canvas element dimensions directly.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface a counterexample that demonstrates the blurriness on unfixed code, then verify the fix produces a sharp committed stroke and preserves all other behaviors.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the commit blur BEFORE implementing the fix. Confirm or refute the root cause analysis. If refuted, re-hypothesize.

**Test Plan**: Write a test that simulates a pencil stroke sequence (mousedown → mousemove → mouseup) on a mock canvas with `devicePixelRatio = 2` and `enableRetinaScaling: false`, then inspects the pixel data of the committed path to detect blurriness (e.g., by checking that the path's rendered pixels have sub-pixel interpolated values indicating scaling artefacts). Run this test on the UNFIXED code to confirm the blur.

**Test Cases**:
1. **HiDPI stroke commit test**: Create a Fabric.js canvas with `enableRetinaScaling: false` and mock `devicePixelRatio = 2`. Simulate a pencil stroke. Assert that the committed path's rendered pixel data at the stroke boundary contains only fully-opaque pixels (will fail on unfixed code — partial-opacity anti-alias pixels indicate blurring from downscale/upscale).
2. **1× display baseline test**: Same setup but `devicePixelRatio = 1`. Assert that committed path pixels are sharp (should pass on unfixed code — confirm preservation baseline).
3. **Canvas backing store size test**: Assert that with `enableRetinaScaling: false` on a DPR-2 display, the canvas `width` DOM attribute equals the CSS logical width (not 2×). This confirms the 1× backing store (should pass on unfixed code, documents the root cause).

**Expected Counterexamples**:
- Stroke boundary pixels show fractional opacity values, indicating bilinear interpolation from the resize operation.
- Canvas backing-store width equals CSS pixel width (not multiplied by DPR), confirming `enableRetinaScaling: false` is the cause.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed canvas produces a sharp committed stroke.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := commitStroke_fixed(input)
  ASSERT strokedPixelsAreSharp(result)
  -- i.e., pixels at stroke boundary are fully opaque or fully transparent, no sub-pixel blending
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed canvas produces the same result as the original canvas.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalCanvas.output(input) = fixedCanvas.output(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It automatically generates varied canvas states, brush sizes, and tool configurations.
- It provides strong guarantees that export dimensions, undo/redo state, and shape rendering are unchanged across many input combinations.
- It catches edge cases like zero-length strokes, maximum brush size, and multiple sequential strokes.

**Test Plan**: Observe behavior on UNFIXED code for shape tools, PNG export, and 1× display strokes, then write property-based tests capturing those behaviors.

**Test Cases**:
1. **PNG export dimension preservation**: After fixing, `toDataURL` with `{ enableRetinaScaling: false, multiplier: 1 }` must produce an image whose decoded width × height equals the CSS canvas dimensions (not multiplied by DPR). Verify this holds for randomly generated canvas sizes.
2. **1× display rendering preservation**: On `devicePixelRatio = 1`, stroke pixel data before and after the fix must be identical.
3. **Shape tool rendering preservation**: For randomly generated line, rect, and ellipse strokes, the final JSON canvas state must be equivalent before and after the fix.
4. **Undo/redo state preservation**: After N random strokes with undo/redo sequences, the restored canvas dimensions must equal the original CSS dimensions.

### Unit Tests

- Test that `Canvas` is initialized with `enableRetinaScaling: true` after the fix.
- Test that `exportPng` calls `toDataURL` with `enableRetinaScaling: false` regardless of the canvas setting.
- Test that `c.getWidth()` / `c.getHeight()` return CSS pixel values (not DPR-scaled values) after initialization with `enableRetinaScaling: true`.
- Test that a stroke committed on a DPR-2 canvas with `enableRetinaScaling: true` produces sharp pixel boundaries.

### Property-Based Tests

- Generate random stroke paths on a DPR-2 canvas and verify that all committed pixel boundary values are either fully opaque or fully transparent (no bilinear blur artefacts).
- Generate random canvas sizes and verify that `exportPng` always returns an image matching CSS pixel dimensions.
- Generate random sequences of strokes, undos, and redos and verify that `getWidth()` and `getHeight()` always match the last explicitly set CSS dimensions.

### Integration Tests

- Full draw-and-export flow: draw a stroke on a retina mock, export PNG, verify the PNG dimensions match the CSS canvas dimensions and the stroke is visually crisp.
- Undo/redo flow: draw multiple strokes, undo all, redo all — verify no additional blur is introduced at any step.
- Tool-switching flow: switch between pencil, brush, eraser, and shape tools; verify each tool's output is unaffected by the retina scaling change.
