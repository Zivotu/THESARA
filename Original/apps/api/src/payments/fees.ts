import { getConfig } from '../config.js';

const { STRIPE } = getConfig();
const PLATFORM_FEE_PERCENT = STRIPE.platformFeePercent;

export function calculatePlatformFee(amount: number) {
  const fee = Math.round(amount * PLATFORM_FEE_PERCENT) / 100;
  const payout = amount - fee;
  return {
    total: amount,
    feePercent: PLATFORM_FEE_PERCENT,
    fee,
    payout,
  };
}

export function getPlatformFeePercent() {
  return PLATFORM_FEE_PERCENT;
}
