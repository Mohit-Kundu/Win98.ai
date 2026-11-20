import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Deletes every IndexedDB database for the app origin, then reloads so the app boots with an empty VFS.
 * Call once at the start of a test. Do NOT call it between a save and a refresh, or persistence checks break.
 */
export async function resetIndexedDB(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve();
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

/** Resets storage and opens a fresh desktop. */
export async function freshDesktop(page: Page): Promise<void> {
  await resetIndexedDB(page);
  await page.waitForLoadState('domcontentloaded');
}

export interface Point {
  x: number;
  y: number;
}

/** Converts canvas-relative coordinates (CSS pixels from the canvas top-left) to page coordinates. */
async function toPage(canvas: Locator, p: Point): Promise<Point> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas is not visible');
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Draws a polyline with the left mouse button using page.mouse. Points are canvas-relative. */
export async function drawStroke(page: Page, canvas: Locator, points: Point[]): Promise<void> {
  const [first, ...rest] = points;
  if (!first) return;
  const start = await toPage(canvas, first);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of rest) {
    const pt = await toPage(canvas, p);
    await page.mouse.move(pt.x, pt.y, { steps: 8 });
  }
  await page.mouse.up();
}

/** Draws a straight line between two canvas-relative points. */
export async function drawLine(page: Page, canvas: Locator, from: Point, to: Point): Promise<void> {
  await drawStroke(page, canvas, [from, to]);
}

/** Clicks once at a canvas-relative point. */
export async function clickCanvas(page: Page, canvas: Locator, p: Point): Promise<void> {
  const pt = await toPage(canvas, p);
  await page.mouse.click(pt.x, pt.y);
}

/** Returns the canvas content as a PNG data URL. */
export function canvasDataUrl(canvas: Locator): Promise<string> {
  return canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL('image/png'));
}

export type RGBA = [number, number, number, number];

/** Reads one pixel in canvas bitmap coordinates (not CSS pixels) via a toDataURL round trip. */
export function getPixel(canvas: Locator, x: number, y: number): Promise<RGBA> {
  return canvas.evaluate(
    async (el, [px, py]) => {
      const src = el as HTMLCanvasElement;
      const img = new Image();
      img.src = src.toDataURL('image/png');
      await img.decode();
      const copy = document.createElement('canvas');
      copy.width = src.width;
      copy.height = src.height;
      const ctx = copy.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
    },
    [x, y] as [number, number],
  );
}

/** Counts pixels that differ from a background colour (default opaque white). Useful for "something was drawn". */
export function countNonBackgroundPixels(canvas: Locator, bg: RGBA = [255, 255, 255, 255]): Promise<number> {
  return canvas.evaluate(
    async (el, background) => {
      const src = el as HTMLCanvasElement;
      const img = new Image();
      img.src = src.toDataURL('image/png');
      await img.decode();
      const copy = document.createElement('canvas');
      copy.width = src.width;
      copy.height = src.height;
      const ctx = copy.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i] !== background[0] ||
          data[i + 1] !== background[1] ||
          data[i + 2] !== background[2] ||
          data[i + 3] !== background[3]
        ) {
          n++;
        }
      }
      return n;
    },
    bg,
  );
}

/** Asserts a pixel matches an expected colour within a per-channel tolerance (default 8, for anti-aliasing). */
export async function expectPixel(
  canvas: Locator,
  x: number,
  y: number,
  expected: [number, number, number],
  tolerance = 8,
): Promise<void> {
  const [r, g, b] = await getPixel(canvas, x, y);
  expect(Math.abs(r - expected[0])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(g - expected[1])).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(b - expected[2])).toBeLessThanOrEqual(tolerance);
}

/** Asserts the canvas has at least `min` non-background pixels. */
export async function expectCanvasDrawn(canvas: Locator, min = 1, bg?: RGBA): Promise<void> {
  expect(await countNonBackgroundPixels(canvas, bg)).toBeGreaterThanOrEqual(min);
}
