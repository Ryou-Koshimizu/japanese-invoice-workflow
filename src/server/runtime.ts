import { readConfig, DEMO_TODAY, todayInJapan, type Config } from './config';
import { pgDatabase, type Database } from './db';
import type { ExtractionProvider } from '../core/invoice';
import type { Deps } from './service';

export type Runtime = { config: Config; deps: Deps };

async function provider(config: Config): Promise<ExtractionProvider> {
  if (config.mode === 'demo')
    return (await import('../adapters/fixture')).fixtureProvider();
  if (config.EXTRACTION_PROVIDER === 'codex')
    return (await import('../adapters/codex')).codexProvider({
      model: config.CODEX_MODEL!,
      effort: config.CODEX_EFFORT,
    });
  return (await import('../adapters/claude')).claudeProvider(
    config.ANTHROPIC_API_KEY!,
    config.ANTHROPIC_MODEL!,
  );
}

/** Refuse to run on a connection that could bypass row-level security. */
async function assertRestrictedRole(db: Database) {
  const r = await db.transaction((tx) =>
    tx.query<{ rolsuper: boolean; rolbypassrls: boolean; member: boolean }>(
      `SELECT rolsuper, rolbypassrls, pg_has_role(current_user, 'app_user', 'MEMBER') AS member
         FROM pg_roles WHERE rolname = current_user`,
    ),
  );
  const role = r.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || !role.member)
    throw new Error(
      'DATABASE_URL must use a non-superuser role without BYPASSRLS that is a member of app_user.',
    );
}

async function init(): Promise<Runtime> {
  const config = readConfig();
  const extraction = await provider(config);
  let db: Database;
  let today: () => string;
  if (config.mode === 'demo') {
    // In-process PostgreSQL seeded on start; resets when the server restarts.
    const { createPgliteDatabase } = await import('./schema');
    const { seedDemo } = await import('./demo-seed');
    const created = await createPgliteDatabase();
    db = created.db;
    today = () => DEMO_TODAY;
    await seedDemo(created.pg, db, extraction, today);
  } else {
    db = await pgDatabase(config.DATABASE_URL);
    await assertRestrictedRole(db);
    today = () => todayInJapan();
  }
  return { config, deps: { db, provider: extraction, today } };
}

const g = globalThis as unknown as { __invoiceRuntime?: Promise<Runtime> };
export function runtime(): Promise<Runtime> {
  g.__invoiceRuntime ??= init().catch((e) => {
    g.__invoiceRuntime = undefined;
    throw e;
  });
  return g.__invoiceRuntime;
}

/** Demo only: throw away the in-memory database and seed it again. */
export async function resetDemo() {
  const current = await runtime();
  if (current.config.mode !== 'demo') throw new Error('reset is demo-only');
  g.__invoiceRuntime = undefined;
  await current.deps.db.close().catch(() => {});
  return runtime();
}
