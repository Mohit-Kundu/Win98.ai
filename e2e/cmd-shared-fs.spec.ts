import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

// Requirement 15.6: CMD and Explorer share one virtual filesystem.

async function openApp(page: Page, title: string) {
  // Keyboard launch: open windows may cover the desktop icons, which would block a double-click.
  await page.locator('.desktop-icon', { hasText: title }).focus();
  await page.keyboard.press('Enter');
  const win = page.getByRole('dialog', { name: title });
  await expect(win).toBeVisible();
  return win;
}

test.describe('CMD shared filesystem', () => {
  test('mkdir in CMD appears in Explorer; rename in Explorer shows in CMD dir', async ({ page }) => {
    await freshDesktop(page);

    const cmd = await openApp(page, 'Command Prompt');
    const term = cmd.locator('.xterm');
    await expect(term).toContainText('C:\\>');
    await cmd.locator('.xterm').click();
    await page.keyboard.type('mkdir Projects');
    await page.keyboard.press('Enter');
    await page.keyboard.type('dir');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('Projects');

    // Explorer shows the folder created from CMD.
    const explorer = await openApp(page, 'File Explorer');
    const row = explorer.getByRole('option', { name: /Projects/ });
    await expect(row).toBeVisible();

    // Rename it in Explorer via the context menu.
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const input = page.getByLabel('New name:');
    await input.fill('Work');
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(explorer.getByRole('option', { name: /Work/ })).toBeVisible();
    await expect(explorer.getByRole('option', { name: /Projects/ })).toHaveCount(0);

    // CMD dir reflects the new name. Bring CMD to the front via the taskbar (Explorer may cover it).
    await page.getByRole('toolbar', { name: 'Taskbar' }).getByRole('button', { name: 'Command Prompt' }).click();
    await cmd.getByRole('textbox', { name: 'Terminal input' }).focus();
    await page.keyboard.type('cls');
    await page.keyboard.press('Enter');
    await page.keyboard.type('dir');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('Work');
    await expect(term).not.toContainText('Projects');
  });
});
