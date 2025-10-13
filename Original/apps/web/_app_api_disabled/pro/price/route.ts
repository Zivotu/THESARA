import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Returns the price for a selected plan/package. The plan is taken from the
// `plan` or `package` query parameter. Prices are looked up from environment
// variables following the `PRO_<PLAN>_PRICE` naming convention and fall back to
// `PRO_MONTHLY_PRICE` or a hardcoded default.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const plan =
    searchParams.get('plan') || searchParams.get('package') || 'monthly';
  const envKey = `PRO_${plan.toUpperCase()}_PRICE`;
  const price = Number(
    process.env[envKey] ?? process.env.PRO_MONTHLY_PRICE ?? 14.99,
  );
  return NextResponse.json({ price });
}
