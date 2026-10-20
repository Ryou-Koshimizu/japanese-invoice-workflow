import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createPgliteDatabase } from '../src/server/schema';
import { asUser, AppError, type Database } from '../src/server/db';
import {
  login,
  sessionFromToken,
  logout,
  type Session,
} from '../src/server/auth';
import { fixtureProvider } from '../src/adapters/fixture';
import { seedDemo, DEMO_PASSWORD, demoUsers } from '../src/server/demo-seed';
import {
  decideInvoice,
  exportApproved,
  extractInvoice,
  getInvoice,
  listInvoices,
  saveInvoice,
  submitInvoice,
  uploadInvoice,
  setRole,
  type Deps,
} from '../src/server/service';

let pg: PGlite;
let db: Database;
let deps: Deps;
let s: Record<'member' | 'approver' | 'admin', Session>;
let otherOrgInvoice: string;
let otherAdmin: Session;
const file = (n: string) => new Uint8Array(readFileSync(`eval/invoices/${n}`));
const ctx = (x: Session) => ({ userId: x.userId, orgId: x.orgId });

beforeAll(async () => {
  ({ pg, db } = await createPgliteDatabase());
  deps = { db, provider: fixtureProvider(), today: () => '2026-10-14' };
  const seeded = await seedDemo(pg, db, deps.provider, deps.today);
  s = seeded.sessions;
  const other = await pg.query<{ user_id: string; org_id: string }>(
    `SELECT m.user_id, m.org_id FROM app.memberships m JOIN app.users u ON u.id = m.user_id
      WHERE u.email = 'other@other.example'`,
  );
  otherAdmin = {
    ...s.admin,
    userId: other.rows[0].user_id,
    orgId: other.rows[0].org_id,
  };
  otherOrgInvoice = await uploadInvoice(
    deps,
    otherAdmin,
    'inv-03.pdf',
    file('inv-03.pdf'),
  );
}, 60000);
afterAll(() => db.close());

const expectDbDenied = (p: Promise<unknown>) =>
  expect(p).rejects.toSatisfy(
    (e) => e instanceof AppError && [403, 409].includes(e.status),
  );

describe('seeded demo workflow', () => {
  it('reaches every status through the real service functions', async () => {
    const { invoices } = await listInvoices(deps, s.member);
    const byStatus = Object.groupBy(invoices, (i) => i.status);
    expect(Object.keys(byStatus).sort()).toEqual([
      'approved',
      'rejected',
      'reviewing',
      'submitted',
      'uploaded',
    ]);
    expect(invoices).toHaveLength(7);
  });
});

describe('row-level security', () => {
  it('never shows another organization’s invoices or files', async () => {
    const mine = await listInvoices(deps, s.admin);
    expect(mine.invoices.map((i) => i.id)).not.toContain(otherOrgInvoice);
    await expect(
      getInvoice(deps, s.admin, otherOrgInvoice),
    ).rejects.toMatchObject({ status: 404 });
    const raw = await asUser(db, ctx(s.admin), (tx) =>
      tx.query(
        'SELECT count(*)::int AS n FROM app.invoice_files WHERE invoice_id = $1',
        [otherOrgInvoice],
      ),
    );
    expect(raw.rows[0]).toEqual({ n: 0 });
  });
  it('cannot write into another organization even with a forged org id', async () => {
    await expectDbDenied(
      asUser(db, { userId: s.member.userId, orgId: otherAdmin.orgId }, (tx) =>
        tx.query(`INSERT INTO app.invoices (org_id, file_name, file_type, file_size, file_sha256, uploaded_by)
                  VALUES (app.current_org_id(), 'x.pdf', 'application/pdf', 1, repeat('a', 64), app.current_user_id())`),
      ),
    );
  });
  it('hides password hashes and sessions from the application role', async () => {
    await expect(
      asUser(db, ctx(s.admin), (tx) =>
        tx.query('SELECT password_hash FROM app.users'),
      ),
    ).rejects.toBeTruthy();
    await expect(
      asUser(db, ctx(s.admin), (tx) => tx.query('SELECT * FROM app.sessions')),
    ).rejects.toBeTruthy();
  });
});

describe('workflow enforced by the database itself', () => {
  async function submittedBy(who: Session, name: string) {
    const id = await uploadInvoice(deps, who, name, file(name));
    await extractInvoice(deps, who, id);
    await submitInvoice(deps, who, id, '');
    return id;
  }
  it('rejects self-approval even when the service check is bypassed', async () => {
    const id = await submittedBy(s.approver, 'inv-04.pdf');
    await expect(
      decideInvoice(deps, s.approver, id, 'approve'),
    ).rejects.toMatchObject({ status: 403 });
    await expectDbDenied(
      asUser(db, ctx(s.approver), (tx) =>
        tx.query(
          `UPDATE app.invoices SET status = 'approved', approved_by = app.current_user_id() WHERE id = $1`,
          [id],
        ),
      ),
    );
  });
  it('does not let an approver rewrite who submitted their own request', async () => {
    const id = await uploadInvoice(
      deps,
      s.approver,
      'inv-08.pdf',
      file('inv-08.pdf'),
    );
    await extractInvoice(deps, s.approver, id);
    await submitInvoice(deps, s.approver, id, '確認済み');
    await expectDbDenied(
      asUser(db, ctx(s.approver), (tx) =>
        tx.query('UPDATE app.invoices SET submitted_by = $2 WHERE id = $1', [
          id,
          s.member.userId,
        ]),
      ),
    );
    await expectDbDenied(
      asUser(db, ctx(s.approver), (tx) =>
        tx.query(
          `UPDATE app.invoices SET status = 'approved', approved_by = app.current_user_id(),
                  submitted_by = $2 WHERE id = $1`,
          [id, s.member.userId],
        ),
      ),
    );
  });
  it('limits AI reads per invoice, also against parallel requests and direct SQL', async () => {
    const id = await uploadInvoice(
      deps,
      s.member,
      'inv-09.pdf',
      file('inv-09.pdf'),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => extractInvoice(deps, s.member, id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    await expect(extractInvoice(deps, s.member, id)).rejects.toMatchObject({
      status: 429,
      code: 'EXTRACTION_LIMIT',
    });
    await expectDbDenied(
      asUser(db, ctx(s.member), (tx) =>
        tx.query('UPDATE app.invoices SET extraction_count = 0 WHERE id = $1', [
          id,
        ]),
      ),
    );
  });
  it('rejects approval by a member at the database level', async () => {
    const id = await submittedBy(s.admin, 'inv-07.pdf');
    await expectDbDenied(
      asUser(db, ctx(s.member), (tx) =>
        tx.query(
          `UPDATE app.invoices SET status = 'approved', approved_by = app.current_user_id() WHERE id = $1`,
          [id],
        ),
      ),
    );
  });
  it('does not let a submission with errors through, even by direct SQL', async () => {
    const id = await uploadInvoice(
      deps,
      s.member,
      'inv-36.pdf',
      file('inv-36.pdf'),
    );
    await extractInvoice(deps, s.member, id);
    await expect(submitInvoice(deps, s.member, id, 'ok')).rejects.toMatchObject(
      { code: 'HAS_ERRORS' },
    );
    await expectDbDenied(
      asUser(db, ctx(s.member), (tx) =>
        tx.query(
          `UPDATE app.invoices SET status = 'submitted', submitted_by = app.current_user_id() WHERE id = $1`,
          [id],
        ),
      ),
    );
  });
  it('requires a reason to reject and a note to submit with warnings', async () => {
    const { invoices } = await listInvoices(deps, s.member);
    const fee = invoices.find((i) => i.file_name === 'inv-23.pdf')!;
    await expect(
      decideInvoice(deps, s.approver, fee.id, 'reject', ' '),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const id = await uploadInvoice(
      deps,
      s.member,
      'inv-30.jpg',
      file('inv-30.jpg'),
    );
    await extractInvoice(deps, s.member, id);
    await expect(submitInvoice(deps, s.member, id, '')).rejects.toMatchObject({
      code: 'NOTE_REQUIRED',
    });
  });
  it('locks invoices after export, writes the CSV once and audits everything', async () => {
    await expect(exportApproved(deps, s.approver)).rejects.toMatchObject({
      status: 403,
    });
    const result = await exportApproved(deps, s.admin);
    expect(result.count).toBeGreaterThan(0);
    expect(result.csv).toContain('課対仕入10%');
    const { invoices } = await listInvoices(deps, s.admin);
    const exported = invoices.find((i) => i.status === 'exported')!;
    await expectDbDenied(
      asUser(db, ctx(s.admin), (tx) =>
        tx.query(`UPDATE app.invoices SET account = '雑費' WHERE id = $1`, [
          exported.id,
        ]),
      ),
    );
    await expect(exportApproved(deps, s.admin)).rejects.toMatchObject({
      status: 409,
    });
    const audit = await getInvoice(deps, s.admin, exported.id);
    expect(audit.audit.map((a) => a.action)).toEqual([
      'upload',
      'status:reviewing',
      'status:submitted',
      'status:approved',
      'status:exported',
    ]);
  });
  it('keeps the audit log append-only', async () => {
    await expect(
      asUser(db, ctx(s.admin), (tx) =>
        tx.query(`UPDATE app.audit_log SET action = 'x'`),
      ),
    ).rejects.toBeTruthy();
    await expect(
      asUser(db, ctx(s.admin), (tx) => tx.query(`DELETE FROM app.audit_log`)),
    ).rejects.toBeTruthy();
    await expect(
      asUser(db, ctx(s.admin), (tx) => tx.query(`DELETE FROM app.invoices`)),
    ).rejects.toBeTruthy();
  });
  it('records field corrections in the audit log', async () => {
    const id = await uploadInvoice(
      deps,
      s.member,
      'inv-05.pdf',
      file('inv-05.pdf'),
    );
    await extractInvoice(deps, s.member, id);
    const { invoice } = await getInvoice(deps, s.member, id);
    await saveInvoice(deps, s.member, id, {
      data: { ...invoice.data!, invoiceNumber: 'CHANGED-1' },
      account: '雑費',
    });
    const { audit } = await getInvoice(deps, s.member, id);
    const edit = audit.find((a) => a.action === 'edit')!;
    expect(edit.detail.invoiceNumber).toMatchObject({ to: 'CHANGED-1' });
    expect(edit.actor).toBe('佐藤 美咲');
  });
  it('detects a duplicate of an invoice already registered', async () => {
    const id = await uploadInvoice(
      deps,
      s.member,
      'inv-13.png',
      file('inv-13.png'),
    );
    const { issues } = await extractInvoice(deps, s.member, id);
    expect(issues.map((i) => i.code)).toContain('DUPLICATE');
  });
  it('keeps at least one admin', async () => {
    await expect(
      setRole(deps, s.admin, s.admin.userId, 'member'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      setRole(deps, s.member, s.member.userId, 'admin'),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('authentication', () => {
  it('logs in with the demo password and resolves the session', async () => {
    const token = await login(db, demoUsers[1].email, DEMO_PASSWORD);
    const session = await sessionFromToken(db, token);
    expect(session).toMatchObject({
      role: 'approver',
      userName: '鈴木 健',
      orgName: '株式会社サンプル商事',
    });
    await logout(db, token);
    expect(await sessionFromToken(db, token)).toBeNull();
  });
  it('gives the same error for a wrong password and an unknown email', async () => {
    await expect(
      login(db, demoUsers[0].email, 'wrong-password!'),
    ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
    await expect(
      login(db, 'nobody@example.com', 'wrong-password!'),
    ).rejects.toMatchObject({ code: 'LOGIN_FAILED' });
  });
});

describe('quota and billing', () => {
  it('stops uploads at the plan limit and lifts it after an upgrade, once per event', async () => {
    const { used } = await listInvoices(deps, s.member);
    const remaining = 30 - used;
    for (let i = 0; i < remaining; i++)
      await uploadInvoice(deps, s.member, 'inv-06.pdf', file('inv-06.pdf'));
    await expect(
      uploadInvoice(deps, s.member, 'inv-06.pdf', file('inv-06.pdf')),
    ).rejects.toMatchObject({ status: 429 });
    const apply = (id: string) =>
      asUser(db, null, (tx) =>
        tx.query<{ ok: boolean }>(
          `SELECT app.billing_apply($1, 'checkout.session.completed', $2, 'pro', 'cus_test') AS ok`,
          [id, s.admin.orgId],
        ),
      );
    expect((await apply('evt_1')).rows[0].ok).toBe(true);
    expect((await apply('evt_1')).rows[0].ok).toBe(false);
    await expect(
      uploadInvoice(deps, s.member, 'inv-06.pdf', file('inv-06.pdf')),
    ).resolves.toBeTruthy();
  });
});
