# Bugfix Requirements Document

## Introduction

When drawing with the pencil tool in the Paint application, the rendered line starts sharp but becomes progressively blurrier and lower quality as the user continues a single continuous stroke. The root cause is in `Paint.tsx`: Fabric.js `PencilBrush` uses an incremental rendering strategy during a stroke — each `mousemove` event appends a new segment to the upper canvas (`contextTop`) via `ctx.stroke()` without first clearing prior paint. Because `needsFullRender()` returns `false` for a plain solid-color brush (no shadow, full opacity), the full-redraw path is never taken during the stroke. As a result, every `ctx.stroke()` call repaints anti-aliased pixels on top of previously-painted anti-aliased pixels, causing alpha compositing buildup that makes the line look increasingly blurry and thick as the stroke lengthens. Additionally, the canvas is initialized with `enableRetinaScaling: false`, which means the canvas backing store is not scaled for HiDPI displays, causing all drawing to be rendered at reduced physical pixel density.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user starts a continuous pencil stroke THEN the system renders the initial segment at high quality (sharp, crisp edges)

1.2 WHEN the user continues moving the pointer during a pencil stroke THEN the system appends each new segment via `ctx.stroke()` on the existing `contextTop` canvas without clearing prior paint, causing anti-aliasing compositing to accumulate over previously-drawn pixels

1.3 WHEN the pencil stroke grows beyond a few segments THEN the system produces a visibly blurry and degraded line due to repeated overdraw with anti-aliasing on the same pixel region

1.4 WHEN drawing on a HiDPI (retina) display THEN the system renders the canvas at non-retina resolution because `enableRetinaScaling: false` is set, resulting in a consistently blurry canvas backing store independent of stroke length

### Expected Behavior (Correct)

2.1 WHEN the user starts a continuous pencil stroke THEN the system SHALL render the initial segment at high quality

2.2 WHEN the user continues moving the pointer during a pencil stroke THEN the system SHALL clear `contextTop` and redraw the entire path from all accumulated points on each move, preventing anti-aliasing overdraw buildup

2.3 WHEN the pencil stroke grows beyond a few segments THEN the system SHALL produce a consistent, sharp line with no progressive quality degradation compared to the first segment

2.4 WHEN drawing on a HiDPI (retina) display THEN the system SHALL render the canvas at the native device pixel ratio by enabling retina scaling, so that all drawing (live stroke preview and finalized paths) is sharp at the physical pixel level

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user releases the pointer to end a pencil stroke THEN the system SHALL CONTINUE TO finalize the stroke as a Fabric.js `Path` object added to the lower canvas and clear the upper canvas preview

3.2 WHEN the user draws with the brush or eraser tools THEN the system SHALL CONTINUE TO render those tools using the same drawing pipeline without regression

3.3 WHEN the user draws shapes (line, rectangle, ellipse) THEN the system SHALL CONTINUE TO render shape previews and finalize them as Fabric objects on mouse-up

3.4 WHEN the user performs undo and redo THEN the system SHALL CONTINUE TO restore prior canvas snapshots correctly

3.5 WHEN the user saves a drawing as PNG THEN the system SHALL CONTINUE TO export the canvas contents faithfully

3.6 WHEN the user draws a stroke with a positive-width brush THEN the system SHALL CONTINUE TO produce a smooth quadratic bezier path using all recorded points
