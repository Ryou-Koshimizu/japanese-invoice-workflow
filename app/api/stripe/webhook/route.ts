import { stripeConfig } from '../../../../src/server/config';
import { handleWebhook } from '../../../../src/server/billing';
import { runtime } from '../../../../src/server/runtime';
import { AppError } from '../../../../src/server/db';
import { readBody } from '../../../../src/server/http';

export async function POST(request: Request) {
  const settings = stripeConfig();
  if (!settings)
    return Response.json(
      { error: 'Stripe is not configured' },
      { status: 503 },
    );
  try {
    const raw = new TextDecoder().decode(await readBody(request, 500_000));
    const { deps } = await runtime();
    const result = await handleWebhook(
      deps.db,
      settings,
      raw,
      request.headers.get('stripe-signature'),
    );
    return Response.json(result);
  } catch (e) {
    console.error(
      JSON.stringify({
        event: 'stripe_webhook_failed',
        code: e instanceof AppError ? e.code : (e as Error)?.name,
      }),
    );
    if (e instanceof AppError)
      return Response.json({ error: e.code }, { status: e.status });
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
