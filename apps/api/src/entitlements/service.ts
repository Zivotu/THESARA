import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EntitlementType } from '@loopyway/entitlements';
export type { EntitlementType };
import { db, upsertEntitlement, removeEntitlement } from '../db.js';
import { enforceAppLimit } from '../lib/appLimit.js';

const InputBase = z
  .object({
    id: z.string().uuid().optional(),
    active: z.boolean().optional(),
  })
  .strict();

const Base = InputBase.extend({
  userId: z.string(),
}).strict();

const PerAppSubData = z
  .object({
    appId: z.string(),
    expiresAt: z.string().optional(),
    stripeCustomerId: z.string().optional(),
    stripeSubscriptionId: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
  })
  .strict();

const PerAppSub = Base.extend({
  feature: z.literal('app-subscription'),
  data: PerAppSubData,
});
const PerAppSubInput = InputBase.extend({
  feature: z.literal('app-subscription'),
  data: PerAppSubData,
});

const CreatorAllAccessData = z
  .object({
    creatorId: z.string(),
    expiresAt: z.string().optional(),
    stripeCustomerId: z.string().optional(),
    stripeSubscriptionId: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
  })
  .strict();

const CreatorAllAccess = Base.extend({
  feature: z.literal('creator-all-access'),
  data: CreatorAllAccessData,
});
const CreatorAllAccessInput = InputBase.extend({
  feature: z.literal('creator-all-access'),
  data: CreatorAllAccessData,
});

const FreeAdsData = z.object({}).strict();
const FreeAds = Base.extend({
  feature: z.literal('free-ads'),
  data: FreeAdsData.optional(),
});
const FreeAdsInput = InputBase.extend({
  feature: z.literal('free-ads'),
  data: FreeAdsData.optional(),
});

const IsGoldData = z.object({
  expiresAt: z.string().optional(),
}).strict();
const IsGold = Base.extend({
  feature: z.literal('isGold'),
  data: IsGoldData.optional(),
});
const IsGoldInput = InputBase.extend({
  feature: z.literal('isGold'),
  data: IsGoldData.optional(),
});

const PurchaseData = z
  .object({
    listingId: z.string(),
  })
  .strict();
const Purchase = Base.extend({
  feature: z.literal('purchase'),
  data: PurchaseData,
});
const PurchaseInput = InputBase.extend({
  feature: z.literal('purchase'),
  data: PurchaseData,
});

const NoAdsData = z
  .object({
    appId: z.string().optional(),
    creatorId: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .strict();
const NoAds = Base.extend({
  feature: z.literal('noAds'),
  data: NoAdsData.optional(),
});
const NoAdsInput = InputBase.extend({
  feature: z.literal('noAds'),
  data: NoAdsData.optional(),
});

// "no-ads-addon" was an old entitlement name and has been replaced by "noAds" above.

const EntitlementSchema = z.union([
  PerAppSub,
  CreatorAllAccess,
  FreeAds,
  IsGold,
  Purchase,
  NoAds,
]);
const EntitlementInputSchema = z.union([
  PerAppSubInput,
  CreatorAllAccessInput,
  FreeAdsInput,
  IsGoldInput,
  PurchaseInput,
  NoAdsInput,
]);

export type Entitlement = z.infer<typeof EntitlementSchema>;

export async function list(uid: string): Promise<Entitlement[]> {
  const snap = await db
    .collection('entitlements')
    .where('userId', '==', uid)
    .get();
  return snap.docs.map((d: any) => EntitlementSchema.parse(d.data()));
}

export async function get(
  uid: string,
  id: string,
): Promise<Entitlement | undefined> {
  const doc = await db.collection('entitlements').doc(id).get();
  if (!doc.exists) return undefined;
  const data = doc.data() as any;
  if (data.userId !== uid) return undefined;
  return EntitlementSchema.parse(data);
}

export async function create(
  uid: string,
  input: z.infer<typeof EntitlementInputSchema>,
): Promise<Entitlement> {
  const parsed = EntitlementInputSchema.parse(input);
  const ent: Entitlement = {
    ...parsed,
    userId: uid,
    id: parsed.id ?? randomUUID(),
  } as Entitlement;
  await upsertEntitlement(ent as any);
  if (ent.feature === 'isGold' && ent.active === false) {
    await enforceAppLimit(ent.userId);
  }
  return ent;
}

export async function update(
  uid: string,
  id: string,
  input: z.infer<typeof EntitlementInputSchema>,
): Promise<Entitlement> {
  const parsed = EntitlementInputSchema.parse({ ...input, id });
  const ent: Entitlement = { ...parsed, userId: uid } as Entitlement;
  await upsertEntitlement(ent as any);
  if (ent.feature === 'isGold' && ent.active === false) {
    await enforceAppLimit(ent.userId);
  }
  return ent;
}

export async function remove(uid: string, id: string): Promise<void> {
  const doc = await db.collection('entitlements').doc(id).get();
  const ent = doc.exists ? (doc.data() as any) : undefined;
  if (!ent || ent.userId !== uid) return;
  await removeEntitlement(id, uid);
  if (ent.feature === 'isGold') {
    await enforceAppLimit(ent.userId);
  }
}
