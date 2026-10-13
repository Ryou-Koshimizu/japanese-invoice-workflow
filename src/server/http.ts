import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError } from './db';
import { sessionFromToken, type Session } from './auth';
import { runtime } from './runtime';

export const SESSION_COOKIE = 'invoice_session';

export async function currentSession(): Promise<Session | null> {
  const { deps } = await runtime();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionFromToken(deps.db, token);
}

/** For pages: send people without a session to the login screen. */
export async function pageSession(): Promise<Session> {
  const s = await currentSession();
  if (!s) redirect('/login');
  return s;
}

/** Same-origin check for state-changing requests (cookies are SameSite=Lax too). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host)
    throw new AppError(
      403,
      '別のサイトからのリクエストは受け付けません。',
      'BAD_ORIGIN',
    );
}

/** Wrap a route handler: session, origin check and uniform JSON errors. */
export function route<A extends unknown[]>(
  handler: (
    session: Session,
    request: Request,
    ...args: A
  ) => Promise<Response>,
  { auth = true }: { auth?: boolean } = {},
) {
  return async (request: Request, ...args: A): Promise<Response> => {
    try {
      if (request.method !== 'GET') assertSameOrigin(request);
      const session = await currentSession();
      if (auth && !session)
        throw new AppError(401, 'ログインしてください。', 'UNAUTHENTICATED');
      return await handler(session!, request, ...args);
    } catch (e) {
      if (e instanceof AppError)
        return Response.json(
          { error: e.message, code: e.code },
          { status: e.status },
        );
      console.error(
        JSON.stringify({ event: 'unhandled_error', name: (e as Error)?.name }),
      );
      return Response.json(
        { error: 'サーバーでエラーが発生しました。', code: 'INTERNAL' },
        { status: 500 },
      );
    }
  };
}

export async function readJson(
  request: Request,
  limit = 200_000,
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > limit)
    throw new AppError(413, 'リクエストが大きすぎます。');
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value;
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'リクエストの形式が正しくありません。');
}
