import Stripe from 'stripe';
import {
  STRIPE_CANCEL_URL,
  STRIPE_SUCCESS_URL,
  PLATFORM_FEE_PERCENT,
  STRIPE_LOGO_URL,
  STRIPE_PRIMARY_COLOR,
  STRIPE_AUTOMATIC_TAX,
  stripe,
  computePlatformFee,
  toStripePercent,
  PUBLIC_BASE,
  GOLD_PRICE_ID,
  NOADS_PRICE_ID,
} from '../billing.js';
import { Package, PACKAGES } from './packages.js';
import { ensureAppProductPrice } from './products.js';
import {
  getStripeAccountId,
  setStripeAccountId,
  addPaymentRecord,
  upsertSubscription,
  upsertUserSubscription,
  getSubscription,
  hasProcessedEvent,
  markEventProcessed,
  upsertEntitlement,
  readApps,
  readCreators,
  listEntitlements,
  hasAppSubscription,
  hasCreatorAllAccess,
  hasSubscriptionByPriceId,
  getUserIdByStripeCustomerId,
  setStripeCustomerIdForUser,
  logBillingEvent,
  logUnmappedBillingEvent,
  getAppByIdOrSlug,
} from '../db.js';
import { enforceAppLimit } from '../lib/appLimit.js';
import { ForbiddenError } from '../lib/errors.js';
import { hasPurchaseAccess } from '../purchaseAccess.js';
import { app } from '../index.js';

export const dbAccess = {
  getStripeAccountId,
  setStripeAccountId,
  addPaymentRecord,
  logBillingEvent,
  logUnmappedBillingEvent,
  upsertSubscription,
  upsertUserSubscription,
  getSubscription,
  hasProcessedEvent,
  markEventProcessed,
  upsertEntitlement,
  readCreators,
  readApps,
  getAppByIdOrSlug,
  listEntitlements,
  hasAppSubscription,
  hasCreatorAllAccess,
  hasSubscriptionByPriceId,
  getUserIdByStripeCustomerId,
  setStripeCustomerIdForUser,
};

/** Default descriptor shown on statements */
const STATEMENT_DESCRIPTOR = 'CreateX';

export async function listPackages(): Promise<Package[]> {
  return Promise.all(
    PACKAGES.map(async (p) => {
      try {
        const price = await stripe.prices.retrieve(p.priceId);
        return {
          ...p,
          price: price.unit_amount ?? undefined,
          currency: price.currency,
        };
      } catch {
        return p;
      }
    }),
  );
}

export function cleanUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .map((v) => cleanUndefined(v))
      .filter((v) => v !== undefined) as any;
  }
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      if (v === undefined) continue;
      out[k] = cleanUndefined(v);
    }
    return out;
  }
  return obj;
}

export function buildCheckoutPayload(
  body: Record<string, any>,
  mode: 'payment' | 'subscription',
) {
  const allowed =
    mode === 'subscription'
      ? [
          'line_items',
          'customer',
          'customer_email',
          'automatic_tax',
          'allow_promotion_codes',
          'success_url',
          'cancel_url',
          'custom_text',
          'subscription_data',
        ]
      : [
          'line_items',
          'customer',
          'customer_email',
          'customer_creation',
          'customer_update',
          'automatic_tax',
          'allow_promotion_codes',
          'success_url',
          'cancel_url',
          'custom_text',
          'payment_intent_data',
          'metadata',
        ];
  const payload: Record<string, any> = { mode };
  for (const key of allowed) {
    if (body[key] !== undefined) {
      payload[key] = body[key];
    }
  }
  return cleanUndefined(payload);
}

const PRICE_ID_MAP_TTL_MS = Number(process.env.PRICE_ID_MAP_TTL_MS || 60_000);
const priceIdMap = new Map<
  string,
  { appId?: string; creatorId?: string; priceId?: string }
>();
let priceIdMapBuiltAt = 0;

async function buildPriceIdMap(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - priceIdMapBuiltAt < PRICE_ID_MAP_TTL_MS && priceIdMap.size) {
    return;
  }
  priceIdMapBuiltAt = now;
  priceIdMap.clear();
  const [apps, creators] = await Promise.all([
    dbAccess.readApps(['stripePriceId']),
    dbAccess.readCreators(['stripeAllAccessPriceId', 'stripePriceId']),
  ]);
  for (const app of apps as any[]) {
    const id = (app as any).stripePriceId;
    if (id) {
      priceIdMap.set(id, { appId: app.id });
      priceIdMap.set(`appId:${app.id}`, { priceId: id });
    }
  }
  for (const creator of creators as any[]) {
    const priceId =
      (creator as any).stripeAllAccessPriceId || (creator as any).stripePriceId;
    if (priceId) {
      priceIdMap.set(priceId, { creatorId: creator.id });
      priceIdMap.set(`creatorId:${creator.id}`, { priceId });
    }
  }
}

async function getPriceMetadata(priceId: string) {
  await buildPriceIdMap();
  return priceIdMap.get(priceId);
}

export async function getCreatorAccount(creatorId: string) {
  return dbAccess.getStripeAccountId(creatorId);
}

/**
 * Create or reuse a Standard connected account and return onboarding link
 */
export async function createOrReuseAccount(
  creatorId: string,
  returnUrl: string,
) {
  let accountId = await dbAccess.getStripeAccountId(creatorId);
  if (!accountId) {
    // Use Express so we can manage payout schedule and provide dashboard links
    const acc = await stripe.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    } as any);
    accountId = acc.id;
    await dbAccess.setStripeAccountId(creatorId, accountId);
  }
  // Ensure 3-day payout delay (best-effort; depends on account country/risk)
  try {
    await stripe.accounts.update(accountId, {
      settings: { payouts: { schedule: { interval: 'daily', delay_days: 3 } } },
    } as any);
  } catch (err) {
    app.log.warn(err, 'stripe_payout_schedule_update_failed');
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: STRIPE_CANCEL_URL || PUBLIC_BASE,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return { url: link.url, accountId };
}

interface CheckoutInput {
  creatorId: string;
  title: string;
  amountCents: number;
  currency: 'usd' | 'eur';
  customerEmail?: string;
  customerId?: string;
  images?: string;
  metadata?: Record<string, string>;
}

/** Create a dynamic checkout session with Connect split */
export async function createCheckoutSession(
  data: CheckoutInput,
  userId: string,
  idempotencyKey?: string
) {
  const connectedAccountId = await dbAccess.getStripeAccountId(data.creatorId);
  if (!connectedAccountId) {
    throw new Error('creator_not_onboarded');
  }
  if (data.amountCents < 50 || data.amountCents > 500000) {
    throw new Error('amount_out_of_range');
  }
  const listingId = data.metadata?.listingId;
  if (listingId) {
    const ents = (await dbAccess.listEntitlements(userId)).filter(
      (e: any) => e.active !== false,
    );
    if (hasPurchaseAccess(ents as any, listingId)) {
      return { ok: true, purchaseNotNeeded: true } as const;
    }
  }
  const fee = computePlatformFee(data.amountCents, PLATFORM_FEE_PERCENT);
  const payload = buildCheckoutPayload(
    {
      customer: data.customerId,
      customer_email: data.customerEmail,
      customer_creation: 'always',
      customer_update: { address: 'auto' },
      automatic_tax: STRIPE_AUTOMATIC_TAX ? { enabled: true } : undefined,
      line_items: [
        {
          price_data: {
            currency: data.currency,
            unit_amount: data.amountCents,
            product_data: {
              name: data.title,
              images: data.images ? [data.images] : undefined,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: fee,
        transfer_data: { destination: connectedAccountId },
        receipt_email: data.customerEmail,
        statement_descriptor: STATEMENT_DESCRIPTOR,
      },
      metadata: { creatorId: data.creatorId, ...data.metadata },
      custom_text: { submit: { message: 'Complete your purchase' } },
      success_url: `${STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: STRIPE_CANCEL_URL,
    },
    'payment',
  );
  payload.client_reference_id = userId;
  payload.metadata = { ...(payload.metadata || {}), userId };
  console.log('stripe.create payload keys:', Object.keys(payload));
  const session = await stripe.checkout.sessions.create(payload, { idempotencyKey });
  return { id: session.id, url: session.url };
}

/** Create subscription checkout session for a fixed price */
async function createFixedSubscription(
  priceId: string,
  userId: string,
  customerEmail?: string,
  customerId?: string,
  idempotencyKey?: string,
  ctx?: { appId?: string; hasActive?: boolean },
) {
  // Determine connected account for revenue split based on priceId
  let destinationAccount: string | undefined;
  let hasOwnerMeta = false;
  try {
    const meta = await getPriceMetadata(priceId);
    if (meta?.creatorId) {
      hasOwnerMeta = true;
      destinationAccount = await dbAccess.getStripeAccountId(meta.creatorId);
    } else if (meta?.appId) {
      hasOwnerMeta = true;
      const app = await dbAccess.getAppByIdOrSlug(meta.appId);
      const ownerUid = (app as any)?.author?.uid || (app as any)?.ownerUid;
      if (ownerUid) destinationAccount = await dbAccess.getStripeAccountId(ownerUid);
    }
  } catch {}
  if (hasOwnerMeta && !destinationAccount) {
    throw new Error('creator_not_onboarded');
  }

  // Build subscription_data with optional Connect transfer and platform fee percent
  const subscriptionData: any = { metadata: { userId } };
  if (destinationAccount) {
    subscriptionData.transfer_data = { destination: destinationAccount };
    subscriptionData.application_fee_percent = toStripePercent(PLATFORM_FEE_PERCENT);
  }
  const payload = buildCheckoutPayload(
    {
      customer: customerId,
      customer_email: customerEmail,
      automatic_tax: STRIPE_AUTOMATIC_TAX ? { enabled: true } : undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      custom_text: { submit: { message: 'Complete your purchase' } },
      success_url: `${STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: STRIPE_CANCEL_URL,
      subscription_data: subscriptionData,
    },
    'subscription',
  );
  payload.client_reference_id = userId;
  payload.metadata = { ...(payload.metadata || {}), userId };
  const logger = app?.log || console;
  logger.debug({ payloadKeys: Object.keys(payload) }, 'stripe_create_payload_keys');
  const session = await stripe.checkout.sessions.create(payload, { idempotencyKey });
  logger.info(
    { appId: ctx?.appId, userId, hasActive: ctx?.hasActive ?? false, sessionId: session.id },
    'billing_session_created',
  );
  return { id: session.id, url: session.url };
}

export async function getConnectStatus(creatorId: string) {
  const accountId = await dbAccess.getStripeAccountId(creatorId);
  if (!accountId) return { onboarded: false } as const;
  try {
    const acc = await stripe.accounts.retrieve(accountId);
    const status = {
      onboarded: true,
      accountId,
      charges_enabled: (acc as any).charges_enabled,
      payouts_enabled: (acc as any).payouts_enabled,
      details_submitted: (acc as any).details_submitted,
      requirements_due: ((acc as any).requirements?.currently_due || []).length,
      payout_delay_days: (acc as any).settings?.payouts?.schedule?.delay_days,
    };
    return status;
  } catch (e) {
    return { onboarded: false, accountId } as any;
  }
}

export async function createExpressDashboardLink(creatorId: string) {
  const accountId = await dbAccess.getStripeAccountId(creatorId);
  if (!accountId) throw new Error('creator_not_onboarded');
  const link = await stripe.accounts.createLoginLink(accountId);
  return { url: link.url };
}

export async function createSubscriptionByPriceId(
  priceId: string,
  userId: string,
  customerEmail?: string,
  customerId?: string,
  idempotencyKey?: string,
): Promise<{ id: string; url: string } | { alreadySubscribed: true }> {
  const hasActive = await dbAccess.hasSubscriptionByPriceId(
    userId,
    priceId,
  );
  if (hasActive) {
    return { alreadySubscribed: true } as const;
  }
  return createFixedSubscription(
    priceId,
    userId,
    customerEmail,
    customerId,
    idempotencyKey,
  );
}

async function findPriceIdByProductMetadata(
  key: 'appId' | 'creatorId',
  value: string
): Promise<string> {
  const mapKey = `${key}:${value}`;
  let priceId = priceIdMap.get(mapKey)?.priceId;
  if (!priceId) {
    await buildPriceIdMap();
    priceId = priceIdMap.get(mapKey)?.priceId;
  }
  if (!priceId) throw new Error('price_not_found');
  return priceId;
}

export function createGoldSubscription(
  userId: string,
  customerEmail?: string,
  customerId?: string
) {
  return createSubscriptionByPriceId(
    GOLD_PRICE_ID,
    userId,
    customerEmail,
    customerId,
  );
}

export function createNoAdsSubscription(
  userId: string,
  customerEmail?: string,
  customerId?: string
) {
  return createSubscriptionByPriceId(
    NOADS_PRICE_ID,
    userId,
    customerEmail,
    customerId,
  );
}

export async function createAppSubscription(
  appIdentifier: string,
  userId: string,
  customerEmail?: string,
  customerId?: string,
  idempotencyKey?: string,
): Promise<{ id: string; url: string } | { alreadySubscribed: true }> {
  const app = await dbAccess.getAppByIdOrSlug(appIdentifier);
  if (!app) throw new Error('app_not_found');
  if (app.status !== 'published' || app.state !== 'active') {
    console.error('app_inactive', {
      appId: app.id,
      slug: (app as any).slug,
      status: (app as any).status,
      state: (app as any).state,
      userId,
    });
    throw new Error('app_inactive');
  }
  const appId = app.id;
  const slug = (app as any).slug;
  const logger = app?.log || console;
  const creatorId = (app as any)?.author?.uid || (app as any)?.ownerUid;
  if (creatorId) {
    const hasAllAccess = await dbAccess.hasCreatorAllAccess(userId, creatorId);
    if (hasAllAccess) {
      logger.info(
        { appId, userId, creatorId, hasAllAccess },
        'app_subscription_session_skipped',
      );
      return { alreadySubscribed: true } as const;
    }
  }
  const hasActive = await dbAccess.hasAppSubscription(userId, appId);
  if (hasActive) {
    logger.info({ appId, userId, hasActive }, 'app_subscription_session_skipped');
    return { alreadySubscribed: true } as const;
  }

  let priceId: string;
  try {
    priceId = await findPriceIdByProductMetadata('appId', appId);
  } catch (e) {
    try {
      await ensureAppProductPrice(app as any);
      await buildPriceIdMap(true);
      priceId = await findPriceIdByProductMetadata('appId', appId);
    } catch (err) {
      console.error('app_subscription_price_missing', {
        appId,
        slug,
        creatorId: (app as any)?.author?.uid || (app as any)?.ownerUid,
        currency: 'usd',
        interval: 'month',
        unit_amount:
          typeof (app as any).price === 'number'
            ? Math.round((app as any).price * 100)
            : undefined,
      });
      throw err;
    }
  }
  if (customerId) {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      price: priceId,
      status: 'active',
    });
    if (subs.data.length > 0) {
      logger.info(
        { appId, userId, customerId, priceId },
        'app_subscription_session_skipped',
      );
      return { alreadySubscribed: true } as const;
    }
  }
  const session = await createFixedSubscription(
    priceId,
    userId,
    customerEmail,
    customerId,
    idempotencyKey,
    { appId, hasActive },
  );
  logger.info(
    { appId, userId, hasActive, sessionId: session.id },
    'app_subscription_session_created',
  );
  return session;
}

export async function createCreatorAllAccessSubscription(
  creatorId: string,
  userId: string,
  customerEmail?: string,
  customerId?: string
) {
  const hasActive = await dbAccess.hasCreatorAllAccess(userId, creatorId);
  if (hasActive) return;
  const priceId = await findPriceIdByProductMetadata('creatorId', creatorId);
  return createFixedSubscription(priceId, userId, customerEmail, customerId);
}

export async function createPortalSession(customerId: string) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: STRIPE_SUCCESS_URL,
  });
  return { url: session.url };
}

async function syncSubscription(
  sub: Stripe.Subscription,
  active: boolean,
  userId?: string,
) {
  const stripeCustomerId =
    typeof sub.customer === 'string'
      ? sub.customer
      : (sub.customer as Stripe.Customer).id;
  let uid = userId || (sub.metadata?.userId as string | undefined);
  if (!uid) {
    uid = await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId);
    if (!uid) {
      console.warn('Missing userId for customer', stripeCustomerId);
      return;
    }
  }
  const stripeSubscriptionId = sub.id;
  const existingEntitlements = await dbAccess.listEntitlements(uid);
  const itemIds = new Set(sub.items.data.map((it) => it.id));
  const currentPeriodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : undefined;
  for (const item of sub.items.data) {
    const price = item.price;
    const priceId = price.id;
    const productId =
      typeof price.product === 'string' ? price.product : price.product.id;
    const product =
      typeof price.product === 'object'
        ? (price.product as Stripe.Product)
        : await stripe.products.retrieve(productId);
    const metadata = {
      ...(product.metadata as any),
      ...(price.metadata as any),
      ...(await getPriceMetadata(priceId)),
    } as any;
    const commonData = cleanUndefined({
      stripeCustomerId,
      stripeSubscriptionId,
      currentPeriodEnd,
      expiresAt: currentPeriodEnd,
      itemId: item.id,
    });
    if (priceId === GOLD_PRICE_ID) {
      await dbAccess.upsertEntitlement(
        cleanUndefined({
          id: `gold-${item.id}`,
          userId: uid,
          feature: 'isGold',
          active,
          data: commonData,
        }),
      );
      if (!active) {
        await enforceAppLimit(uid);
      }
    } else if (priceId === NOADS_PRICE_ID) {
      await dbAccess.upsertEntitlement(
        cleanUndefined({
          id: `noAds-${item.id}`,
          userId: uid,
          feature: 'noAds',
          active,
          data: commonData,
        }),
      );
    } else if (metadata?.appId) {
      await dbAccess.upsertEntitlement(
        cleanUndefined({
          id: `appSubs-${item.id}`,
          userId: uid,
          feature: 'app-subscription',
          active,
          data: { appId: metadata.appId, ...commonData },
        }),
      );
    } else if (metadata?.creatorId) {
      await dbAccess.upsertEntitlement(
        cleanUndefined({
          id: `creatorSubs-${item.id}`,
          userId: uid,
          feature: 'creator-all-access',
          active,
          data: { creatorId: metadata.creatorId, ...commonData },
        }),
      );
    }
  }

  for (const ent of existingEntitlements as any[]) {
    if (ent.data?.stripeSubscriptionId !== stripeSubscriptionId) continue;
    const entItemId = ent.data?.itemId;
    if (entItemId && !itemIds.has(entItemId)) {
      await dbAccess.upsertEntitlement({ ...ent, active: false });
      if (ent.feature === 'isGold') {
        await enforceAppLimit(uid);
      }
    }
  }
}

/** Helper: count active subscriptions for a given price */
export async function countActiveSubscriptionsForPrice(priceId: string): Promise<number> {
  if (!priceId) return 0;
  let total = 0;
  let startingAfter: string | undefined;
  // Stripe .list supports pagination; iterate until done
  // We filter by price and status active to avoid scanning all subscriptions
  do {
    const page = await stripe.subscriptions.list({
      price: priceId,
      status: 'active',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    } as any);
    total += page.data.length;
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);
  return total;
}

export async function getCreatorSubscriptionMetrics(creatorId: string) {
  // Build app/creator mapping
  await buildPriceIdMap();
  // All‑access price for creator
  const creatorKey = `creatorId:${creatorId}`;
  const creatorPriceId = priceIdMap.get(creatorKey)?.priceId;
  let allAccessUnit: number | undefined;
  let allAccessActive = 0;
  if (creatorPriceId) {
    try {
      const price = await stripe.prices.retrieve(creatorPriceId);
      allAccessUnit = price.unit_amount ?? undefined;
    } catch {}
    try {
      allAccessActive = await countActiveSubscriptionsForPrice(creatorPriceId);
    } catch {}
  }
  // App prices for all apps belonging to creator
  const apps = await dbAccess.readApps();
  const mine = (apps as any[]).filter(
    (a) => a?.author?.uid === creatorId || (a as any).ownerUid === creatorId,
  );
  const appMetrics: Array<{ appId: string; priceId?: string; unitAmount?: number; active: number }> = [];
  for (const app of mine) {
    const appId = app.id as string;
    const priceId = (app as any).stripePriceId as string | undefined;
    let unit: number | undefined;
    let active = 0;
    if (priceId) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        unit = price.unit_amount ?? undefined;
      } catch {}
      try {
        active = await countActiveSubscriptionsForPrice(priceId);
      } catch {}
    }
    appMetrics.push({ appId, priceId, unitAmount: unit, active });
  }
  const allAccessRevenueMonthly = typeof allAccessUnit === 'number' ? allAccessActive * allAccessUnit : undefined;
  const appsRevenueMonthly = appMetrics.reduce((sum, it) => sum + (it.unitAmount ? it.active * it.unitAmount : 0), 0);
  const creatorShare = 1 - (toStripePercent(PLATFORM_FEE_PERCENT) / 100);
  const allAccessRevenueMonthlyCreator =
    typeof allAccessRevenueMonthly === 'number'
      ? Math.round(allAccessRevenueMonthly * creatorShare)
      : undefined;
  const appMetricsWithCreator = appMetrics.map((it) => ({
    ...it,
    creatorMonthly: Math.round(((it.unitAmount || 0) * it.active) * creatorShare),
  }));
  return {
    allAccess: {
      priceId: creatorPriceId,
      unitAmount: allAccessUnit,
      active: allAccessActive,
      monthlyEstimateGross: allAccessRevenueMonthly,
      monthlyEstimateCreator: allAccessRevenueMonthlyCreator,
    },
    apps: appMetricsWithCreator,
    totals: {
      monthlyEstimateGross: (allAccessRevenueMonthly ?? 0) + appsRevenueMonthly,
      monthlyEstimateCreator: Math.round(((allAccessRevenueMonthly ?? 0) + appsRevenueMonthly) * creatorShare),
    },
  };
}

/** Information extracted from handling a webhook event. */
export interface WebhookResult {
  sessionId?: string;
  subId?: string | null;
  piId?: string | null;
  mode?: Stripe.Checkout.Session.Mode;
  amountTotal?: number;
}

/** Handle incoming Stripe webhook */
export async function handleWebhook(event: Stripe.Event): Promise<WebhookResult> {
  console.log('[handleWebhook] event received', { id: event.id, type: event.type });
  if (await dbAccess.hasProcessedEvent(event.id)) {
    return {};
  }

  let result: WebhookResult = {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const stripeAccount = event.account as string | undefined;
      const retrieve = <T>(
        fn: (opts?: Stripe.RequestOptions) => Promise<T>,
      ) => (stripeAccount ? fn({ stripeAccount }) : fn());

      let full: Stripe.Checkout.Session;
      try {
        full = await retrieve((opts) =>
          stripe.checkout.sessions.retrieve(
            session.id,
            { expand: ['subscription', 'line_items', 'customer'] },
            opts,
          ),
        );
      } catch (err) {
        console.warn('checkout.session.retrieve_failed', {
          sessionId: session.id,
          err,
        });
        throw err;
      }

      const mode = full.mode;
      const items = full.line_items?.data ?? [];
      const subId =
        typeof full.subscription === 'string'
          ? full.subscription
          : full.subscription?.id ?? null;
      const piId =
        typeof full.payment_intent === 'string'
          ? full.payment_intent
          : (full.payment_intent as Stripe.PaymentIntent | null)?.id ?? null;
      const amountTotal = full.amount_total ?? 0;
      const stripeCustomerId =
        typeof full.customer === 'string'
          ? full.customer
          : full.customer?.id;

      let pi: Stripe.PaymentIntent | null = null;
      if (typeof full.payment_intent === 'object') {
        pi = full.payment_intent as Stripe.PaymentIntent;
      } else if (piId) {
        try {
          pi = await retrieve((opts) =>
            stripe.paymentIntents.retrieve(piId, opts),
          );
        } catch (err) {
          console.warn('checkout.session.pi_missing', { piId, err });
        }
      }
      const fee = pi?.application_fee_amount || undefined;
      const dest = pi?.transfer_data?.destination as any;
      const destination = typeof dest === 'string' ? dest : dest?.id;

      let userId =
        full.client_reference_id || (full.metadata?.userId as string | undefined);
      let sub: Stripe.Subscription | null = null;
      if (mode === 'subscription' && subId) {
        if (typeof full.subscription === 'string') {
          try {
            sub = await retrieve((opts) =>
              stripe.subscriptions.retrieve(
                subId,
                { expand: ['items.data.price.product'] },
                opts,
              ),
            );
          } catch (err) {
            console.warn('checkout.session.sub_missing', { subId, err });
          }
        } else {
          sub = full.subscription as Stripe.Subscription;
        }
        userId =
          userId ||
          (sub?.metadata?.userId as string | undefined) ||
          (stripeCustomerId
            ? await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId)
            : undefined);
        if (userId && sub) {
          const subData = cleanUndefined({
            id: sub.id,
            userId,
            status: sub.status,
            currentPeriodEnd: sub.current_period_end * 1000,
            cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
            customerId: stripeCustomerId,
            priceId: sub.items?.data?.[0]?.price?.id || null,
          });
          await dbAccess.upsertSubscription(subData);
          await dbAccess.upsertUserSubscription(userId, subData);
          console.log('[handleWebhook] upserted subscription', {
            subscriptionId: sub.id,
            userId,
          });
          await syncSubscription(sub, true, userId);
        }
      } else if (!userId && stripeCustomerId) {
        userId = await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId);
      }

      if (!userId) {
        console.warn('checkout.session.completed missing userId', full.id);
        await dbAccess.logBillingEvent({
          eventType: event.type,
          ts: event.created * 1000,
          status: 'error',
          details: cleanUndefined({
            sessionId: full.id,
            stripeCustomerId,
          }),
        });
        await dbAccess.logUnmappedBillingEvent({
          eventId: event.id,
          type: event.type,
          payload: full,
        });
        return result;
      }

      await dbAccess.addPaymentRecord(
        cleanUndefined({
          id: full.id,
          userId,
          eventType: event.type,
          timestamp: event.created * 1000,
          customer: full.customer,
          creatorId: full.metadata?.creatorId,
          amount_total: amountTotal,
          application_fee_amount: fee,
          destination,
        }),
      );

      if (userId) {
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          subscriptionId: sub?.id || subId || undefined,
          amount: amountTotal || undefined,
          ts: event.created * 1000,
          details: cleanUndefined({
            destination,
            fee,
            line_items: items.length,
            payment_intent: piId,
          }),
        });
        if (mode === 'payment') {
          const listingId = full.metadata?.listingId as
            | string
            | undefined;
          if (listingId) {
            await dbAccess.upsertEntitlement(
              cleanUndefined({
                id: `purchase-${listingId}`,
                userId,
                feature: 'purchase',
                active: true,
                data: { listingId },
              }),
            );
            await dbAccess.logBillingEvent({
              userId,
              eventType: 'purchase',
              amount: amountTotal || undefined,
              ts: event.created * 1000,
              details: cleanUndefined({
                listingId,
                payment_intent: piId,
              }),
            });
          }
        }
      }
      if (stripeCustomerId && userId) {
        await dbAccess.setStripeCustomerIdForUser(userId, stripeCustomerId);
      }
      console.log('[handleWebhook] checkout.session.completed', {
        sessionId: full.id,
        subscriptionId: sub?.id || subId,
        paymentIntentId: piId,
        userId,
        lineItems: items.length,
      });
      result = {
        sessionId: full.id,
        subId: sub?.id || subId,
        piId,
        mode,
        amountTotal,
      };
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const sub = event.data.object as Stripe.Subscription;
      const stripeCustomerId =
        typeof sub.customer === 'string'
          ? sub.customer
          : (sub.customer as Stripe.Customer).id;
      const userId =
        (sub.metadata?.userId as string) ||
        (await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId));
      if (userId) {
        const subData = cleanUndefined({
          id: sub.id,
          userId,
          status: sub.status,
          currentPeriodEnd: sub.current_period_end * 1000,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          customerId: stripeCustomerId,
          priceId: sub.items?.data?.[0]?.price?.id || null,
        });
        await dbAccess.upsertSubscription(subData);
        await dbAccess.upsertUserSubscription(userId, subData);
        let active: boolean;
        if (event.type === 'customer.subscription.paused') {
          active = false;
        } else if (event.type === 'customer.subscription.resumed') {
          active = true;
        } else {
          active =
            event.type !== 'customer.subscription.deleted' &&
            sub.status !== 'canceled';
        }
        await syncSubscription(sub, active, userId);
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          subscriptionId: sub.id,
          amount: sub.items?.data?.[0]?.price?.unit_amount || undefined,
          ts: event.created * 1000,
          details: cleanUndefined({ status: sub.status }),
        });
        console.log('[handleWebhook] subscription event processed', {
          eventType: event.type,
          subscriptionId: sub.id,
          userId,
        });
      } else {
        console.warn('subscription event missing userId', sub.id);
        await dbAccess.logBillingEvent({
          eventType: event.type,
          ts: event.created * 1000,
          status: 'error',
          details: cleanUndefined({
            subscriptionId: sub.id,
            stripeCustomerId,
          }),
        });
        await dbAccess.logUnmappedBillingEvent({
          eventId: event.id,
          type: event.type,
          payload: sub,
        });
        return result;
      }
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required': {
      const invoice = event.data.object as Stripe.Invoice;
      const stripeCustomerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : (invoice.customer as Stripe.Customer).id;
      const userId = await dbAccess.getUserIdByStripeCustomerId(
        stripeCustomerId,
      );
      // Log for visibility
      await dbAccess.addPaymentRecord(
        cleanUndefined({
          type: event.type,
          id: event.id,
          userId,
          eventType: event.type,
          timestamp: event.created * 1000,
        }),
      );
      if (userId) {
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          subscriptionId:
            typeof invoice.subscription === 'string'
              ? invoice.subscription
              : undefined,
          amount: invoice.total || undefined,
          ts: event.created * 1000,
          details: cleanUndefined({
            invoiceId: invoice.id,
            status: invoice.status,
          }),
        });
      }
      break;
    }
    case 'account.updated': {
      const acct = event.data.object as Stripe.Account;
      const creators = (await dbAccess.readCreators()) as any[];
      for (const creator of creators) {
        const accId = await dbAccess.getStripeAccountId(creator.id);
        if (accId === acct.id) {
          const status = await getConnectStatus(creator.id);
          await dbAccess.logBillingEvent({
            userId: creator.id,
            eventType: event.type,
            ts: event.created * 1000,
            details: cleanUndefined(status),
          });
          break;
        }
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      const stripeCustomerId =
        typeof pi.customer === 'string'
          ? pi.customer
          : (pi.customer as Stripe.Customer | null)?.id;
      const userId =
        (pi.metadata?.userId as string | undefined) ||
        (stripeCustomerId
          ? await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId)
          : undefined);
      await dbAccess.addPaymentRecord(
        cleanUndefined({
          id: pi.id,
          userId,
          eventType: event.type,
          timestamp: event.created * 1000,
          amount_received: pi.amount_received,
          customer: stripeCustomerId,
        }),
      );
      if (userId) {
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          amount: pi.amount_received || undefined,
          ts: event.created * 1000,
          details: cleanUndefined({ payment_intent: pi.id }),
        });
      }
      result = { piId: pi.id };
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const stripeCustomerId =
        typeof charge.customer === 'string'
          ? charge.customer
          : (charge.customer as Stripe.Customer | null)?.id;
      const userId =
        stripeCustomerId
          ? await dbAccess.getUserIdByStripeCustomerId(stripeCustomerId)
          : undefined;
      await dbAccess.addPaymentRecord(
        cleanUndefined({
          id: charge.id,
          userId,
          eventType: event.type,
          timestamp: event.created * 1000,
          amount_refunded: charge.amount_refunded,
          payment_intent: charge.payment_intent,
          refunded: true,
        }),
      );
      if (userId) {
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          amount: charge.amount_refunded ? -charge.amount_refunded : undefined,
          ts: event.created * 1000,
          details: cleanUndefined({
            payment_intent: charge.payment_intent,
            chargeId: charge.id,
          }),
        });
        const piId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : (charge.payment_intent as Stripe.PaymentIntent | null)?.id;
        if (piId) {
          const ents = await dbAccess.listEntitlements(userId);
          const ent = (ents as any[]).find(
            (e) =>
              e.data?.payment_intent === piId ||
              e.data?.paymentIntentId === piId ||
              e.data?.stripePaymentIntentId === piId,
          );
          if (ent) {
            await dbAccess.upsertEntitlement({ ...ent, active: false });
          }
        }
      }
      break;
    }
    case 'entitlements.active_entitlement_summary.updated': {
      const summary: any = event.data.object as any;
      const stripeCustomerId =
        summary.customer || summary.stripe_customer_id;
      const userId = await dbAccess.getUserIdByStripeCustomerId(
        stripeCustomerId,
      );
      if (userId) {
        const ents = summary.entitlements || summary.active_entitlements || [];
        const seen = new Set<string>();
        for (const ent of ents) {
          const id = ent.id || `${ent.feature}-${ent.lookup_key || 'unknown'}`;
          await dbAccess.upsertEntitlement(
            cleanUndefined({
              id,
              userId,
              feature: ent.feature,
              active: true,
              data: cleanUndefined({
                stripeEntitlementId: ent.id,
                stripeCustomerId,
              }),
            }),
          );
          seen.add(id);
        }
        const existing = await dbAccess.listEntitlements(userId);
        for (const ent of existing as any[]) {
          if (
            ent.data?.stripeCustomerId === stripeCustomerId &&
            !seen.has(ent.id)
          ) {
            await dbAccess.upsertEntitlement({ ...ent, active: false });
          }
        }
        await dbAccess.logBillingEvent({
          userId,
          eventType: event.type,
          ts: event.created * 1000,
          details: cleanUndefined({ count: ents.length }),
        });
      }
      break;
    }
    default:
      break;
  }

  await dbAccess.markEventProcessed(event.id);
  return result;
}

/**
 * Fallback endpoint to sync a checkout session after redirect.
 */
export async function syncCheckoutSession(
  sessionId: string,
  userId: string,
) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.mode !== 'subscription' || !session.subscription) {
    return null;
  }
  if (
    session.client_reference_id !== userId &&
    session.metadata?.userId !== userId
  ) {
    // Guard against accidental cross-user verification attempts
    throw new ForbiddenError('session_mismatch');
  }
  const sub = await stripe.subscriptions.retrieve(String(session.subscription));
  const subData = cleanUndefined({
    id: sub.id,
    userId,
    status: sub.status,
    currentPeriodEnd: sub.current_period_end * 1000,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    customerId:
      typeof sub.customer === 'string'
        ? sub.customer
        : (sub.customer as Stripe.Customer).id,
    priceId: sub.items?.data?.[0]?.price?.id || null,
  });
  await dbAccess.upsertSubscription(subData);
  await dbAccess.upsertUserSubscription(userId, subData);
  await syncSubscription(sub, true, userId);
  await dbAccess.addPaymentRecord(
    cleanUndefined({
      id: session.id,
      userId,
      eventType: 'checkout.session.completed.sync',
      timestamp: session.created * 1000,
      customer: session.customer,
      subscriptionId: sub.id,
      amount_total: session.amount_total,
    }),
  );
  await dbAccess.logBillingEvent({
    userId,
    eventType: 'checkout.session.completed.sync',
    subscriptionId: sub.id,
    amount: session.amount_total || undefined,
    ts: session.created * 1000,
    details: cleanUndefined({ sessionId: session.id }),
  });
  return { id: sub.id, status: sub.status };
}

/**
 * List invoices for a Stripe customer and next payment date.
 */
export async function listInvoices(customerId: string) {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 100,
  });
  const items = invoices.data
    .sort((a, b) => a.created - b.created)
    .map((inv) => ({
      id: inv.id,
      amount: inv.total ?? 0,
      currency: inv.currency ?? 'usd',
      date: new Date(inv.created * 1000).toISOString(),
      status: inv.status ?? 'unknown',
      pdf: inv.invoice_pdf || undefined,
    }));
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'active',
    limit: 1,
  });
  let nextPaymentDate: string | undefined;
  if (subs.data.length && subs.data[0].current_period_end) {
    nextPaymentDate = new Date(
      subs.data[0].current_period_end * 1000,
    ).toISOString();
  }
  return { invoices: items, nextPaymentDate };
}

/**
 * Refund helper for one-time payments with Connect.
 */
export async function refundWithConnect(paymentIntentId: string) {
  try {
    return await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reverse_transfer: true,
      refund_application_fee: true,
    });
  } catch (err) {
    console.error('stripe_refund_error', err);
    throw new Error('refund_failed');
  }
}


/** Upgrade a subscription plan to a new price */
export async function upgradeSubscription(
  subscriptionId: string,
  priceId: string
) {
  try {
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    const currentItemId = current.items.data[0]?.id;
    const sub = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      proration_behavior: 'create_prorations',
      items: [{ id: currentItemId, price: priceId }],
      metadata: { action: 'upgrade' },
    });
    return { id: sub.id, status: sub.status };
  } catch (err) {
    console.error('stripe_upgrade_error', err);
    throw new Error('upgrade_failed');
  }
}

/** Downgrade a subscription plan to a new price */
export async function downgradeSubscription(
  subscriptionId: string,
  priceId: string
) {
  try {
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    const currentItemId = current.items.data[0]?.id;
    const sub = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      proration_behavior: 'create_prorations',
      items: [{ id: currentItemId, price: priceId }],
      metadata: { action: 'downgrade' },
    });
    return { id: sub.id, status: sub.status };
  } catch (err) {
    console.error('stripe_downgrade_error', err);
    throw new Error('downgrade_failed');
  }
}

/** Cancel a subscription at period end */
export async function cancelSubscription(subscriptionId: string) {
  try {
    const sub = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    return { id: sub.id, status: sub.status };
  } catch (err) {
    console.error('stripe_cancel_error', err);
    throw new Error('cancel_failed');
  }
}

