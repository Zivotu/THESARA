'use client';

import Avatar from '@/components/Avatar';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { useAuth } from '@/lib/auth';
import { db, storage } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

function Toast({
  message,
  type = 'success',
  onClose,
}: {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-red-600',
    info: 'from-blue-500 to-blue-600',
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

export default function EditProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    phone: '',
    bio: '',
    address: '',
    city: '',
    postalCode: '',
    country: '',
    vatId: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      if (!db) return;
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        setForm({
          firstName: d.firstName || '',
          lastName: d.lastName || '',
          username: d.username || '',
          phone: d.phone || '',
          bio: d.bio || '',
          address: d.address || '',
          city: d.city || '',
          postalCode: d.postalCode || '',
          country: d.country || '',
          vatId: d.vatId || '',
        });
      }
    };
    load();
  }, [user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

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
        await updateProfile(user, { photoURL });
        if (db) await updateDoc(doc(db, 'users', user.uid), { photoURL });
      }
      if (!db) return;
      await updateDoc(doc(db, 'users', user.uid), {
        firstName: form.firstName,
        lastName: form.lastName,
        username: form.username,
        phone: form.phone || null,
        bio: form.bio || null,
        address: form.address || null,
        city: form.city || null,
        postalCode: form.postalCode || null,
        country: form.country || null,
        vatId: form.vatId || null,
      });
      await updateProfile(user, {
        displayName: `${form.firstName} ${form.lastName}`.trim(),
        photoURL: photoURL || undefined,
      });
      router.push('/profile');
    } finally {
      setBusy(false);
    }
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
    <main className="max-w-md mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <Logo />
        <Link href="/profile" className="text-sm text-gray-600 hover:text-emerald-700">
          ← Natrag na profil
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-4">Uredi profil</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar uid={user.uid} src={user.photoURL ?? undefined} name={`${form.firstName} ${form.lastName}`} size={64} />
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div className="flex gap-4">
          <Input
            name="firstName"
            value={form.firstName}
            onChange={handleChange}
            placeholder="Ime"
          />
          <Input
            name="lastName"
            value={form.lastName}
            onChange={handleChange}
            placeholder="Prezime"
          />
        </div>
        <Input
          name="username"
          value={form.username}
          onChange={handleChange}
          placeholder="Korisničko ime"
        />
        <Input
          name="phone"
          value={form.phone}
          onChange={handleChange}
          placeholder="Broj mobitela"
        />
        <Textarea
          name="bio"
          value={form.bio}
          onChange={handleChange}
          placeholder="Bio"
        />
        <Input
          name="address"
          value={form.address}
          onChange={handleChange}
          placeholder="Adresa"
        />
        <div className="flex gap-4">
          <Input
            name="city"
            value={form.city}
            onChange={handleChange}
            placeholder="Grad"
          />
          <Input
            name="postalCode"
            value={form.postalCode}
            onChange={handleChange}
            placeholder="Poštanski broj"
          />
        </div>
        <Input
          name="country"
          value={form.country}
          onChange={handleChange}
          placeholder="Država"
        />
        <Input
          name="vatId"
          value={form.vatId}
          onChange={handleChange}
          placeholder="OIB/VAT ID"
        />
        <Button type="submit" disabled={busy} className="rounded-2xl">
          {busy ? 'Spremanje...' : 'Spremi'}
        </Button>
      </form>
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
