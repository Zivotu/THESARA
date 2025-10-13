'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ensureUserDoc } from './ensureUserDoc';

type AuthCtx = { user: User | null; loading: boolean };
const Ctx = createContext<AuthCtx>({ user: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const off = onAuthStateChanged(auth, async (u) => {
      setUser(u ?? null);
      setLoading(false);

      if (u) {
        try {
          await ensureUserDoc({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
          });
        } catch (err) {
          console.error('Error ensuring user document', err);
        }
      }
    });
    return () => off();
  }, []);

  return <Ctx.Provider value={{ user, loading }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

export function getDisplayName(user: User | null): string {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  const email = user.email || '';
  const local = email.split('@')[0] || '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}
