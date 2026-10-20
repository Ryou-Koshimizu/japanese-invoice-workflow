// The shared public demo database on a real PostgreSQL (docker compose, or CI).
//   RUN_POSTGRES_TESTS=1 npx vitest run tests/demo-postgres.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { fixtureProvider } from '../src/adapters/fixture';
import { openSharedDemo, type SharedDemo } from '../src/server/demo-postgres';
import { login, sessionFromToken } from '../src/server/auth';
import { DEMO_PASSWORD } from '../src/server/demo-seed';
import { listInvoices, uploadInvoice } from '../src/server/service';
import { readFileSync } from 'node:fs';
import { MAX_EXTRACTIONS } from '../src/core/workflow';

const run = process.env.RUN_POSTGRES_TESTS === '1';
const ADMIN =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres_local_only@127.0.0.1:54325/invoices';
const demoUrl = new URL(ADMIN);
demoUrl.pathname = '/demo_shared_test';
const DEMO = demoUrl.toString();

describe.skipIf(!run)('shared demo database', () => {
  const opened: SharedDemo[] = [];
  const today = () => '2026-10-14';
  const count = async (sql: string) => {
    const c = new pg.Client({ connectionString: DEMO });
    await c.connect();
    try {
      return (await c.query<{ n: number }>(sql)).rows[0].n;
    } finally {
      await c.end();
    }
  };

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS demo_shared_test WITH (FORCE)');
    await admin.query('CREATE DATABASE demo_shared_test');
    await admin.end();
  });
  afterAll(async () => {
    await Promise.all(opened.map((d) => d.db.close()));
  });

  it('creates and seeds the database once, even when instances start together', async () => {
    opened.push(
      ...(await Promise.all(
        [1, 2, 3].map(() =>
          openSharedDemo(DEMO, DEMO, fixtureProvider(), today),
        ),
      )),
    );
    expect(
      await count(
        `SELECT count(*)::int AS n FROM app.organizations WHERE name = '株式会社サンプル商事'`,
      ),
    ).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM app.invoices')).toBe(7);
  }, 120000);

  it('shares logins and data between instances, still under row-level security', async () => {
    const [a, b] = opened;
    const token = await login(a.db, 'sato@sample-shoji.example', DEMO_PASSWORD);
    const session = await sessionFromToken(b.db, token);
    expect(session?.role).toBe('member');
    const deps = { db: b.db, provider: fixtureProvider(), today };
    const { invoices } = await listInvoices(deps, session!);
    expect(invoices).toHaveLength(7);
  });

  it('resets to the original data on request', async () => {
    const [a] = opened;
    const token = await login(a.db, 'sato@sample-shoji.example', DEMO_PASSWORD);
    const session = (await sessionFromToken(a.db, token))!;
    const deps = { db: a.db, provider: fixtureProvider(), today };
    await uploadInvoice(
      deps,
      session,
      'inv-05.pdf',
      new Uint8Array(readFileSync('eval/invoices/inv-05.pdf')),
    );
    expect(await count('SELECT count(*)::int AS n FROM app.invoices')).toBe(8);
    await a.refresh(true);
    expect(await count('SELECT count(*)::int AS n FROM app.invoices')).toBe(7);
    expect(await sessionFromToken(a.db, token)).toBeNull();
  }, 120000);

  it('raises the per-invoice AI call limit on a database created with the old one', async () => {
    const admin = new pg.Client({ connectionString: DEMO });
    await admin.connect();
    try {
      await admin.query(
        `ALTER TABLE app.invoices DROP CONSTRAINT invoices_extraction_count_check,
           ADD CONSTRAINT invoices_extraction_count_check CHECK (extraction_count BETWEEN 0 AND 3)`,
      );
      opened.push(await openSharedDemo(DEMO, DEMO, fixtureProvider(), today));
      const def = await admin.query<{ d: string }>(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
          WHERE conname = 'invoices_extraction_count_check'`,
      );
      expect(def.rows[0].d).toContain(`${MAX_EXTRACTIONS}`);
    } finally {
      await admin.end();
    }
  }, 120000);
});
