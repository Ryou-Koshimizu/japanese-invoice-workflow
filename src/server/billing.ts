import Stripe from 'stripe';
import { asUser, AppError, type Database } from './db';
import type { Session } from './auth';

export type StripeSettings = {
  secret: string;
  webhookSecret: string;
  price: string;
};

export async function createCheckout(
  settings: StripeSettings,
  s: Session,
  origin: string,
  stripe = new Stripe(settings.secret),
) {
  if (s.role !== 'admin')
    throw new AppError(403, '管理者の操作です。', 'FORBIDDEN');
  if (s.plan === 'pro') throw new AppError(409, '既にProプランです。');
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: settings.price, quantity: 1 }],
    client_reference_id: s.orgId,
    metadata: { orgId: s.orgId },
    subscription_data: { metadata: { orgId: s.orgId } },
    success_url: `${origin}/settings?billing=success`,
    cancel_url: `${origin}/settings?billing=cancel`,
  });
  if (!checkout.url)
    throw new AppError(502, '決済ページを作成できませんでした。');
  return checkout.url;
}

type PlanChange = {
  orgId: string | null;
  customer: string | null;
  plan: 'free' | 'pro';
};

/** Map the Stripe events we care about to a plan change; ignore the rest. */
export function planChange(event: Stripe.Event): PlanChange | null {
  const customerOf = (
    c: string | Stripe.Customer | Stripe.DeletedCustomer | null,
  ) => (typeof c === 'string' ? c : (c?.id ?? null));
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (s.mode !== 'subscription' || s.payment_status === 'unpaid')
        return null;
      return {
        orgId: s.client_reference_id ?? s.metadata?.orgId ?? null,
        customer: customerOf(s.customer),
        plan: 'pro',
      };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const active =
        event.type === 'customer.subscription.updated' &&
        ['active', 'trialing'].includes(sub.status);
      return {
        orgId: sub.metadata?.orgId ?? null,
        customer: customerOf(sub.customer),
        plan: active ? 'pro' : 'free',
      };
    }
    default:
      return null;
  }
}

/**
 * Verify the signature over the raw body, then apply the plan change exactly
 * once per event id. Unsigned or tampered payloads never reach the database.
 */
export async function handleWebhook(
  db: Database,
  settings: Pick<StripeSettings, 'webhookSecret'>,
  rawBody: string,
  signature: string | null,
  stripe = new Stripe('sk_test_unused'),
) {
  if (!signature)
    throw new AppError(400, 'Stripe-Signature がありません。', 'NO_SIGNATURE');
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      settings.webhookSecret,
    );
  } catch {
    throw new AppError(400, '署名を検証できませんでした。', 'BAD_SIGNATURE');
  }
  const change = planChange(event);
  if (!change || (!change.orgId && !change.customer))
    return { applied: false, ignored: true };
  // Stripe may deliver events out of order; the database ignores an event
  // older than the one that last changed the plan.
  const created =
    typeof event.created === 'number'
      ? new Date(event.created * 1000).toISOString()
      : null;
  const r = await asUser(db, null, (tx) =>
    tx.query<{ ok: boolean }>(
      'SELECT app.billing_apply($1, $2, $3, $4, $5, $6) AS ok',
      [
        event.id,
        event.type,
        change.orgId,
        change.plan,
        change.customer,
        created,
      ],
    ),
  );
  return { applied: r.rows[0].ok, ignored: false };
}
