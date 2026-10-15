// Seeds the fictional demo organization into a live PostgreSQL (for local
// testing of live mode with the same sample data as the public demo).
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { pgDatabase } from '../src/server/db';
import { fixtureProvider } from '../src/adapters/fixture';
import { seedDemo } from '../src/server/demo-seed';
import { DEMO_TODAY } from '../src/server/config';

// The demo accounts use a published password, so they must never reach a
// database that anyone else can log in to.
const host = new URL(process.env.ADMIN_DATABASE_URL ?? '').hostname;
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(host) &&
  process.env.ALLOW_DEMO_SEED !== '1'
)
  throw new Error(
    'Demo accounts use a published password. Seed only a local database, or set ALLOW_DEMO_SEED=1 if you are sure.',
  );

const admin = new pg.Client({
  connectionString: process.env.ADMIN_DATABASE_URL,
});
await admin.connect();
const exists = await admin.query(
  `SELECT 1 FROM app.organizations WHERE name = '株式会社サンプル商事'`,
);
if (exists.rowCount) {
  console.log('Demo organization already exists; nothing to do.');
  await admin.end();
  process.exit(0);
}
// seedDemo needs raw inserts (users, memberships) and the app-role database.
const raw = {
  query: (text: string, params?: unknown[]) =>
    admin.query(text, params as unknown[]),
} as unknown as PGlite;
const db = await pgDatabase(process.env.DATABASE_URL!);
await seedDemo(raw, db, fixtureProvider(), () => DEMO_TODAY);
await db.close();
await admin.end();
console.log('Seeded the demo organization.');
