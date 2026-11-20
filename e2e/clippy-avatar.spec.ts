import { expect, test } from '@playwright/test';
import { freshDesktop } from './helpers';

// Bug condition exploration (clippy-avatar-instead-of-button, Property 1).
// Validates: Requirements 2.1, 2.2, 2.3. Fails on unfixed code, passes once the agent is placed in view.

const TASKBAR_H = 28;
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

test.describe('Clippy avatar is visible (bug condition)', () => {
  for (const vp of VIEWPORTS) {
    test(`agent is in view, bottom-right, uncovered at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);

      const assetStatus: Record<string, number> = {};
      page.on('response', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/clippy/')) assetStatus[u.pathname] = r.status();
      });

      await freshDesktop(page);
      const agent = page.getByTestId('clippy-agent');
      await agent.waitFor({ state: 'attached', timeout: 15_000 });

      // Assets load, so the bug condition's agentAssetsLoad holds (rules out asset failure).
      for (const f of ['agent.json', 'map.png', 'sounds.json']) {
        expect([200, 304], f).toContain(assetStatus[`/clippy/${f}`]); // 304 = served from revalidated cache
      }

      const info = await agent.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
          zIndex: getComputedStyle(el).zIndex,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          covered: !(hit === el || el.contains(hit)),
          hitClass: hit ? `${hit.tagName}.${(hit as HTMLElement).className}` : null,
        };
      });
      console.log(`[${vp.width}x${vp.height}]`, JSON.stringify(info));

      const { rect } = info;
      expect(rect.top, 'top >= 0').toBeGreaterThanOrEqual(0);
      expect(rect.left, 'left >= 0').toBeGreaterThanOrEqual(0);
      expect(rect.right, 'right <= innerWidth').toBeLessThanOrEqual(info.innerWidth);
      expect(rect.bottom, 'bottom <= innerHeight - taskbar').toBeLessThanOrEqual(info.innerHeight - TASKBAR_H);
      expect(rect.left, 'bottom-right area').toBeGreaterThan(info.innerWidth / 2);
      expect(rect.top, 'bottom-right area').toBeGreaterThan(info.innerHeight / 2);
      expect(info.covered, `covered by ${info.hitClass}`).toBe(false);
      await expect(page.getByTestId('clippy-toggle')).toHaveCount(0);
    });
  }
});

test.describe('Clippy fallback button', () => {
  test('shows clippy-toggle and opens the chat when agent.json cannot load', async ({ page }) => {
    await page.route('**/clippy/agent.json', (route) => route.abort());
    await freshDesktop(page);
    const toggle = page.getByTestId('clippy-toggle');
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('clippy-agent')).toHaveCount(0);
    const chat = page.getByTestId('clippy-chat');
    if (!(await chat.isVisible())) await toggle.click();
    await expect(chat).toBeVisible();
  });
});
