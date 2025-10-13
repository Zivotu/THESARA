'use client';

import { auth } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithRedirect,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { useEffect, useState, FormEvent } from 'react';
import { useAuth, getDisplayName } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ensureUserDoc } from '@/lib/ensureUserDoc';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { SITE_NAME } from '@/lib/config';
import { useI18n } from '@/lib/i18n-provider';

export default function LoginPage() {
  const { messages, locale } = useI18n();
  const tLogin = (k: string, p?: Record<string, any>) => {
    let s = messages[`Login.${k}`] || k;
    if (p) Object.entries(p).forEach(([pk, pv]) => (s = s.replaceAll(`{${pk}}`, String(pv))));
    return s;
  };
  const { user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) {
          ensureUserDoc({
            uid: res.user.uid,
            email: res.user.email,
            displayName: res.user.displayName,
            photoURL: res.user.photoURL,
          })
            .then(() => res.user.getIdToken(true))
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/');
    }
  }, [user, loading, router]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      if (!auth) throw new Error('Auth not initialized');
      const { user } = await signInWithPopup(auth, provider);
      await ensureUserDoc({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      });
      await auth.currentUser?.getIdToken(true);
      router.push('/');
    } catch (e: any) {
      if (auth && (e?.code === 'auth/popup-blocked' || e?.code === 'auth/cancelled-popup-request')) {
        await signInWithRedirect(auth, provider);
      } else {
        console.error(e);
      }
    }
  };

  const logout = async () => {
    if (auth) await signOut(auth);
  };

  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (!auth) throw new Error('Auth not initialized');
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDoc({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      });
      await auth.currentUser?.getIdToken(true);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    }
  };

  return (
    <main className="min-h-[calc(100vh-80px)] bg-gradient-to-br from-emerald-50 to-white py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <Logo className="h-10" />
          <Link href="/" className="text-sm text-gray-600 hover:text-emerald-700">{tLogin('backToHome')}</Link>
        </div>

        <div className="grid md:grid-cols-2 gap-6 items-stretch">
          <div className="relative hidden md:block rounded-3xl overflow-hidden border border-emerald-100 bg-gradient-to-br from-emerald-600 to-green-700 text-white p-8">
            <div className="absolute -top-16 -right-16 w-64 h-64 bg-emerald-500/30 rounded-full blur-2xl" />
            <div className="relative z-10">
              <h2 className="text-3xl font-black tracking-tight">{tLogin('welcomeTitle', { site: SITE_NAME })}</h2>
              <p className="mt-3 text-emerald-50/90">
                {tLogin('welcomeBody')}
              </p>
              <ul className="mt-6 space-y-2 text-emerald-50/90 text-sm">
                <li className="flex items-center gap-2"><span>•</span> {tLogin('bulletOne')}</li>
                <li className="flex items-center gap-2"><span>•</span> {tLogin('bulletTwo')}</li>
                <li className="flex items-center gap-2"><span>•</span> {tLogin('bulletThree')}</li>
              </ul>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 md:p-8">
            <h1 className="text-2xl font-bold">{tLogin('title')}</h1>
            <p className="mt-1 text-gray-500">{tLogin('subtitle')}</p>

            <div className="mt-6">
              {loading ? (
                <div className="text-gray-500">{tLogin('checking')}</div>
              ) : user ? (
                <div className="space-y-4">
                  <div className="text-gray-700">
                    {tLogin('signedInAs')}{' '}
                    <span className="font-mono">
                      {getDisplayName(user) || user.email || user.uid}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <Link href="/create" className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">{tLogin('goToCreate')}</Link>
                    <button
                      onClick={logout}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
                    >
                      {tLogin('signOut')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={login}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2.5"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12   s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
                      <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,16.108,18.961,13,24,13c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657   C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
                      <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.197l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.277-7.954  l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
                      <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.793,2.237-2.231,4.166-4.087,5.565c0.001-0.001,0.002-0.001,0.003-0.002  l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
                    </svg>
                    {tLogin('continueWithGoogle')}
                  </button>

                  <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
                    <div className="flex-1 h-px bg-gray-200" />
                    <span>{tLogin('or')}</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>

                  <form onSubmit={handleEmailLogin} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tLogin('email')}</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        required
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{tLogin('password')}</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
                      />
                    </div>
                    {error && <p className="text-red-600 text-sm">{error}</p>}
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5"
                    >
                      {tLogin('signInWithEmail')}
                    </button>
                  </form>

                  <div className="mt-4 text-sm text-gray-500">
                    {tLogin('noAccount')}{' '}
                    <Link href="/register" className="text-emerald-700 hover:underline">
                      {tLogin('register')}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
