import {
  extractionSchema,
  invoiceDataSchema,
  toInvoiceData,
  type Extraction,
  type ExtractionProvider,
  type InvoiceData,
  type Issue,
  type Role,
  type Status,
  type Usage,
} from '../core/invoice';
import { hasErrors } from '../core/rules';
import { reviewIssues } from '../core/review';
import { suggestAccount, accounts } from '../core/accounts';
import { can, type Action } from '../core/workflow';
import { toCsv } from '../core/csv';
import { asUser, AppError, type Database, type Sql } from './db';
import type { Session } from './auth';
import { inspectUpload, pdfText } from './files';

export type Deps = {
  db: Database;
  provider: ExtractionProvider;
  /** Today's date in Japan, YYYY-MM-DD. Injected so tests and the demo are stable. */
  today: () => string;
};

export type ExtractionMeta = {
  provider?: string;
  usage?: Usage;
  elapsedMs?: number;
  uncertain?: Extraction['uncertain'];
  confirmed?: boolean;
  documentText?: string;
  accountSource?: string;
  error?: string;
};

export type InvoiceRow = {
  id: string;
  status: Status;
  file_name: string;
  file_type: string;
  file_size: number;
  data: InvoiceData | null;
  ai_data: InvoiceData | null;
  issues: Issue[];
  account: string | null;
  warning_note: string | null;
  reject_reason: string | null;
  extraction_meta: ExtractionMeta | null;
  uploaded_by: string;
  submitted_by: string | null;
  approved_by: string | null;
  uploader_name: string;
  submitter_name: string | null;
  approver_name: string | null;
  created_at: string;
  updated_at: string;
};

const ctx = (s: Session) => ({ userId: s.userId, orgId: s.orgId });

async function load(tx: Sql, id: string): Promise<InvoiceRow> {
  if (!/^[0-9a-f-]{36}$/.test(id))
    throw new AppError(404, '請求書が見つかりません。');
  const r = await tx.query<InvoiceRow>(
    `SELECT i.id, i.status, i.file_name, i.file_type, i.file_size, i.data, i.ai_data,
            i.issues, i.account, i.warning_note, i.reject_reason, i.extraction_meta,
            i.uploaded_by, i.submitted_by, i.approved_by,
            u.name AS uploader_name, s.name AS submitter_name, a.name AS approver_name,
            i.created_at, i.updated_at
       FROM app.invoices i
       JOIN app.users u ON u.id = i.uploaded_by
       LEFT JOIN app.users s ON s.id = i.submitted_by
       LEFT JOIN app.users a ON a.id = i.approved_by
      WHERE i.id = $1`,
    [id],
  );
  if (!r.rows[0]) throw new AppError(404, '請求書が見つかりません。');
  return r.rows[0];
}

function ensure(action: Action, s: Session, inv: InvoiceRow) {
  const verdict = can(
    action,
    { userId: s.userId, role: s.role },
    {
      status: inv.status,
      submittedBy: inv.submitted_by,
    },
  );
  if (!verdict.ok) throw new AppError(403, verdict.reason, 'FORBIDDEN');
}

async function duplicateOf(tx: Sql, id: string, d: InvoiceData) {
  if (!d.registrationNumber || !d.invoiceNumber || d.totalAmount === null)
    return undefined;
  const r = await tx.query<{ id: string }>(
    `SELECT id FROM app.invoices
      WHERE id <> $1 AND registration_number = $2 AND invoice_number = $3 AND total_amount = $4
      LIMIT 1`,
    [id, d.registrationNumber, d.invoiceNumber, d.totalAmount],
  );
  return r.rows[0]?.id;
}

async function computeIssues(
  tx: Sql,
  deps: Deps,
  id: string,
  d: InvoiceData,
  meta: ExtractionMeta,
) {
  return reviewIssues({
    data: d,
    ctx: { today: deps.today(), duplicateOf: await duplicateOf(tx, id, d) },
    documentText: meta.documentText,
    uncertain: meta.confirmed ? [] : meta.uncertain,
  });
}

export async function uploadInvoice(
  deps: Deps,
  s: Session,
  name: string,
  bytes: Uint8Array,
) {
  const file = await inspectUpload(name, bytes);
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO app.invoices (org_id, file_name, file_type, file_size, file_sha256, uploaded_by)
       VALUES (app.current_org_id(), $1, $2, $3, $4, app.current_user_id()) RETURNING id`,
      [file.name, file.mediaType, file.bytes.length, file.sha256],
    );
    await tx.query(
      `INSERT INTO app.invoice_files (invoice_id, org_id, content) VALUES ($1, app.current_org_id(), $2)`,
      [r.rows[0].id, Buffer.from(file.bytes)],
    );
    return r.rows[0].id;
  });
}

export async function getFile(deps: Deps, s: Session, id: string) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    const r = await tx.query<{ content: Uint8Array }>(
      'SELECT content FROM app.invoice_files WHERE invoice_id = $1',
      [id],
    );
    if (!r.rows[0]) throw new AppError(404, 'ファイルが見つかりません。');
    return {
      bytes: new Uint8Array(r.rows[0].content),
      type: inv.file_type,
      name: inv.file_name,
    };
  });
}

/** Run AI extraction, then the deterministic checks, and move to review. */
export async function extractInvoice(
  deps: Deps,
  s: Session,
  id: string,
  signal?: AbortSignal,
) {
  const { inv, file } = await asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    ensure('extract', s, inv);
    const f = await tx.query<{ content: Uint8Array }>(
      'SELECT content FROM app.invoice_files WHERE invoice_id = $1',
      [id],
    );
    return { inv, file: new Uint8Array(f.rows[0].content) };
  });

  const started = Date.now();
  let extraction: Extraction;
  let usage: Usage;
  try {
    const { createHash } = await import('node:crypto');
    const out = await deps.provider.extract(
      {
        bytes: file,
        mediaType: inv.file_type as never,
        sha256: createHash('sha256').update(file).digest('hex'),
        name: inv.file_name,
      },
      signal,
    );
    extraction = extractionSchema.parse(out.value);
    usage = out.usage;
  } catch (e) {
    const message =
      e instanceof AppError
        ? e.message
        : 'AIによる読み取りに失敗しました。時間をおいて再実行するか、手入力してください。';
    await asUser(deps.db, ctx(s), (tx) =>
      tx.query(
        `UPDATE app.invoices SET extraction_meta = $2, updated_at = now() WHERE id = $1`,
        [
          id,
          JSON.stringify({
            provider: deps.provider.id,
            error: message,
          } satisfies ExtractionMeta),
        ],
      ),
    );
    throw e instanceof AppError
      ? e
      : new AppError(502, message, 'EXTRACTION_FAILED');
  }

  const data = toInvoiceData(extraction);
  const documentText =
    inv.file_type === 'application/pdf'
      ? await pdfText(file).catch(() => '')
      : '';
  return asUser(deps.db, ctx(s), async (tx) => {
    const vendor = data.registrationNumber
      ? await tx.query<{ account: string }>(
          'SELECT account FROM app.vendor_accounts WHERE registration_number = $1',
          [data.registrationNumber],
        )
      : { rows: [] };
    const suggestion = suggestAccount(data, {
      vendorAccount: vendor.rows[0]?.account,
      aiHint: extraction.accountHint,
    });
    const meta: ExtractionMeta = {
      provider: deps.provider.id,
      usage,
      elapsedMs: Date.now() - started,
      uncertain: extraction.uncertain,
      confirmed: false,
      documentText,
      accountSource: suggestion.source,
    };
    const issues = await computeIssues(tx, deps, id, data, meta);
    await tx.query(
      `UPDATE app.invoices
          SET status = 'reviewing', data = $2, ai_data = $2, issues = $3, account = $4,
              extraction_meta = $5, registration_number = $6, invoice_number = $7,
              total_amount = $8, updated_at = now()
        WHERE id = $1`,
      [
        id,
        JSON.stringify(data),
        JSON.stringify(issues),
        suggestion.account,
        JSON.stringify(meta),
        data.registrationNumber,
        data.invoiceNumber,
        data.totalAmount,
      ],
    );
    return { issues, data };
  });
}

/** Save the reviewer's corrections; saving also confirms uncertain fields. */
export async function saveInvoice(
  deps: Deps,
  s: Session,
  id: string,
  input: { data: unknown; account: unknown },
) {
  const data = invoiceDataSchema.safeParse(input.data);
  if (!data.success)
    throw new AppError(422, '入力の形式が正しくありません。', 'INVALID');
  if (
    typeof input.account !== 'string' ||
    !(accounts as readonly string[]).includes(input.account)
  )
    throw new AppError(422, '勘定科目を選んでください。', 'INVALID');
  return asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    ensure('edit', s, inv);
    const meta: ExtractionMeta = {
      ...(inv.extraction_meta ?? {}),
      confirmed: true,
    };
    const issues = await computeIssues(tx, deps, id, data.data, meta);
    await tx.query(
      `UPDATE app.invoices
          SET status = 'reviewing', data = $2, issues = $3, account = $4, extraction_meta = $5,
              registration_number = $6, invoice_number = $7, total_amount = $8, updated_at = now()
        WHERE id = $1`,
      [
        id,
        JSON.stringify(data.data),
        JSON.stringify(issues),
        input.account,
        JSON.stringify(meta),
        data.data.registrationNumber,
        data.data.invoiceNumber,
        data.data.totalAmount,
      ],
    );
    return issues;
  });
}

export async function submitInvoice(
  deps: Deps,
  s: Session,
  id: string,
  warningNote: string,
) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    ensure('submit', s, inv);
    if (!inv.data)
      throw new AppError(409, '先にAIで読み取るか、内容を入力してください。');
    // Re-check at submission time: a duplicate may have appeared since review.
    const issues = await computeIssues(
      tx,
      deps,
      id,
      inv.data,
      inv.extraction_meta ?? {},
    );
    if (hasErrors(issues))
      throw new AppError(
        409,
        'エラーを解消してから承認依頼してください。',
        'HAS_ERRORS',
      );
    const note = warningNote.trim().slice(0, 500);
    if (issues.length && !note)
      throw new AppError(
        409,
        '警告を確認した理由を入力してください。',
        'NOTE_REQUIRED',
      );
    await tx.query(
      `UPDATE app.invoices SET status = 'submitted', issues = $2, warning_note = $3,
              submitted_by = app.current_user_id(), reject_reason = NULL, updated_at = now()
        WHERE id = $1`,
      [id, JSON.stringify(issues), note || null],
    );
  });
}

export async function decideInvoice(
  deps: Deps,
  s: Session,
  id: string,
  decision: 'approve' | 'reject',
  reason = '',
) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    ensure(decision, s, inv);
    if (decision === 'approve') {
      await tx.query(
        `UPDATE app.invoices SET status = 'approved', approved_by = app.current_user_id(),
                updated_at = now() WHERE id = $1`,
        [id],
      );
      // Remember the confirmed account for this vendor (vendor master).
      if (inv.data?.registrationNumber && inv.account)
        await tx.query(
          `INSERT INTO app.vendor_accounts (org_id, registration_number, account)
           VALUES (app.current_org_id(), $1, $2)
           ON CONFLICT (org_id, registration_number) DO UPDATE SET account = excluded.account`,
          [inv.data.registrationNumber, inv.account],
        );
    } else {
      const r = reason.trim().slice(0, 500);
      if (!r)
        throw new AppError(
          422,
          '差し戻しの理由を入力してください。',
          'REASON_REQUIRED',
        );
      await tx.query(
        `UPDATE app.invoices SET status = 'rejected', reject_reason = $2, updated_at = now()
          WHERE id = $1`,
        [id, r],
      );
    }
  });
}

/** Export every approved invoice once, as one batch, and lock them. */
export async function exportApproved(deps: Deps, s: Session) {
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{
      id: string;
      data: InvoiceData;
      account: string;
    }>(
      `SELECT id, data, account FROM app.invoices WHERE status = 'approved'
        ORDER BY (data->>'issueDate'), id FOR UPDATE`,
    );
    if (!r.rows.length)
      throw new AppError(409, '出力できる承認済みの請求書がありません。');
    const batch = await tx.query<{ id: string }>(
      `INSERT INTO app.export_batches (org_id, created_by, invoice_count)
       VALUES (app.current_org_id(), app.current_user_id(), $1) RETURNING id`,
      [r.rows.length],
    );
    await tx.query(
      `UPDATE app.invoices SET status = 'exported', export_batch_id = $1, updated_at = now()
        WHERE id = ANY($2::uuid[])`,
      [batch.rows[0].id, r.rows.map((x) => x.id)],
    );
    return {
      batchId: batch.rows[0].id,
      count: r.rows.length,
      csv: toCsv(r.rows.map((x) => ({ data: x.data, account: x.account }))),
    };
  });
}

/** Re-download a previous batch without changing anything. */
export async function batchCsv(deps: Deps, s: Session, batchId: string) {
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{ data: InvoiceData; account: string }>(
      `SELECT data, account FROM app.invoices WHERE export_batch_id = $1
        ORDER BY (data->>'issueDate'), id`,
      [batchId],
    );
    if (!r.rows.length) throw new AppError(404, '出力履歴が見つかりません。');
    return toCsv(r.rows.map((x) => ({ data: x.data, account: x.account })));
  });
}

export async function listInvoices(deps: Deps, s: Session) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query<{
      id: string;
      status: Status;
      file_name: string;
      vendor: string | null;
      total: number | null;
      issue_date: string | null;
      errors: number;
      warnings: number;
      uploader_name: string;
      submitted_by: string | null;
      updated_at: string;
    }>(
      `SELECT i.id, i.status, i.file_name, i.data->>'vendorName' AS vendor,
              (i.data->>'totalAmount')::bigint AS total, i.data->>'issueDate' AS issue_date,
              (SELECT count(*) FROM jsonb_array_elements(i.issues) x WHERE x->>'severity' = 'error')::int AS errors,
              (SELECT count(*) FROM jsonb_array_elements(i.issues) x WHERE x->>'severity' = 'warning')::int AS warnings,
              u.name AS uploader_name, i.submitted_by, i.updated_at
         FROM app.invoices i JOIN app.users u ON u.id = i.uploaded_by
        ORDER BY i.updated_at DESC LIMIT 500`,
    );
    const usage = await tx.query<{ used: number }>(
      'SELECT app.monthly_usage() AS used',
    );
    return {
      invoices: r.rows.map((x) => ({
        ...x,
        total: x.total === null ? null : Number(x.total),
      })),
      used: usage.rows[0].used,
    };
  });
}

export async function getInvoice(deps: Deps, s: Session, id: string) {
  return asUser(deps.db, ctx(s), async (tx) => {
    const inv = await load(tx, id);
    const audit = await tx.query<{
      action: string;
      detail: Record<string, unknown>;
      at: string;
      actor: string | null;
    }>(
      `SELECT l.action, l.detail, l.at, u.name AS actor FROM app.audit_log l
         LEFT JOIN app.users u ON u.id = l.actor_id
        WHERE l.invoice_id = $1 ORDER BY l.id`,
      [id],
    );
    const { documentText: _t, ...meta } = inv.extraction_meta ?? {};
    return { invoice: { ...inv, extraction_meta: meta }, audit: audit.rows };
  });
}

export async function listMembers(deps: Deps, s: Session) {
  return asUser(
    deps.db,
    ctx(s),
    async (tx) =>
      (
        await tx.query<{
          user_id: string;
          name: string;
          email: string;
          role: Role;
        }>(
          `SELECT m.user_id, u.name, u.email, m.role FROM app.memberships m
           JOIN app.users u ON u.id = m.user_id ORDER BY u.name`,
        )
      ).rows,
  );
}

export async function setRole(
  deps: Deps,
  s: Session,
  userId: string,
  role: Role,
) {
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  if (!['member', 'approver', 'admin'].includes(role))
    throw new AppError(422, '役割が正しくありません。');
  return asUser(deps.db, ctx(s), async (tx) => {
    const r = await tx.query(
      'UPDATE app.memberships SET role = $2 WHERE user_id = $1 AND org_id = app.current_org_id() RETURNING user_id',
      [userId, role],
    );
    if (!r.rows.length) throw new AppError(404, 'メンバーが見つかりません。');
  });
}

export async function auditLog(deps: Deps, s: Session) {
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  return asUser(
    deps.db,
    ctx(s),
    async (tx) =>
      (
        await tx.query<{
          id: number;
          action: string;
          detail: Record<string, unknown>;
          at: string;
          actor: string | null;
          invoice_id: string | null;
          file_name: string | null;
        }>(
          `SELECT l.id, l.action, l.detail, l.at, u.name AS actor, l.invoice_id, i.file_name
           FROM app.audit_log l LEFT JOIN app.users u ON u.id = l.actor_id
           LEFT JOIN app.invoices i ON i.id = l.invoice_id
          ORDER BY l.id DESC LIMIT 300`,
        )
      ).rows,
  );
}

export async function exportBatches(deps: Deps, s: Session) {
  if (s.role !== 'admin') return [];
  return asUser(
    deps.db,
    ctx(s),
    async (tx) =>
      (
        await tx.query<{
          id: string;
          invoice_count: number;
          created_at: string;
          creator: string;
        }>(
          `SELECT b.id, b.invoice_count, b.created_at, u.name AS creator
           FROM app.export_batches b JOIN app.users u ON u.id = b.created_by
          ORDER BY b.created_at DESC LIMIT 50`,
        )
      ).rows,
  );
}
