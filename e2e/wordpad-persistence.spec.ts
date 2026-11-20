import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

// Requirement 15.5: WordPad formatting persists through save, reopen via Explorer, and page refresh.

const FILE_NAME = 'persist.wpd';

async function launch(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).first().dblclick();
}

async function openFromExplorer(page: Page): Promise<void> {
  await launch(page, 'File Explorer');
  const explorer = page.locator('[data-testid^="window-"]').filter({ has: page.getByRole('tree', { name: 'Folders' }) });
  await explorer.getByRole('button', { name: 'My Documents', exact: true }).click();
  await expect(explorer.getByLabel('Current folder')).toContainText('My Documents');
  await explorer.getByRole('option', { name: new RegExp(FILE_NAME.replace('.', '\\.')) }).dblclick();
}

async function expectFormatting(page: Page): Promise<void> {
  const editor = page.getByRole('textbox', { name: 'Document' });
  await expect(editor.locator('h1')).toHaveText('Project Title');
  await expect(editor.locator('h2')).toHaveText('Section Heading');
  await expect(editor.locator('strong')).toHaveText('bold words');
  const items = editor.locator('ul > li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('first bullet');
  await expect(items.nth(1)).toHaveText('second bullet');
}

test('WordPad headings, bold, and bullets persist through save, Explorer reopen, and refresh', async ({ page }) => {
  await freshDesktop(page);
  await launch(page, 'WordPad');

  const wp = page.locator('.wordpad');
  const editor = wp.getByRole('textbox', { name: 'Document' });
  await editor.click();

  // Heading 1
  await wp.getByRole('button', { name: 'Heading 1' }).click();
  await page.keyboard.type('Project Title');
  await page.keyboard.press('Enter');

  // Heading 2
  await wp.getByRole('button', { name: 'Heading 2' }).click();
  await page.keyboard.type('Section Heading');
  await page.keyboard.press('Enter');

  // Bold text
  await wp.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('bold words');
  await wp.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.press('Enter');

  // Bullets
  await wp.getByRole('button', { name: 'Bullet list' }).click();
  await page.keyboard.type('first bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second bullet');

  await expectFormatting(page);

  // Save via File > Save As
  await wp.getByRole('menuitem', { name: 'File' }).or(wp.getByRole('button', { name: 'File', exact: true })).first().click();
  await wp.getByRole('menuitem', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save As' });
  await dialog.getByLabel('File name:').fill(`C:\\My Documents\\${FILE_NAME}`);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(wp.getByRole('status')).toContainText(FILE_NAME);
  await expect(wp.getByRole('status')).not.toContainText('*');

  // Close WordPad, reopen through Explorer
  await page.locator('[data-testid^="window-"]').filter({ has: wp }).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.wordpad')).toHaveCount(0);

  await openFromExplorer(page);
  await expect(page.locator('.wordpad').getByRole('status')).toContainText(FILE_NAME);
  await expectFormatting(page);

  // Refresh (no storage reset) and reopen again
  await page.reload();
  if ((await page.locator('.wordpad').count()) === 0) {
    await openFromExplorer(page);
  } else {
    // Window state survived the refresh; reopen via Explorer anyway if the document is not shown.
    if ((await page.getByRole('textbox', { name: 'Document' }).locator('h1').count()) === 0) await openFromExplorer(page);
  }
  await expect(page.locator('.wordpad').getByRole('status')).toContainText(FILE_NAME);
  await expectFormatting(page);
});
