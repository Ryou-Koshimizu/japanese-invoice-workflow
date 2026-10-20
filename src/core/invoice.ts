import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .describe('YYYY-MM-DD');
const yen = z.number().int().describe('Japanese yen, integer');
const rate = z.union([z.literal(10), z.literal(8)]);

export const fieldNames = [
  'vendorName',
  'registrationNumber',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'recipientName',
  'taxBreakdown',
  'withholdingTax',
  'totalAmount',
  'lineItems',
] as const;
export type FieldName = (typeof fieldNames)[number];

/** Structured data extracted from one invoice (by AI or corrected by a person). */
export const invoiceDataSchema = z.object({
  vendorName: z.string().max(200).nullable().describe('Issuer (seller) name'),
  registrationNumber: z
    .string()
    .max(20)
    .nullable()
    .describe(
      'Qualified invoice registration number as printed, e.g. T1234567890123',
    ),
  invoiceNumber: z.string().max(60).nullable(),
  issueDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  recipientName: z
    .string()
    .max(200)
    .nullable()
    .describe('Addressee (buyer) name'),
  amountBasis: z
    .enum(['excluding', 'including'])
    .describe(
      'Whether the per-rate amounts are printed excluding or including tax',
    ),
  taxBreakdown: z
    .array(
      z.object({
        rate,
        base: yen.describe(
          'Amount for this tax rate as printed (see amountBasis)',
        ),
        tax: yen.describe('Consumption tax for this rate as printed'),
      }),
    )
    .max(2),
  withholdingTax: yen.nonnegative().describe('源泉徴収税額, 0 if none'),
  totalAmount: yen.nullable().describe('Amount requested (ご請求金額)'),
  lineItems: z
    .array(
      z.object({
        description: z.string().max(200),
        amount: yen.describe('Line amount on the same basis as amountBasis'),
        taxRate: rate,
      }),
    )
    .max(60),
});
export type InvoiceData = z.infer<typeof invoiceDataSchema>;

/** What an extraction provider returns: data plus the model's own doubts. */
export const extractionSchema = invoiceDataSchema.extend({
  uncertain: z
    .array(
      z.object({
        field: z.enum(fieldNames),
        reason: z.string().max(200),
      }),
    )
    .max(20)
    .describe('Fields that were hard to read or ambiguous'),
  accountHint: z
    .string()
    .max(30)
    .nullable()
    .describe('Suggested Japanese account title (勘定科目) or null'),
});
export type Extraction = z.infer<typeof extractionSchema>;

export type Severity = 'error' | 'warning';
export type Issue = {
  code: string;
  severity: Severity;
  field: FieldName | 'document';
  message: string;
};

export type Usage = { inputTokens: number; outputTokens: number };
export type InvoiceFile = {
  bytes: Uint8Array;
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg';
  sha256: string;
  name: string;
};

export type ExtractOptions = {
  /**
   * Asked before any extra upstream AI call (a retry or a re-read). Returns
   * false when the per-invoice read limit is used up.
   */
  anotherCall?: () => Promise<boolean>;
};

export interface ExtractionProvider {
  readonly id: string;
  extract(
    file: InvoiceFile,
    signal?: AbortSignal,
    options?: ExtractOptions,
  ): Promise<{ value: Extraction; usage: Usage }>;
}

export const statuses = [
  'uploaded',
  'reviewing',
  'submitted',
  'approved',
  'rejected',
  'exported',
] as const;
export type Status = (typeof statuses)[number];
export type Role = 'member' | 'approver' | 'admin';

export const statusLabels: Record<Status, string> = {
  uploaded: '抽出待ち',
  reviewing: '確認中',
  submitted: '承認待ち',
  approved: '承認済み',
  rejected: '差し戻し',
  exported: '出力済み',
};
export const roleLabels: Record<Role, string> = {
  member: '担当者',
  approver: '承認者',
  admin: '管理者',
};
export const fieldLabels: Record<FieldName, string> = {
  vendorName: '発行者',
  registrationNumber: '登録番号',
  invoiceNumber: '請求書番号',
  issueDate: '請求日',
  dueDate: '支払期日',
  recipientName: '宛名',
  taxBreakdown: '税率別の金額',
  withholdingTax: '源泉徴収税額',
  totalAmount: '請求金額',
  lineItems: '明細',
};

/** Strip model-only fields to get the data a person reviews and edits. */
export function toInvoiceData(e: Extraction): InvoiceData {
  const { uncertain: _u, accountHint: _a, ...data } = e;
  return invoiceDataSchema.parse(data);
}
