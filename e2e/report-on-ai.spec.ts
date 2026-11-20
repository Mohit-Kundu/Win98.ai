import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshDesktop } from './helpers';

// E2E 8: Report on AI demo (Requirements 13.1-13.6, 15.11, 12.8). Runs against Mock_Gemini (MOCK_GEMINI=1)
// with the script tests/fixtures/scripts/report-on-ai.json.

const DOC = 'Report on AI.wpd';
const IMG = 'data-center.png';
const SECTIONS = ['History of LLMs', 'How LLMs Work', 'Applications', 'Implications', 'Data Centers'];

interface StoredNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  content?: unknown;
}

async function readNodes(page: Page): Promise<StoredNode[]> {
  return page.evaluate(
    () =>
      new Promise<StoredNode[]>((resolve, reject) => {
        const open = indexedDB.open('win98-ai-vfs');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('nodes').objectStore('nodes').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(req.result as StoredNode[]);
          };
        };
      }),
  );
}

async function expectDocumentContent(page: Page): Promise<void> {
  const wordpad = page.getByRole('dialog', { name: 'WordPad' });
  await expect(wordpad).toBeVisible();
  await expect(wordpad.getByRole('status')).toContainText(DOC);
  const editor = wordpad.getByRole('textbox', { name: 'Document' });
  await expect(editor.locator('h1')).toHaveText('Report on AI');
  const headings = editor.locator('h2');
  await expect(headings).toHaveCount(SECTIONS.length);
  for (let i = 0; i < SECTIONS.length; i++) await expect(headings.nth(i)).toHaveText(SECTIONS[i]!);
  // Section bodies exist.
  await expect(editor).toContainText('transformer');
  await expect(editor).toContainText('attention');
  await expect(editor).toContainText('code generation');
  await expect(editor).toContainText('productivity');
  await expect(editor).toContainText('electricity');
  // The image sits in the Data Centers section: after that heading, and nowhere before it.
  const img = editor.locator('.wp-image img');
  await expect(img).toHaveCount(1);
  await expect(img).toBeVisible();
  const placement = await editor.evaluate((el) => {
    const heading = Array.from(el.querySelectorAll('h2')).find((h) => h.textContent?.trim() === 'Data Centers');
    const image = el.querySelector('.wp-image');
    if (!heading || !image) return 'missing';
    return heading.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
  });
  expect(placement).toBe('after');
  // The image loaded for real (not a broken or missing placeholder).
  await expect(editor.locator('.wp-image-missing')).toHaveCount(0);
  await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

async function openFromExplorer(page: Page, folder: string, file: RegExp): Promise<void> {
  await page.locator('.desktop-icon', { hasText: 'File Explorer' }).dblclick();
  const explorer = page.getByRole('dialog', { name: 'File Explorer', exact: true });
  await explorer.getByRole('tree', { name: 'Folders' }).getByRole('button', { name: folder, exact: true }).click();
  await explorer.getByRole('option', { name: file }).dblclick();
}

test.describe('E2E 8: Report on AI demo', () => {
  test('Clippy writes the report, adds the image, saves it, opens it, and it persists after refresh', async ({ page }) => {
    test.setTimeout(90_000);
    await freshDesktop(page);

    // Ask Clippy.
    await page.getByTestId('clippy-toggle').click();
    const chat = page.getByTestId('clippy-chat');
    await expect(chat).toBeVisible();
    await chat.getByTestId('clippy-input').fill(
      'Write a report on AI with sections on the history of LLMs, how LLMs work, applications, implications, and data centers. Add an image of a data center to the data centers section.',
    );
    await chat.getByTestId('clippy-send').click();

    // Every step succeeds, in order, and Clippy reports the saved location.
    const reply = chat.locator('[data-testid="clippy-message"][data-role="assistant"]');
    await expect(reply).toHaveCount(1, { timeout: 45_000 });
    const steps = reply.getByTestId('clippy-step');
    await expect(steps).toHaveCount(4);
    for (const [i, tool] of ['create_document', 'generate_image', 'insert_image_into_document', 'open_file'].entries()) {
      await expect(steps.nth(i)).toContainText(tool);
      await expect(steps.nth(i)).toHaveAttribute('data-status', 'ok');
    }
    await expect(reply).toContainText(`C:\\My Documents\\${DOC}`);
    await expect(reply).toContainText(`C:\\My Pictures\\${IMG}`);
    await expect(reply).toContainText('open in WordPad');

    // The document is open in WordPad with all five sections and the image.
    await expectDocumentContent(page);

    // The document and the image are saved in the VFS under the reported folders.
    const nodes = await readNodes(page);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const parentName = (n: StoredNode) => (n.parentId ? byId.get(n.parentId)?.name : undefined);
    const doc = nodes.find((n) => n.name === DOC);
    const img = nodes.find((n) => n.name === IMG);
    expect(doc).toBeTruthy();
    expect(img).toBeTruthy();
    expect(parentName(doc!)).toBe('My Documents');
    expect(parentName(img!)).toBe('My Pictures');

    // Close WordPad and refresh. Nothing resets storage.
    await page.reload();
    await expect(page.locator('.desktop-icon', { hasText: 'File Explorer' })).toBeVisible();
    const afterReload = await readNodes(page);
    expect(afterReload.some((n) => n.name === DOC && parentName(n) === 'My Documents')).toBe(true);
    expect(afterReload.some((n) => n.name === IMG)).toBe(true);

    // Reopen from Explorer if the window did not survive the refresh; either way, verify the content.
    if ((await page.getByRole('dialog', { name: 'WordPad' }).count()) === 0) {
      await openFromExplorer(page, 'My Documents', /Report on AI\.wpd/);
    }
    await expectDocumentContent(page);
  });

  test('a PDF preview iframe is fully sandboxed', async ({ page }) => {
    await freshDesktop(page);
    await page.locator('.desktop-icon', { hasText: 'File Explorer' }).dblclick();
    const explorer = page.getByRole('dialog', { name: 'File Explorer', exact: true });
    await expect(explorer).toBeVisible();

    const pdf =
      '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
      'trailer<</Root 1 0 R/Size 4>>\n%%EOF\n';
    await page.setInputFiles('input[aria-label="Upload file"]', {
      name: 'sample.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdf, 'latin1'),
    });
    const option = explorer.getByRole('option', { name: /sample\.pdf/ });
    await expect(option).toBeVisible();
    await option.dblclick();

    const frame = page.locator('iframe[title$="preview"]');
    await expect(frame).toHaveCount(1, { timeout: 20_000 });
    // An empty sandbox attribute means every restriction applies (no scripts, no same-origin).
    await expect(frame).toHaveAttribute('sandbox', '');
  });
});
