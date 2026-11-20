import { expect, test } from '@playwright/test';
import { canvasDataUrl, countNonBackgroundPixels, drawLine, expectCanvasDrawn, expectPixel, freshDesktop } from './helpers';

// Requirement 15.8: Paint AI generation, edit, save, reopen through Explorer (Mock_Gemini returns a stub PNG).
test.describe('Paint AI generation', () => {
  test('generate, edit, save, and reopen from Explorer', async ({ page }) => {
    await freshDesktop(page);

    // Open Paint from the desktop.
    await page.locator('.desktop-icon', { hasText: 'Paint' }).dblclick();
    const paint = page.getByRole('dialog', { name: 'Paint', exact: true });
    await expect(paint).toBeVisible();
    const canvas = paint.locator('canvas.lower-canvas');
    await expect(canvas).toBeVisible();
    const blank = await canvasDataUrl(canvas);

    // AI Automate: submit a prompt.
    await paint.getByRole('button', { name: 'AI Automate...' }).click();
    const ai = paint.getByRole('dialog', { name: 'AI Automate' });
    await ai.getByRole('textbox').fill('a red apple on a table');
    await ai.getByRole('button', { name: 'Generate' }).click();
    await expect(ai).toBeHidden();

    // The generated image is on the canvas.
    await expectCanvasDrawn(canvas, 50);
    const generated = await countNonBackgroundPixels(canvas);
    expect(await canvasDataUrl(canvas)).not.toBe(blank);

    // Edit: draw a blue line with the Brush tool.
    const before = await canvasDataUrl(canvas);
    await paint.getByRole('button', { name: 'Brush', exact: true }).click();
    await paint.getByRole('radio', { name: '#0000ff' }).click();
    await paint.locator('select[aria-label="Brush size"]').selectOption('20');
    const box = (await canvas.boundingBox())!;
    const y = Math.round(box.height / 2);
    await drawLine(page, canvas, { x: 5, y }, { x: Math.round(box.width) - 5, y });
    await expect(paint.locator('.status-bar-field')).toContainText('*');
    expect(await canvasDataUrl(canvas)).not.toBe(before);
    await expectPixel(canvas, Math.round(box.width / 2), y, [0, 0, 255], 40);

    // Save As a new PNG.
    await paint.getByRole('button', { name: 'Save As...' }).click();
    const saveAs = page.getByRole('dialog', { name: 'Save As' });
    await saveAs.getByRole('textbox').fill('ai-apple.png');
    await saveAs.getByRole('button', { name: 'OK' }).click();
    await expect(paint.locator('.status-bar-field')).toHaveText('C:\\My Pictures\\ai-apple.png');
    const saved = await canvasDataUrl(canvas);

    // Close Paint, then reopen the file through Explorer.
    await paint.getByRole('button', { name: 'Close' }).click();
    await expect(paint).toBeHidden();

    await page.locator('.desktop-icon', { hasText: 'File Explorer' }).dblclick();
    const explorer = page.getByRole('dialog', { name: 'File Explorer', exact: true });
    await explorer.getByRole('tree', { name: 'Folders' }).getByRole('button', { name: 'My Pictures', exact: true }).click();
    await explorer.getByRole('option', { name: /ai-apple\.png/ }).dblclick();

    const reopened = page.getByRole('dialog', { name: 'Paint', exact: true });
    await expect(reopened.locator('.status-bar-field')).toHaveText('C:\\My Pictures\\ai-apple.png');
    const canvas2 = reopened.locator('canvas.lower-canvas');
    await expectCanvasDrawn(canvas2, generated);
    const box2 = (await canvas2.boundingBox())!;
    await expectPixel(canvas2, Math.round(box2.width / 2), Math.round(box2.height / 2), [0, 0, 255], 40);
    expect(saved).toMatch(/^data:image\/png;base64,/);
  });
});
