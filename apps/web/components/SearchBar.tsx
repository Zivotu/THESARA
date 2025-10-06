'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SearchBar() {
  const router = useRouter();
  const [lokacija, setLokacija] = useState('');
  const [cijenaMin, setCijenaMin] = useState('');
  const [cijenaMax, setCijenaMax] = useState('');
  const [kategorija, setKategorija] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (lokacija) params.set('lokacija', lokacija);
    if (cijenaMin) params.set('cijenaMin', cijenaMin);
    if (cijenaMax) params.set('cijenaMax', cijenaMax);
    if (kategorija) params.set('kategorija', kategorija);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-4">
      <input
        value={lokacija}
        onChange={(e) => setLokacija(e.target.value)}
        placeholder="Lokacija"
        className="border p-2 rounded"
      />
      <input
        value={cijenaMin}
        onChange={(e) => setCijenaMin(e.target.value)}
        placeholder="Min cijena"
        type="number"
        className="border p-2 rounded w-24"
      />
      <input
        value={cijenaMax}
        onChange={(e) => setCijenaMax(e.target.value)}
        placeholder="Max cijena"
        type="number"
        className="border p-2 rounded w-24"
      />
      <input
        value={kategorija}
        onChange={(e) => setKategorija(e.target.value)}
        placeholder="Kategorija"
        className="border p-2 rounded"
      />
      <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
        Pretraži
      </button>
    </form>
  );
}
