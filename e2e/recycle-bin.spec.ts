import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

const REFUSAL = 'System Applications cannot be deleted';

async function openApp(page: Page, title: string) {
  // Keyboard launch: open windows may cover the desktop icons, which would block a double-click.
  await page.locator('.desktop-icon', { hasText: title }).focus();
  await page.keyboard.press('Enter');
  const win = page.getByRole('dialog', { name: title });
  await expect(win).toBeVisible();
  return win;
}

test.describe('Recycle Bin', () => {
  test('deleted folders go to the bin and can be restored; applications cannot be deleted', async ({ page }) => {
    await freshDesktop(page);

    // Deleting an application from the desktop is refused.
    await page.locator('.desktop-icon', { hasText: 'Paint' }).focus();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('alert')).toHaveText(REFUSAL);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Create a folder in Explorer, then delete it.
    const explorer = await openApp(page, 'File Explorer');
    await explorer.getByRole('button', { name: 'New Folder' }).click();
    await page.getByLabel('Folder name:').fill('Doomed');
    await page.getByRole('button', { name: 'OK' }).click();
    const row = explorer.getByRole('option', { name: /Doomed/ });
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm Delete' });
    await expect(confirm).toContainText('Recycle Bin');
    await confirm.getByRole('button', { name: 'Yes' }).click();
    await expect(row).toHaveCount(0);
    // The bin folder itself is not browsable from Explorer.
    await expect(explorer.getByRole('option', { name: /Recycle Bin/ })).toHaveCount(0);

    // The folder is in the Recycle Bin window.
    const bin = await openApp(page, 'Recycle Bin');
    const binRow = bin.getByRole('option', { name: /Doomed/ });
    await expect(binRow).toBeVisible();

    // Restore it and read where it went.
    await binRow.click();
    await bin.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('alert')).toContainText('restored to C:\\Doomed');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(bin.getByText('The Recycle Bin is empty.')).toBeVisible();
    await expect(explorer.getByRole('option', { name: /Doomed/ })).toBeVisible();
  });

  test('dragging an application onto the Recycle Bin is refused and the icon snaps back', async ({ page }) => {
    await freshDesktop(page);
    const paint = page.locator('.desktop-icon', { hasText: 'Paint' });
    const bin = page.locator('.desktop-icon', { hasText: 'Recycle Bin' });
    const before = await paint.boundingBox();
    const target = await bin.boundingBox();
    if (!before || !target) throw new Error('icons not visible');

    await page.mouse.move(before.x + before.width / 2, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByRole('alert')).toHaveText(REFUSAL);
    await page.getByRole('button', { name: 'OK' }).click();
    const after = await paint.boundingBox();
    expect(after).toEqual(before);
  });

  test('application shortcuts in Program Files cannot be deleted from Explorer', async ({ page }) => {
    await freshDesktop(page);
    const explorer = await openApp(page, 'File Explorer');
    await explorer.getByRole('option', { name: /Program Files/ }).dblclick();
    const shortcut = explorer.getByRole('option', { name: /Paint\.lnk/ });
    await expect(shortcut).toBeVisible();
    await shortcut.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Confirm Delete' }).getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByRole('dialog', { name: 'Explorer', exact: true })).toContainText(REFUSAL);
  });
});
