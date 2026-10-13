import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scoreCase, summarize, compareField } from '../src/eval/compare';
import { fixtureProvider } from '../src/adapters/fixture';
import { toInvoiceData, type InvoiceData } from '../src/core/invoice';

const manifest = JSON.parse(readFileSync('eval/cases.json', 'utf8'));

it('scores tolerant text fields and strict numbers', () => {
  const t: InvoiceData = manifest.cases[0].truth;
  expect(
    compareField(
      'vendorName',
      { ...t, vendorName: t.vendorName!.replace('株式会社', '株式会社 ') },
      t,
    ),
  ).toBe(true);
  expect(
    compareField(
      'recipientName',
      { ...t, recipientName: `${t.recipientName} 御中` },
      t,
    ),
  ).toBe(true);
  expect(
    compareField('totalAmount', { ...t, totalAmount: t.totalAmount! + 1 }, t),
  ).toBe(false);
  expect(
    compareField(
      'taxBreakdown',
      { ...t, taxBreakdown: [...t.taxBreakdown].reverse() },
      t,
    ),
  ).toBe(true);
});

it('runs the eval pipeline end to end on the demo fixtures (pipeline check, not AI accuracy)', async () => {
  const provider = fixtureProvider();
  const results = [];
  for (const c of manifest.cases) {
    const bytes = new Uint8Array(
      readFileSync(`eval/invoices/${c.files.pdf ?? c.files.image}`),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { value, usage } = await provider.extract({
      bytes,
      mediaType: 'application/pdf',
      sha256,
      name: 'x',
    });
    results.push(
      scoreCase(
        c,
        toInvoiceData(value),
        { elapsedMs: 0, usage },
        manifest.referenceDate,
      ),
    );
  }
  const s = summarize(results);
  // The fixtures equal the truth except one deliberately misread number (inv-29).
  expect(s.fullyCorrectRate).toBeCloseTo(39 / 40);
  expect(results.find((r) => !r.fullyCorrect)?.id).toBe('inv-29');
  expect(s.seededMistakesDetected).toBe(1);
});
