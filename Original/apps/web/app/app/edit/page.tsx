"use client";

import { Suspense, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteParam } from '@/hooks/useRouteParam';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPatch } from '@/lib/api';

interface Listing {
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility: 'public' | 'unlisted';
  author?: { uid?: string };
}

export default function EditAppPage() {
  return (
    <Suspense fallback={null}>
      <EditAppClient />
    </Suspense>
  );
}

function EditAppClient() {
  const slug = useRouteParam('slug', (segments) => {
    if (segments.length > 2 && segments[0] === 'app' && segments[1] === 'edit') {
      return segments[2] ?? '';
    }
    if (segments.length > 1 && segments[0] === 'app') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const { user, loading } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug) return;
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    (async () => {
      try {
        const res = await apiGet<{ item?: Listing }>(`/listing/${encodeURIComponent(slug)}`, { auth: true });
        const item = res.item || (res as any);
        if (item?.author?.uid !== user.uid) {
          router.push(`/app?slug=${encodeURIComponent(slug)}`);
          return;
        }
        setTitle(item.title || '');
        setDescription(item.description || '');
        setTags((item.tags || []).join(', '));
        setVisibility(item.visibility || 'public');
        setLoaded(true);
      } catch (e) {
        setError('Failed to load application');
      }
    })();
  }, [slug, user, loading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setBusy(true);
    try {
      await apiPatch(`/listing/${encodeURIComponent(slug)}`, {
        title,
        description,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        visibility,
      }, { auth: true });
      router.push('/my');
    } catch (e) {
      setError('Failed to update application');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded && !error) {
    return <main className="p-4">Loading...</main>;
  }

  if (error) {
    return <main className="p-4 text-red-600">{error}</main>;
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Edit Application</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full border rounded-md px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full border rounded-md px-3 py-2"
            rows={4}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Tags (comma separated)</label>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            className="w-full border rounded-md px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Visibility</label>
          <select
            value={visibility}
            onChange={e => setVisibility(e.target.value as 'public' | 'unlisted')}
            className="w-full border rounded-md px-3 py-2"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded border border-gray-300"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </main>
  );
}

