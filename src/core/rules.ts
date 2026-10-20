import type { InvoiceData, Issue } from './invoice';

/**
 * Check digit of a 13-digit corporate number (法人番号).
 * The first digit is 9 - (Σ Pn×Qn mod 9) over the remaining 12 digits,
 * where n counts from the rightmost digit and Qn is 1 for odd n, 2 for even n.
 */
export function corporateCheckDigit(base12: string): number {
  let sum = 0;
  for (let n = 1; n <= 12; n++) {
    const digit = Number(base12[12 - n]);
    sum += digit * (n % 2 === 1 ? 1 : 2);
  }
  return 9 - (sum % 9);
}

/**
 * A corporation's registration number is "T" + its corporate number, which
 * always carries a valid check digit. A sole proprietor's number is assigned
 * separately, so the check digit only applies when the issuer is a corporation.
 */
const corporateForm =
  /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|医療法人|社会福祉法人|学校法人|宗教法人|弁護士法人|税理士法人|監査法人|司法書士法人|行政書士法人|社会保険労務士法人|[(（]株[)）]|[(（]有[)）]|[(（]同[)）]|㈱|㈲)/;
export const isCorporateName = (name: string | null) =>
  !!name && corporateForm.test(name.normalize('NFKC').replace(/\s/g, ''));

/** Withholding tax on fees paid to individuals (所得税及び復興特別所得税). */
export function expectedWithholding(base: number): number {
  return base <= 1_000_000
    ? Math.floor(base * 0.1021)
    : Math.floor((base - 1_000_000) * 0.2042) + 102_100;
}

/** Tax that a printed amount implies, before the invoice's own rounding. */
export function impliedTax(
  base: number,
  rate: number,
  basis: 'excluding' | 'including',
) {
  return basis === 'excluding'
    ? (base * rate) / 100
    : (base * rate) / (100 + rate);
}

/** One rounding per rate per invoice: floor, ceil and round are all lawful. */
export function taxWithinRounding(tax: number, exact: number) {
  return tax === Math.floor(exact) || tax === Math.ceil(exact);
}

export type RuleContext = {
  /** Today's date in Japan (YYYY-MM-DD). */
  today: string;
  /** Another invoice in the same org with the same number, vendor and total. */
  duplicateOf?: string;
};

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const days = (a: string, b: string) =>
  (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

export function validateInvoice(d: InvoiceData, ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const add = (
    code: string,
    severity: Issue['severity'],
    field: Issue['field'],
    message: string,
  ) => issues.push({ code, severity, field, message });

  // Registration number (登録番号)
  if (d.registrationNumber) {
    const reg = d.registrationNumber.replace(/[\s-]/g, '');
    if (!/^T\d{13}$/.test(reg)) {
      add(
        'REG_FORMAT',
        'error',
        'registrationNumber',
        '登録番号は「T」と数字13桁です。',
      );
    } else if (
      isCorporateName(d.vendorName) &&
      corporateCheckDigit(reg.slice(2)) !== Number(reg[1])
    ) {
      add(
        'REG_CHECK_DIGIT',
        'warning',
        'registrationNumber',
        '法人の登録番号（T＋法人番号）の検査数字と一致しません。読み取り誤りの可能性があります。',
      );
    }
  }

  // Required items of a qualified invoice (適格請求書の記載事項)
  const missing = [
    !d.vendorName && '発行者名',
    !d.registrationNumber && '登録番号',
    !d.issueDate && '取引日（請求日）',
    !d.lineItems.length && '取引内容',
    !d.taxBreakdown.length && '税率ごとの対価と税率',
    !d.recipientName && '宛名',
  ].filter(Boolean);
  if (missing.length)
    add(
      'QUALIFIED_ITEMS',
      'warning',
      'document',
      `適格請求書の記載事項が不足しています：${missing.join('、')}。仕入税額控除の要件を満たさない可能性があります。`,
    );

  // Tax per rate
  const rates = new Set<number>();
  for (const t of d.taxBreakdown) {
    if (rates.has(t.rate))
      add(
        'TAX_RATE_DUPLICATE',
        'error',
        'taxBreakdown',
        `${t.rate}%の行が重複しています。`,
      );
    rates.add(t.rate);
    const exact = impliedTax(t.base, t.rate, d.amountBasis);
    if (!taxWithinRounding(t.tax, exact))
      add(
        'TAX_CALC',
        'error',
        'taxBreakdown',
        `${t.rate}%の消費税額が${yen(t.tax)}ですが、計算上は${yen(Math.floor(exact))}〜${yen(Math.ceil(exact))}です。`,
      );
  }

  // Totals
  if (d.totalAmount === null) {
    add(
      'TOTAL_MISSING',
      'error',
      'totalAmount',
      '請求金額が読み取れていません。',
    );
  } else if (d.taxBreakdown.length) {
    const sum = d.taxBreakdown.reduce(
      (s, t) => s + t.base + (d.amountBasis === 'excluding' ? t.tax : 0),
      0,
    );
    const expected = sum - d.withholdingTax;
    if (expected !== d.totalAmount)
      add(
        'TOTAL_MISMATCH',
        'error',
        'totalAmount',
        `税率別の合計${d.withholdingTax ? 'から源泉徴収額を引いた額' : ''}は${yen(expected)}ですが、請求金額は${yen(d.totalAmount)}です。`,
      );
  }
  if (!d.taxBreakdown.length)
    add(
      'TAX_MISSING',
      'error',
      'taxBreakdown',
      '税率ごとの金額が読み取れていません。',
    );

  // Line items against per-rate amounts
  if (d.lineItems.length)
    for (const t of d.taxBreakdown) {
      const lines = d.lineItems
        .filter((l) => l.taxRate === t.rate)
        .reduce((s, l) => s + l.amount, 0);
      if (lines !== t.base)
        add(
          'LINES_MISMATCH',
          'warning',
          'lineItems',
          `${t.rate}%の明細の合計${yen(lines)}が、税率別の金額${yen(t.base)}と一致しません。`,
        );
    }

  // Withholding
  if (d.withholdingTax > 0) {
    const taxExcluded = d.taxBreakdown.reduce(
      (s, t) => s + t.base - (d.amountBasis === 'including' ? t.tax : 0),
      0,
    );
    const expected = expectedWithholding(taxExcluded);
    if (expected !== d.withholdingTax)
      add(
        'WITHHOLDING',
        'warning',
        'withholdingTax',
        `税抜${yen(taxExcluded)}に対する源泉徴収額は${yen(expected)}ですが、${yen(d.withholdingTax)}と記載されています。`,
      );
  }

  // Dates
  if (d.issueDate) {
    if (days(ctx.today, d.issueDate) > 0)
      add('ISSUE_FUTURE', 'warning', 'issueDate', '請求日が未来の日付です。');
    else if (days(d.issueDate, ctx.today) > 365)
      add(
        'ISSUE_OLD',
        'warning',
        'issueDate',
        '請求日が1年以上前です。計上時期を確認してください。',
      );
  }
  if (d.issueDate && d.dueDate && days(d.issueDate, d.dueDate) < 0)
    add(
      'DUE_BEFORE_ISSUE',
      'warning',
      'dueDate',
      '支払期日が請求日より前です。',
    );

  if (ctx.duplicateOf)
    add(
      'DUPLICATE',
      'error',
      'document',
      '同じ登録番号・請求書番号・金額の請求書が既に登録されています。二重計上の可能性があります。',
    );

  return issues;
}

export const hasErrors = (issues: Issue[]) =>
  issues.some((i) => i.severity === 'error');
