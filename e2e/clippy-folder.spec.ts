import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

// E2E 7: Clippy folder creation (Requirement 15.10). Runs against Mock_Gemini (MOCK_GEMINI=1).

async function openApp(page: Page, title: string) {
  await page.locator('.desktop-icon', { hasText: title }).focus();
  await page.keyboard.press('Enter');
  const win = page.getByRole('dialog', { name: title });
  await expect(win).toBeVisible();
  return win;
}

/** True when a node with this name and type exists in the VFS IndexedDB. */
function storedFolderExists(page: Page, name: string): Promise<boolean> {
  return page.evaluate(
    (n) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('win98-ai-vfs');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('nodes').objectStore('nodes').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            const nodes = req.result as Array<{ id: string; parentId: string | null; name: string; kind: string }>;
            const docs = nodes.find((x) => x.name === 'My Documents' && x.kind === 'folder');
            resolve(nodes.some((x) => x.name === n && x.kind === 'folder' && !!docs && x.parentId === docs.id));
          };
        };
      }),
    name,
  );
}

test.describe('E2E 7: Clippy folder creation', () => {
  test('creates AI Research in My Documents, shows it in Explorer and lets CMD cd into it', async ({ page }) => {
    await freshDesktop(page);

    // Ask Clippy.
    const chat = page.getByTestId('clippy-chat');
    if (!(await chat.isVisible())) await page.getByTestId('clippy-agent').click();
    await expect(chat).toBeVisible();
    await page.getByTestId('clippy-input').fill('Create a folder called AI Research in My Documents');
    await page.getByTestId('clippy-send').click();

    // The tool step succeeded and Clippy reports back.
    const step = chat.getByTestId('clippy-step').first();
    await expect(step).toContainText('create_folder');
    await expect(step).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
    await expect(chat.getByTestId('clippy-message').last()).toContainText('AI Research');

    // The folder exists in the VFS.
    await expect.poll(() => storedFolderExists(page, 'AI Research')).toBe(true);

    // It appears in Explorer under My Documents.
    const explorer = await openApp(page, 'File Explorer');
    await explorer.getByRole('option', { name: /My Documents/ }).dblclick();
    await expect(explorer.getByRole('option', { name: /AI Research/ })).toBeVisible();

    // cd works in CMD.
    const cmd = await openApp(page, 'Command Prompt');
    const term = cmd.locator('.xterm');
    await expect(term).toContainText('C:\\>');
    await term.click();
    await page.keyboard.type('cd "C:\\My Documents\\AI Research"');
    await page.keyboard.press('Enter');
    await expect(term).toContainText('C:\\My Documents\\AI Research>');
  });
});
