# Bugfix Requirements Document

## Introduction

When using the pencil tool in the Paint application (`src/apps/paint/Paint.tsx`), strokes appear sharp and crisp while the mouse button is held down. The moment the mouse button is released and Fabric.js commits the stroke from the temporary upper canvas (`contextTop`) to the main canvas, the line immediately becomes blurry and low-definition. This affects all pencil strokes on HiDPI/retina displays and makes drawings look degraded after every stroke.

The root cause is a resolution mismatch during stroke commit: the Paint canvas is initialized with `enableRetinaScaling: false`, which keeps the main canvas backing store at CSS pixel resolution (1×). On retina displays the browser composites at 2× physical pixels, so the committed stroke — copied from a higher-resolution `contextTop` — is downsampled to the 1× main canvas and then stretched back up for display, producing a blurry result.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user draws with the pencil tool on a HiDPI/retina display and releases the mouse button THEN the system commits the stroke to the main canvas at 1× CSS pixel resolution, causing the line to appear blurry and low-definition

1.2 WHEN the pencil stroke finalization copies pixel data from `contextTop` to the main canvas THEN the system loses sharpness due to the resolution mismatch between the display pixel ratio and the canvas backing store resolution

### Expected Behavior (Correct)

2.1 WHEN a user draws with the pencil tool on a HiDPI/retina display and releases the mouse button THEN the system SHALL commit the stroke to the main canvas at the full device pixel ratio resolution, producing a sharp and crisp line that matches the in-progress appearance

2.2 WHEN the pencil stroke finalization copies pixel data from `contextTop` to the main canvas THEN the system SHALL preserve the stroke resolution so that the committed line is visually identical to the line drawn during the mouse-down phase

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user draws with the pencil tool on a standard (1×) display THEN the system SHALL CONTINUE TO render and commit strokes at their existing resolution without any visible change in appearance

3.2 WHEN a user draws shapes (line, rectangle, ellipse) using any shape tool THEN the system SHALL CONTINUE TO render and commit those shapes correctly without blur or distortion

3.3 WHEN a user draws with the brush or eraser tools THEN the system SHALL CONTINUE TO render and commit those strokes correctly without introducing blur or distortion

3.4 WHEN the Paint canvas exports a PNG via `toDataURL` THEN the system SHALL CONTINUE TO export at the same resolution and quality as before the fix

3.5 WHEN a user performs undo or redo after a pencil stroke THEN the system SHALL CONTINUE TO restore canvas state correctly without introducing additional blur
