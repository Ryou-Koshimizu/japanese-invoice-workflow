import { describe, it, expect, beforeAll } from 'vitest';
import Stripe from 'stripe';
import { createPgliteDatabase } from '../src/server/schema';
import { handleWebhook, planChange } from '../src/server/billing';
import type { Database } from '../src/server/db';
import type { PGlite } from '@electric-sql/pglite';

const secret = 'whsec_test_secret';
const stripe = new Stripe('sk_test_unused');
let db: Database;
let pg: PGlite;
let orgId: string;

const event = (
  id: string,
  type: string,
  object: Record<string, unknown>,
  created = 1,
) =>
  JSON.stringify({
    id,
    object: 'event',
    type,
    data: { object },
    api_version: '2026-01-01',
    created,
    livemode: false,
    pending_webhooks: 0,
    request: null,
  });
const sign = (payload: string, s = secret) =>
  stripe.webhooks.generateTestHeaderString({ payload, secret: s });
const plan = async () =>
  (
    await pg.query<{ plan: string }>(
      'SELECT plan FROM app.organizations WHERE id = $1',
      [orgId],
    )
  ).rows[0].plan;

beforeAll(async () => {
  ({ db, pg } = await createPgliteDatabase());
  orgId = (
    await pg.query<{ id: string }>(
      `INSERT INTO app.organizations (name) VALUES ('課金テスト') RETURNING id`,
    )
  ).rows[0].id;
});

describe('Stripe webhook', () => {
  it('rejects a missing or wrong signature without touching the database', async () => {
    const body = event('evt_a', 'checkout.session.completed', {
      mode: 'subscription',
      payment_status: 'paid',
      client_reference_id: orgId,
      customer: 'cus_1',
    });
    await expect(
      handleWebhook(db, { webhookSecret: secret }, body, null, stripe),
    ).rejects.toMatchObject({ code: 'NO_SIGNATURE' });
    await expect(
      handleWebhook(
        db,
        { webhookSecret: secret },
        body,
        sign(body, 'whsec_other'),
        stripe,
      ),
    ).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    await expect(
      handleWebhook(
        db,
        { webhookSecret: secret },
        body.replace('paid', 'unpaid'),
        sign(body),
        stripe,
      ),
    ).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    expect(await plan()).toBe('free');
  });
  it('upgrades on checkout once, even if Stripe retries the event', async () => {
    const body = event('evt_b', 'checkout.session.completed', {
      mode: 'subscription',
      payment_status: 'paid',
      client_reference_id: orgId,
      customer: 'cus_1',
    });
    expect(
      await handleWebhook(
        db,
        { webhookSecret: secret },
        body,
        sign(body),
        stripe,
      ),
    ).toEqual({ applied: true, ignored: false });
    expect(
      await handleWebhook(
        db,
        { webhookSecret: secret },
        body,
        sign(body),
        stripe,
      ),
    ).toEqual({ applied: false, ignored: false });
    expect(await plan()).toBe('pro');
    const audit = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'billing'`,
    );
    expect(audit.rows[0].n).toBe(1);
  });
  it('downgrades when the subscription ends, matched by customer', async () => {
    const body = event('evt_c', 'customer.subscription.deleted', {
      status: 'canceled',
      customer: 'cus_1',
      metadata: {},
    });
    await handleWebhook(
      db,
      { webhookSecret: secret },
      body,
      sign(body),
      stripe,
    );
    expect(await plan()).toBe('free');
  });
  it('ignores an older event that Stripe delivers after a newer one', async () => {
    const newer = event(
      'evt_f',
      'customer.subscription.deleted',
      { status: 'canceled', customer: 'cus_1', metadata: {} },
      300,
    );
    const older = event(
      'evt_g',
      'customer.subscription.updated',
      { status: 'active', customer: 'cus_1', metadata: {} },
      200,
    );
    for (const body of [newer, older])
      await handleWebhook(
        db,
        { webhookSecret: secret },
        body,
        sign(body),
        stripe,
      );
    expect(await plan()).toBe('free');
  });
  it('ignores unrelated events', () => {
    expect(
      planChange(JSON.parse(event('evt_d', 'invoice.paid', {}))),
    ).toBeNull();
    expect(
      planChange(
        JSON.parse(
          event('evt_e', 'customer.subscription.updated', {
            status: 'past_due',
            customer: 'cus_1',
            metadata: {},
          }),
        ),
      )?.plan,
    ).toBe('free');
  });
});
