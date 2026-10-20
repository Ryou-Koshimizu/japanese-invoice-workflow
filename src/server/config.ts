import { z } from 'zod';

const live = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  // http(s) only; z.httpUrl() would also reject 127.0.0.1 and localhost.
  APP_ORIGIN: z.url({ protocol: /^https?$/ }),
  EXTRACTION_PROVIDER: z.enum(['claude', 'codex']).default('claude'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  CODEX_MODEL: z.string().optional(),
  CODEX_EFFORT: z
    .enum(['auto', 'low', 'medium', 'high', 'xhigh'])
    .default('auto'),
});

export type Config =
  | {
      mode: 'demo';
      /** Shared demo database for multi-instance hosts (see demo-postgres.ts). */
      sharedDatabase?: { url: string; adminUrl: string };
    }
  | ({ mode: 'live' } & z.infer<typeof live>);

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.APP_MODE ?? 'demo';
  if (mode === 'demo') {
    const url = env.DEMO_DATABASE_URL;
    if (!url) return { mode };
    if (!url.startsWith('postgres'))
      throw new Error('DEMO_DATABASE_URL must be a PostgreSQL URL.');
    // Managed hosts hand out sslmode=require. node-postgres treats it as
    // verify-full today but will weaken it; keep certificate and host checks.
    const strict = (u: string) =>
      u.replace(
        /([?&])sslmode=(prefer|require|verify-ca)\b/,
        '$1sslmode=verify-full',
      );
    return {
      mode,
      sharedDatabase: {
        url: strict(url),
        adminUrl: strict(env.DEMO_DATABASE_URL_UNPOOLED || url),
      },
    };
  }
  if (mode !== 'live') throw new Error('APP_MODE must be demo or live');
  const parsed = live.safeParse(env);
  if (!parsed.success)
    throw new Error(
      '実運用モードには DATABASE_URL と APP_ORIGIN（例：https://invoices.example.com）が必要です。',
    );
  const c = parsed.data;
  if (
    c.EXTRACTION_PROVIDER === 'claude' &&
    (!c.ANTHROPIC_API_KEY || !c.ANTHROPIC_MODEL)
  )
    throw new Error(
      'Claudeで読み取るには ANTHROPIC_API_KEY と ANTHROPIC_MODEL が必要です。',
    );
  if (c.EXTRACTION_PROVIDER === 'codex' && !c.CODEX_MODEL)
    throw new Error('ChatGPT（Codex）で読み取るには CODEX_MODEL が必要です。');
  return { mode, ...c };
}

/**
 * Live mode: the exact public origin people use, e.g. https://invoices.example.com.
 * Behind a proxy the request URL and Host header can differ from it, so the
 * origin check, the Secure cookie flag and the Stripe return URLs use this.
 */
export function publicOrigin(env: NodeJS.ProcessEnv = process.env) {
  return env.APP_MODE === 'live' && env.APP_ORIGIN
    ? new URL(env.APP_ORIGIN).origin
    : null;
}

export function stripeConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const price = env.STRIPE_PRICE_PRO;
  return secret && webhookSecret && price
    ? { secret, webhookSecret, price }
    : null;
}

/** Today's date in Japan. The demo pins it so the sample invoices stay current. */
export function todayInJapan(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
    now,
  );
}
export const DEMO_TODAY = '2026-10-14';
