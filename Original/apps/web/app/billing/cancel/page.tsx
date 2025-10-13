'use client';

import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Payment cancelled</h1>
      <p>Your payment was cancelled. You can try again anytime.</p>
      <Link href="/" className="block mt-4 underline text-blue-500">
        Go back home
      </Link>
    </div>
  );
}

