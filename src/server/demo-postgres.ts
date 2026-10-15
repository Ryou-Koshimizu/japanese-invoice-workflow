// Public demo on a shared PostgreSQL (APP_MODE=demo with DEMO_DATABASE_URL).
// Serverless hosts run several instances, each with its own memory, so the
// in-process demo database would differ from request to request. With a
// shared database every instance sees the same fictional data. The database
// must be dedicated to the demo: it is created, seeded and wiped here.
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';
import { pgDatabase, type Database } from './db';
import { schemaSql } from './schema';
import { seedDemo } from './demo-seed';
import type { ExtractionProvider } from '../core/invoice';

const LOCK_KEY = 72_410_140;
const RESET_AFTER_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 10 * 60 * 1000;
const DEMO_ORG = '株式会社サンプル商事';
const TABLES =
  'app.audit_log, app.invoice_files, app.vendor_accounts, app.export_batches, app.invoices, app.sessions, app.memberships, app.users, app.organizations, app.stripe_events';

export type SharedDemo = {
  db: Database;
  /** Re-seed when the data is older than a day, or always with force. */
  refresh(force?: boolean): Promise<void>;
};

/**
 * Setup and resets run as the connection's own role (the owner of the demo
 * database) under an advisory lock, so parallel instances never seed twice.
 * Requests still run as the restricted app_user role through asUser().
 */
export async function openSharedDemo(
  url: string,
  adminUrl: string,
  provider: ExtractionProvider,
  today: () => string,
): Promise<SharedDemo> {
  const withLock = async (fn: (admin: pg.Client) => Promise<void>) => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await fn(admin);
    } finally {
      await admin
        .query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
        .catch(() => {});
      await admin.end();
    }
  };

  await withLock(async (admin) => {
    const t = await admin.query<{ t: string | null }>(
      `SELECT to_regclass('app.organizations')::text AS t`,
    );
    if (!t.rows[0].t) await admin.query(schemaSql());
    // On managed PostgreSQL the owner is not a superuser and needs membership
    // to switch to app_user for each request.
    await admin.query('GRANT app_user TO CURRENT_USER');
  });

  const db = await pgDatabase(url);
  let checkedAt = 0;
  const refresh = async (force = false) => {
    if (!force && Date.now() - checkedAt < CHECK_EVERY_MS) return;
    checkedAt = Date.now();
    await withLock(async (admin) => {
      const r = await admin.query<{ created_at: Date }>(
        'SELECT created_at FROM app.organizations WHERE name = $1',
        [DEMO_ORG],
      );
      const seededAt = r.rows[0]?.created_at?.getTime();
      if (!force && seededAt && Date.now() - seededAt < RESET_AFTER_MS) return;
      await admin.query(`TRUNCATE ${TABLES} CASCADE`);
      const raw = {
        query: (text: string, params?: unknown[]) => admin.query(text, params),
      } as unknown as PGlite;
      await seedDemo(raw, db, provider, today);
    });
  };
  await refresh();
  return { db, refresh };
}
