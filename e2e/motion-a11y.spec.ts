import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAs, resetDemo } from './helpers';

/**
 * The settled screen is checked elsewhere. Here axe runs again and again
 * while things are still moving (entrances, the looping showcase, the menu
 * sheet), so no frame of any animation may drop below WCAG AA contrast.
 */
async function contrastWhileMoving(page: Page, where: string, samples = 10) {
  const found: string[] = [];
  for (let n = 0; n < samples; n++) {
    const r = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    for (const v of r.violations)
      for (const node of v.nodes)
        found.push(`${where} #${n}: ${node.target.join(' ')}`);
    await page.waitForTimeout(170);
  }
  return found;
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser, baseURL }) => {
  await resetDemo(browser, baseURL!);
});

test('動きの途中のどの瞬間もコントラスト違反0件（入口・一覧・確認画面・メニュー）', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const found: string[] = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().clearCookies();
  // The showcase loops every 6 s; sample across a whole loop.
  await page.goto('/login');
  found.push(...(await contrastWhileMoving(page, 'login', 24)));

  await loginAs(page, /佐藤 美咲/);
  found.push(...(await contrastWhileMoving(page, 'inbox')));
  await page.getByRole('link', { name: '株式会社アオバ通信' }).click();
  await page.waitForURL(/\/invoices\//);
  found.push(...(await contrastWhileMoving(page, 'review')));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  found.push(...(await contrastWhileMoving(page, 'menu', 6)));
  expect(found).toEqual([]);
});
