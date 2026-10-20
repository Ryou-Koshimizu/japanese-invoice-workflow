import { expect, type Page, type Browser } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { DEMO_PASSWORD, demoUsers } from '../src/server/demo-seed';

export async function loginAs(page: Page, who: RegExp) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: who }).click();
  await page.waitForURL('/');
}

/**
 * Wait until every finite animation (entrances, count-ups, page transitions)
 * has finished, so checks see the settled screen. Endless decorative loops
 * (the floating background, the scanning light) are ignored.
 */
export async function settle(page: Page) {
  // Jump every finite animation to its end state instead of waiting it out
  // in real time (slow CI machines can take minutes otherwise). Frames in
  // between are checked separately in motion-a11y.spec.ts.
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming();
      if (a.playState === 'running' && t && t.iterations !== Infinity)
        a.finish();
    }
  });
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          (a) =>
            a.playState !== 'running' ||
            a.effect?.getComputedTiming().iterations === Infinity,
        ),
    undefined,
    { timeout: 15_000 },
  );
  // Count-ups run on requestAnimationFrame for about a second.
  await page.waitForTimeout(400);
}

export async function a11y(page: Page) {
  await settle(page);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);
}

/** Put the shared demo back to its seeded state through the admin API. */
export async function resetDemo(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL });
  const login = await ctx.request.post('/api/auth/login', {
    data: {
      email: demoUsers.find((u) => u.role === 'admin')!.email,
      password: DEMO_PASSWORD,
    },
    headers: { origin: baseURL },
  });
  expect(login.ok()).toBe(true);
  const reset = await ctx.request.post('/api/demo/reset', {
    headers: { origin: baseURL },
  });
  expect(reset.ok()).toBe(true);
  await ctx.close();
}
