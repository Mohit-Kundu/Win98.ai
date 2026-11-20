import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drawLine, expectCanvasDrawn, expectPixel, freshDesktop } from './helpers';

// Validates: Requirement 15.4 (E2E 1: Paint persistence)

const paintCanvas = (page: Page) => page.locator('[data-testid^="window-"] .paint canvas.lower-canvas');
const paintUpper = (page: Page) => page.locator('[data-testid^="window-"] .paint canvas.upper-canvas');

async function pickColor(page: Page, hex: string): Promise<void> {
  await page.getByRole('radio', { name: hex }).click();
}

test('Paint: draw, save, reopen from Explorer, edit, save, refresh, edit persists', async ({ page }) => {
  await freshDesktop(page);

  // Open Paint from the desktop icon.
  await page.locator('.desktop-icon', { hasText: 'Paint' }).dblclick();
  await expect(paintUpper(page)).toBeVisible();

  // Draw a red horizontal stroke with the Brush tool.
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await pickColor(page, '#ff0000');
  await page.getByLabel('Brush size').selectOption('12');
  await drawLine(page, paintUpper(page), { x: 50, y: 100 }, { x: 250, y: 100 });
  await expectCanvasDrawn(paintCanvas(page), 100);
  await expectPixel(paintCanvas(page), 150, 100, [255, 0, 0]);

  // Save As drawing.png.
  await page.getByRole('button', { name: 'Save As...' }).click();
  const saveDialog = page.getByRole('dialog', { name: 'Save As' });
  await saveDialog.getByRole('textbox').fill('drawing.png');
  await saveDialog.getByRole('button', { name: /ok|save/i }).click();
  await expect(page.locator('.paint .status-bar-field')).toHaveText('C:\\My Pictures\\drawing.png');

  // Close Paint.
  await page.locator('[data-testid^="window-"]').getByRole('button', { name: 'Close' }).first().click();
  await expect(paintUpper(page)).toHaveCount(0);

  // Find the file in Explorer.
  await page.locator('.desktop-icon', { hasText: 'File Explorer' }).dblclick();
  await page.getByRole('tree', { name: 'Folders' }).getByRole('button', { name: 'My Pictures', exact: true }).click();
  const row = page.getByRole('option', { name: /drawing\.png/ });
  await expect(row).toBeVisible();

  // Open it by double-click: Paint opens with the saved drawing.
  await row.dblclick();
  await expect(paintUpper(page)).toBeVisible();
  await page.getByRole('dialog', { name: 'Paint' }).locator('.title-bar-text').click();
  await expect(page.locator('.paint .status-bar-field')).toHaveText('C:\\My Pictures\\drawing.png');
  await expect.poll(() => paintCanvas(page).evaluate((c) => (c as HTMLCanvasElement).width)).toBe(640);
  await expect.poll(async () => {
    try {
      await expectPixel(paintCanvas(page), 150, 100, [255, 0, 0]);
      return true;
    } catch {
      return false;
    }
  }).toBe(true);

  // Edit: add a blue stroke, then Save (overwrites in place).
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  await pickColor(page, '#0000ff');
  await page.getByLabel('Brush size').selectOption('12');
  await drawLine(page, paintUpper(page), { x: 50, y: 160 }, { x: 250, y: 160 });
  await expectPixel(paintCanvas(page), 150, 160, [0, 0, 255]);
  await expect(page.locator('.paint .status-bar-field')).toContainText('*');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.paint .status-bar-field')).toHaveText('C:\\My Pictures\\drawing.png');

  // Refresh (no storage reset) and reopen via Explorer.
  await page.reload();
  await page.locator('.desktop-icon', { hasText: 'File Explorer' }).dblclick();
  await page.getByRole('tree', { name: 'Folders' }).getByRole('button', { name: 'My Pictures', exact: true }).click();
  const rowAfter = page.getByRole('option', { name: /drawing\.png/ });
  await expect(rowAfter).toBeVisible();
  await rowAfter.dblclick();
  await expect(paintUpper(page)).toBeVisible();

  // Both the original and the edited strokes persist.
  const check = async (x: number, y: number, rgb: [number, number, number]) =>
    expect.poll(async () => {
      try {
        await expectPixel(paintCanvas(page), x, y, rgb);
        return true;
      } catch {
        return false;
      }
    }).toBe(true);
  await check(150, 100, [255, 0, 0]);
  await check(150, 160, [0, 0, 255]);
});
