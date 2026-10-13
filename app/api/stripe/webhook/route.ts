import { stripeConfig } from '../../../../src/server/config';
import { handleWebhook } from '../../../../src/server/billing';
import { runtime } from '../../../../src/server/runtime';
import { AppError } from '../../../../src/server/db';

export async function POST(request: Request) {
  const settings = stripeConfig();
  if (!settings)
    return Response.json(
      { error: 'Stripe is not configured' },
      { status: 503 },
    );
  try {
    const raw = await request.text();
    if (raw.length > 500_000) throw new AppError(413, 'payload too large');
    const { deps } = await runtime();
    const result = await handleWebhook(
      deps.db,
      settings,
      raw,
      request.headers.get('stripe-signature'),
    );
    return Response.json(result);
  } catch (e) {
    if (e instanceof AppError)
      return Response.json({ error: e.code }, { status: e.status });
    return Response.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
