import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { Database } from './db';
import { hashPassword, type Session } from './auth';
import type { ExtractionProvider, Role } from '../core/invoice';
import {
  decideInvoice,
  extractInvoice,
  submitInvoice,
  uploadInvoice,
  type Deps,
} from './service';

export const DEMO_PASSWORD = 'demo-password-2026';
export const demoUsers: { email: string; name: string; role: Role }[] = [
  { email: 'sato@sample-shoji.example', name: '佐藤 美咲', role: 'member' },
  { email: 'suzuki@sample-shoji.example', name: '鈴木 健', role: 'approver' },
  { email: 'takahashi@sample-shoji.example', name: '高橋 由紀', role: 'admin' },
];

const file = (name: string) =>
  new Uint8Array(readFileSync(join(process.cwd(), 'eval/invoices', name)));

/**
 * Seed the demo organization through the same service functions the UI uses,
 * so every sample invoice reached its state through the real workflow.
 */
export async function seedDemo(
  pg: PGlite,
  db: Database,
  provider: ExtractionProvider,
  today: () => string,
) {
  const hash = await hashPassword(DEMO_PASSWORD);
  const org = await pg.query<{ id: string }>(
    `INSERT INTO app.organizations (name) VALUES ('株式会社サンプル商事') RETURNING id`,
  );
  const orgId = org.rows[0].id;
  const sessions: Record<Role, Session> = {} as never;
  for (const u of demoUsers) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO app.users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [u.email, u.name, hash],
    );
    await pg.query(`INSERT INTO app.memberships VALUES ($1, $2, $3)`, [
      orgId,
      r.rows[0].id,
      u.role,
    ]);
    sessions[u.role] = {
      userId: r.rows[0].id,
      orgId,
      role: u.role,
      userName: u.name,
      email: u.email,
      orgName: '株式会社サンプル商事',
      plan: 'free',
    };
  }
  // A second organization proves isolation: nothing of it is ever visible.
  const other = await pg.query<{ id: string }>(
    `INSERT INTO app.organizations (name) VALUES ('他社デモ株式会社') RETURNING id`,
  );
  const otherUser = await pg.query<{ id: string }>(
    `INSERT INTO app.users (email, name, password_hash) VALUES ('other@other.example', '別組織 太郎', $1) RETURNING id`,
    [hash],
  );
  await pg.query(`INSERT INTO app.memberships VALUES ($1, $2, 'admin')`, [
    other.rows[0].id,
    otherUser.rows[0].id,
  ]);

  const deps: Deps = { db, provider, today };
  const { member, approver } = sessions;
  const up = (name: string) => uploadInvoice(deps, member, name, file(name));

  // Waiting for extraction: a clean PDF and a scan-like image.
  await up('inv-01.pdf');
  await up('inv-29.jpg');
  // Under review: mixed tax rates (clean) and a seeded tax mistake (errors).
  const reduced = await up('inv-13.pdf');
  await extractInvoice(deps, member, reduced);
  const wrongTax = await up('inv-35.pdf');
  await extractInvoice(deps, member, wrongTax);
  // Waiting for approval: a fee with withholding tax, submitted by the member.
  const fee = await up('inv-23.pdf');
  await extractInvoice(deps, member, fee);
  await submitInvoice(deps, member, fee, '');
  // Approved and ready to export.
  const approvedId = await up('inv-02.pdf');
  await extractInvoice(deps, member, approvedId);
  await submitInvoice(deps, member, approvedId, '');
  await decideInvoice(deps, approver, approvedId, 'approve');
  // Rejected back to the member with a reason.
  const late = await up('inv-40.pdf');
  await extractInvoice(deps, member, late);
  await submitInvoice(deps, member, late, '期日は先方の記載どおり');
  await decideInvoice(
    deps,
    approver,
    late,
    'reject',
    '支払期日が請求日より前です。先方に正しい期日を確認してください。',
  );
  return { orgId, sessions };
}
