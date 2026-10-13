import type { InvoiceData, Issue } from './invoice';

/** NFKC, no whitespace or thousands separators: "１２，３４５ 円" -> "12345円". */
export const normalizeText = (s: string) =>
  s.normalize('NFKC').replace(/[\s,，、]/g, '');

const eraYear = (y: number) => y - 2018; // 令和1年 = 2019

function dateForms(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    `${y}年${m}月${d}日`,
    `${y}年${pad(m)}月${pad(d)}日`,
    `${y}/${m}/${d}`,
    `${y}/${pad(m)}/${pad(d)}`,
    `${y}-${pad(m)}-${pad(d)}`,
    `${y}.${pad(m)}.${pad(d)}`,
    `令和${eraYear(y)}年${m}月${d}日`,
  ];
}

/**
 * Guard against values the model may have invented: when the document has a
 * text layer (most digital PDFs), the key values must appear in it.
 * Images have no text layer, so this check is skipped for them.
 */
export function crossCheckWithText(d: InvoiceData, text: string): Issue[] {
  const t = normalizeText(text);
  if (t.length < 20) return [];
  const issues: Issue[] = [];
  const miss = (field: Issue['field'], label: string) =>
    issues.push({
      code: 'NOT_IN_SOURCE',
      severity: 'warning',
      field,
      message: `${label}がPDFの文字情報に見つかりません。原本と照合してください。`,
    });
  if (d.registrationNumber && !t.includes(normalizeText(d.registrationNumber)))
    miss('registrationNumber', '登録番号');
  if (d.invoiceNumber && !t.includes(normalizeText(d.invoiceNumber)))
    miss('invoiceNumber', '請求書番号');
  if (d.totalAmount !== null && !t.includes(String(d.totalAmount)))
    miss('totalAmount', '請求金額');
  if (d.issueDate && !dateForms(d.issueDate).some((f) => t.includes(f)))
    miss('issueDate', '請求日');
  return issues;
}
