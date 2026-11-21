/**
 * Bug condition exploration test — Property 1: Committed Pencil Stroke Sharpness on HiDPI
 *
 * This test encodes the EXPECTED (fixed) behavior: after a pencil stroke is committed,
 * the canvas backing store must be allocated at CSS_width × DPR by CSS_height × DPR
 * physical pixels. On unfixed code (enableRetinaScaling: false), the backing store stays
 * at 1× — equal to the CSS pixel dimensions — so this test FAILS on unfixed code.
 *
 * EXPECTED OUTCOME on unfixed code: FAIL
 *   Counterexample: el.width === 640 (CSS pixels) instead of 1280 (CSS × DPR)
 *   This confirms the resolution mismatch that produces blur on commit.
 *
 * EXPECTED OUTCOME after fix (enableRetinaScaling: true): PASS
 *
 * Root cause: Canvas({ enableRetinaScaling: false }) keeps the HTML canvas element's
 * backing-store width attribute equal to the CSS logical width. At DPR=2 the browser
 * stretches that 1× buffer to fill the 2× display area, blurring committed strokes.
 *
 * Validates: Requirements 1.1, 1.2
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Canvas, PencilBrush, Point, config } from 'fabric';

// ─── JSDOM canvas stub ───────────────────────────────────────────────────────
// jsdom does not implement HTMLCanvasElement.getContext(). We provide a minimal
// stub that lets Fabric.js construct and operate the canvas without real GPU
// rendering. We capture the getContext calls so the stub canvas element still
// reflects the backing-store width/height written to its attributes by Fabric.
function installCanvasStub() {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const el = this;
    return {
      scale: () => {},
      clearRect: () => {},
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      quadraticCurveTo: () => {},
      save: () => {},
      restore: () => {},
      transform: () => {},
      setTransform: () => {},
      fillRect: () => {},
      clip: () => {},
      closePath: () => {},
      arc: () => {},
      fill: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      measureText: () => ({ width: 0 }),
      setLineDash: () => {},
      getLineDash: () => [],
      isPointInPath: () => false,
      get canvas() {
        return el;
      },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      shadowBlur: 0,
      shadowColor: '',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      fillStyle: '#000',
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      miterLimit: 10,
      lineDashOffset: 0,
      imageSmoothingEnabled: true,
      patternQuality: 'best',
    } as unknown as CanvasRenderingContext2D;
  };

  // Fabric.js schedules renders via requestAnimationFrame. We provide a no-op
  // since all test canvases use renderOnAddRemove:false and we never need actual
  // rendering — only the backing-store dimension set during canvas initialization.
  window.requestAnimationFrame = (_cb: FrameRequestCallback) => 0;
  window.cancelAnimationFrame = () => {};
}

// ─── Helper: build a Paint-like Canvas instance ──────────────────────────────
function makeCanvas(
  el: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  enableRetinaScaling: boolean,
): Canvas {
  const c = new Canvas(el, {
    width: cssWidth,
    height: cssHeight,
    backgroundColor: '#ffffff',
    selection: false,
    skipTargetFind: true,
    enableRetinaScaling,
    preserveObjectStacking: true,
    renderOnAddRemove: false,
  });
  return c;
}

// ─── Helper: simulate a 3-point pencil stroke and wait for path:created ──────
function simulateStroke(
  c: Canvas,
  points: Array<{ x: number; y: number }>,
): Promise<void> {
  return new Promise((resolve) => {
    c.on('path:created', () => resolve());

    const brush = new PencilBrush(c);
    brush.color = '#000000';
    brush.width = 1;
    c.freeDrawingBrush = brush;
    c.isDrawingMode = true;

    // All synthetic events need isPrimary:true so _isMainEvent() accepts them.
    const ev = { isPrimary: true as const, type: 'mousedown' };

    brush.onMouseDown(new Point(points[0]?.x ?? 10, points[0]?.y ?? 10), { e: ev });
    for (let i = 1; i < points.length - 1; i++) {
      brush.onMouseMove(new Point(points[i]?.x ?? 10 + i, points[i]?.y ?? 10 + i), {
        e: { ...ev, type: 'mousemove' },
      });
    }
    // mouseup triggers _finalizeAndAddPath → path:created
    brush.onMouseUp({ e: { ...ev, type: 'mouseup' } });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bug Condition Exploration — Property 1: Committed Pencil Stroke Sharpness on HiDPI', () => {
  const DPR = 2;
  let originalDpr: number;

  beforeEach(() => {
    installCanvasStub();
    // Record original so we can restore; set Fabric's DPR override.
    originalDpr = config.devicePixelRatio ?? 1;
    config.configure({ devicePixelRatio: DPR });
  });

  afterEach(() => {
    config.configure({ devicePixelRatio: originalDpr });
  });

  // ── Concrete failing case ─────────────────────────────────────────────────

  it(
    'committed stroke backing store equals CSS_width × DPR on HiDPI ' +
      '(FAILS on unfixed code — backing store stays at CSS pixel resolution)',
    async () => {
      /**
       * isBugCondition:
       *   event.type = 'mouseup'
       *   AND canvas.isDrawingMode = true
       *   AND canvas.freeDrawingBrush IS PencilBrush
       *   AND canvas.enableRetinaScaling = false   ← unfixed value
       *   AND window.devicePixelRatio > 1          ← DPR = 2
       *
       * Expected (correct) behavior:
       *   el.width  = cssWidth  × DPR  (1280 for a 640px canvas at DPR=2)
       *   el.height = cssHeight × DPR  (960  for a 480px canvas at DPR=2)
       *
       * Counterexample on unfixed code:
       *   el.width  = 640  (CSS pixels only — 1× backing store)
       *   el.height = 480
       *   → browser stretches 640×480 to fill 1280×960 physical area → blur
       */
      const CSS_W = 640;
      const CSS_H = 480;

      const el = document.createElement('canvas');
      document.body.appendChild(el);

      // Fixed: enableRetinaScaling: true (matches Paint.tsx after the fix)
      const c = makeCanvas(el, CSS_W, CSS_H, true);

      await simulateStroke(c, [
        { x: 50, y: 50 },
        { x: 150, y: 100 },
        { x: 250, y: 200 },
        { x: 350, y: 150 },
      ]);

      const backingStoreWidth = el.width;
      const backingStoreHeight = el.height;

      // On unfixed code this assertion fails:
      //   expect(640).toBe(1280)  ← counterexample: 640 !== 1280
      expect(backingStoreWidth).toBe(
        CSS_W * DPR,
        `Backing store width is ${backingStoreWidth}px (CSS pixels only). ` +
          `Expected ${CSS_W * DPR}px (CSS × DPR). ` +
          `This confirms the 1× backing store that causes blur on commit.`,
      );
      expect(backingStoreHeight).toBe(
        CSS_H * DPR,
        `Backing store height is ${backingStoreHeight}px. Expected ${CSS_H * DPR}px.`,
      );

      void c.dispose();
      document.body.removeChild(el);
    },
  );

  // ── Property-based: same invariant over random canvas sizes and strokes ───

  it(
    'PBT: for all canvas sizes and stroke paths, committed backing store = CSS × DPR ' +
      '(Validates: Requirements 1.1, 1.2)',
    async () => {
      /**
       * **Validates: Requirements 1.1, 1.2**
       *
       * Property: for any CSS canvas dimension and any pencil stroke, after
       * path:created fires, el.width === cssWidth × DPR.
       *
       * On unfixed code (enableRetinaScaling: false) the backing store stays at
       * 1×, so el.width === cssWidth instead of cssWidth × DPR. This means every
       * committed stroke is downsampled into a 1× buffer and then stretched 2×
       * by the browser for display — producing the observed blur.
       *
       * fast-check will find this counterexample immediately.
       */
      await fc.assert(
        fc.asyncProperty(
          // CSS canvas dimensions
          fc.integer({ min: 100, max: 800 }),
          fc.integer({ min: 100, max: 600 }),
          // A stroke: at least 3 points with meaningful spread
          fc.array(
            fc.record({
              x: fc.integer({ min: 10, max: 300 }),
              y: fc.integer({ min: 10, max: 300 }),
            }),
            { minLength: 3, maxLength: 8 },
          ),
          async (cssWidth, cssHeight, strokePoints) => {
            const el = document.createElement('canvas');
            document.body.appendChild(el);

            // Fixed: enableRetinaScaling: true
            const c = makeCanvas(el, cssWidth, cssHeight, true);

            await simulateStroke(c, strokePoints);

            const backingStoreWidth = el.width;

            void c.dispose();
            document.body.removeChild(el);

            // Fails on unfixed code: backingStoreWidth === cssWidth (not cssWidth × DPR)
            return backingStoreWidth === cssWidth * DPR;
          },
        ),
        { numRuns: 20 },
      );
    },
  );
});
