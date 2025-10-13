'use client';
import { useState } from 'react';
import { API_URL } from '@/lib/config';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED = ['image/jpeg', 'image/png'];

export default function NoviOglas() {
  const [opis, setOpis] = useState('');
  const [slike, setSlike] = useState<File[]>([]);
  const [preview, setPreview] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [oglasId, setOglasId] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const valid: File[] = [];
    const urls: string[] = [];
    for (const f of files) {
      if (ALLOWED.includes(f.type) && f.size <= MAX_SIZE) {
        valid.push(f);
        urls.push(URL.createObjectURL(f));
      } else {
        setError('Dozvoljene su samo JPG/PNG slike do 5MB.');
      }
    }
    setSlike(valid);
    setPreview(urls);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('');
    const fd = new FormData();
    slike.forEach((s) => fd.append('slike', s));
    const uploadRes = await fetch(`${API_URL}/upload`, { method: 'POST', body: fd });
    const { urls } = await uploadRes.json();
    const body = JSON.stringify({ opis, slike: urls });
    const res = await fetch(
      oglasId ? `${API_URL}/oglasi/${oglasId}` : `${API_URL}/oglasi`,
      {
        method: oglasId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }
    );
    const data = await res.json();
    if (data?.item?.id) setOglasId(data.item.id);
    setStatus('Spremljeno.');
  }

  async function handlePublish() {
    if (!oglasId) return;
    await fetch(`${API_URL}/oglasi/${oglasId}/publish`, { method: 'POST' });
    setStatus('Objavljeno.');
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Novi oglas</h1>
      {error && <p className="text-red-500 mb-2">{error}</p>}
      {status && <p className="text-green-600 mb-2">{status}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          value={opis}
          onChange={(e) => setOpis(e.target.value)}
          placeholder="Opis"
          className="w-full border p-2 rounded"
        />
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg"
          onChange={handleFiles}
        />
        <div className="flex gap-2 flex-wrap">
          {preview.map((src, i) => (
            <img key={i} src={src} alt="preview" className="w-24 h-24 object-cover" />
          ))}
        </div>
        <div className="flex gap-2">
          <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
            Spremi
          </button>
          {oglasId && (
            <button
              type="button"
              onClick={handlePublish}
              className="bg-green-600 text-white px-4 py-2 rounded"
            >
              Objavi
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
