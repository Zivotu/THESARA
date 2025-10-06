import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Aplikacija je deaktivirana',
  robots: { index: false, follow: false },
};

export default function InactivePage() {
  return (
    <div className="p-4 text-center">
      <h1 className="text-2xl font-bold">Ova aplikacija je privremeno deaktivirana.</h1>
      <p className="mt-2 text-gray-500">Pokušajte kasnije ili kontaktirajte kreatora.</p>
      <Link href="/" className="mt-4 inline-block text-blue-500 underline">← Početna</Link>
    </div>
  );
}
