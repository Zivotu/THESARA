'use client';

import { useAuth, getDisplayName } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import Avatar from '@/components/Avatar';
// Using global header from layout; no local header
import { type Listing } from '@/components/AppCard';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import {
  listEntitlements,
  EntitlementsList,
  type EntitlementDisplay,
} from '@/lib/entitlements';
import { useEntitlements } from '@/hooks/useEntitlements';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  useConnectStatus,
  startStripeOnboarding,
  openStripeDashboard,
} from '@/hooks/useConnectStatus';

interface ProfileData {
  items: Listing[];
  stats: { likes: number; plays: number; apps: number };
}

interface SubscriptionInfo {
  id?: string;
  status: 'active' | 'trial' | 'expired' | 'loading' | 'processing';
  renewalDate?: string;
}

interface UsageInfo {
  plan: string;
  apps: { used: number; limit: number; remaining: number };
  storage: { used: number; limit: number; remaining: number };
}

interface BillingEvent {
  eventType: string;
  amount?: number;
  ts: number;
}

function renderBillingEvent(ev: BillingEvent): string {
  try {
    const amount = typeof ev.amount === 'number' ? `$${(ev.amount / 100).toFixed(2)}` : '';
    const date = new Date(ev.ts).toLocaleDateString();
    const data: any = (ev as any).data || {};
    if (data.appTitle || data.appId) {
      return `${date} – App subscription: ${data.appTitle || data.appId} ${amount}`;
    }
    if (data.creatorName || data.creatorId) {
      return `${date} – Creator all-access: ${data.creatorName || data.creatorId} ${amount}`;
    }
    if (data.plan === 'gold') {
      return `${date} – Gold plan ${amount}`;
    }
    return `${date} – ${ev.eventType}${amount ? ` (${amount})` : ''}`;
  } catch {
    return `${new Date(ev.ts).toLocaleDateString()} – ${ev.eventType}`;
  }
}

async function buildHeaders(withJson: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = withJson
    ? { 'Content-Type': 'application/json' }
    : {};
  try {
    const token = await auth?.currentUser?.getIdToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<ProfileData | null>(null);
  const [busy, setBusy] = useState(false);
  const [userInfo, setUserInfo] = useState<any | null>(null);
  const [subscription, setSubscription] =
    useState<SubscriptionInfo>({ status: 'loading' });
  const [activeSubs, setActiveSubs] = useState<{
    id: string;
    feature: EntitlementDisplay['feature'];
    label: string;
    // For creator all-access
    creatorUid?: string;
    creatorHandle?: string;
    creatorName?: string;
    creatorAppCount?: number;
    // For app-subscription
    appId?: number;
  }[]>([]);
  const [entitlementsError, setEntitlementsError] = useState(false);
  const [entitlementsAttempts, setEntitlementsAttempts] = useState(0);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [billingHistory, setBillingHistory] = useState<BillingEvent[]>([]);
  const [resolvingTitles, setResolvingTitles] = useState(false);
  const [resolvedTitleIds, setResolvedTitleIds] = useState<Set<string>>(new Set());
  const [autoCanceledIds, setAutoCanceledIds] = useState<Set<string>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState<{ id: string; label?: string } | null>(null);
  const [resolvedCreators, setResolvedCreators] = useState<Set<string>>(new Set());
  const [resolvedCreatorNames, setResolvedCreatorNames] = useState<Set<string>>(new Set());
  const {
    data: entitlementsData,
    loading: entitlementsLoading,
  } = useEntitlements();
  const connect = useConnectStatus();
  const canMonetize =
    connect?.payouts_enabled && (connect.requirements_due ?? 0) === 0;
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    phone: '',
    bio: '',
    website: '',
    twitter: '',
    github: '',
  });
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<'cancel' | null>(null);
  // Compute stable values before any early returns to keep hooks order consistent
  const handle = userInfo?.username || '';
  const joined = useMemo(() => {
    try {
      const t = (user as any)?.metadata?.creationTime;
      return t ? new Date(t).toLocaleDateString() : '';
    } catch {
      return '';
    }
  }, [user]);

  const entitlementItems: EntitlementDisplay[] = useMemo(
    () => [
      {
        feature: 'isGold',
        owned: entitlementsData?.gold ?? false,
        upgradeHref: '/pro/checkout/gold',
      },
      {
        feature: 'noAds',
        owned: entitlementsData?.noAds ?? false,
        upgradeHref: '/pro/checkout/noads',
      },
    ],
    [entitlementsData],
  );

  const loadSubscription = useCallback(
    async (subId: string) => {
      try {
        const res = await fetch(
          `${API_URL}/billing/subscription-status?sub_id=${subId}`,
          {
            headers: await buildHeaders(false),
            credentials: 'include',
          },
        );
        if (res.ok) {
          const json = await res.json();
          if (json.exists) {
            const status: SubscriptionInfo['status'] =
              json.status === 'active'
                ? 'active'
                : json.status === 'trialing'
                ? 'trial'
                : 'expired';
            const renewal = json.currentPeriodEnd
              ? new Date(json.currentPeriodEnd).toLocaleDateString()
              : undefined;
            setSubscription({ id: subId, status, renewalDate: renewal });
          } else {
            setSubscription({ id: subId, status: 'processing' });
          }
        } else {
          setSubscription({ id: subId, status: 'processing' });
        }
      } catch (err) {
        console.error('Failed to load subscription', err);
        setSubscription({ id: subId, status: 'processing' });
      }
    },
    [],
  );

  const loadEntitlements = useCallback(async () => {
    if (!user) return;
    try {
      const ents = await listEntitlements(user.uid);
      const subEnts = ents.filter((e) => e.data?.stripeSubscriptionId);
      const mapped = subEnts.map((e) => {
        const d: any = e.data || {};
        let label: string;
        if (e.feature === 'isGold') label = 'Gold plan';
        else if (e.feature === 'noAds') label = 'No ads';
        else if (e.feature === 'creator-all-access') label = d.creatorName ? `${d.creatorName}` : 'Creator all‑access';
        else if (e.feature === 'app-subscription') label = d.appTitle ? d.appTitle : (d.appId ? `Pretplata na aplikaciju #${d.appId}` : 'Pretplata na aplikaciju');
        else label = String(e.feature);
        return {
          id: String(d.stripeSubscriptionId || e.id),
          feature: e.feature,
          label,
          creatorUid: d.creatorId || d.creatorUid || undefined,
          creatorHandle: d.creatorHandle || undefined,
          creatorName: d.creatorName || undefined,
          appId: typeof d.appId === 'number' ? d.appId : (typeof d.appId === 'string' && /^\d+$/.test(d.appId) ? Number(d.appId) : undefined),
        };
      });
      // De‑duplicate: keep one per feature, except keep per‑creator for creator‑all‑access, and per‑app for app‑subscription
      const seen = new Set<string>();
      const deduped: { id: string; feature: EntitlementDisplay['feature']; label: string; creatorUid?: string; creatorHandle?: string; creatorName?: string; appId?: number }[] = [];
      for (const item of mapped) {
        const key = item.feature === 'app-subscription'
          ? `${item.feature}:${item.id}`
          : item.feature === 'creator-all-access'
          ? `${item.feature}:${item.creatorUid || item.id}`
          : String(item.feature);
        if (seen.has(key as string)) continue;
        seen.add(key as string);
        deduped.push(item);
      }
      setActiveSubs(deduped);
      if (subEnts[0]?.data?.stripeSubscriptionId) {
        const subId = subEnts[0].data!.stripeSubscriptionId as string;
        setSubscription({ id: subId, status: 'loading' });
        await loadSubscription(subId);
      } else {
        setSubscription({ status: 'expired' });
      }
      setEntitlementsError(false);
      setEntitlementsAttempts(0);
    } catch (err) {
      console.error('Failed to load entitlements', err);
      setSubscription({ status: 'processing' });
      setEntitlementsError(true);
      setEntitlementsAttempts((n) => n + 1);
    }
  }, [user, loadSubscription]);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/listings?owner=${encodeURIComponent(user.uid)}`,
        {
          cache: 'no-store',
          credentials: 'include',
          headers: await buildHeaders(false),
        },
      );
      if (res.ok) {
        const json = await res.json();
        const items: Listing[] = json.items ?? [];
        const stats = {
          likes: items.reduce((s, it) => s + (it.likesCount ?? 0), 0),
          plays: items.reduce(
            (s, it) => s + ((it as any).playCount ?? it.playsCount ?? 0),
            0,
          ),
          apps: items.length,
        };
        setData({ items, stats });
      } else {
        setData({ items: [], stats: { likes: 0, plays: 0, apps: 0 } });
      }
      if (!db) return;
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        setUserInfo(d);
        setForm({
          firstName: d.firstName || '',
          lastName: d.lastName || '',
          username: d.username || '',
          phone: d.phone || '',
          bio: d.bio || '',
          website: d.website || '',
          twitter: d.twitter || '',
          github: d.github || '',
        });
      }
      await loadEntitlements();
    } catch (e) {
      console.error('Failed to load profile', e);
    } finally {
      setBusy(false);
    }
  }, [user, loadEntitlements]);

  const loadUsage = useCallback(async () => {
    if (!user) return;
    setUsageBusy(true);
    try {
      const res = await fetch(`${API_URL}/me/usage`, {
        cache: 'no-store',
        credentials: 'include',
        headers: await buildHeaders(false),
      });
      if (res.ok) {
        setUsage(await res.json());
      }
    } catch (err) {
      console.error('Failed to load usage', err);
    } finally {
      setUsageBusy(false);
    }
  }, [user]);

  const loadBillingHistory = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_URL}/billing/history`, {
        cache: 'no-store',
        credentials: 'include',
        headers: await buildHeaders(false),
      });
      if (res.ok) {
        setBillingHistory(await res.json());
      }
    } catch (err) {
      console.error('Failed to load billing history', err);
    }
  }, [user]);

  // Try to resolve app titles for app-subscription entries missing a friendly label
  useEffect(() => {
    (async () => {
      if (!activeSubs.length || resolvingTitles) return;
      const needs = activeSubs.filter(
        (s) =>
          s.feature === 'app-subscription' &&
          /#\d+$/.test(s.label) &&
          !resolvedTitleIds.has(s.id) &&
          !autoCanceledIds.has(s.id),
      );
      if (!needs.length) return;
      setResolvingTitles(true);
      try {
        const updated: Record<string, string> = {};
        const autoCancel: string[] = [];
        for (const s of needs) {
          const m = s.label.match(/#(\d+)$/);
          const id = m ? m[1] : undefined;
          if (!id) continue;
          try {
            let ok = false;
            let title: string | undefined;
            let res = await fetch(`${API_URL}/listing/${encodeURIComponent(id)}`);
            if (res.ok) {
              const j = await res.json();
              title = j?.item?.title as string | undefined;
              ok = !!title;
            } else if ((res as any)?.status === 404) {
              autoCancel.push(s.id);
            }
            if (!ok) {
              res = await fetch(`${API_URL}/app/${encodeURIComponent(id)}`);
              if (res.ok) {
                const j2 = await res.json();
                title = (j2?.title || j2?.item?.title) as string | undefined;
                ok = !!title;
              } else if ((res as any)?.status === 404) {
                if (!autoCancel.includes(s.id)) autoCancel.push(s.id);
              }
            }
            if (ok && title) updated[s.id] = title;
          } catch {}
        }
        if (Object.keys(updated).length) {
          setActiveSubs((arr) => arr.map((x) => (updated[x.id] ? { ...x, label: updated[x.id] } : x)));
          setResolvedTitleIds((prev) => {
            const next = new Set(prev);
            for (const id of Object.keys(updated)) next.add(id);
            return next;
          });
        }
        for (const subId of autoCancel) {
          try {
            await cancelSubscription(subId, { silent: true });
            setAutoCanceledIds((prev) => new Set(prev).add(subId));
            setErrorMessage('Pretplata je automatski otkazana jer je aplikacija obrisana.');
          } catch {}
        }
      } finally {
        setResolvingTitles(false);
      }
    })();
  }, [activeSubs, resolvingTitles, resolvedTitleIds, autoCanceledIds]);

  // Enrich creator-all-access with app count for each creator
  useEffect(() => {
    (async () => {
      const pending = activeSubs.filter(
        (s) =>
          s.feature === 'creator-all-access' &&
          !!s.creatorUid &&
          !resolvedCreators.has(s.creatorUid!),
      );
      if (!pending.length) return;
      const byCreator = Array.from(new Set(pending.map((p) => p.creatorUid!)));
      const counts: Record<string, number> = {};
      for (const uid of byCreator) {
        try {
          const res = await fetch(`${API_URL}/listings?owner=${encodeURIComponent(uid)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            counts[uid] = Array.isArray(j?.items) ? j.items.length : 0;
          } else {
            counts[uid] = 0;
          }
        } catch {
          counts[uid] = 0;
        }
      }
      setActiveSubs((arr) =>
        arr.map((x) => {
          if (x.feature === 'creator-all-access' && x.creatorUid && counts[x.creatorUid] != null) {
            const n = counts[x.creatorUid];
            return { ...x, creatorAppCount: n };
          }
          return x;
        }),
      );
      setResolvedCreators((prev) => {
        const next = new Set(prev);
        for (const uid of byCreator) next.add(uid);
        return next;
      });
    })();
  }, [activeSubs, resolvedCreators]);

  // Ensure creator name and handle are present on creator-all-access entries
  useEffect(() => {
    (async () => {
      const missingName = activeSubs.filter(
        (s) =>
          s.feature === 'creator-all-access' &&
          !!s.creatorUid &&
          (!s.creatorName || !s.creatorHandle) &&
          !resolvedCreatorNames.has(s.creatorUid!),
      );
      if (!missingName.length) return;
      const byCreator = Array.from(new Set(missingName.map((p) => p.creatorUid!)));
      const names: Record<string, { name?: string; handle?: string }> = {};
      for (const uid of byCreator) {
        try {
          const res = await fetch(`${API_URL}/creators/id/${encodeURIComponent(uid)}`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json();
            names[uid] = { name: j?.displayName || j?.name || j?.handle || undefined, handle: j?.handle };
          }
        } catch {}
      }
      setActiveSubs((arr) =>
        arr.map((x) => {
          if (x.feature === 'creator-all-access' && x.creatorUid && names[x.creatorUid]) {
            const baseName = names[x.creatorUid].name || x.creatorName || x.label;
            return { ...x, creatorName: baseName, creatorHandle: names[x.creatorUid].handle || x.creatorHandle };
          }
          return x;
        }),
      );
      setResolvedCreatorNames((prev) => {
        const next = new Set(prev);
        for (const uid of byCreator) next.add(uid);
        return next;
      });
    })();
  }, [activeSubs, resolvedCreatorNames]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    loadUsage();
    const t = setInterval(loadUsage, 60000);
    return () => clearInterval(t);
  }, [loadUsage]);

  useEffect(() => {
    loadBillingHistory();
  }, [loadBillingHistory]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      if (!db) return;
      await updateDoc(doc(db, 'users', user.uid), {
        firstName: form.firstName,
        lastName: form.lastName,
        username: form.username,
        phone: form.phone || null,
        bio: form.bio || null,
        website: form.website || null,
        twitter: form.twitter || null,
        github: form.github || null,
      });
      await updateProfile(user, {
        displayName: `${form.firstName} ${form.lastName}`.trim(),
      });
      setUserInfo((prev: any) => ({ ...(prev ?? {}), ...form }));
    } finally {
      setSaving(false);
    }
  };

  async function manageBilling() {
    try {
      const res = await fetch(`${API_URL}/billing/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('bad_response');
      const session = await res.json();
      if (session?.url) {
        window.location.href = session.url as string;
        return;
      }
      setErrorMessage('Neispravan odgovor poslužitelja');
    } catch (err) {
      console.error('Manage billing failed', err);
      setErrorMessage('Greška pri komunikaciji s API-jem');
    }
  }

  async function cancelSubscription(id?: string, opts?: { silent?: boolean }) {
    const subId = id ?? subscription.id;
    if (!user || !subId) return;
    try {
      const res = await fetch(`${API_URL}/billing/subscriptions/cancel`, {
        method: 'POST',
        headers: await buildHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ subscriptionId: subId }),
      });
      if (res.status === 200) {
        setErrorMessage('');
        if (opts?.silent) {
          setActiveSubs((arr) => arr.filter((x) => x.id !== subId));
        } else {
          await loadProfile();
        }
      } else {
        setErrorMessage('Cancel failed');
      }
    } catch (err) {
      console.error('Cancel failed', err);
      setErrorMessage('Cancel failed');
    }
  }

  if (loading || busy) {
    return (
      <main className="flex items-center justify-center h-64">
        <p className="text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-600">Sign in to view profile</p>
        <Link href="/login" className={buttonVariants({})}>
          Sign In
        </Link>
      </main>
    );
  }

  const apps = data?.items ?? [];
  const stats = data?.stats ?? { likes: 0, plays: 0, apps: 0 };
  const name =
    getDisplayName(user) ||
    [userInfo?.firstName, userInfo?.lastName].filter(Boolean).join(' ').trim() ||
    userInfo?.username ||
    'User';
  const statusColor =
    subscription.status === 'active'
      ? 'text-emerald-600'
      : subscription.status === 'trial'
      ? 'text-yellow-600'
      : subscription.status === 'expired'
      ? 'text-red-600'
      : 'text-gray-600';
  const statusText =
    subscription.status === 'loading'
      ? 'Loading…'
      : subscription.status === 'processing'
      ? 'Processing…'
      : subscription.status.charAt(0).toUpperCase() +
        subscription.status.slice(1);
  return (
    <>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        {connect && !canMonetize && (
          <div className="p-6 bg-blue-50 border border-blue-200 rounded-xl text-center">
            <p className="mb-4 text-blue-900">
              Da bi monetizirao aplikacije ili repozitorij, najprije dovrši Stripe onboarding.
            </p>
            <div className="space-x-2">
              <button
                onClick={() => startStripeOnboarding(user!.uid, handle)}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                Podesi isplate (Stripe)
              </button>
              {connect.onboarded && connect.payouts_enabled && (
                <button
                  onClick={() => openStripeDashboard(user!.uid)}
                  className="px-4 py-2 bg-gray-200 rounded"
                >
                  Otvori Stripe dashboard
                </button>
              )}
            </div>
          </div>
        )}
        <Card className="relative overflow-hidden rounded-3xl border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-6">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-200/40 rounded-full blur-3xl" />
          <div className="relative z-10 flex items-center gap-5">
            <Avatar uid={user.uid} src={user.photoURL ?? undefined} name={name} size={72} />
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {name}
                {connect && (
                  <span
                    className={`ml-3 text-xs px-2 py-1 rounded-full ${
                      canMonetize
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {canMonetize ? 'Isplate aktivne' : 'Onboarding potreban'}
                  </span>
                )}
              </h1>
              <div className="mt-1 text-sm text-gray-600 flex flex-wrap items-center gap-3">
                <span>{user.email}</span>
                {handle && <span>· @{handle}</span>}
                {joined && <span>· Joined {joined}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700 text-sm">Apps: {stats.apps}</span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700 text-sm">Likes: {stats.likes}</span>
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-700 text-sm">Plays: {stats.plays}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/profile/edit" className={buttonVariants({ className: 'text-sm text-center' })}>
                Edit Profile
              </Link>
              {handle && (
                <Link
                  href={`/u/${handle}`}
                  className={buttonVariants({ variant: 'outline', className: 'text-sm text-center' })}
                >
                  Public Profile
                </Link>
              )}
            </div>
          </div>
        </Card>
        <Card className="rounded-3xl p-6">
          <h2 className="text-xl font-semibold mb-2">Značajke</h2>
          {entitlementsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            (() => {
              const addable = entitlementItems.filter((it) => !it.owned);
              return addable.length > 0 ? (
                <EntitlementsList items={addable} />
              ) : (
                <p className="text-sm text-gray-500">Sve dostupne značajke su aktivne.</p>
              );
            })()
          )}
        </Card>
        <Card className="rounded-3xl p-6">
          <h2 className="text-xl font-semibold mb-2">Subscription</h2>
          <p className="text-sm text-gray-700">
            Status{' '}
            <span className={`font-medium ${statusColor}`}>{statusText}</span>
          </p>
          {entitlementsError && (
            <div className="mt-2 text-sm text-red-600">
              Unable to load subscription.{' '}
              <button onClick={loadEntitlements} className="underline">
                Retry
              </button>
              {entitlementsAttempts > 2 && (
                <>
                  {' '}
                  or{' '}
                  <Link href="/support" className="underline">
                    contact support
                  </Link>
                </>
              )}
            </div>
          )}
          {subscription.renewalDate && subscription.status !== 'loading' && (
            <p className="text-sm text-gray-700">
              Renews on {subscription.renewalDate}
            </p>
          )}
          {subscription.status === 'loading' ? (
            <p className="mt-4 text-sm text-gray-500">Loading…</p>
          ) : subscription.status === 'processing' ? (
            <p className="mt-4 text-sm text-gray-500">
              Processing subscription…{' '}
              {subscription.id && (
                <button
                  onClick={() => loadSubscription(subscription.id!)}
                  className="underline"
                >
                  Try again
                </button>
              )}
            </p>
          ) : activeSubs.length > 0 ? (
            <>
              <div className="mt-4 flex flex-col gap-3">
                <div>
                  <h3 className="font-medium text-gray-900 text-sm">Aktivne pretplate</h3>
                  <ul className="mt-2 space-y-2">
                    {activeSubs.map((s) => {
                      let primary: React.ReactNode = s.label;
                      if (s.feature === 'app-subscription' && s.appId != null) {
                        primary = (
                          <Link href={{ pathname: '/app', query: { slug: s.appId } }} className="text-blue-600 hover:underline">
                            {s.label}
                          </Link>
                        );
                      } else if (s.feature === 'creator-all-access') {
                        const name = s.creatorName || s.label.replace(/^Repozitorij:\s*/i, '').replace(/^All.?access:?\s*/i, '');
                        const count = typeof s.creatorAppCount === 'number' ? ` (${s.creatorAppCount} aplikacija)` : '';
                        const text = `Repozitorij: ${name}${count}`;
                        primary = s.creatorHandle ? (
                          <Link href={`/u/${s.creatorHandle}`} className="text-blue-600 hover:underline">
                            {text}
                          </Link>
                        ) : (
                          <span className="text-gray-800">{text}</span>
                        );
                      } else {
                        primary = <span className="text-gray-800">{s.label}</span>;
                      }
                      return (
                        <li key={s.id} className="flex items-center justify-between text-sm">
                          <span className="text-gray-800">{primary}</span>
                          <button
                            onClick={() => setConfirmCancel({ id: s.id, label: s.label })}
                            className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 text-xs"
                          >
                            Otkaži
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!((entitlementsData?.gold ?? false) && (entitlementsData?.noAds ?? false)) && (
                    <Link
                      href="/pro"
                      className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 text-sm"
                    >
                      Dodaj značajke
                    </Link>
                  )}
                  <button
                    onClick={manageBilling}
                    className="px-3 py-1 rounded bg-gray-800 text-white hover:bg-gray-900 text-sm"
                  >
                    Upravljanje naplatom
                  </button>
                </div>
              </div>
              {errorMessage && (
                <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-gray-500">Nema aktivne pretplate</p>
          )}
        </Card>
        <Card className="rounded-3xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Billing History</h2>
            <Link
              href="/billing/history"
              className="text-sm text-blue-600 hover:underline"
            >
              Purchase history
            </Link>
          </div>
          {billingHistory.length ? (
            <ul className="text-sm text-gray-700 space-y-1">
              {billingHistory.map((ev, i) => (
                <li key={i} className="py-2 border-b border-gray-100">
                  {renderBillingEvent(ev)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No history</p>
          )}
        </Card>
        <Card className="rounded-3xl p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold">Usage</h2>
            <Button
              onClick={loadUsage}
              disabled={usageBusy}
              variant="outline"
              size="sm"
            >
              {usageBusy ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
          {usage ? (
            <ul className="text-sm text-gray-700 space-y-1">
              <li>
                Apps: {usage.apps.used} / {usage.apps.limit} (remaining {usage.apps.remaining})
              </li>
              <li>
                Storage: {usage.storage.used}MB / {usage.storage.limit}MB (remaining {usage.storage.remaining}MB)
              </li>
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No usage data</p>
          )}
        </Card>

        <div>
          <h2 className="text-xl font-semibold mb-2">Osobni podaci</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Input
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                placeholder="Ime"
              />
              <Input
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                placeholder="Prezime"
              />
            </div>
            <Input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Korisničko ime"
            />
            <Input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="Broj mobitela"
            />
            <Textarea
              name="bio"
              value={form.bio}
              onChange={handleChange}
              placeholder="Bio"
            />
            <div className="grid md:grid-cols-3 gap-4">
              <Input name="website" value={form.website} onChange={handleChange} placeholder="https://example.com" />
              <Input name="twitter" value={form.twitter} onChange={handleChange} placeholder="https://twitter.com/handle" />
              <Input name="github" value={form.github} onChange={handleChange} placeholder="https://github.com/user" />
            </div>
            <Button type="submit" disabled={saving} className="rounded-2xl">
              {saving ? 'Spremanje...' : 'Spremi'}
            </Button>
          </form>
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-2">Moji projekti ({apps.length})</h2>
          <p className="text-sm text-gray-600 mb-4">Ukupno lajkova: {stats.likes}</p>
          {apps.length > 0 ? (
            <ul className="space-y-4">
              {apps.map((app) => (
                <li key={app.id}>
                  <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                    <h3 className="text-lg font-medium">{app.title}</h3>
                    {app.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {app.description}
                      </p>
                    )}
                    <div className="mt-1 text-xs text-gray-500 flex gap-4">
                      {typeof app.likesCount === 'number' && (
                        <span>Likes: {app.likesCount}</span>
                      )}
                      {typeof (app as any).playCount === 'number' || typeof app.playsCount === 'number' ? (
                        <span>
                          Plays: {(app as any).playCount ?? app.playsCount ?? 0}
                        </span>
                      ) : null}
                    </div>
                  </div>
                    <div className="flex gap-2">
                      <a
                        href={`/play?appId=${encodeURIComponent(app.id)}&run=1`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ className: 'text-sm' })}
                      >
                        Open
                      </a>
                      <Link
                        href={{ pathname: '/app', query: { slug: app.slug } }}
                        className={buttonVariants({ variant: 'outline', className: 'text-sm' })}
                      >
                        Manage
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-gray-500">You don&apos;t have any applications yet.</p>
          )}
        </div>
      </main>
      <ConfirmDialog
        open={!!confirmCancel}
        title={'Otkaži pretplatu'}
        message={`Želite li otkazati pretplatu${confirmCancel?.label ? ` za "${confirmCancel.label}"` : ''}? Pretplata će ostati aktivna do kraja tekućeg obračunskog razdoblja.`}
        confirmLabel={'Da, otkaži'}
        cancelLabel="Ne"
        confirmTone={'danger'}
        onConfirm={() => {
          const id = confirmCancel?.id;
          setConfirmCancel(null);
          if (id) cancelSubscription(id);
        }}
        onClose={() => setConfirmCancel(null)}
      />
    </>
  );
}


