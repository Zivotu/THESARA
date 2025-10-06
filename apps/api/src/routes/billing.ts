import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createOrReuseAccount,
  createCheckoutSession,
  createAppSubscription,
  createCreatorAllAccessSubscription,
  createSubscriptionByPriceId,
  createPortalSession,
  listInvoices,
  refundWithConnect,
  handleWebhook,
  upgradeSubscription,
  downgradeSubscription,
  cancelSubscription,
  syncCheckoutSession,
  listPackages,
  dbAccess,
} from '../billing/service.js';
import {
  GOLD_PRICE_ID,
  NOADS_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  stripe,
} from '../billing.js';
import { requireRole } from '../middleware/auth.js';
import {
  getSubscription,
  listBillingEventsForUser,
  getStripeCustomerIdForUser,
} from '../db.js';
import { ForbiddenError } from '../lib/errors.js';

/** Register billing and Stripe routes. */
export default async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/packages', async (req, reply) => {
    const pkgs = await listPackages();
    reply.send(pkgs);
  });

  /** Creator onboarding to Stripe Connect */
  app.post(
    '/billing/connect/onboard',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const schema = z.object({
        creatorId: z.string(),
        returnUrl: z.string().url(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      const { creatorId, returnUrl } = parsed.data;
      const isAdmin =
        req.authUser!.role === 'admin' ||
        (req.authUser!.claims as any).admin === true;
      if (req.authUser!.uid !== creatorId && !isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        const res = await createOrReuseAccount(creatorId, returnUrl);
        reply.send(res);
      } catch (e) {
        app.log.error(e);
        reply.code(500).send({ error: 'onboard_failed' });
      }
    },
  );

  /** Creator Connect status (for CTA banners in UI) */
  app.get(
    '/billing/connect/status',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const schema = z.object({ creatorId: z.string() });
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      const { creatorId } = parsed.data;
      const isAdmin =
        req.authUser!.role === 'admin' ||
        (req.authUser!.claims as any).admin === true;
      if (req.authUser!.uid !== creatorId && !isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        const { getConnectStatus } = await import('../billing/service.js');
        const status = await getConnectStatus(creatorId);
        reply.send(status);
      } catch (e) {
        app.log.error(e);
        reply.code(500).send({ error: 'status_failed' });
      }
    },
  );

  /** Express dashboard link so creator can manage payout method */
  app.post(
    '/billing/connect/dashboard',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const schema = z.object({ creatorId: z.string() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      const { creatorId } = parsed.data;
      const isAdmin =
        req.authUser!.role === 'admin' ||
        (req.authUser!.claims as any).admin === true;
      if (req.authUser!.uid !== creatorId && !isAdmin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        const { createExpressDashboardLink } = await import('../billing/service.js');
        const link = await createExpressDashboardLink(creatorId);
        reply.send(link);
      } catch (e) {
        app.log.error(e);
        reply.code(500).send({ error: 'dashboard_link_failed' });
      }
    },
  );

  /** Dynamic checkout with Connect split */
  app.post('/billing/checkout', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({
      creatorId: z.string(),
      title: z.string(),
      amountCents: z.number().int().min(50).max(500_000),
      currency: z.enum(['usd', 'eur']),
      customerEmail: z.string().email().optional(),
      metadata: z.record(z.string()).optional(),
      idempotencyKey: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { idempotencyKey, ...data } = parsed.data;
      const session = await createCheckoutSession(
        data,
        req.authUser!.uid,
        idempotencyKey,
      );
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  app.post('/billing/subscriptions', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({
      priceId: z.string(),
      customerEmail: z.string().email().optional(),
      idempotencyKey: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { priceId, customerEmail, idempotencyKey } = parsed.data;
      const session = await createSubscriptionByPriceId(
        priceId,
        req.authUser!.uid,
        customerEmail,
        undefined,
        idempotencyKey,
      );
      if (session?.alreadySubscribed) {
        return reply.code(200).send(session);
      }
      if (session?.id) {
        return reply.send({ ok: true, sessionId: session.id });
      }
      if (session?.url) {
        return reply.send({ ok: true, url: session.url });
      }
      return reply.status(500).send({ ok: false, error: 'no_session_returned' });
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  /** Fixed subscription: Gold Creator */
  app.post('/billing/subscriptions/gold', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({ customerEmail: z.string().email().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      if (!GOLD_PRICE_ID) {
        return reply.code(500).send({ error: 'missing_gold_price_id' });
      }
      const session = await createSubscriptionByPriceId(
        GOLD_PRICE_ID,
        req.authUser!.uid,
        parsed.data.customerEmail,
      );
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  /** Fixed subscription: No-Ads add-on */
  app.post('/billing/subscriptions/no-ads', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({ customerEmail: z.string().email().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      if (!NOADS_PRICE_ID) {
        return reply.code(500).send({ error: 'missing_noads_price_id' });
      }
      const session = await createSubscriptionByPriceId(
        NOADS_PRICE_ID,
        req.authUser!.uid,
        parsed.data.customerEmail,
      );
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  /** Subscription for a specific app */
  app.post('/billing/subscriptions/app', { preHandler: requireRole('user') }, async (req, reply) => {
    app.log.info({ bodyKeys: Object.keys(req.body), appIdType: typeof req.body.appId }, 'billing_subscriptions_app_pre_validation');
    const schema = z.object({
      appId: z.string(),
      customerEmail: z.string().email().optional(),
      idempotencyKey: z.string().uuid().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      if (process.env.NODE_ENV === 'development') {
        app.log.error(parsed.error.issues, 'billing_subscriptions_app_validation_error');
      }
      return reply.code(400).send({ error: 'invalid_input' });
    }
    try {
      const { appId, customerEmail, idempotencyKey } = parsed.data;
      const session = await createAppSubscription(
        appId,
        req.authUser!.uid,
        customerEmail,
        undefined,
        idempotencyKey,
      );
      if (session?.alreadySubscribed) {
        return reply.code(200).send(session);
      }
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  /** Subscription for creator all-access */
  app.post('/billing/subscriptions/creator', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({
      creatorId: z.string(),
      customerEmail: z.string().email().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { creatorId, customerEmail } = parsed.data;
      const session = await createCreatorAllAccessSubscription(
        creatorId,
        req.authUser!.uid,
        customerEmail,
      );
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'checkout_failed' });
    }
  });

  /** Upgrade an existing subscription */
  app.post('/billing/subscriptions/upgrade', async (req, reply) => {
    const schema = z.object({
      subscriptionId: z.string(),
      priceId: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { subscriptionId, priceId } = parsed.data;
      const result = await upgradeSubscription(subscriptionId, priceId);
      reply.send(result);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'upgrade_failed' });
    }
  });

  /** Downgrade an existing subscription */
  app.post('/billing/subscriptions/downgrade', async (req, reply) => {
    const schema = z.object({
      subscriptionId: z.string(),
      priceId: z.string(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const { subscriptionId, priceId } = parsed.data;
      const result = await downgradeSubscription(subscriptionId, priceId);
      reply.send(result);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'downgrade_failed' });
    }
  });

  /** Cancel a subscription at period end */
  app.post('/billing/subscriptions/cancel', async (req, reply) => {
    const schema = z.object({ subscriptionId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const result = await cancelSubscription(parsed.data.subscriptionId);
      reply.send(result);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'cancel_failed' });
    }
  });

  /** Sync checkout session after redirect */
  app.post(
    '/billing/sync-checkout',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const schema = z.object({ session_id: z.string() });
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      try {
        const result = await syncCheckoutSession(
          parsed.data.session_id,
          req.authUser!.uid,
        );
      app.log.info(
        { sessionId: parsed.data.session_id, result },
        'billing_sync',
      );
      reply.send({ ok: true, subscriptionId: result?.id, status: result?.status });
    } catch (e) {
      if (e instanceof ForbiddenError) {
        // Explicit 403 for mismatched checkout sessions
        return reply
          .code(403)
          .send({ error: (e as Error).message || 'forbidden' });
      }
      app.log.error(e, 'billing_sync_failed');
      reply.code(500).send({ error: 'sync_failed' });
    }
  });

  /** Subscription status lookup */
  app.get(
    '/billing/subscription-status',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      const schema = z.object({ sub_id: z.string() });
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
      try {
        const sub = await getSubscription(parsed.data.sub_id);
        if (!sub || sub.userId !== req.authUser!.uid) {
          return reply.send({ exists: false });
        }
        reply.send({ exists: true, ...sub });
      } catch (e) {
        app.log.error(e, 'subscription_status_failed');
        reply.code(500).send({ error: 'status_failed' });
      }
    },
  );

  /** Billing history for current user */
  app.get(
    '/billing/history',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      try {
        const events = await listBillingEventsForUser(req.authUser!.uid);
        reply.send(events);
      } catch (e) {
        app.log.error(e, 'billing_history_failed');
        reply.code(500).send({ error: 'history_failed' });
      }
    },
  );

  app.get(
    '/billing/transactions',
    { preHandler: requireRole('user') },
    async (req, reply) => {
      try {
        const customerId = await getStripeCustomerIdForUser(req.authUser!.uid);
        if (!customerId) {
          reply.send({ invoices: [], nextPaymentDate: undefined });
          return;
        }
        const data = await listInvoices(customerId);
        reply.send(data);
      } catch (e) {
        app.log.error(e, 'billing_transactions_failed');
        reply.code(500).send({ error: 'transactions_failed' });
      }
    },
  );

  /** List customer invoices */
  app.get('/billing/invoices', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({ customerId: z.string() });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const data = await listInvoices(parsed.data.customerId);
      reply.send(data);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'invoices_failed' });
    }
  });

  /** Customer portal session */
  app.post('/billing/portal', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({ customerId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const userCustomerId = await getStripeCustomerIdForUser(req.authUser!.uid);
      if (!userCustomerId || userCustomerId !== parsed.data.customerId) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const session = await createPortalSession(parsed.data.customerId);
      reply.send(session);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'portal_failed' });
    }
  });

  /** Refund a one-time payment */
  app.post('/billing/refund', { preHandler: requireRole('user') }, async (req, reply) => {
    const schema = z.object({ paymentIntentId: z.string() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    try {
      const refund = await refundWithConnect(parsed.data.paymentIntentId);
      reply.send(refund);
    } catch (e) {
      app.log.error(e);
      reply.code(500).send({ error: 'refund_failed' });
    }
  });

  /** Stripe webhook handler */
  app.post(
    '/billing/stripe/webhook',
    { config: { rawBody: true } },
    async (req, reply) => {
      const sig = req.headers['stripe-signature'] as string | undefined;
      const raw = (req as any).rawBody as string | undefined;
      if (!sig || !raw) {
        app.log.warn({ hasSig: !!sig, hasRaw: !!raw }, 'stripe_webhook_bad_req');
        return reply.code(400).send({ error: 'bad_request' });
      }
      let event: any;
      try {
        event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);
      } catch (e) {
        app.log.warn(e, 'stripe_webhook_invalid_sig');
        return reply.code(400).send({ error: 'invalid_signature' });
      }
      try {
        app.log.info({ id: event.id, type: event.type }, 'stripe_webhook_received');
        if (await dbAccess.hasProcessedEvent(event.id)) {
          return reply.send({ received: true });
        }
        const info = await handleWebhook(event);
        app.log.info(
          { id: event.id, type: event.type, ...info },
          'stripe_webhook_ok',
        );
      } catch (e) {
        app.log.error(
          { err: e, id: event.id, type: event.type },
          'stripe_handler_error',
        );
        return reply.code(500).send({ error: 'handler_error' });
      }
      return reply.send({ received: true });
    },
  );
}


