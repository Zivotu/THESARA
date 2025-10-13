"use client";

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { API_URL } from '@/lib/config';
import type { AccessMode } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useSafeSearchParams } from '@/hooks/useSafeSearchParams';

function Toast({
  message,
  type = 'error',
  onClose,
}: {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-red-600',
    info: 'from-blue-500 to-blue-600',
  } as const;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slideInRight">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg bg-gradient-to-r ${colors[type]}`}
      >
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

function PurchaseOptions({
  unlockApp,
  subscribeAllAccess,
  manageBilling,
  creatorUid,
  showAllAccess,
}: {
  unlockApp: () => void;
  subscribeAllAccess: () => void;
  manageBilling: () => void;
  creatorUid: string | null;
  showAllAccess: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 mt-4">
      <button
        type="button"
        onClick={unlockApp}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        Unlock this app
      </button>
      {creatorUid && showAllAccess && (
        <button
          type="button"
          onClick={subscribeAllAccess}
          className="px-3 py-1 bg-blue-600 text-white rounded"
        >
          Subscribe All-Access
        </button>
      )}
      <button
        type="button"
        onClick={manageBilling}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        Manage billing
      </button>
    </div>
  );
}

function LoginPrompt() {
  return (
    <div className="flex flex-col gap-2 mt-4">
      <p>Prijavite se za kupnju</p>
      <Link
        href="/login"
        className="px-3 py-1 bg-blue-600 text-white rounded text-center"
      >
        Prijava
      </Link>
    </div>
  );
}

function OwnerNotice({ openApp }: { openApp: () => void | Promise<void> }) {
  return (
    <div className="flex flex-col gap-2 mt-4">
      <p>You own this app; access is free.</p>
      <button
        type="button"
        onClick={openApp}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        Open app
      </button>
    </div>
  );
}

export default function PaywallPage() {
  return (
    <Suspense fallback={null}>
      <PaywallClient />
    </Suspense>
  );
}

function PaywallClient() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const safeSlug = slug ? encodeURIComponent(slug) : '';
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [windowRange, setWindowRange] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [creatorUid, setCreatorUid] = useState<string | null>(null);
  const [allAccessAvailable, setAllAccessAvailable] = useState(false);
  const [appNumericId, setAppNumericId] = useState<number | null>(null);
  const search = useSafeSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const idempotencyKeys = useRef<Record<string, string>>({});
  const [isPaid, setIsPaid] = useState(false);
  const [trialStep, setTrialStep] = useState<'idle' | 'verify' | 'granted'>('idle');
  const [trialEmail, setTrialEmail] = useState('');
  const [trialCode, setTrialCode] = useState('');
  const [trialExpiresAt, setTrialExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const isOwner = user?.uid === creatorUid;

  function formatRemaining(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  useEffect(() => {
    const err = search.get('e');
    if (err === 'invalid_session') {
      const msg = 'Sesija je istekla ili je opozvana';
      setError(msg);
      setToast(msg);
    } else if (err === 'forbidden') {
      const msg = 'Nemate pristup ovoj aplikaciji';
      setError(msg);
      setToast(msg);
    }
  }, [search]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/listing/${safeSlug}`);
        if (res.ok) {
          const json = await res.json();
          const f = json?.item?.pinActiveFrom;
          const t = json?.item?.pinActiveUntil;
          if (f || t) {
            const from = f ? new Date(f).toLocaleString() : '';
            const to = t ? new Date(t).toLocaleString() : '';
            setWindowRange(`${from} - ${to}`);
          }
          const mode = json?.item?.accessMode as AccessMode | undefined;
          if (mode) {
            setAccessMode(mode);
            setShowModal(mode === 'pin');
          }
          const owner = json?.item?.author?.uid || json?.item?.ownerUid;
          if (owner) {
            setCreatorUid(owner);
            try {
              const handle = json?.item?.author?.handle;
              let h = handle as string | undefined;
              if (!h) {
                const r = await fetch(`${API_URL}/creators/id/${encodeURIComponent(owner)}`);
                if (r.ok) {
                  const j = await r.json();
                  h = j?.handle as string | undefined;
                }
              }
              if (h) {
                const r2 = await fetch(`${API_URL}/creators/${encodeURIComponent(h)}`);
                if (r2.ok) {
                  const j2 = await r2.json();
                  const p = j2?.allAccessPrice;
                  setAllAccessAvailable(typeof p === 'number' && p > 0);
                }
              }
            } catch {}
          }
          const price = json?.item?.price;
          if (json?.item?.id != null) setAppNumericId(Number(json.item.id));
          setIsPaid(typeof price === 'number' && price > 0);
        }
      } catch {}
    })();
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API_URL}/app/${safeSlug}/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      let msg = 'Greška';
      try {
        const json: any = await res.json();
        const code = json?.error as string;
        msg = (
          {
            inactive: 'Aplikacija je privremeno deaktivirana',
            bad_pin: 'Neispravan PIN',
            concurrency_limit: 'Previše aktivnih sesija, pokušajte kasnije',
            rate_limited: 'Previše pokušaja, pokušajte kasnije',
          } as Record<string, string>
        )[code] || msg;
      } catch {}
      setError(msg);
      setToast(msg);
      return;
    }
    // Open the public app endpoint which resolves slug -> buildId
    const url = `${API_URL}/app/${safeSlug}/`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setShowModal(false);
    setToast('Aplikacija je otvorena u novom prozoru');
  }

  // On mount (and when user/app changes), check trial status and entitlements.
  useEffect(() => {
    if (!user || appNumericId == null) {
      return;
    }

    const checkTrialStatus = async () => {
      try {
        const token = await (user as any)?.getIdToken?.();
        if (!token) return;

        const u = new URL(`${API_URL}/trial/status`);
        u.searchParams.set('appId', String(appNumericId));
        const res = await fetch(u.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;

        const data = await res.json();
        if (data?.ok && data.exists) {
          if (data.verified) {
            setTrialStep('granted');
            // Now fetch entitlements to get expiry
            const r = await fetch(`${API_URL}/me/entitlements`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            });
            if (r.ok) {
              const ents = await r.json();
              if (Array.isArray(ents)) {
                const e = ents.find(
                  (x: any) =>
                    x.feature === 'app-trial' &&
                    x.active !== false &&
                    String(x.data?.appId) === String(appNumericId)
                );
                const expRaw = e?.data?.expiresAt;
                let exp: number | null = null;
                if (typeof expRaw === 'number') exp = expRaw;
                else if (typeof expRaw === 'string') exp = Date.parse(expRaw);
                if (exp && Number.isFinite(exp)) setTrialExpiresAt(exp);
              }
            }
          } else if (Date.now() < Number(data.validUntil || 0)) {
            setTrialStep('verify');
          }
        }
      } catch (err) {
        console.error('Failed to check trial status:', err);
      }
    };

    checkTrialStatus();
  }, [user, appNumericId]);

  // Countdown for verified trial expiry
  useEffect(() => {
    if (!trialExpiresAt) { setRemainingMs(null); return; }
    const update = () => setRemainingMs(Math.max(0, trialExpiresAt - Date.now()));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [trialExpiresAt]);

  async function startCheckout(body: any) {
    setError(null);
    try {
      const token = await (user as any)?.getIdToken?.();
      if (!token) {
        router.push('/login');
        return;
      }
      const key = JSON.stringify(body);
      if (!idempotencyKeys.current[key]) {
        idempotencyKeys.current[key] = crypto.randomUUID();
      }
      const idempotencyKey = idempotencyKeys.current[key];
      const requestedType = body?.type;
      let endpoint = `${API_URL}/billing/checkout`;
      // Map convenience calls to proper subscription endpoints
      if (body?.type === 'app' && body?.appId) {
        endpoint = `${API_URL}/billing/subscriptions/app`;
        body = { appId: String(body.appId) };
      } else if (body?.type === 'creator' && body?.creatorUid) {
        endpoint = `${API_URL}/billing/subscriptions/creator`;
        body = { creatorId: body.creatorUid };
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...body, idempotencyKey }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('bad_response');
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        console.warn('Unexpected content type:', contentType);
        const msg = 'Neispravan odgovor poslužitelja';
        setError(msg);
        setToast(msg);
        return;
      }
      let session: any;
      try {
        session = await res.json();
      } catch (err) {
        console.warn('Failed to parse JSON response', err);
        const msg = 'Neispravan odgovor poslužitelja';
        setError(msg);
        setToast(msg);
        return;
      }
      if (session?.url) {
        window.location.href = session.url as string;
        return;
      }
      if (session?.alreadySubscribed) {
        if (requestedType === 'app') {
          openPlayNow();
        }
        setToast('Već ste pretplaćeni');
        return;
      }
      const msg = 'Neispravan odgovor poslužitelja: nedostaje URL sesije';
      setError(msg);
      setToast(msg);
    } catch {
      const msg = 'Greška pri komunikaciji s API-jem';
      setError(msg);
      setToast(msg);
    }
  }

  async function unlockApp() {
    if (isOwner) {
      openPlayNow();
      return;
    }
    if (appNumericId == null) {
      console.warn('Attempted to unlock app with null appNumericId. Using slug as fallback.');
      await startCheckout({ type: 'app', appId: slug });
    } else {
      await startCheckout({ type: 'app', appId: appNumericId });
    }
  }

  async function openPlayNow() {
    // Open via frontend route so auth/session is handled and player iframe resolves correctly
    const url = new URL('/play', window.location.origin);
    if (slug) url.searchParams.set('appId', slug);
    url.searchParams.set('run', '1');
    if (user) {
      try {
        const token = await user.getIdToken();
        url.searchParams.set('token', token);
      } catch {}
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  async function subscribeAllAccess() {
    if (!creatorUid) return;
    if (isOwner) {
      openPlayNow();
      return;
    }
    await startCheckout({ type: 'creator', creatorUid });
  }

  async function manageBilling() {
    setError(null);
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
      const msg = 'Neispravan odgovor poslužitelja';
      setError(msg);
      setToast(msg);
    } catch {
      const msg = 'Greška pri komunikaciji s API-jem';
      setError(msg);
      setToast(msg);
    }
  }

  async function requestTrial() {
    setError(null);
    try {
      const token = await (user as any)?.getIdToken?.();
      if (!token) { router.push('/login'); return; }
      const res = await fetch(`${API_URL}/trial/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appId: appNumericId, email: (user as any)?.email || trialEmail || undefined }),
      });
      if (!res.ok) throw new Error('bad_response');
      setTrialStep('verify');
      setToast('Poslali smo kod na vaš e‑mail');
    } catch {
      // Ako slanje ne uspije (npr. rate‑limit), ipak dopusti unos koda koji je već primljen.
      setTrialStep('verify');
      setError('Ne možemo poslati novi kod. Unesite kod koji ste već primili e‑poštom.');
    }
  }

  async function verifyTrial() {
    setError(null);
    try {
      const token = await (user as any)?.getIdToken?.();
      if (!token) { router.push('/login'); return; }
      const res = await fetch(`${API_URL}/trial/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appId: appNumericId, code: trialCode.trim() }),
      });
      if (!res.ok) {
        let msg = 'Pogrešan ili istekao kod.';
        try {
          const j = await res.json();
          if (j?.error === 'code_expired') msg = 'Kod je istekao. Zatražite novi.';
          else if (j?.error === 'bad_code') msg = 'Kod nije ispravan. Provjerite znamenke (uključujući vodeće nule).';
          else if (j?.error === 'already_verified') { msg = 'Kod je već iskorišten.'; setTrialStep('granted'); }
          else if (j?.error === 'trial_request_failed' || j?.error === 'trial_verify_failed') msg = 'Greška poslužitelja. Pokušajte kasnije.';
        } catch {}
        throw new Error(msg);
      }
      setTrialStep('granted');
      setToast('Probni pristup je omogućen.');
    } catch (e: any) {
      setError(e?.message || 'Pogrešan ili istekao kod.');
    }
  }

  return (
    <div>
      {accessMode === 'pin' && showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white p-6 rounded shadow w-full max-w-sm">
            <h1 className="text-2xl font-bold mb-4">Unesi PIN za pristup</h1>
            <form onSubmit={submit} className="space-y-2">
              <input
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="border px-2 py-1 rounded w-full"
                placeholder="PIN"
              />
              <div className="flex justify-end">
                <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded">
                  Potvrdi
                </button>
              </div>
            </form>
            {windowRange && (
              <p className="text-sm text-gray-400 mt-2">PIN pristup: {windowRange}</p>
            )}
            {error && <p className="text-red-500 mt-2">{error}</p>}
            {user ? (
              isOwner ? (
                <OwnerNotice openApp={openPlayNow} />
              ) : (
                <PurchaseOptions
                  unlockApp={unlockApp}
                  subscribeAllAccess={subscribeAllAccess}
                  manageBilling={manageBilling}
                  creatorUid={creatorUid}
                  showAllAccess={allAccessAvailable}
                />
              )
            ) : (
              <LoginPrompt />
            )}
          </div>
        </div>
      )}
      {accessMode && accessMode !== 'pin' && (
        <div className="p-6 max-w-sm">
          {error && <p className="text-red-500 mb-2">{error}</p>}
          {user ? (
            isOwner ? (
              <OwnerNotice openApp={openPlayNow} />
            ) : (
              <PurchaseOptions
                unlockApp={unlockApp}
                subscribeAllAccess={subscribeAllAccess}
                manageBilling={manageBilling}
                creatorUid={creatorUid}
                showAllAccess={allAccessAvailable}
              />
            )
          ) : (
            <LoginPrompt />
          )}
          {user && isPaid && (
            <div className="mt-4 p-4 border rounded">
              <h2 className="font-semibold mb-2">Isprobaj 24h</h2>
              <p className="text-sm text-gray-600 mb-3">
                Zatražite jednokratni probni kod. Kod vrijedi 24 sata i omogućuje 24 h pristupa ovoj aplikaciji nakon potvrde.
                Ako ne možete ponovno zatražiti kod, unesite onaj koji ste već primili u e‑pošti.
              </p>
              {!(user as any)?.email && trialStep === 'idle' && (
                <input
                  type="email"
                  placeholder="Vaš e‑mail"
                  value={trialEmail}
                  onChange={(e) => setTrialEmail(e.target.value)}
                  className="border px-2 py-1 rounded w-full mb-2"
                />
              )}
              {trialStep === 'idle' && (
                <div className="flex items-center gap-3">
                  <button onClick={requestTrial} className="px-3 py-1 bg-gray-800 text-white rounded">Pošalji kod</button>
                  <button
                    type="button"
                    onClick={() => setTrialStep('verify')}
                    className="text-sm text-blue-700 underline"
                    title="Već imate kod? Unesite ga ovdje"
                  >
                    Imam kod
                  </button>
                </div>
              )}
              {trialStep === 'verify' && (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Unesi 8‑znamenkasti kod"
                    value={trialCode}
                    onChange={(e) => setTrialCode(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="border px-2 py-1 rounded w-full"
                  />
                  <div className="flex gap-2">
                    <button onClick={verifyTrial} className="px-3 py-1 bg-emerald-600 text-white rounded">Potvrdi</button>
                    <button onClick={requestTrial} className="px-3 py-1 bg-gray-200 rounded">Novi kod</button>
                  </div>
                  <p className="text-xs text-gray-500">Kod vrijedi 24 sata od slanja.</p>
                </div>
              )}
              {trialStep === 'granted' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <button onClick={openPlayNow} className="px-3 py-1 bg-emerald-600 text-white rounded">Play</button>
                    {remainingMs != null && (
                      <span className="text-xs text-gray-600">
                        Preostalo: {formatRemaining(remainingMs)}
                      </span>
                    )}
                  </div>
                  {trialExpiresAt && (
                    <p className="text-xs text-gray-500">Istek: {new Date(trialExpiresAt).toLocaleString()}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
