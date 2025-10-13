"use client";

import React from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { apiAuthedPost, apiDelete } from './api';
import { onAuthStateChanged } from 'firebase/auth';
import type { EntitlementType } from '@loopyway/entitlements';

export type Entitlement = {
  id: string;
  userId: string;
  feature: EntitlementType;
  data?: Record<string, any>;
};

async function waitForUser(uid: string, timeoutMs = 10_000): Promise<boolean> {
  const authInstance = auth;
  if (!authInstance) return false;
  if (authInstance.currentUser?.uid === uid) return true;
  return new Promise((resolve) => {
    let unsub: () => void = () => {};
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    unsub = onAuthStateChanged(authInstance, (u) => {
      if (u?.uid === uid) {
        clearTimeout(timer);
        unsub();
        resolve(true);
      }
    });
  });
}

export async function listEntitlements(userId: string): Promise<Entitlement[]> {
  let ok = await waitForUser(userId);
  if (!ok) {
    // Retry once in case auth state is still initializing
    ok = await waitForUser(userId);
    if (!ok) {
      const err = new Error('Timed out waiting for authentication');
      (err as any).code = 'auth/timeout';
      throw err;
    }
  }
  try {
    const path = `users/${userId}/entitlements`;
    const snap = db
      ? await getDocs(collection(db, 'users', userId, 'entitlements'))
      : { docs: [] as any[] } as any;
    if (process.env.NODE_ENV !== 'production') {
      console.log('[ENTITLEMENTS]', { uid: userId, path });
    }
    return snap.docs.map((d: any) => ({
      id: d.id,
      ...(d.data() as Omit<Entitlement, 'id'>),
    }));
  } catch (err) {
    console.error('Failed to list entitlements', err);
    throw err;
  }
}

export async function addEntitlement(
  data: Omit<Entitlement, 'id'>,
): Promise<Entitlement> {
  return apiAuthedPost<Entitlement>(
    `/users/${data.userId}/entitlements`,
    data,
  );
}

export async function removeEntitlement(
  userId: string,
  id: string,
): Promise<void> {
  await apiDelete(`/users/${userId}/entitlements/${id}`, { auth: true });
}

export async function hasEntitlement(
  userId: string,
  features: EntitlementType | EntitlementType[],
): Promise<boolean> {
  try {
    const items = await listEntitlements(userId);
    const arr = Array.isArray(features) ? features : [features];
    return items.some((e) => arr.includes(e.feature));
  } catch {
    return false;
  }
}

const labelMap: Record<EntitlementType, string> = {
  'app-subscription': 'Per-app subscription',
  'creator-all-access': 'Creator all-access',
  'free-ads': 'Free + ads',
  isGold: 'Gold plan',
  noAds: 'No ads',
  'app-trial': 'App Trial',
};

export type EntitlementDisplay = {
  feature: EntitlementType;
  owned: boolean;
  upgradeHref?: string;
};

export function EntitlementsList({ items }: { items: EntitlementDisplay[] }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="text-sm text-gray-700 space-y-1">
      {items.map((it) => (
        <li key={it.feature} className="flex items-center justify-between">
          <span>{labelMap[it.feature] ?? it.feature}</span>
          {it.owned ? (
            <span className="text-emerald-600">Pretplaćeni</span>
          ) : (
            it.upgradeHref && (
              <Link href={it.upgradeHref} className="text-blue-600 hover:underline">
                Nadogradi
              </Link>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
