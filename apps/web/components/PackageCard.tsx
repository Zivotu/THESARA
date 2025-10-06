'use client';

import { useRouter } from 'next/navigation';

export interface PackageCardProps {
  name: string;
  description?: string;
  features?: string[];
  price?: number;
  currency?: string;
  cta: string;
  href: string;
}

export default function PackageCard({
  name,
  description,
  features = [],
  price,
  currency,
  cta,
  href,
}: PackageCardProps) {
  const router = useRouter();

  const formatPrice = (p: number, c: string) =>
    new Intl.NumberFormat('hr-HR', { style: 'currency', currency: c }).format(p / 100);

  return (
    <div className="border rounded-lg p-6 space-y-4 bg-white shadow-md flex flex-col">
      <h3 className="text-xl font-semibold text-gray-900">{name}</h3>
      {description && <p className="text-sm text-gray-600">{description}</p>}
      {features.length > 0 && (
        <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1 flex-1">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {price != null && currency && (
        <div className="text-lg font-medium text-blue-600">
          {formatPrice(price, currency)}
        </div>
      )}
      <button
        onClick={() => router.push(href)}
        className="mt-4 px-4 py-3 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        {cta}
      </button>
    </div>
  );
}
