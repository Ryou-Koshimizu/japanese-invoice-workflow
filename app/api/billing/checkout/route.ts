import { route } from '../../../../src/server/http';
import { publicOrigin, stripeConfig } from '../../../../src/server/config';
import { createCheckout } from '../../../../src/server/billing';
import { AppError } from '../../../../src/server/db';

export const POST = route(async (s, request) => {
  const settings = stripeConfig();
  if (!settings)
    throw new AppError(
      503,
      'このデモ環境ではStripeが設定されていません。',
      'STRIPE_DISABLED',
    );
  const url = await createCheckout(
    settings,
    s,
    publicOrigin() ?? new URL(request.url).origin,
  );
  return Response.json({ url });
});
