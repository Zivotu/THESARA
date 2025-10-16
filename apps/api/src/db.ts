import * as admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { CollectionReference, DocumentReference } from 'firebase-admin/firestore';
import fs from 'fs';
import { ARCHIVE_TTL_MS } from './lib/versioning.js';

import type { AppRecord } from './types.js';
import type { Oglas } from './models/Oglas.js';
import type { EntitlementType } from '@loopyway/entitlements';
export type { AppRecord } from './types.js';

function getFirebaseCredential(): admin.credential.Credential {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  // 1. Lokalno (i preporučeno na serveru): JSON datoteka iz env varijable
  if (fromEnv && fs.existsSync(fromEnv)) {
    const raw = JSON.parse(fs.readFileSync(fromEnv, 'utf8'));

    // Normalizacija polja i newline znakova u privatnom ključu
    const serviceAccount = {
      projectId: raw.project_id || raw.projectId,
      clientEmail: raw.client_email || raw.clientEmail,
      privateKey: (raw.private_key || raw.privateKey || '').replace(/\\n/g, '\n'),
    };

    if (!serviceAccount.privateKey || !serviceAccount.clientEmail) {
      throw new Error('Invalid service account JSON: missing private_key or client_email');
    }
    return admin.credential.cert(serviceAccount as admin.ServiceAccount);
  }

  // 2. Server (fallback): Učitavanje iz standardnih putanja
  const jsonDefaultPath = '/etc/thesara/creds/firebase-sa.json';
  if (fs.existsSync(jsonDefaultPath)) {
    return admin.credential.cert(jsonDefaultPath);
  }

  const pemDefaultPath = '/etc/thesara/creds/firebase-sa.pem';
  if (fs.existsSync(pemDefaultPath)) {
    return admin.credential.cert({
      projectId: 'createx-e0ccc',
      clientEmail: 'firebase-adminsdk-fbsvc@createx-e0ccc.iam.gserviceaccount.com',
      privateKey: fs.readFileSync(pemDefaultPath, 'utf8'),
    });
  }

  throw new Error('No Firebase credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or place firebase-sa.json/pem in /etc/thesara/creds/.');
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: getFirebaseCredential(),
  });
}

export const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

export type Creator = {
  id: string;
  handle: string;
  bio?: string;
  plan?: string;
  allAccessPrice?: number;
  stripeProductId?: string;
  stripePriceId?: string;
  stripeAllAccessProductId?: string;
  stripeAllAccessPriceId?: string;
  stripeAccountId?: string;
  [key: string]: any;
};

export type App = AppRecord;

export type Entitlement = {
  id: string;
  userId: string;
  feature: EntitlementType;
  active?: boolean;
  data?: Record<string, any>;
};

export type Metric = {
  plays: number;
  likes: number;
};

// Firestore collections structure mirrors former SQLite tables:
// creators/{creatorId}
// apps/{appId}
//   kv/{key} => { value }
//   likes/{uid} => { liked: true }
// entitlements/{entitlementId}
// metrics/{appId}
// stripe_customers/{userId}

const DEFAULT_COLLECTIONS = [
  'entitlements',
  'billing_events',
  'billing_events_unmapped',
  'subscriptions',
  'stripe_accounts',
  'stripe_customers',
  'stripe_events',
  'payments',
  'users',
  'creators',
];

let dbInitialization: Promise<void> | undefined;

async function runDbInitialization(): Promise<void> {
  await ensureCollections(DEFAULT_COLLECTIONS);
  await ensureAmirSerbicCreator();
}

export function ensureDbInitialized(): Promise<void> {
  if (!dbInitialization) {
    dbInitialization = runDbInitialization().catch((err) => {
      dbInitialization = undefined;
      throw err;
    });
  }
  return dbInitialization;
}

void ensureDbInitialized();
const OGLASI_COLLECTION = 'oglasi';
const OGLASI_SEED_DOC = 'seed_state';

// Utility helpers -----------------------------------------------------------

/**
 * Ensure the 'oglasi' collection exists. If it doesn't, a placeholder document
 * is created so subsequent reads won't fail.
 */
async function ensureOglasiCollection(): Promise<CollectionReference> {
  const col = db.collection(OGLASI_COLLECTION);
  const cols = await db.listCollections();
  const exists = cols.some((c) => c.id === OGLASI_COLLECTION);
  if (!exists) {
    await col.doc(OGLASI_SEED_DOC).set({ createdAt: Date.now(), seed: true });
    console.log('seed:done');
    return col;
  }
  const seedDoc = await col.doc(OGLASI_SEED_DOC).get();
  if (!seedDoc.exists) {
    await col.doc(OGLASI_SEED_DOC).set({ createdAt: Date.now(), seed: true });
    console.log('seed:done');
  } else {
    console.log('seed:skip');
  }
  return col;
}

/**
 * Ensure the given top level collection already exists. This guards against
 * accidental writes to misspelled paths which would otherwise create new
 * collections implicitly.
 */
async function getExistingCollection(name: string): Promise<CollectionReference> {
  const cols = await db.listCollections();
  const found = cols.find((c) => c.id === name);
  if (!found) {
    throw new Error(`Missing collection: ${name}`);
  }
  return db.collection(name);
}

export async function ensureCollections(names: string[]): Promise<void> {
  const existing = await db.listCollections();
  const existingNames = new Set(existing.map((c) => c.id));
  for (const name of names) {
    if (!existingNames.has(name)) {
      await db
        .collection(name)
        .doc('_init')
        .set({ createdAt: Timestamp.now() });
      console.log(`Created collection '${name}'`);
    }
  }
}

/**
 * Return a reference to a subcollection under a document. The parent document
 * must exist; if the subcollection hasn't been created yet it will be created on
 * first write. This function merely ensures the path is valid and avoids
 * duplicates by checking the existing list of subcollections.
 */
async function getSubcollection(
  docRef: DocumentReference,
  name: string,
): Promise<CollectionReference> {
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error(`Missing document for subcollection '${name}'`);
  }
  const cols = await docRef.listCollections();
  const exists = cols.some((c) => c.id === name);
  if (!exists) {
    // Firestore creates subcollections on first write; nothing to do other than
    // returning the reference so callers can perform that write.
  }
  return docRef.collection(name);
}

function attachMetrics(data: any, m?: Metric): App {
  return {
    // spread to retain arbitrary fields like updatedAt and publishedAt
    ...data,
    likesCount: m?.likes ?? 0,
    playsCount: m?.plays ?? 0,
  } as App;
}

export async function readCreators(fields?: string[]): Promise<Creator[]> {
  const col = await getExistingCollection('creators');
  let query: any = col;
  if (fields && fields.length) {
    query = query.select(...fields);
  }
  const snap = await query.get();
  return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as Creator);
}

export async function writeCreators(items: Creator[]): Promise<void> {
  const col = await getExistingCollection('creators');
  const existing = await col.get();
  const batch = db.batch();
  existing.docs.forEach((d: any) => batch.delete(d.ref));
  items.forEach((it) => batch.set(col.doc(it.id), it));
  await batch.commit();
}

export async function getCreatorByHandle(handle: string): Promise<Creator | undefined> {
  const snap = await (await getExistingCollection('creators'))
    .where('handle', '==', handle)
    .limit(1)
    .get();
  if (!snap.empty) {
    return snap.docs[0].data() as Creator;
  }

  // Fallback: search users collection by handle
  const userSnap = await db
    .collection('users')
    .where('handle', '==', handle)
    .limit(1)
    .get();
  if (userSnap.empty) return undefined;
  const doc = userSnap.docs[0];
  const data = doc.data() as any;
  const creator: Creator = {
    id: doc.id,
    handle: data.handle || handle,
    allAccessPrice: data.allAccessPrice,
    displayName: data.displayName,
    photoURL: data.photoURL,
  };
  // Persist minimal creator record for future lookups
  try {
    await upsertCreator({ id: creator.id, handle: creator.handle, allAccessPrice: creator.allAccessPrice });
  } catch {}
  return creator;
}

export async function upsertCreator(it: Creator): Promise<void> {
  await (await getExistingCollection('creators')).doc(it.id).set(it);
}

export async function readApps(fields?: string[]): Promise<App[]> {
  // Ensure base collections exist on first boot to avoid 500s
  await ensureCollections(['apps', 'metrics']);
  const appsCol = await getExistingCollection('apps');
  if (fields && fields.length) {
    const snap = await appsCol.select(...fields).get();
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as App);
  }
  const appsSnap = await appsCol.get();
  const metricsSnap = await (await getExistingCollection('metrics')).get();
  const metrics = new Map<string, Metric>(
    metricsSnap.docs.map((d: any) => [d.id, d.data() as Metric]),
  );
  const now = Date.now();
  const updates: Promise<any>[] = [];
  const results = appsSnap.docs.map((d: any) => {
    const data = d.data();
    data.reports = data.reports ?? [];
    data.domainsSeen = data.domainsSeen ?? [];
    const origLen = (data.archivedVersions ?? []).length;
    const expiry = now - ARCHIVE_TTL_MS;
    data.archivedVersions = (data.archivedVersions ?? []).filter(
      (v: any) => v.archivedAt >= expiry,
    );
    if (origLen !== data.archivedVersions.length) {
      updates.push(appsCol.doc(d.id).update({ archivedVersions: data.archivedVersions }));
    }
    return attachMetrics(data, metrics.get(d.id));
  });
  if (updates.length) {
    await Promise.all(updates);
  }
  return results;
}

/**
 * Fetch a single app either by its document ID or slug without scanning the
 * entire collection. Throws an error if multiple apps share the same slug.
 *
 * @param idOrSlug - Application document ID or slug
 * @throws Error with message 'app_slug_not_unique' if slug is not unique
 */
export async function getAppByIdOrSlug(
  idOrSlug: string,
): Promise<App | undefined> {
  await ensureCollections(['apps', 'metrics']);
  const appsCol = await getExistingCollection('apps');
  const metricsCol = await getExistingCollection('metrics');

  let doc = await appsCol.doc(idOrSlug).get();
  let ref: DocumentReference = appsCol.doc(idOrSlug);

  if (!doc.exists) {
    const snap = await appsCol.where('slug', '==', idOrSlug).limit(2).get();
    if (snap.empty) return undefined;
    if (snap.size > 1) {
      throw new Error('app_slug_not_unique');
    }
    doc = snap.docs[0];
    ref = doc.ref;
  }

  const data = doc.data() as any;
  data.reports = data.reports ?? [];
  data.domainsSeen = data.domainsSeen ?? [];
  const origLen = (data.archivedVersions ?? []).length;
  const expiry = Date.now() - ARCHIVE_TTL_MS;
  data.archivedVersions = (data.archivedVersions ?? []).filter(
    (v: any) => v.archivedAt >= expiry,
  );
  if (origLen !== data.archivedVersions.length) {
    await ref.update({ archivedVersions: data.archivedVersions });
  }

  const metricDoc = await metricsCol.doc(doc.id).get();
  return attachMetrics(
    data,
    metricDoc.exists ? (metricDoc.data() as Metric) : undefined,
  );
}

export async function writeApps(items: App[]): Promise<void> {
  // Verify top level collections exist before performing batch writes
  const appsCol = await getExistingCollection('apps');
  const metricsCol = await getExistingCollection('metrics');
  const appsSnap = await appsCol.get();
  const metricsSnap = await metricsCol.get();
  const batch = db.batch();
  appsSnap.docs.forEach((d: any) => batch.delete(d.ref));
  metricsSnap.docs.forEach((d: any) => batch.delete(d.ref));
  for (const it of items) {
    const { likesCount, playsCount, ...rest } = it as any;
    // rest contains timestamps such as updatedAt and publishedAt which
    // should be stored alongside other listing data
    batch.set(appsCol.doc(it.id), rest);
    batch.set(metricsCol.doc(it.id), {
      plays: playsCount ?? 0,
      likes: likesCount ?? 0,
    });
  }
  await batch.commit();
}

export async function getListingByBuildId(buildId: string): Promise<App | undefined> {
  const apps = await readApps();
  return apps.find((a) => a.buildId === buildId);
}

export async function readOglasi(): Promise<Oglas[]> {
  const col = await ensureOglasiCollection();
  const snap = await col.get();
  return snap.docs
    .filter((d: any) => d.id !== OGLASI_SEED_DOC)
    .map((d: any) => {
      const data = d.data() as Oglas;
      data.reports = data.reports ?? [];
      return data;
    });
}

export async function writeOglasi(items: Oglas[]): Promise<void> {
  const col = await ensureOglasiCollection();
  const snap = await col.get();
  const batch = db.batch();
  snap.docs.forEach((d: any) => batch.delete(d.ref));
  items.forEach((it) =>
    batch.set(col.doc(String(it.id)), { ...it, reports: it.reports ?? [] })
  );
  if (items.length === 0) {
    batch.set(col.doc(OGLASI_SEED_DOC), { createdAt: Date.now(), seed: true });
  }
  await batch.commit();
}

export async function listAppsByOwner(uid: string): Promise<App[]> {
  const appsSnap = await (await getExistingCollection('apps')).where('ownerUid', '==', uid).get();
  const results: App[] = [];
  for (const doc of appsSnap.docs) {
    const metricDoc = await (await getExistingCollection('metrics')).doc(doc.id).get();
    results.push(
      attachMetrics(doc.data(), metricDoc.exists ? (metricDoc.data() as Metric) : undefined)
    );
  }
  return results;
}

export async function readAppKv(appId: string): Promise<Record<string, any>> {
  const col = await getSubcollection(db.collection('apps').doc(appId), 'kv');
  const snap = await col.get();
  const obj: Record<string, any> = {};
  snap.docs.forEach((d: any) => {
    obj[d.id] = d.data().value;
  });
  return obj;
}

export async function writeAppKv(appId: string, data: Record<string, any>): Promise<void> {
  // Only create the 'kv' subcollection if it doesn't yet exist under the app
  const col = await getSubcollection(db.collection('apps').doc(appId), 'kv');
  const snap = await col.get();
  const batch = db.batch();
  snap.docs.forEach((d: any) => batch.delete(d.ref));
  for (const [k, v] of Object.entries(data)) {
    batch.set(col.doc(k), { value: v });
  }
  await batch.commit();
}

export async function listEntitlements(userId?: string): Promise<Entitlement[]> {
  const col = await getExistingCollection('entitlements');
  const snap = userId
    ? await col.where('userId', '==', userId).get()
    : await col.get();
  return snap.docs.map((d: any) => d.data() as Entitlement);
}

export async function hasAppSubscription(
  userId: string,
  appId: string,
): Promise<boolean> {
  const snap = await (
    await getExistingCollection('entitlements')
  )
    .where('userId', '==', userId)
    .where('feature', '==', 'app-subscription')
    .where('data.appId', '==', appId)
    .get();
  const subIds = new Set<string>();
  for (const d of snap.docs) {
    const ent = d.data() as Entitlement;
    if (ent.active === false) continue;
    const subId = ent.data?.stripeSubscriptionId as string | undefined;
    if (subId) subIds.add(subId);
  }
  if (!subIds.size) return false;
  const subs = await Promise.all(
    [...subIds].map((id) => getSubscription(id)),
  );
  return subs.some(
    (sub) =>
      sub &&
      ['active', 'trialing', 'past_due'].includes(sub.status) &&
      sub.currentPeriodEnd > Date.now(),
  );
}

export async function hasCreatorAllAccess(
  userId: string,
  creatorId: string,
): Promise<boolean> {
  const snap = await (
    await getExistingCollection('entitlements')
  )
    .where('userId', '==', userId)
    .where('feature', '==', 'creator-all-access')
    .where('data.creatorId', '==', creatorId)
    .get();
  const subIds = new Set<string>();
  for (const d of snap.docs) {
    const ent = d.data() as Entitlement;
    if (ent.active === false) continue;
    const subId = ent.data?.stripeSubscriptionId as string | undefined;
    if (subId) subIds.add(subId);
  }
  if (!subIds.size) return false;
  const subs = await Promise.all(
    [...subIds].map((id) => getSubscription(id)),
  );
  return subs.some(
    (sub) =>
      sub &&
      ['active', 'trialing', 'past_due'].includes(sub.status) &&
      sub.currentPeriodEnd > Date.now(),
  );
}

export async function getEntitlement(id: string): Promise<Entitlement | undefined> {
  const doc = await (await getExistingCollection('entitlements')).doc(id).get();
  return doc.exists ? (doc.data() as Entitlement) : undefined;
}

export async function upsertEntitlement(it: Entitlement): Promise<void> {
  const entRef = (await getExistingCollection('entitlements')).doc(it.id);
  const userRef = db.collection('users').doc(it.userId).collection('entitlements').doc(it.id);
  const batch = db.batch();
  batch.set(entRef, it);
  batch.set(userRef, it);
  await batch.commit();
}

export async function removeEntitlement(id: string, userId: string): Promise<void> {
  const entRef = (await getExistingCollection('entitlements')).doc(id);
  const userRef = db.collection('users').doc(userId).collection('entitlements').doc(id);
  const batch = db.batch();
  batch.delete(entRef);
  batch.delete(userRef);
  await batch.commit();
}

export async function writeEntitlements(items: Entitlement[]): Promise<void> {
  const col = await getExistingCollection('entitlements');
  const snap = await col.get();
  const batch = db.batch();
  snap.docs.forEach((d: any) => batch.delete(d.ref));
  items.forEach((it) => batch.set(col.doc(it.id), it));
  await batch.commit();
}

export async function incrementAppPlay(appId: string): Promise<void> {
  const ref = (await getExistingCollection('metrics')).doc(appId);
  await ref.set({ plays: FieldValue.increment(1) }, { merge: true });
}

export async function setAppLike(appId: string, uid: string, like: boolean): Promise<void> {
  // Lazily create 'likes' subcollection if necessary
  const likeRef = (await getSubcollection(db.collection('apps').doc(appId), 'likes')).doc(uid);
  const metricRef = (await getExistingCollection('metrics')).doc(appId);
  await db.runTransaction(async (t: any) => {
    const likeDoc = await t.get(likeRef);
    if (like) {
      if (!likeDoc.exists) {
        t.set(likeRef, { liked: true });
        t.set(metricRef, { likes: FieldValue.increment(1) }, { merge: true });
      }
    } else {
      if (likeDoc.exists) {
        t.delete(likeRef);
        t.set(metricRef, { likes: FieldValue.increment(-1) }, { merge: true });
      }
    }
  });
}

export async function writeScore(
  appId: string,
  uid: string,
  score: number
): Promise<void> {
  // Scores subcollection is created on first write if absent
  const scores = await getSubcollection(db.collection('apps').doc(appId), 'scores');
  await scores.doc(uid).set({ score, ts: Date.now() });
}

export async function readTopScores(
  appId: string,
  limit = 10
): Promise<Array<{ uid: string; score: number }>> {
  const snap = await db
    .collection('apps')
    .doc(appId)
    .collection('scores')
    .orderBy('score', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d: any) => ({ uid: d.id, ...(d.data() as any) }));
}

export async function getStripeCustomerIdForUser(
  userId: string
): Promise<string | undefined> {
  const doc = await (await getExistingCollection('stripe_customers')).doc(userId).get();
  return doc.exists ? (doc.data() as any).stripeCustomerId : undefined;
}

export async function setStripeCustomerIdForUser(
  userId: string,
  customerId: string
): Promise<void> {
  await (await getExistingCollection('stripe_customers')).doc(userId).set({ stripeCustomerId: customerId });
}

export async function getUserIdByStripeCustomerId(
  customerId: string,
): Promise<string | undefined> {
  const snap = await (
    await getExistingCollection('stripe_customers')
  )
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0].id;
}

export async function getStripeAccountId(
  creatorId: string,
): Promise<string | undefined> {
  const doc = await (await getExistingCollection('stripe_accounts')).doc(creatorId).get();
  return doc.exists ? (doc.data() as any).accountId : undefined;
}

export async function setStripeAccountId(
  creatorId: string,
  accountId: string,
): Promise<void> {
  await (await getExistingCollection('stripe_accounts')).doc(creatorId).set({ accountId });
}

export type PaymentRecord = {
  id: string;
  userId?: string;
  eventType?: string;
  timestamp?: number;
  [key: string]: any;
};

export async function addPaymentRecord(data: PaymentRecord): Promise<void> {
  await (await getExistingCollection('payments')).doc(data.id).set(data, { merge: true });
}

export type BillingEvent = {
  userId?: string;
  eventType: string;
  subscriptionId?: string | null;
  amount?: number;
  ts: number;
  status?: string;
  details?: any;
};

export async function logBillingEvent(data: BillingEvent): Promise<void> {
  await (await getExistingCollection('billing_events')).add(data);
}

export async function logUnmappedBillingEvent(data: any): Promise<void> {
  await (await getExistingCollection('billing_events_unmapped')).add(data);
}

export async function listBillingEventsForUser(
  userId: string,
): Promise<BillingEvent[]> {
  const snap = await (
    await getExistingCollection('billing_events')
  )
    .where('userId', '==', userId)
    .orderBy('ts', 'desc')
    .get();
  return snap.docs.map((d: any) => d.data() as BillingEvent);
}

export type SubscriptionRecord = {
  id: string;
  userId: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  customerId?: string;
  priceId?: string | null;
};

export async function upsertSubscription(
  data: SubscriptionRecord,
): Promise<void> {
  const { id, userId, ...rest } = data;
  await (await getExistingCollection('subscriptions'))
    .doc(id)
    .set({ userId, ...rest }, { merge: true });
}

export async function upsertUserSubscription(
  userId: string,
  data: SubscriptionRecord,
): Promise<void> {
  const { id, userId: _userId, ...rest } = data; // Destrukturiramo i userId da ne bude u 'rest'
  const col = await getSubcollection(
    (await getExistingCollection('users')).doc(userId),
    'subscriptions',
  );
  await col.doc(id).set({ userId, ...rest }, { merge: true });
}

export async function getSubscription(
  id: string,
): Promise<SubscriptionRecord | undefined> {
  const doc = await (await getExistingCollection('subscriptions')).doc(id).get();
  return doc.exists ? (doc.data() as SubscriptionRecord) : undefined;
}

export async function hasSubscriptionByPriceId(
  userId: string,
  priceId: string,
): Promise<boolean> {
  const snap = await (await getExistingCollection('subscriptions'))
    .where('userId', '==', userId)
    .where('priceId', '==', priceId)
    .where('status', 'in', ['active', 'trialing', 'past_due'])
    .limit(1)
    .get();
  if (snap.empty) return false;
  const sub = snap.docs[0].data() as SubscriptionRecord;
  if (sub.currentPeriodEnd <= Date.now()) {
    return false;
  }
  return true;
}

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const doc = await (await getExistingCollection('stripe_events'))
    .doc(eventId)
    .get();
  if (!doc.exists) return false;
  const data = doc.data() as any;
  const ts = data.ts instanceof Timestamp ? data.ts.toMillis() : data.ts;
  if (!ts || Date.now() - ts > EVENT_TTL_MS) {
    return false;
  }
  return true;
}

export async function markEventProcessed(eventId: string): Promise<void> {
  await (await getExistingCollection('stripe_events'))
    .doc(eventId)
    .set({
      processed: true,
      ts: Date.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
    });
}

// Seed a default creator so profile pages load during development and tests
async function ensureAmirSerbicCreator(): Promise<void> {
  try {
    await ensureCollections(['creators']);
    const col = await getExistingCollection('creators');
    const docRef = col.doc('amir.serbic');
    const data = {
      id: 'amir.serbic',
      handle: 'amir.serbic',
      displayName: 'Amir Serbic',
      photoURL: 'https://avatars.githubusercontent.com/u/583231?v=4',
      allAccessPrice: 0,
    };
    const doc = await docRef.get();
    if (!doc.exists || doc.data()?.photoURL !== data.photoURL) {
      await docRef.set(data, { merge: true });
    }
  } catch {}
}