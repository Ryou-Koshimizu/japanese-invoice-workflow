import type { InvoiceData } from './invoice';

export type ExportRow = {
  data: InvoiceData;
  account: string;
};

/** Cells starting with these can run as formulas in spreadsheet software. */
const FORMULA = /^[=+\-@\t\r]/;
function cell(value: string | number | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvHeader = [
  '取引日',
  '借方勘定科目',
  '借方金額',
  '借方税区分',
  '貸方勘定科目',
  '貸方金額',
  '取引先',
  '登録番号',
  '請求書番号',
  '摘要',
];

/**
 * Journal entries per invoice: one debit line per tax rate (tax-inclusive),
 * credited to 未払金, plus 未払金 / 預り金 for withholding tax.
 */
export function journalRows(r: ExportRow): (string | number | null)[][] {
  const d = r.data;
  const memo = d.lineItems[0]?.description ?? '';
  const common = [d.vendorName, d.registrationNumber, d.invoiceNumber];
  const rows = d.taxBreakdown.map((t) => {
    const gross = d.amountBasis === 'excluding' ? t.base + t.tax : t.base;
    return [
      d.issueDate,
      r.account,
      gross,
      t.rate === 8 ? '課対仕入8%（軽）' : '課対仕入10%',
      '未払金',
      gross,
      ...common,
      memo,
    ];
  });
  if (d.withholdingTax > 0)
    rows.push([
      d.issueDate,
      '未払金',
      d.withholdingTax,
      '対象外',
      '預り金',
      d.withholdingTax,
      ...common,
      '源泉所得税',
    ]);
  return rows;
}

/** UTF-8 with BOM so Excel opens Japanese text correctly. */
export function toCsv(rows: ExportRow[]): string {
  const lines = [csvHeader, ...rows.flatMap(journalRows)].map((r) =>
    r.map(cell).join(','),
  );
  return '﻿' + lines.join('\r\n') + '\r\n';
}
