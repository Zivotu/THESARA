'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import { useAuth, getDisplayName } from '@/lib/auth';
import { updateProfile } from 'firebase/auth';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { API_URL } from '@/lib/config';

function Toast({
  message,
  type = 'success',
  onClose,
}: {
  message: string;
  type?: 'success' | 'error';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-red-600',
  } as const;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slideInRight">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg bg-gradient-to-r ${colors[type]}`}
      >
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);
  const [appId, setAppId] = useState('');
  const [versions, setVersions] = useState<
    { buildId: string; version: number; archivedAt: number }[]
  >([]);
  const [loadingVersions, setLoadingVersions] = useState(false);

  useEffect(() => {
    if (user) setName(getDisplayName(user));
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      let photoURL = user.photoURL || null;
      if (file && storage) {
        const storageRef = ref(storage, `avatars/${user.uid}`);
        try {
          await uploadBytes(storageRef, file);
        } catch (err) {
          console.error('Error uploading avatar', err);
          setToast({
            message: 'Upload failed. Please try again or contact support.',
            type: 'error',
          });
          return;
        }
        photoURL = await getDownloadURL(storageRef);
      }
      await updateProfile(user, { displayName: name, photoURL: photoURL || undefined });
      if (db) {
        await updateDoc(doc(db, 'users', user.uid), { displayName: name, photoURL });
      }
      setToast({ message: 'Profil ažuriran', type: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const loadVersions = async () => {
    if (!appId) return;
    setLoadingVersions(true);
    try {
      const res = await fetch(`${API_URL}/app/${appId}/versions`, {
        credentials: 'include',
      });
      const data = await res.json();
      setVersions(data.archivedVersions || []);
    } finally {
      setLoadingVersions(false);
    }
  };

  const restoreVersion = async (buildId: string) => {
    await fetch(`${API_URL}/app/${appId}/versions/${buildId}/promote`, {
      method: 'POST',
      credentials: 'include',
    });
    setToast({ message: 'Version restored', type: 'success' });
    await loadVersions();
  };

  if (loading) {
    return (
      <main className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!user) {
    router.push('/login');
    return null;
  }

  return (
    <main className="max-w-md mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Postavke profila</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar uid={user.uid} src={user.photoURL ?? undefined} name={name} size={64} />
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ime"
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
          >
            {busy ? 'Spremanje...' : 'Spremi'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded border border-gray-300"
          >
            Odustani
          </button>
        </div>
      </form>
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Archived Versions</h2>
        <div className="flex gap-2">
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="App ID"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
          <button
            type="button"
            onClick={loadVersions}
            disabled={loadingVersions}
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {loadingVersions ? 'Loading...' : 'Load'}
          </button>
        </div>
        {versions.length > 0 && (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.buildId} className="flex items-center gap-2">
                <span className="flex-1">v{v.version}</span>
                <button
                  type="button"
                  onClick={() => restoreVersion(v.buildId)}
                  className="px-2 py-1 text-sm rounded bg-emerald-600 text-white"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </main>
  );
}
