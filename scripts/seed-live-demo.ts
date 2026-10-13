// Seeds the fictional demo organization into a live PostgreSQL (for local
// testing of live mode with the same sample data as the public demo).
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { pgDatabase } from '../src/server/db';
import { fixtureProvider } from '../src/adapters/fixture';
import { seedDemo } from '../src/server/demo-seed';
import { DEMO_TODAY } from '../src/server/config';

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
