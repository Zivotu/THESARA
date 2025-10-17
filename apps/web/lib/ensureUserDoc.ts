import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type MinimalUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
};

export async function ensureUserDoc(user: MinimalUser) {
  if (!db) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(
      ref,
      {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        username: user.email?.split('@')[0] ?? null,
        role: 'user',
        createdAt: serverTimestamp(),
      },
      { merge: false }
    );
  } else {
    await setDoc(
      ref,
      {
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        username: user.email?.split('@')[0] ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}

