import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

// E2E 4: AI file search (Requirement 15.7). Runs against Mock_Gemini (MOCK_GEMINI=1).

interface StoredMeta {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  aiStatus?: string;
}

/** Reads a file's metadata straight from the VFS IndexedDB, so it proves persistence rather than UI state. */
async function readStoredMeta(page: Page, name: string): Promise<StoredMeta | null> {
  return page.evaluate(
    (fileName) =>
      new Promise<StoredMeta | null>((resolve, reject) => {
        const open = indexedDB.open('win98-ai-vfs');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('nodes').objectStore('nodes').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            const node = (req.result as Array<{ name: string; meta: StoredMeta }>).find((n) => n.name === fileName);
            resolve(node ? node.meta : null);
          };
        };
      }),
    name,
  );
}

async function upload(page: Page, name: string, text: string): Promise<void> {
  await page.setInputFiles('input[aria-label="Upload file"]', {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
  });
  await expect(page.getByRole('option', { name: new RegExp(name.replace('.', '\\.')) })).toBeVisible();
}

test.describe('E2E 4: AI file search', () => {
  test('uploads a machine-learning document, persists AI_Metadata, finds it by natural language and opens it', async ({ page }) => {
    await freshDesktop(page);

    // Open File Explorer from the desktop.
    await page.getByRole('button', { name: 'File Explorer' }).dblclick();
    const explorer = page.getByRole('dialog', { name: 'File Explorer' });
    await expect(explorer).toBeVisible();

    // Upload a machine-learning document and an unrelated one.
    const mlText = 'Machine learning trains models on data. Neural networks are a common machine learning technique.';
    await upload(page, 'ml-notes.txt', mlText);
    await upload(page, 'pancake-recipe.txt', 'Mix flour, eggs and milk. Fry until golden.');

    // AI_Metadata is generated for the machine-learning document.
    await expect
      .poll(async () => (await readStoredMeta(page, 'ml-notes.txt'))?.aiStatus, { timeout: 15_000 })
      .toBe('ok');
    const meta = await readStoredMeta(page, 'ml-notes.txt');
    expect(meta?.title).toBeTruthy();
    expect(meta?.description?.toLowerCase()).toContain('machine learning');
    expect(meta?.category).toBeTruthy();
    expect(meta?.tags).toContain('machine learning');

    // The unrelated document does not get machine-learning metadata.
    await expect.poll(async () => (await readStoredMeta(page, 'pancake-recipe.txt'))?.aiStatus, { timeout: 15_000 }).toBe('ok');
    expect((await readStoredMeta(page, 'pancake-recipe.txt'))?.tags ?? []).not.toContain('machine learning');

    // AI_Metadata persists across a refresh.
    await page.reload();
    await expect.poll(async () => (await readStoredMeta(page, 'ml-notes.txt'))?.aiStatus).toBe('ok');
    expect(await readStoredMeta(page, 'ml-notes.txt')).toMatchObject({
      title: meta?.title,
      description: meta?.description,
      category: meta?.category,
      tags: meta?.tags,
    });

    // Search in natural language.
    await page.getByRole('button', { name: 'File Explorer' }).dblclick();
    const explorer2 = page.getByRole('dialog', { name: 'File Explorer' });
    await expect(explorer2).toBeVisible();
    await explorer2.getByRole('searchbox', { name: 'Search query' }).fill('the document about machine learning');
    await explorer2.getByRole('button', { name: 'Search', exact: true }).click();

    const results = explorer2.getByRole('list', { name: 'Search results' });
    await expect(results).toBeVisible();
    const hits = results.getByRole('listitem');
    await expect(hits).toHaveCount(1);
    await expect(hits.first()).toContainText('ml-notes.txt');
    await expect(results).not.toContainText('pancake-recipe.txt');

    // Open the result: it opens in WordPad with the document's content.
    await results.getByRole('button', { name: 'Open ml-notes.txt' }).click();
    const wordpad = page.getByRole('dialog', { name: 'WordPad' });
    await expect(wordpad).toBeVisible();
    await expect(wordpad.getByRole('status')).toContainText('ml-notes.txt');
    await expect(wordpad.getByRole('textbox', { name: 'Document' })).toContainText('Neural networks');
  });
});
