import Stripe from 'stripe';
import { getConfig } from './config.js';

const { STRIPE, PUBLIC_BASE: PUBLIC_BASE_URL } = getConfig();

export const PUBLIC_BASE = PUBLIC_BASE_URL;

export const STRIPE_SECRET_KEY = STRIPE.secretKey;
export const STRIPE_WEBHOOK_SECRET = STRIPE.webhookSecret;
export const STRIPE_SUCCESS_URL = STRIPE.successUrl;
export const STRIPE_CANCEL_URL = STRIPE.cancelUrl;
export const PLATFORM_FEE_PERCENT = STRIPE.platformFeePercent;
export const GOLD_PRICE_ID = STRIPE.goldPriceId;
export const NOADS_PRICE_ID = STRIPE.noadsPriceId;
export const STRIPE_LOGO_URL = STRIPE.logoUrl;
export const STRIPE_PRIMARY_COLOR = STRIPE.primaryColor;
export const STRIPE_AUTOMATIC_TAX = STRIPE.automaticTax;

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20' as any,
});

export const retrieveOnPlatform = <T>(
  fn: (opts?: Stripe.RequestOptions) => Promise<T>,
) => fn();

export const retrieveOnConnected = <T>(
  acct: string,
  fn: (opts: Stripe.RequestOptions) => Promise<T>,
) => fn({ stripeAccount: acct });

/** Compute platform fee in integer cents. */
export function computePlatformFee(amountCents: number, percent: number): number {
  // Accept either fraction (0.7) or percent (70)
  const p = percent <= 1 ? percent : percent / 100;
  return Math.round(amountCents * p);
}

/** Convert env percent (fraction or 0-100) to Stripe percent (0-100). */
export function toStripePercent(percent: number): number {
  return percent <= 1 ? percent * 100 : percent;
}
