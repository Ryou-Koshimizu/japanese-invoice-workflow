import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  corporateCheckDigit,
  expectedWithholding,
  validateInvoice,
  taxWithinRounding,
} from '../src/core/rules';
import type { InvoiceData } from '../src/core/invoice';
import type { RuleContext } from '../src/core/rules';

const cases: {
  id: string;
  group: string;
  expectedIssues: string[];
  truth: InvoiceData;
}[] = JSON.parse(readFileSync('eval/cases.json', 'utf8')).cases;
const ctx = { today: '2026-10-14' };
const base: InvoiceData = {
  vendorName: '株式会社テスト',
  registrationNumber: 'T7000012050002',
  invoiceNumber: 'A-1',
  issueDate: '2026-09-30',
  dueDate: '2026-10-31',
  recipientName: '株式会社サンプル商事',
  amountBasis: 'excluding',
  taxBreakdown: [{ rate: 10, base: 10000, tax: 1000 }],
  withholdingTax: 0,
  totalAmount: 11000,
  lineItems: [{ description: '作業費', amount: 10000, taxRate: 10 }],
};
const codes = (d: Partial<InvoiceData>, c: RuleContext = ctx) =>
  validateInvoice({ ...base, ...d }, c).map((i) => i.code);

describe('registration number', () => {
  it('computes the corporate check digit (国税庁 7000012050002)', () => {
    expect(corporateCheckDigit('000012050002')).toBe(7);
  });
  it('rejects a wrong length as an error and a wrong check digit as a warning', () => {
    expect(codes({ registrationNumber: 'T700001205000' })).toContain(
      'REG_FORMAT',
    );
    expect(codes({ registrationNumber: 'T8000012050002' })).toContain(
      'REG_CHECK_DIGIT',
    );
    expect(codes({})).toEqual([]);
  });
  it('applies the corporate check digit only to corporations', () => {
    const wrong = 'T8000012050002';
    for (const vendorName of [
      '株式会社テスト',
      'テスト（株）',
      '一般社団法人テスト',
      'NPO法人テスト',
    ])
      expect(
        codes({ vendorName, registrationNumber: wrong }),
        vendorName,
      ).toContain('REG_CHECK_DIGIT');
    for (const vendorName of ['デザイン事務所 佐々木葵', '翻訳 田中結衣'])
      expect(
        codes({ vendorName, registrationNumber: wrong }),
        vendorName,
      ).toEqual([]);
  });
});

describe('tax and totals', () => {
  it('accepts floor, ceil and round per rate and nothing else', () => {
    expect(taxWithinRounding(87, 87.4)).toBe(true);
    expect(taxWithinRounding(88, 87.4)).toBe(true);
    expect(taxWithinRounding(86, 87.4)).toBe(false);
    expect(
      codes({
        taxBreakdown: [{ rate: 10, base: 10005, tax: 1001 }],
        totalAmount: 11006,
        lineItems: [{ description: 'x', amount: 10005, taxRate: 10 }],
      }),
    ).toEqual([]);
    expect(
      codes({
        taxBreakdown: [{ rate: 10, base: 10000, tax: 1100 }],
        totalAmount: 11100,
      }),
    ).toContain('TAX_CALC');
  });
  it('handles tax-inclusive amounts', () => {
    expect(
      codes({
        amountBasis: 'including',
        taxBreakdown: [{ rate: 8, base: 10800, tax: 800 }],
        totalAmount: 10800,
        lineItems: [{ description: '※ 食品', amount: 10800, taxRate: 8 }],
      }),
    ).toEqual([]);
  });
  it('detects totals that do not add up and duplicated rates', () => {
    expect(codes({ totalAmount: 12000 })).toContain('TOTAL_MISMATCH');
    expect(
      codes({
        taxBreakdown: [
          { rate: 10, base: 5000, tax: 500 },
          { rate: 10, base: 5000, tax: 500 },
        ],
      }),
    ).toContain('TAX_RATE_DUPLICATE');
    expect(codes({ totalAmount: null })).toContain('TOTAL_MISSING');
  });
  it('warns when line items do not match the per-rate amount', () => {
    expect(
      codes({ lineItems: [{ description: 'x', amount: 9000, taxRate: 10 }] }),
    ).toContain('LINES_MISMATCH');
  });
});

describe('withholding', () => {
  it('uses 10.21% up to 1,000,000 yen and 20.42% above', () => {
    expect(expectedWithholding(100000)).toBe(10210);
    expect(expectedWithholding(1000000)).toBe(102100);
    expect(expectedWithholding(1200000)).toBe(142940);
  });
  it('checks the printed withholding against the tax-excluded amount', () => {
    const fee = { withholdingTax: 1021, totalAmount: 11000 - 1021 };
    expect(codes(fee)).toEqual([]);
    expect(codes({ withholdingTax: 1000, totalAmount: 10000 })).toContain(
      'WITHHOLDING',
    );
  });
});

describe('dates, qualified invoice items and duplicates', () => {
  it('flags due before issue, future and very old invoices', () => {
    expect(codes({ dueDate: '2026-09-01' })).toContain('DUE_BEFORE_ISSUE');
    expect(codes({ issueDate: '2026-12-01', dueDate: '2026-12-31' })).toContain(
      'ISSUE_FUTURE',
    );
    expect(codes({ issueDate: '2025-09-01' })).toContain('ISSUE_OLD');
  });
  it('lists missing qualified-invoice items', () => {
    const issues = validateInvoice(
      { ...base, registrationNumber: null, recipientName: null },
      ctx,
    );
    expect(issues.find((i) => i.code === 'QUALIFIED_ITEMS')?.message).toMatch(
      /登録番号、宛名/,
    );
  });
  it('raises an error for a duplicate', () => {
    expect(codes({}, { ...ctx, duplicateOf: 'x' })).toContain('DUPLICATE');
  });
});

describe('eval set', () => {
  it('has 40 invoices in the planned groups', () => {
    const count = (g: string) => cases.filter((c) => c.group === g).length;
    expect([
      count('standard'),
      count('reduced'),
      count('withholding'),
      count('hard'),
      count('error'),
    ]).toEqual([12, 10, 6, 6, 6]);
  });
  it('catches every seeded mistake from the printed values (no AI involved)', () => {
    for (const c of cases.filter((x) => x.group === 'error')) {
      const found = validateInvoice(c.truth, ctx).map((i) => i.code);
      for (const e of c.expectedIssues) expect(found, c.id).toContain(e);
    }
  });
  it('raises nothing on the clean invoices and only the seeded mistake on the others', () => {
    for (const c of cases) {
      const found = validateInvoice(c.truth, ctx).map((i) => i.code);
      expect(found.sort(), c.id).toEqual([...c.expectedIssues].sort());
    }
  });
});
