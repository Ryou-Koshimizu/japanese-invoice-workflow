import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

async function loginAs(page: Page, who: RegExp) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByRole('button', { name: who }).click();
  await page.waitForURL('/');
}
const a11y = async (page: Page) =>
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
      .violations,
  ).toEqual([]);

test.describe.configure({ mode: 'serial' });

test('担当者が誤った税額を修正して承認依頼し、承認者が承認し、管理者がCSVを出力する', async ({
  page,
}) => {
  await loginAs(page, /佐藤 美咲/);
  await a11y(page);
  await page.getByRole('link', { name: '株式会社アオバ通信' }).click();
  const issues = page.getByRole('list', { name: '検証で見つかった問題' });
  await expect(issues).toContainText(
    '10%の消費税額が18,668円ですが、計算上は18,568円',
  );
  await expect(issues).toContainText('請求金額は204,248円');
  await expect(
    page.getByText('エラーが2件あるため承認依頼できません'),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: /請求書の原本 inv-35\.pdf 1ページ目/ }),
  ).toBeVisible();
  await a11y(page);

  await page.getByLabel('10%の消費税額').fill('18568');
  await page.getByRole('button', { name: '保存して再検証' }).click();
  await expect(
    page.getByText(
      'インボイス制度の記載事項と計算に問題は見つかりませんでした',
    ),
  ).toBeVisible();
  await expect(page.getByText('AIの値から修正')).toBeVisible();
  await page.getByRole('button', { name: '承認を依頼する' }).click();
  await expect(
    page.getByText('承認待ち', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText('自分が承認依頼した請求書は判断できません。')
      .or(page.getByText('承認者または管理者の操作です。')),
  ).toBeVisible();

  await loginAs(page, /鈴木 健/);
  await page.getByRole('link', { name: '株式会社アオバ通信' }).click();
  await page.getByRole('button', { name: '承認する' }).click();
  await expect(
    page.getByText('承認済み', { exact: true }).first(),
  ).toBeVisible();
  const timeline = page.getByRole('list').filter({ hasText: '内容を修正' });
  await expect(timeline).toContainText('税率別の金額');

  await loginAs(page, /高橋 由紀/);
  await page.getByRole('link', { name: '仕訳CSV出力' }).click();
  await expect(
    page.getByRole('link', { name: '株式会社アオバ通信' }),
  ).toBeVisible();
  page.once('dialog', (d) => d.accept());
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /件をCSV出力/ }).click();
  const csv = await (await download).createReadStream();
  const text = await new Promise<string>((resolve) => {
    let s = '';
    csv.on('data', (c) => (s += c));
    csv.on('end', () => resolve(s));
  });
  expect(text).toContain('取引日,借方勘定科目,借方金額');
  expect(text).toContain('株式会社アオバ通信');
  await expect(
    page.getByText('出力待ちの承認済み請求書はありません。'),
  ).toBeVisible();
  await page.getByRole('link', { name: '監査ログ' }).click();
  await expect(
    page.getByRole('cell', { name: 'CSVを出力' }).first(),
  ).toBeVisible();
  await a11y(page);
});

test('サンプルをアップロードすると読み取りと検証が走り、疑わしい値が強調される', async ({
  page,
}) => {
  await loginAs(page, /佐藤 美咲/);
  await page.getByRole('link', { name: 'アップロード', exact: true }).click();
  await page
    .locator('.sample')
    .filter({ hasText: '読み取りにくい画像' })
    .getByRole('button', { name: /試す|サンプルを登録/ })
    .click();
  await page.waitForURL(/\/invoices\//);
  await expect(
    page.getByRole('list', { name: '検証で見つかった問題' }),
  ).toContainText('AIが登録番号の読み取りに自信がありません');
  await expect(
    page.locator('.field.has-warning #registrationNumber'),
  ).toBeVisible();
});

test('権限のない操作はAPIでも拒否される', async ({ page }) => {
  await loginAs(page, /佐藤 美咲/);
  const exportAsMember = await page.request.post('/api/export', {
    headers: { origin: 'http://127.0.0.1:3012' },
  });
  expect(exportAsMember.status()).toBe(403);
  const crossSite = await page.request.post('/api/export', {
    headers: { origin: 'https://evil.example' },
  });
  expect(crossSite.status()).toBe(403);
  const anonymous = await page.request.get(
    '/api/invoices/00000000-0000-0000-0000-000000000000/file',
    {
      headers: { cookie: '' },
    },
  );
  expect([401, 404]).toContain(anonymous.status());
  await page.goto('/audit');
  await expect(page).toHaveURL('/');
});

test('スマホ幅で横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, /佐藤 美咲/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole('link', { name: '北斗フードサービス株式会社' }).click();
  await expect(page.getByRole('heading', { name: '検証結果' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
