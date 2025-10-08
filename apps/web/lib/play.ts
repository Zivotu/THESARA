import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase';

async function resolveCurrentUser(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  return await new Promise<User | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        unsubscribe();
        resolve(u ?? null);
      },
      () => {
        unsubscribe();
        resolve(null);
      },
    );
  });
}

export async function getPlayUrl(id: string): Promise<string> {
  const user = await resolveCurrentUser();
  const token = user ? await user.getIdToken() : undefined;
  const params = new URLSearchParams({ appId: id, run: '1' });
  if (token) params.append('token', token);
  return `/play?${params.toString()}`;
}
