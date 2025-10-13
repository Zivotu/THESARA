import { stripe } from '../billing.js';
import { upsertCreator, readApps, writeApps, type Creator, type AppRecord } from '../db.js';
import { getConfig } from '../config.js';

const { PRICE_MIN, PRICE_MAX } = getConfig();

export const MIN_PRICE = PRICE_MIN; // USD
export const MAX_PRICE = PRICE_MAX; // USD

if (Number.isNaN(MIN_PRICE) || Number.isNaN(MAX_PRICE) || MIN_PRICE > MAX_PRICE) {
  throw new Error('invalid_price_config');
}

function assertPriceRange(amount: number) {
  if (amount < MIN_PRICE || amount > MAX_PRICE) {
    throw new Error('price_out_of_range');
  }
}

type EnsurePriceArgs = {
  creatorId?: string;
  appId?: string;
  currency: string;
  interval: string;
  amount: number;
};

export async function ensurePrice({
  creatorId,
  appId,
  currency,
  interval,
  amount,
}: EnsurePriceArgs): Promise<{ productId: string; priceId: string }> {
  if ((creatorId ? 1 : 0) + (appId ? 1 : 0) !== 1) {
    throw new Error('must_provide_creator_or_app');
  }
  const meta = creatorId ? { creatorId } : { appId: appId! };
  const query = `metadata['${creatorId ? 'creatorId' : 'appId'}']:'${
    creatorId ?? appId
  }'`;
  let productId: string | undefined;
  try {
    const res = await stripe.products.search({ query, limit: 1 });
    productId = res.data[0]?.id;
  } catch {}
  if (!productId) {
    const product = await stripe.products.create({
      name: creatorId ? `Creator ${creatorId}` : `App ${appId}`,
      metadata: meta,
    });
    productId = product.id;
  }

  const unitAmount = Math.round(amount * 100);
  const prices = await stripe.prices.list({ product: productId, limit: 100 });
  const found = prices.data.find(
    (p) =>
      p.currency === currency &&
      p.recurring?.interval === interval &&
      p.unit_amount === unitAmount,
  );
  let priceId: string;
  if (found) {
    priceId = found.id;
  } else {
    const price = await stripe.prices.create({
      product: productId,
      currency,
      unit_amount: unitAmount,
      recurring: { interval },
      metadata: meta,
    });
    priceId = price.id;
  }
  return { productId, priceId };
}

/**
 * Ensure Stripe Product/Price exist for a creator.
 * Creates a monthly recurring price using the creator's price field.
 */
export async function ensureCreatorProductPrice(creator: Creator): Promise<Creator> {
  const amount = typeof (creator as any).price === 'number' ? (creator as any).price : 0;
  if (!amount) return creator;
  assertPriceRange(amount);

  const { productId, priceId } = await ensurePrice({
    creatorId: creator.id,
    currency: 'usd',
    interval: 'month',
    amount,
  });
  creator.stripeProductId = productId;
  creator.stripePriceId = priceId;

  await upsertCreator(creator);
  return creator;
}

/**
 * Ensure Stripe Product/Price exist for creator's all-access subscription.
 * Uses the `allAccessPrice` field on the creator object.
 */
export async function ensureCreatorAllAccessProductPrice(
  creator: Creator
): Promise<Creator> {
  const amount =
    typeof (creator as any).allAccessPrice === 'number'
      ? (creator as any).allAccessPrice
      : 0;
  if (!amount) return creator;
  assertPriceRange(amount);

  const { productId, priceId } = await ensurePrice({
    creatorId: creator.id,
    currency: 'usd',
    interval: 'month',
    amount,
  });
  creator.stripeAllAccessProductId = productId;
  creator.stripeAllAccessPriceId = priceId;

  await upsertCreator(creator);
  return creator;
}

/**
 * Ensure Stripe Product/Price exist for an app.
 * Expects a `price` field on the app object.
 */
export async function ensureAppProductPrice(app: AppRecord): Promise<AppRecord> {
  const amount = typeof (app as any).price === 'number' ? (app as any).price : 0;
  if (!amount) return app;
  assertPriceRange(amount);

  const { productId, priceId } = await ensurePrice({
    appId: app.id,
    currency: 'usd',
    interval: 'month',
    amount,
  });
  app.stripeProductId = productId;
  app.stripePriceId = priceId;

  const all: AppRecord[] = await readApps();
  const idx = all.findIndex((x: AppRecord) => x.id === app.id);
  if (idx >= 0) {
    all[idx] = app;
    await writeApps(all);
  }

  console.log('ensure_app_product_price', {
    appId: app.id,
    slug: (app as any).slug,
    priceId,
    currency: 'usd',
    interval: 'month',
    unit_amount: Math.round(amount * 100),
  });

  return app;
}
