# API Billing Setup

Set the following environment variables before running the API:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `PLATFORM_FEE_PERCENT` (0-1)
- `PRICE_MIN` (default: 0) – minimum allowed product price in USD
- `PRICE_MAX` (default: 1000) – maximum allowed product price in USD
- `GOLD_PRICE_ID` – required only when Gold subscriptions are offered
- `NOADS_PRICE_ID` – required only when No-Ads add-ons are offered
- `GOLD_MAX_APPS_PER_USER` – max apps for Gold users (default: 10)
- `FREE_MAX_APPS_PER_USER` – max apps for free users (default: 2)
- `STRIPE_LOGO_URL`
- `STRIPE_PRIMARY_COLOR`
- `PUBLIC_BASE` – base URL for redirects (fallback for Stripe URLs)

## Configuration examples

### Local development

```env
WEB_BASE=http://localhost:3000
STRIPE_SUCCESS_URL=http://localhost:3000/billing/success
```

### Production

```env
WEB_BASE=https://app.example.com
STRIPE_SUCCESS_URL=https://app.example.com/billing/success
```

Create Stripe **Price** objects for Gold and NoAds in the Dashboard (Products → Add product). After adding a price, copy its `Price ID` from the product page and set `GOLD_PRICE_ID` or `NOADS_PRICE_ID` accordingly.

## Testing Webhooks

Use the Stripe CLI to forward events:

```bash
stripe listen --forward-to localhost:8788/billing/stripe/webhook
```

Then run the API with `pnpm --filter @loopyway/api dev`.

## Creator onboarding flow

Creators use **Stripe Connect Standard** accounts. Call
`POST /billing/connect/onboard` with `{ creatorId, returnUrl }` to receive an onboarding URL. `returnUrl` should point to the creator's finances page (e.g. `https://app.example.com/u/<handle>/finances`). After a creator finishes onboarding, Stripe redirects to the provided `returnUrl`; if the flow is restarted, `STRIPE_CANCEL_URL` (or
`PUBLIC_BASE`) is used.

## Troubleshooting

If preview refresh fails or the player shows a blank page, see `docs/troubleshooting.md` for common causes and fixes (owner/admin checks, bundle not found, React hook crash hints, SES/lockdown issues).
