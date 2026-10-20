import { test, expect, type Page } from '@playwright/test';
import { loginAs, resetDemo } from './helpers';

// Every screen size the app must fit (CSS px): folded phones, phones,
// landscape phones, tablets, laptops and large monitors.
const sizes: [number, number][] = [
  [280, 653],
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [393, 852],
  [412, 915],
  [430, 932],
  [568, 320],
  [667, 375],
  [844, 390],
  [932, 430],
  [600, 960],
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1024, 1366],
  [1180, 820],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

type Report = { problems: string[] };

/**
 * Layout checks run inside the page:
 * - no horizontal scroll;
 * - the header is exactly 80px and at the top;
 * - the given "first screen" elements sit fully between the header and the
 *   bottom of the viewport, and do not overlap one another;
 * - no visible text is cut off (an element narrower than its own text);
 * - the header's parts do not overlap.
 */
async function check(page: Page, firstScreen: string[]): Promise<Report> {
  return page.evaluate((firstScreen) => {
    const problems: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    if (doc.scrollWidth > vw)
      problems.push(`横スクロール ${doc.scrollWidth}px`);

    const header = document.querySelector('.topbar');
    const hr = header?.getBoundingClientRect();
    if (!hr || Math.round(hr.height) !== 80 || Math.round(hr.top) !== 0)
      problems.push(`ヘッダー ${hr?.top}/${hr?.height}`);

    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        st.visibility !== 'hidden' &&
        !el.closest('[aria-hidden="true"], .sr-only')
      );
    };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}「${(el.textContent ?? '').trim().slice(0, 16)}」`;

    const firsts: Element[] = [];
    for (const sel of firstScreen) {
      const els = [...document.querySelectorAll(sel)].filter(shown);
      if (!els.length) problems.push(`見当たらない ${sel}`);
      for (const el of els) {
        firsts.push(el);
        const r = el.getBoundingClientRect();
        if (
          r.top < 80 - 0.5 ||
          r.bottom > vh + 0.5 ||
          r.left < -0.5 ||
          r.right > vw + 0.5
        )
          problems.push(
            `最初の画面に収まらない ${name(el)} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} vh=${vh}`,
          );
      }
    }
    const overlap = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (let i = 0; i < firsts.length; i++)
      for (let j = i + 1; j < firsts.length; j++) {
        const a = firsts[i];
        const b = firsts[j];
        if (a.contains(b) || b.contains(a)) continue;
        if (overlap(a.getBoundingClientRect(), b.getBoundingClientRect()))
          problems.push(`重なり ${name(a)} × ${name(b)}`);
      }

    const parts = [
      ...document.querySelectorAll(
        '.topbar-inner > .brand, .topbar-inner > .menu-toggle, .menu-panel > .main-nav, .menu-panel > .who',
      ),
    ].filter(
      (el) =>
        shown(el) &&
        getComputedStyle(el.closest('.menu-panel') ?? el).position !== 'fixed',
    );
    const bar = document
      .querySelector('.topbar-inner')
      ?.getBoundingClientRect();
    for (let i = 0; i < parts.length; i++) {
      const r = parts[i].getBoundingClientRect();
      if (bar && (r.left < bar.left - 0.5 || r.right > bar.right + 0.5))
        problems.push(`ヘッダーからはみ出し ${name(parts[i])}`);
      for (let j = i + 1; j < parts.length; j++)
        if (overlap(r, parts[j].getBoundingClientRect()))
          problems.push(
            `ヘッダーで重なり ${name(parts[i])} × ${name(parts[j])}`,
          );
    }

    // Cut-off text: a block whose own text is wider than the block itself.
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el)) continue;
      const st = getComputedStyle(el);
      if (st.display === 'inline' || st.display === 'contents') continue;
      if (['auto', 'scroll'].includes(st.overflowX)) continue;
      if (el.closest('.scroll-x, .tabs, .img-wrap, .pebbles, svg, canvas'))
        continue;
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent!.trim(),
      );
      if (!ownText) continue;
      if (el.scrollWidth > el.clientWidth + 1)
        problems.push(
          `文字の欠け ${name(el)} ${el.scrollWidth}>${el.clientWidth}`,
        );
    }
    return { problems };
  }, firstScreen);
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser, baseURL }) => {
  await resetDemo(browser, baseURL!);
});
test.use({ reducedMotion: 'reduce' });

test('全25種の画面の大きさで、はみ出し・欠け・重なりがなく、主な操作が最初の画面に収まる', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const failures: string[] = [];
  const record = (where: string, r: Report) =>
    r.problems.forEach((p) => failures.push(`${where}: ${p}`));

  // The review screen of one invoice, found once.
  await loginAs(page, /高橋 由紀/);
  const reviewHref = await page
    .getByRole('link', { name: '株式会社アオバ通信' })
    .getAttribute('href');
  await page.context().clearCookies();

  for (const [w, h] of sizes) {
    const at = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });

    // The entrance is the hero: header + hero = exactly one screen.
    await page.context().clearCookies();
    await page.goto('/login');
    const hero = await page.evaluate(() => {
      const el = document.querySelector('.hero')!;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        height: Math.round(r.height),
        fits: el.scrollHeight <= el.clientHeight + 1,
        vh: window.innerHeight,
      };
    });
    if (hero.top !== 80 || hero.height !== hero.vh - 80)
      failures.push(`${at} login: ヒーローの高さ ${hero.top}/${hero.height}`);
    if (!hero.fits) failures.push(`${at} login: ヒーローの中身があふれる`);
    record(
      `${at} login`,
      await check(page, [
        '#hero-heading',
        '.hero .lead',
        '.demo-user',
        '.hero-links a',
      ]),
    );

    await page.getByRole('button', { name: /高橋 由紀/ }).click();
    await page.waitForURL('/');
    const screens: [string, string[]][] = [
      ['/', ['h1', '.page-head .btn.primary']],
      [reviewHref!, ['h1', '.check .panel-title h2']],
      ['/upload', ['h1', '.drop']],
      ['/export', ['h1', '.page-head .btn.primary']],
      ['/audit', ['h1', '.list th:first-child']],
      ['/settings', ['h1', '.plan-card h2']],
    ];
    for (const [path, firstScreen] of screens) {
      if (path !== '/') await page.goto(path);
      record(`${at} ${path}`, await check(page, firstScreen));
    }

    // Narrow screens fold the menu: every item fits once it is opened.
    const toggle = page.getByRole('button', { name: 'メニューを開く' });
    if (await toggle.isVisible()) {
      await toggle.click();
      record(
        `${at} menu`,
        await check(page, ['.main-nav a', '.menu-panel .who']),
      );
      await page.keyboard.press('Escape');
    }
  }
  expect(failures).toEqual([]);
});
