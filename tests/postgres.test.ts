// Runs against a real PostgreSQL server (docker compose, or CI). Skipped otherwise.
//   RUN_POSTGRES_TESTS=1 npx vitest run tests/postgres.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';
import { pgDatabase, asUser, type Database } from '../src/server/db';
import { fixtureProvider } from '../src/adapters/fixture';
import { seedDemo } from '../src/server/demo-seed';
import { listInvoices, decideInvoice, type Deps } from '../src/server/service';
import type { Session } from '../src/server/auth';

const run = process.env.RUN_POSTGRES_TESTS === '1';
const APP =
  process.env.DATABASE_URL ??
  'postgresql://invoice_app:invoice_local_only@127.0.0.1:54325/invoices';
const ADMIN =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres_local_only@127.0.0.1:54325/invoices';

describe.skipIf(!run)('real PostgreSQL', () => {
  let admin: pg.Client;
  let db: Database;
  let s: Record<'member' | 'approver' | 'admin', Session>;
  let deps: Deps;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(
      `TRUNCATE app.audit_log, app.invoice_files, app.vendor_accounts, app.export_batches, app.invoices, app.sessions, app.memberships, app.users, app.organizations, app.stripe_events CASCADE`,
    );
    db = await pgDatabase(APP);
    deps = { db, provider: fixtureProvider(), today: () => '2026-10-14' };
    const raw = {
      query: (t: string, p?: unknown[]) => admin.query(t, p as unknown[]),
    } as unknown as PGlite;
    s = (await seedDemo(raw, db, deps.provider, deps.today)).sessions;
  }, 60000);
  afterAll(async () => {
    await db?.close();
    await admin?.end();
  });

  it('connects as a restricted role that cannot bypass row-level security', async () => {
    const r = await db.transaction((tx) =>
      tx.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      ),
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('runs the seeded workflow and isolates the other organization', async () => {
    const { invoices } = await listInvoices(deps, s.admin);
    expect(invoices).toHaveLength(7);
    const other = await admin.query(
      `SELECT count(*)::int AS n FROM app.organizations`,
    );
    expect(other.rows[0].n).toBe(2);
  });
  it('blocks self-approval and hides password hashes on a real server', async () => {
    const { invoices } = await listInvoices(deps, s.member);
    const submitted = invoices.find((i) => i.status === 'submitted')!;
    await expect(
      decideInvoice(deps, s.member, submitted.id, 'approve'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      asUser(db, { userId: s.admin.userId, orgId: s.admin.orgId }, (tx) =>
        tx.query('SELECT password_hash FROM app.users'),
      ),
    ).rejects.toBeTruthy();
    await expect(
      asUser(db, { userId: s.member.userId, orgId: s.member.orgId }, (tx) =>
        tx.query(
          `UPDATE app.invoices SET status = 'approved', approved_by = app.current_user_id() WHERE id = $1`,
          [submitted.id],
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
