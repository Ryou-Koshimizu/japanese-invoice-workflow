import { crossCheckWithText } from './crosscheck';
import {
  fieldLabels,
  type Extraction,
  type InvoiceData,
  type Issue,
} from './invoice';
import { validateInvoice, type RuleContext } from './rules';

export type ReviewInput = {
  data: InvoiceData;
  ctx: RuleContext;
  /** Text layer of the original PDF; empty for images. */
  documentText?: string;
  /** Fields the model flagged; cleared once a person saves the form. */
  uncertain?: Extraction['uncertain'];
};

/** Every issue shown on the review screen, in one deterministic list. */
export function reviewIssues(input: ReviewInput): Issue[] {
  const uncertain: Issue[] = (input.uncertain ?? []).map((u) => ({
    code: 'AI_UNCERTAIN',
    severity: 'warning',
    field: u.field,
    message: `AIが${fieldLabels[u.field]}の読み取りに自信がありません：${u.reason}`,
  }));
  return [
    ...validateInvoice(input.data, input.ctx),
    ...(input.documentText
      ? crossCheckWithText(input.data, input.documentText)
      : []),
    ...uncertain,
  ];
}
