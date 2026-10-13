import { describe, it, expect } from 'vitest';
import { crossCheckWithText, normalizeText } from '../src/core/crosscheck';
import { toCsv, journalRows } from '../src/core/csv';
import { suggestAccount } from '../src/core/accounts';
import { can } from '../src/core/workflow';
import { reviewIssues } from '../src/core/review';
import type { InvoiceData } from '../src/core/invoice';

const d: InvoiceData = {
  vendorName: '=HYPERLINK("x")',
  registrationNumber: 'T7000012050002',
  invoiceNumber: 'INV-1',
  issueDate: '2026-09-30',
  dueDate: '2026-10-31',
  recipientName: '株式会社サンプル商事',
  amountBasis: 'excluding',
  taxBreakdown: [
    { rate: 10, base: 10000, tax: 1000 },
    { rate: 8, base: 5000, tax: 400 },
  ],
  withholdingTax: 0,
  totalAmount: 16400,
  lineItems: [
    { description: 'クラウドサーバー利用料', amount: 10000, taxRate: 10 },
    { description: '※ お弁当', amount: 5000, taxRate: 8 },
  ],
};

describe('cross-check against the PDF text layer', () => {
  const text =
    '請求書 登録番号 T7000012050002 請求書番号 INV-1 請求日 令和8年9月30日 ご請求金額 ¥16,400';
  it('accepts values that appear in the document, in any date style', () => {
    expect(normalizeText('１６，４００ 円')).toBe('16400円');
    expect(crossCheckWithText(d, text)).toEqual([]);
  });
  it('flags values the model may have invented', () => {
    const fields = crossCheckWithText(
      { ...d, totalAmount: 16500, invoiceNumber: 'INV-9' },
      text,
    ).map((i) => i.field);
    expect(fields).toEqual(['invoiceNumber', 'totalAmount']);
  });
  it('skips documents without a text layer', () => {
    expect(crossCheckWithText(d, '')).toEqual([]);
  });
});

describe('journal CSV', () => {
  it('writes one line per tax rate plus withholding, with BOM and CRLF', () => {
    const csv = toCsv([
      { data: { ...d, vendorName: '株式会社テスト' }, account: '消耗品費' },
    ]);
    expect(csv.startsWith('﻿取引日,')).toBe(true);
    expect(csv).toContain('2026-09-30,消耗品費,11000,課対仕入10%,未払金,11000');
    expect(csv).toContain('5400,課対仕入8%（軽）');
    const fee = journalRows({
      data: { ...d, withholdingTax: 1021 },
      account: '支払報酬',
    });
    expect(fee.at(-1)?.slice(1, 6)).toEqual([
      '未払金',
      1021,
      '対象外',
      '預り金',
      1021,
    ]);
  });
  it('neutralizes spreadsheet formulas in text cells', () => {
    expect(toCsv([{ data: d, account: '雑費' }])).toContain(
      `"'=HYPERLINK(""x"")"`,
    );
  });
});

describe('account suggestion', () => {
  it('prefers the vendor master, then keywords, then the AI hint', () => {
    expect(suggestAccount(d, { vendorAccount: '通信費' })).toEqual({
      account: '通信費',
      source: 'vendor',
    });
    expect(suggestAccount(d).account).toBe('通信費');
    expect(
      suggestAccount(
        {
          ...d,
          lineItems: [{ description: '謎の品', amount: 1, taxRate: 10 }],
        },
        { aiHint: '会議費' },
      ),
    ).toEqual({ account: '会議費', source: 'ai' });
    expect(suggestAccount({ ...d, withholdingTax: 1 }).account).toBe(
      '支払報酬',
    );
  });
});

describe('workflow permissions', () => {
  const member = { userId: 'm', role: 'member' as const };
  const approver = { userId: 'a', role: 'approver' as const };
  it('lets only another approver decide, and only admins export', () => {
    expect(
      can('approve', member, { status: 'submitted', submittedBy: 'x' }).ok,
    ).toBe(false);
    expect(
      can('approve', approver, { status: 'submitted', submittedBy: 'a' }).ok,
    ).toBe(false);
    expect(
      can('approve', approver, { status: 'submitted', submittedBy: 'x' }).ok,
    ).toBe(true);
    expect(
      can('export', approver, { status: 'approved', submittedBy: 'x' }).ok,
    ).toBe(false);
    expect(
      can('edit', member, { status: 'exported', submittedBy: 'x' }).ok,
    ).toBe(false);
  });
});

describe('review issues', () => {
  it('shows model uncertainty until a person confirms', () => {
    const uncertain = [{ field: 'totalAmount' as const, reason: 'かすれ' }];
    expect(
      reviewIssues({ data: d, ctx: { today: '2026-10-14' }, uncertain }).map(
        (i) => i.code,
      ),
    ).toEqual(['AI_UNCERTAIN']);
  });
});
