import { cookies } from 'next/headers';
import { login } from '../../../../src/server/auth';
import { route, readJson, SESSION_COOKIE } from '../../../../src/server/http';
import { runtime } from '../../../../src/server/runtime';
import { AppError } from '../../../../src/server/db';

// Small in-memory brake on password guessing per email and client address.
const attempts = new Map<string, { n: number; until: number }>();

export const POST = route(
  async (_s, request) => {
    const body = await readJson(request, 2000);
    const email = String(body.email ?? '').slice(0, 200);
    const password = String(body.password ?? '').slice(0, 200);
    const key = `${email.toLowerCase()}|${request.headers.get('x-forwarded-for') ?? ''}`;
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > Date.now())
      throw new AppError(
        429,
        'ログインの試行が多すぎます。5分後にお試しください。',
        'TOO_MANY',
      );
    const { deps } = await runtime();
    try {
      const token = await login(deps.db, email, password);
      attempts.delete(key);
      (await cookies()).set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(request.url).protocol === 'https:',
        path: '/',
        maxAge: 12 * 60 * 60,
      });
      return Response.json({ ok: true });
    } catch (e) {
      attempts.set(key, {
        n: (a?.until ?? 0) > Date.now() ? a!.n + 1 : 1,
        until: Date.now() + 5 * 60_000,
      });
      throw e;
    }
  },
  { auth: false },
);
