import { z } from 'zod';

const live = z.object({
  DATABASE_URL: z.string().startsWith('postgres'),
  EXTRACTION_PROVIDER: z.enum(['claude', 'codex']).default('claude'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  CODEX_MODEL: z.string().optional(),
  CODEX_EFFORT: z
    .enum(['auto', 'low', 'medium', 'high', 'xhigh'])
    .default('auto'),
});

export type Config =
  { mode: 'demo' } | ({ mode: 'live' } & z.infer<typeof live>);

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.APP_MODE ?? 'demo';
  if (mode === 'demo') return { mode };
  if (mode !== 'live') throw new Error('APP_MODE must be demo or live');
  const parsed = live.safeParse(env);
  if (!parsed.success)
    throw new Error('実運用モードには DATABASE_URL が必要です。');
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
