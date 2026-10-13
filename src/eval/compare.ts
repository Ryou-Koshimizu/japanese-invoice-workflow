import type { InvoiceData } from '../core/invoice';
import { validateInvoice } from '../core/rules';

export const scoredFields = [
  'vendorName',
  'registrationNumber',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'recipientName',
  'amountBasis',
  'taxBreakdown',
  'withholdingTax',
  'totalAmount',
  'lineItems',
] as const;
export type ScoredField = (typeof scoredFields)[number];

/** Fields that must all be right for the invoice to count as fully correct. */
export const requiredFields: ScoredField[] = [
  'vendorName',
  'registrationNumber',
  'invoiceNumber',
  'issueDate',
  'taxBreakdown',
  'withholdingTax',
  'totalAmount',
];

const norm = (s: string | null) =>
  (s ?? '')
    .normalize('NFKC')
    .replace(/[\s　・,，、.。\-‐－ー]/g, '')
    .replace(/(御中|様)$/, '');

function sameTax(
  a: InvoiceData['taxBreakdown'],
  b: InvoiceData['taxBreakdown'],
) {
  const key = (x: InvoiceData['taxBreakdown']) =>
    [...x]
      .sort((p, q) => p.rate - q.rate)
      .map((t) => `${t.rate}:${t.base}:${t.tax}`)
      .join('|');
  return key(a) === key(b);
}
function sameLines(a: InvoiceData['lineItems'], b: InvoiceData['lineItems']) {
  const key = (x: InvoiceData['lineItems']) =>
    x
      .map((l) => `${l.taxRate}:${l.amount}`)
      .sort()
      .join('|');
  return a.length === b.length && key(a) === key(b);
}

export function compareField(
  f: ScoredField,
  got: InvoiceData,
  want: InvoiceData,
): boolean {
  switch (f) {
    case 'vendorName':
    case 'recipientName':
      return norm(got[f]) === norm(want[f]);
    case 'registrationNumber':
    case 'invoiceNumber':
      return (
        (got[f] ?? '').normalize('NFKC').replace(/[\s-]/g, '') ===
        (want[f] ?? '').normalize('NFKC').replace(/[\s-]/g, '')
      );
    case 'taxBreakdown':
      return sameTax(got.taxBreakdown, want.taxBreakdown);
    case 'lineItems':
      return sameLines(got.lineItems, want.lineItems);
    default:
      return got[f] === want[f];
  }
}

export type CaseResult = {
  id: string;
  group: string;
  fields: Record<ScoredField, boolean>;
  fullyCorrect: boolean;
  /** For seeded-mistake invoices: were all expected issues raised on the AI output? */
  detected: boolean | null;
  elapsedMs: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
};

export function scoreCase(
  c: {
    id: string;
    group: string;
    truth: InvoiceData;
    expectedIssues: string[];
  },
  got: InvoiceData | null,
  meta: {
    elapsedMs: number;
    usage: { inputTokens: number; outputTokens: number };
    error?: string;
  },
  today: string,
): CaseResult {
  const fields = Object.fromEntries(
    scoredFields.map((f) => [f, got ? compareField(f, got, c.truth) : false]),
  ) as Record<ScoredField, boolean>;
  const found = got ? validateInvoice(got, { today }).map((i) => i.code) : [];
  return {
    id: c.id,
    group: c.group,
    fields,
    fullyCorrect: requiredFields.every((f) => fields[f]),
    detected: c.expectedIssues.length
      ? c.expectedIssues.every((e) => found.includes(e))
      : null,
    ...meta,
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(results: CaseResult[]) {
  const ok = results.filter((r) => !r.error);
  const rate = (xs: boolean[]) =>
    xs.length ? xs.filter(Boolean).length / xs.length : null;
  const groups = [...new Set(results.map((r) => r.group))];
  return {
    cases: results.length,
    failedCalls: results.length - ok.length,
    fieldAccuracy: Object.fromEntries(
      scoredFields.map((f) => [f, rate(results.map((r) => r.fields[f]))]),
    ),
    fullyCorrectRate: rate(results.map((r) => r.fullyCorrect)),
    byGroup: Object.fromEntries(
      groups.map((g) => [
        g,
        rate(results.filter((r) => r.group === g).map((r) => r.fullyCorrect)),
      ]),
    ),
    seededMistakesDetected: rate(
      results.filter((r) => r.detected !== null).map((r) => r.detected!),
    ),
    medianMs: median(ok.map((r) => r.elapsedMs)),
    meanMs: ok.length
      ? ok.reduce((s, r) => s + r.elapsedMs, 0) / ok.length
      : null,
    tokens: {
      input: results.reduce((s, r) => s + r.usage.inputTokens, 0),
      output: results.reduce((s, r) => s + r.usage.outputTokens, 0),
    },
  };
}
