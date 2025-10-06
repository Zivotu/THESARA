import { auth } from '@/lib/firebase';

export async function getPlayUrl(id: string): Promise<string> {
  const tok = await auth?.currentUser?.getIdToken();
  const params = new URLSearchParams({ appId: id, run: '1' });
  if (tok) params.append('token', tok);
  return `/play?${params.toString()}`;
}
