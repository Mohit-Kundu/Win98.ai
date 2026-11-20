import { expect, test } from '@playwright/test';
import { freshDesktop } from './helpers';

// Requirement 15.9: WordPad AI rewrite shows a preview; reject leaves the document unchanged;
// accept replaces only the selected paragraph.

const P1 = 'First paragraph stays put.';
const P2 = 'Second paragraph gets rewritten.';
const P3 = 'Third paragraph also stays put.';

test('WordPad AI rewrite: preview, reject keeps text, accept changes only the selection', async ({ page }) => {
  await freshDesktop(page);
  await page.getByRole('button', { name: 'WordPad', exact: true }).first().dblclick();

  const wp = page.locator('.wordpad');
  const editor = wp.getByRole('textbox', { name: 'Document' });
  await editor.click();
  await page.keyboard.type(P1);
  await page.keyboard.press('Enter');
  await page.keyboard.type(P2);
  await page.keyboard.press('Enter');
  await page.keyboard.type(P3);

  const paragraphs = editor.locator('p');
  await expect(paragraphs).toHaveText([P1, P2, P3]);

  const preview = wp.getByRole('region', { name: 'AI preview' });

  const rewriteSelected = async (): Promise<void> => {
    await paragraphs.nth(1).click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await wp.getByRole('button', { name: 'AI', exact: true }).click();
    await wp.getByRole('menuitem', { name: 'Rewrite' }).click();
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('replaces the selection');
    await expect(preview.getByLabel('Original text')).toHaveText(P2);
    await expect(preview.getByLabel('AI result')).toHaveText(`[rewritten] ${P2}`);
  };

  // Reject: document unchanged
  await rewriteSelected();
  await preview.getByRole('button', { name: 'Reject' }).click();
  await expect(preview).toHaveCount(0);
  await expect(paragraphs).toHaveText([P1, P2, P3]);

  // Accept: only the selected paragraph changes
  await rewriteSelected();
  await preview.getByRole('button', { name: 'Accept' }).click();
  await expect(preview).toHaveCount(0);
  await expect(paragraphs).toHaveText([P1, `[rewritten] ${P2}`, P3]);
});
