import { expect, test } from '@playwright/test';

async function dragTo(page: import('@playwright/test').Page, name: string, x: number, y: number) {
  const icon = page.locator('.desktop-icon', { hasText: name });
  const b = (await icon.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 20, { steps: 5 });
  await page.mouse.move(x, y, { steps: 15 });
  await page.mouse.up();
}

test('desktop icons can be dragged, persist, and never overlap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('win98.desktopIconCells'));
  await page.reload();
  const paint = page.locator('.desktop-icon', { hasText: 'Paint' });
  await expect(paint).toBeVisible();
  await page.screenshot({ path: 'test-results/icon-drag-before.png' });
  const before = (await paint.boundingBox())!;

  await dragTo(page, 'Paint', 700, 400);
  const after = (await paint.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(300);
  expect(after.y - before.y).toBeGreaterThan(150);
  await page.screenshot({ path: 'test-results/icon-drag-after.png' });

  await page.reload();
  const reloaded = (await page.locator('.desktop-icon', { hasText: 'Paint' }).boundingBox())!;
  expect(Math.abs(reloaded.x - after.x)).toBeLessThan(2);
  expect(Math.abs(reloaded.y - after.y)).toBeLessThan(2);

  const other = page.locator('.desktop-icon').filter({ hasNotText: 'Paint' }).first();
  const ob = (await other.boundingBox())!;
  await dragTo(page, (await other.innerText()).trim(), reloaded.x + reloaded.width / 2, reloaded.y + reloaded.height / 2);
  const ob2 = (await other.boundingBox())!;
  expect(ob2.x !== ob.x || ob2.y !== ob.y).toBe(true);
  const pb = (await page.locator('.desktop-icon', { hasText: 'Paint' }).boundingBox())!;
  expect(ob2.x === pb.x && ob2.y === pb.y).toBe(false);
  expect(errors).toEqual([]);
});
