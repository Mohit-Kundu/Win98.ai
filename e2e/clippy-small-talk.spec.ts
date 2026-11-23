import { expect, test } from '@playwright/test';
import { freshDesktop } from './helpers';

// SmallTalk Clippy replies: small talk is answered locally (no AI call, no tool steps).

test.describe('E2E: Clippy Small talk replies', () => {
  test('answers hi, who are you and what can you do instantly, without steps or a Working state', async ({ page }) => {
    await freshDesktop(page);

    const chat = page.getByTestId('clippy-chat');
    if (!(await chat.isVisible())) await page.getByTestId('clippy-agent').click();
    await expect(chat).toBeVisible();

    // Fail the test if any message reaches the AI.
    let chatCalls = 0;
    await page.route('**/api/chat', (route) => {
      chatCalls++;
      return route.continue();
    });

    const replies = chat.locator('[data-testid="clippy-message"][data-role="assistant"]');
    const prompts = ['hi', 'who are you', 'what can you do?'];
    for (const [i, prompt] of prompts.entries()) {
      await chat.getByTestId('clippy-input').fill(prompt);
      await chat.getByTestId('clippy-send').click();
      await expect(replies).toHaveCount(i + 1, { timeout: 2_000 });
      await expect(replies.nth(i)).not.toBeEmpty();
    }

    await expect(chat.getByTestId('clippy-step')).toHaveCount(0);
    await expect(chat.getByTestId('clippy-running')).toHaveCount(0);
    await expect(chat.getByTestId('clippy-report')).toHaveCount(0);
    await expect(replies.nth(1)).toContainText('Clippy');
    await expect(replies.nth(2)).toContainText('Create a folder called Projects in My Documents');
    expect(chatCalls).toBe(0);
  });
});
