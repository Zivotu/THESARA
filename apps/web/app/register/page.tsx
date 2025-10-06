'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, UserCredential, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { ensureUserDoc } from '@/lib/ensureUserDoc';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    birthYear: '',
    password: '',
    confirmPassword: '',
    phone: '',
    gender: '',
    bio: '',
  });
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    const collection = 'users';
    let cred: UserCredential | null = null;
    try {
      if (!auth) throw new Error('Auth not initialized');
      cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      const displayName =
        `${form.firstName} ${form.lastName}`.trim() || form.email.split('@')[0];
      await updateProfile(cred.user, { displayName });
      await ensureUserDoc({
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
        photoURL: cred.user.photoURL,
      });
      if (!db) throw new Error('DB not initialized');
      await setDoc(
        doc(db, collection, cred.user.uid),
        {
          firstName: form.firstName,
          lastName: form.lastName,
          username: form.username,
          email: form.email,
          birthYear: form.birthYear,
          phone: form.phone || null,
          gender: form.gender || null,
          bio: form.bio || null,
        },
        { merge: true }
      );
      await auth.currentUser?.getIdToken(true);
      router.push('/?welcome=1');
    } catch (err: any) {
      console.error(`Error writing to ${collection} for user ${cred?.user?.uid}`, err);
      setError(
        (err.message || 'Registration failed') +
          ' Molimo provjerite Firestore pravila ili konfiguraciju.'
      );
    }
  };

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-3xl font-bold mt-8">Register</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="flex gap-4">
          <input
            required
            name="firstName"
            placeholder="Ime"
            value={form.firstName}
            onChange={handleChange}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
          <input
            required
            name="lastName"
            placeholder="Prezime"
            value={form.lastName}
            onChange={handleChange}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        <input
          required
          name="username"
          placeholder="Korisničko ime"
          value={form.username}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <input
          required
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <input
          required
          name="birthYear"
          placeholder="Godište"
          value={form.birthYear}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <div className="flex gap-4">
          <input
            required
            type="password"
            name="password"
            placeholder="Lozinka"
            value={form.password}
            onChange={handleChange}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
          <input
            required
            type="password"
            name="confirmPassword"
            placeholder="Potvrdi lozinku"
            value={form.confirmPassword}
            onChange={handleChange}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
          />
        </div>
        <input
          name="phone"
          placeholder="Broj mobitela"
          value={form.phone}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <select
          name="gender"
          value={form.gender}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        >
          <option value="">Spol</option>
          <option value="male">Muško</option>
          <option value="female">Žensko</option>
          <option value="other">Drugo</option>
        </select>
        <textarea
          name="bio"
          placeholder="Bio"
          value={form.bio}
          onChange={handleChange}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button
          type="submit"
          className="rounded-2xl bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-2"
        >
          Register
        </button>
      </form>
    </main>
  );
}

