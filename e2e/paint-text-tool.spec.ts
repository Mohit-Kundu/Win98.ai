import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { clickCanvas, freshDesktop } from './helpers';

/** Counts opaque, dark pixels (default text colour is black), ignoring a transparent or white background. */
function countDarkPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate(async (el) => {
    const src = el as HTMLCanvasElement;
    const img = new Image();
    img.src = src.toDataURL('image/png');
    await img.decode();
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128 && d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++;
    return n;
  });
}

// Validates: add-text-button-not-working bugfix (Paint Text tool overlay must stay open and focused)

const paintCanvas = (page: Page) => page.locator('[data-testid^="window-"] .paint canvas.lower-canvas');
const paintUpper = (page: Page) => page.locator('[data-testid^="window-"] .paint canvas.upper-canvas');
const textInput = (page: Page) => page.locator('.paint-text-input');
const toolButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function openPaintWithText(page: Page): Promise<void> {
  await freshDesktop(page);
  await page.locator('.desktop-icon', { hasText: 'Paint' }).dblclick();
  await expect(paintUpper(page)).toBeVisible();
  await toolButton(page, 'Text').click();
  await expect(toolButton(page, 'Text')).toHaveAttribute('aria-pressed', 'true');
}

const isFocused = (page: Page) => textInput(page).evaluate((el) => el === document.activeElement);

test('Text tool: clicking the canvas opens a focused text box that stays open', async ({ page }) => {
  await openPaintWithText(page);
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.waitForTimeout(300);
  await expect(textInput(page)).toBeVisible();
  expect(await isFocused(page)).toBe(true);
});

test('Text tool: slow click still leaves the text box open and focused', async ({ page }) => {
  await openPaintWithText(page);
  const box = (await paintUpper(page).boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 80);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(textInput(page)).toBeVisible();
  expect(await isFocused(page)).toBe(true);
});

test('Text tool: typing and pressing Enter draws the text on the canvas', async ({ page }) => {
  await openPaintWithText(page);
  const before = await countDarkPixels(paintCanvas(page));
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.keyboard.type('Hello');
  await expect(textInput(page)).toHaveValue('Hello');
  await page.keyboard.press('Enter');
  await expect(textInput(page)).toHaveCount(0);
  await expect.poll(() => countDarkPixels(paintCanvas(page))).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
});

test('Text tool: clicking inside the open text box keeps it open with its text', async ({ page }) => {
  await openPaintWithText(page);
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.keyboard.type('Hi');
  await textInput(page).click();
  await page.waitForTimeout(300);
  await expect(textInput(page)).toHaveValue('Hi');
  expect(await isFocused(page)).toBe(true);
});

test('Text tool: clicking elsewhere on the canvas commits the text', async ({ page }) => {
  await openPaintWithText(page);
  const before = await countDarkPixels(paintCanvas(page));
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.keyboard.type('Away');
  await clickCanvas(page, paintUpper(page), { x: 300, y: 250 });
  await expect(textInput(page)).toHaveCount(0);
  await expect.poll(() => countDarkPixels(paintCanvas(page))).toBeGreaterThan(before);
});

test('Text tool: Escape cancels and draws nothing', async ({ page }) => {
  await openPaintWithText(page);
  const before = await countDarkPixels(paintCanvas(page));
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.keyboard.type('Nope');
  await page.keyboard.press('Escape');
  await expect(textInput(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await countDarkPixels(paintCanvas(page))).toBe(before);
});

test('Text tool: switching tools cancels the open text box', async ({ page }) => {
  await openPaintWithText(page);
  const before = await countDarkPixels(paintCanvas(page));
  await clickCanvas(page, paintUpper(page), { x: 100, y: 100 });
  await page.keyboard.type('Gone');
  await toolButton(page, 'Pencil').click();
  await expect(toolButton(page, 'Pencil')).toHaveAttribute('aria-pressed', 'true');
  await expect(textInput(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await countDarkPixels(paintCanvas(page))).toBe(before);
});
