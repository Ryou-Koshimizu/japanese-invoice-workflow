import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgliteDatabase, type Database } from './db';

export const schemaSql = () =>
  readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8');

/** In-process PostgreSQL (WASM) with the full schema, for the demo and tests. */
export async function createPgliteDatabase(): Promise<{
  db: Database;
  pg: PGlite;
}> {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  return { db: pgliteDatabase(pg), pg };
}
