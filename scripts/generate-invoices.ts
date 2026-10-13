// Renders the fictional eval invoices to PDF and PNG with Chromium.
// Output is committed, so running this is only needed to change the set.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCases } from './invoice-data';
import { renderInvoice } from './render-invoice';
import { validateInvoice } from '../src/core/rules';

const out = resolve('eval/invoices');
const tmp = resolve('.captures/invoice-html');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await mkdir(tmp, { recursive: true });
const fontCss = pathToFileURL(
  resolve('node_modules/@fontsource/noto-sans-jp/index.css'),
).href;
const fontBold = pathToFileURL(
  resolve('node_modules/@fontsource/noto-sans-jp/700.css'),
).href;

const cases = buildCases();
// Every seeded mistake must be caught by the rules on the printed values.
for (const c of cases) {
  const codes = validateInvoice(c.truth, { today: '2026-10-14' }).map(
    (i) => i.code,
  );
  for (const expected of c.expectedIssues)
    if (!codes.includes(expected))
      throw new Error(`${c.id}: ${expected} not raised`);
  if (
    c.group !== 'error' &&
    codes.some((code) => !['REG_CHECK_DIGIT'].includes(code))
  )
    throw new Error(`${c.id}: unexpected issues ${codes.join(',')}`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
});
const manifest = [];
try {
  for (const c of cases) {
    const html = renderInvoice(c, fontCss).replace(
      '</head>',
      `<link rel="stylesheet" href="${fontBold}"></head>`,
    );
    const htmlPath = join(tmp, `${c.id}.html`);
    await writeFile(htmlPath, html);
    const page = await browser.newPage({
      viewport: { width: 794, height: 1123 },
      deviceScaleFactor: c.scanLike ? 1 : 1.5,
    });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => document.fonts.ready);
    const files: Record<string, string> = {};
    if (!c.scanLike) {
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      await writeFile(join(out, `${c.id}.pdf`), pdf);
      files.pdf = `${c.id}.pdf`;
    }
    const png = await page.screenshot({
      fullPage: false,
      type: c.scanLike ? 'jpeg' : 'png',
      quality: c.scanLike ? 55 : undefined,
    });
    const imageName = `${c.id}.${c.scanLike ? 'jpg' : 'png'}`;
    await writeFile(join(out, imageName), png);
    files.image = imageName;
    await page.close();
    manifest.push({
      id: c.id,
      group: c.group,
      template: c.template,
      dateStyle: c.dateStyle,
      scanLike: c.scanLike,
      note: c.note,
      files,
      expectedIssues: c.expectedIssues,
      truth: c.truth,
    });
  }
} finally {
  await browser.close();
}
const json =
  JSON.stringify({ referenceDate: '2026-10-14', cases: manifest }, null, 2) +
  '\n';
await writeFile(resolve('eval/cases.json'), json);
console.log(
  `Generated ${manifest.length} invoices. cases.json sha256=${createHash('sha256').update(json).digest('hex')}`,
);
