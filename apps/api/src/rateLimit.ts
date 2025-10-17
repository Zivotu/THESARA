import type {Firestore} from '@google-cloud/firestore';

export async function rateLimit(
  db: Firestore,
  collection: string,
  key: string,
  windowMs: number,
  max: number,
) {
  const ref = db.collection(collection).doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let state = snap.exists ? (snap.data() as any) : { count: 0, resetAt: now + windowMs };

    if (now > state.resetAt) state = { count: 0, resetAt: now + windowMs };
    state.count += 1;

    tx.set(ref, state);

    if (state.count > max) {
      throw new Error('RATE_LIMITED');
    }
  });
}