import { expect, test } from '@playwright/test';
import { canvasDataUrl, drawLine, expectCanvasDrawn, expectPixel, freshDesktop } from './helpers';

test.describe('Playwright harness', () => {
  test('Express runs with MOCK_GEMINI=1', async ({ request }) => {
    const res = await request.get('http://localhost:8787/api/health');
    expect(await res.json()).toEqual({ ok: true, ai: true });
  });

  test('resets IndexedDB and loads the desktop', async ({ page }) => {
    await freshDesktop(page);
    await expect(page.locator('body')).toBeVisible();
    const dbCount = await page.evaluate(async () => (await indexedDB.databases()).length);
    expect(dbCount).toBeLessThanOrEqual(1);
  });

  test('canvas helpers draw and read pixels', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.id = 'harness-canvas';
      c.width = 200;
      c.height = 100;
      c.style.cssText = 'position:fixed;left:20px;top:20px;background:#fff;z-index:99999';
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 200, 100);
      let down = false;
      let last = { x: 0, y: 0 };
      c.addEventListener('mousedown', (e) => ((down = true), (last = { x: e.offsetX, y: e.offsetY })));
      c.addEventListener('mouseup', () => (down = false));
      c.addEventListener('mousemove', (e) => {
        if (!down) return;
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(e.offsetX, e.offsetY);
        ctx.stroke();
        last = { x: e.offsetX, y: e.offsetY };
      });
      document.body.appendChild(c);
    });
    const canvas = page.locator('#harness-canvas');
    await drawLine(page, canvas, { x: 10, y: 50 }, { x: 190, y: 50 });
    await expectCanvasDrawn(canvas, 100);
    await expectPixel(canvas, 100, 50, [255, 0, 0]);
    expect(await canvasDataUrl(canvas)).toMatch(/^data:image\/png;base64,/);
  });
});
