import { db } from './db.js';

export type PinSession = {
  createdAt: number;
  lastSeenAt: number;
  expiresAt?: number;
  ipHash: string;
  userAgent?: string;
  anonId?: string;
  revoked?: boolean;
  played?: boolean;
};

const COLLECTION = 'pin_sessions';

function docRef(appId: string, sessionId: string) {
  return db.collection('apps').doc(appId).collection(COLLECTION).doc(sessionId);
}

function toFirestore(sess: PinSession) {
  return {
    ...sess,
    ...(sess.expiresAt ? { expiresAt: new Date(sess.expiresAt) } : {}),
  };
}

function fromFirestore(data: any): PinSession {
  return {
    ...data,
    ...(data.expiresAt
      ? { expiresAt: data.expiresAt.toMillis ? data.expiresAt.toMillis() : data.expiresAt.getTime() }
      : {}),
  } as PinSession;
}

export async function cleanup(appId: string, ttlMs: number) {
  const snap = await db.collection('apps').doc(appId).collection(COLLECTION).get();
  const now = Date.now();
  const batch = db.batch();
  snap.forEach((doc) => {
    const data = fromFirestore(doc.data());
    if (
      data.revoked ||
      (data.expiresAt && data.expiresAt < now) ||
      now - data.lastSeenAt > ttlMs
    ) {
      batch.delete(doc.ref);
    }
  });
  await batch.commit();
}

export async function count(appId: string): Promise<number> {
  const snap = await db.collection('apps').doc(appId).collection(COLLECTION).get();
  return snap.size;
}

export async function create(appId: string, sessionId: string, sess: PinSession) {
  await docRef(appId, sessionId).set(toFirestore(sess));
}

export async function get(appId: string, sessionId: string): Promise<PinSession | undefined> {
  const snap = await docRef(appId, sessionId).get();
  return snap.exists ? fromFirestore(snap.data()) : undefined;
}

export async function update(
  appId: string,
  sessionId: string,
  patch: Partial<PinSession>,
) {
  const ref = docRef(appId, sessionId);
  return await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return undefined;
    const current = fromFirestore(snap.data());
    const next = { ...current, ...patch } as PinSession;
    t.set(ref, toFirestore(next), { merge: true });
    return next;
  });
}

export async function remove(appId: string, sessionId: string) {
  await docRef(appId, sessionId).delete();
}

export async function list(
  appId: string,
): Promise<Array<{ sessionId: string } & PinSession>> {
  const snap = await db.collection('apps').doc(appId).collection(COLLECTION).get();
  return snap.docs.map((d) => ({ sessionId: d.id, ...fromFirestore(d.data()) }));
}

export async function revoke(appId: string, sessionId: string) {
  await update(appId, sessionId, { revoked: true });
}

export async function revokeAll(appId: string) {
  const col = db.collection('apps').doc(appId).collection(COLLECTION);
  const snap = await col.get();
  const batch = db.batch();
  snap.forEach((doc) => batch.set(doc.ref, { revoked: true }, { merge: true }));
  await batch.commit();
}
