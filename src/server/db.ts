import type { PGlite } from '@electric-sql/pglite';

export type Row = Record<string, unknown>;
export interface Sql {
  query<T extends Row = Row>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Database {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502 | 503,
    message: string,
    readonly code = 'APP_ERROR',
  ) {
    super(message);
  }
}

/** Map database errors raised by RLS, triggers and constraints to HTTP errors. */
export function mapDbError(e: unknown): unknown {
  const err = e as { code?: string; message?: string };
  switch (err?.code) {
    case '42501':
      return new AppError(
        403,
        '権限がないか、この状態では実行できない操作です。',
        'FORBIDDEN',
      );
    case '23514':
      return new AppError(
        409,
        '入力が業務ルールを満たしていません。',
        'RULE_VIOLATION',
      );
    case '53400':
      return new AppError(
        429,
        '今月のプランの処理枚数の上限に達しました。',
        'QUOTA',
      );
    case '23505':
      return new AppError(409, '既に登録されています。', 'DUPLICATE');
    case '22P02':
      return new AppError(404, '見つかりません。', 'NOT_FOUND');
    default:
      return e;
  }
}

export type RequestContext = { userId: string; orgId: string } | null;

/**
 * Run fn as the restricted app_user role with the request's user and org set
 * for row-level security. Everything the application reads or writes on behalf
 * of a person goes through here.
 */
export async function asUser<T>(
  db: Database,
  ctx: RequestContext,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE app_user');
      await tx.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`,
        [ctx?.userId ?? '', ctx?.orgId ?? ''],
      );
      await tx.query(`SET LOCAL statement_timeout = '10s'`);
      return fn(tx);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export function pgliteDatabase(pg: PGlite): Database {
  return {
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({ query: (text, params) => tx.query(text, params) as never }),
      ),
    close: () => pg.close(),
  };
}

export async function pgDatabase(connectionString: string): Promise<Database> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) =>
            client.query(text, params as unknown[]) as never,
        });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
