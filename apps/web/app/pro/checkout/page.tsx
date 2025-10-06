"use client";

import { Suspense, useEffect, useState } from 'react';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { apiAuthedPost } from '@/lib/api';
import CheckoutReview, {
  BillingPackage,
  CheckoutItem,
} from '@/components/CheckoutReview';
import CheckoutStepper from '@/components/CheckoutStepper';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useEntitlements, type Entitlements } from '@/hooks/useEntitlements';
import { useRouter } from 'next/navigation';
import { useRouteParam } from '@/hooks/useRouteParam';
import { Card } from '@/components/ui/Card';


async function loadStripe() {
  if (typeof window === 'undefined') return null;
  if (!(window as any).Stripe) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3';
      script.onload = () => resolve();
      script.onerror = () => reject();
      document.body.appendChild(script);
    });
  }
  const key =
    process.env.NEXT_PUBLIC_STRIPE_PK ??
    process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new Error('Missing Stripe publishable key');
  return (window as any).Stripe(key);
}

export default function ProCheckoutPage() {
  return (
    <Suspense fallback={null}>
      <ProCheckoutClient />
    </Suspense>
  );
}

function ProCheckoutClient() {
  const priceId = useRouteParam('priceId', (segments) => {
    if (segments.length > 2 && segments[0] === 'pro' && segments[1] === 'checkout') {
      return segments[2] ?? '';
    }
    return undefined;
  });
  const { user } = useAuth();
  const router = useRouter();
  const { data: entitlements, loading: entitlementsLoading } = useEntitlements();
  const [pkg, setPkg] = useState<BillingPackage | null>(null);
  const [item, setItem] = useState<CheckoutItem | null>(null);
  const [tax, setTax] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [vatId, setVatId] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entitlementMap: Record<string, keyof Entitlements> = {
    gold: 'gold',
    noads: 'noAds',
  };

  const owned = pkg && entitlements
    ? (() => {
        const key = entitlementMap[pkg.id];
        if (key) {
          return (entitlements as any)[key];
        }
        return entitlements.purchases.includes(pkg.id);
      })()
    : false;

  useEffect(() => {
    fetch(`${API_URL}/billing/packages`)
      .then((r) => r.json())
      .then((data: BillingPackage[]) => {
        const found =
          data.find((p) => p.id === priceId || p.priceId === priceId) || null;
        setPkg(found);
        if (found && found.price != null) {
          const mapped: CheckoutItem = {
            name: found.name,
            description: found.description,
            price: found.price,
            currency: found.currency,
          };
          setItem(mapped);
          // simple tax/discount placeholders
          setTax(Math.round(found.price * 0.0));
          setDiscount(0);
        }
      })
      .catch(() => setPkg(null))
      .finally(() => setLoading(false));
  }, [priceId]);

  useEffect(() => {
    if (!loading && !entitlementsLoading && !pkg) {
      if (
        entitlements?.gold ||
        entitlements?.noAds ||
        (entitlements?.purchases || []).length > 0
      ) {
        router.replace('/profile');
      } else {
        router.replace('/pro');
      }
    }
  }, [loading, entitlementsLoading, pkg, entitlements, router]);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
    if (user?.uid && db) {
      getDoc(doc(db, 'users', user.uid))
        .then((snap) => {
          const d = snap.data() as any;
          if (d?.address) setAddress(d.address);
          if (d?.city) setCity(d.city);
          if (d?.postalCode) setPostalCode(d.postalCode);
          if (d?.country) setCountry(d.country);
          if (d?.vatId) setVatId(d.vatId);
        })
        .catch(() => {});
    }
  }, [user]);

  const onProceed = async (
    customerEmail: string,
    addr: {
      address?: string;
      city?: string;
      postalCode?: string;
      country?: string;
      vatId?: string;
    },
  ) => {
    if (!pkg || owned) return;
    // Basic validation
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      setError('Neispravna email adresa');
      return;
    }
    if (!addr.address || !addr.city || !addr.postalCode || !addr.country) {
      setError('Molimo ispunite sve potrebne podatke');
      return;
    }
    setCheckoutLoading(true);
    setError(null);
    try {
      if (user && db) {
        await updateDoc(doc(db, 'users', user.uid), {
          address: addr.address || null,
          city: addr.city || null,
          postalCode: addr.postalCode || null,
          country: addr.country || null,
          vatId: addr.vatId || null,
        });
      }
      const res = await apiAuthedPost<{
        ok: boolean;
        sessionId?: string;
        url?: string;
        error?: string;
      }>('billing/subscriptions', {
        priceId: pkg.priceId || pkg.id,
        customerEmail: customerEmail || user?.email,
        customerAddress: addr,
      });

      if (!res.ok) {
        setError(res.error || 'Subscription failed');
        return;
      }

      if (res.sessionId) {
        const stripe = await loadStripe();
        const { error } = await stripe?.redirectToCheckout({ sessionId: res.sessionId });
        if (error) setError(error.message);
        return;
      }

      if (res.url) {
        window.location.href = res.url;
        return;
      }

      setError('Subscription failed: no session');
    } catch (e: any) {
      setError(e?.message || 'Subscription failed');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading || entitlementsLoading || !pkg || !item) {
    return <p>Loading...</p>;
  }

  if (owned) {
    return (
      <main className="p-4">
        <Card className="p-4">
          <p>Već imate ovu pretplatu.</p>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <CheckoutStepper step={1} />
        <CheckoutReview
          item={item}
          email={email}
          addressInfo={{
            address,
            city,
            postalCode,
            country,
            vatId,
          }}
          tax={tax}
          discount={discount}
          onProceed={onProceed}
          loading={checkoutLoading}
          error={error}
        />
      </div>
    </main>
  );
}

