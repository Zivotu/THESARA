import { GOLD_PRICE_ID, NOADS_PRICE_ID } from '../billing.js';

export interface Package {
  id: string;
  name: string;
  description: string;
  features: string[];
  tier: string;
  priceId: string;
  price?: number;
  currency?: string;
}

export const PACKAGES: Package[] = [
  {
    id: 'gold',
    name: 'Gold',
    description: 'Gold plan with extended limits and features',
    features: [
      'Prošireni limiti',
      'Priority support',
      'Premium predlošci',
    ],
    tier: 'pro',
    priceId: GOLD_PRICE_ID,
  },
  {
    id: 'noads',
    name: 'No Ads',
    description: 'Remove ads from apps',
    features: ['Bez oglasa'],
    tier: 'addon',
    priceId: NOADS_PRICE_ID,
  },
].filter((p): p is Package => Boolean(p.priceId));
