"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import { useSafeSearchParams } from "@/hooks/useSafeSearchParams";
import Link from "next/link";
import { triggerConfetti } from "@/components/Confetti";
import { API_URL } from "@/lib/config";
import { auth } from "@/lib/firebase";
import type { User } from 'firebase/auth';
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type BillingPackage = {
  id: string;
  name: string;
  description?: string;
  priceId: string;
  price?: number;
  currency?: string;
};

export default function BillingSuccessClient() {
  const search = useSafeSearchParams();
  const [sessionId] = useState<string | null>(() => {
    const id = search.get("session_id");
    if (id) return id;
    try {
      return localStorage.getItem("lastCheckoutSessionId");
    } catch {
      return null;
    }
  });
  const [appSlug, setAppSlug] = useState<string | null>(() =>
    search.get("app") || search.get("appId") || search.get("slug"),
  );
  const [status, setStatus] = useState<
    "processing" | "error" | "forbidden" | "unauthorized" | "success"
  >("processing");
  const [retryToken, setRetryToken] = useState(0);
  const [order, setOrder] = useState<{
    id: string;
    status: string;
    priceId?: string | null;
  } | null>(null);
  const [pkg, setPkg] = useState<BillingPackage | null>(null);

  const handleRetry = useCallback(() => {
    setStatus("processing");
    setRetryToken((x) => x + 1);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem("lastCheckoutSessionId", sessionId);
    } catch {}
    let cancelled = false;
    let ran = false;

    const run = async (user: User) => {
      try {
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };
        const res = await fetch(
          `${API_URL}/billing/sync-checkout?session_id=${sessionId}`,
          { method: "POST", credentials: "include", headers },
        );
        if (res.status === 403) {
          setStatus("forbidden");
          return;
        }
        if (res.status === 401) {
          setStatus("unauthorized");
          return;
        }
        if (!res.ok) throw new Error("sync_failed");
        const data = await res.json();
        if (data?.appSlug || data?.appId || data?.app) {
          setAppSlug(String(data.appSlug ?? data.appId ?? data.app));
        }
        const subId = data.subscriptionId;
        const start = Date.now();
        const poll = async (attempt = 0) => {
          if (cancelled) return;
          const r = await fetch(
            `${API_URL}/billing/subscription-status?sub_id=${subId}`,
            { headers, credentials: "include" },
          );
          const j = await r.json();
          if (j.exists) {
            triggerConfetti();
            setOrder({ id: subId, status: j.status, priceId: j.priceId });
            setStatus("success");
            return;
          }
          if (Date.now() - start < 15000) {
            setTimeout(
              () => poll(attempt + 1),
              Math.min(1000 * (attempt + 1), 3000),
            );
          } else {
            setStatus("error");
          }
        };
        poll();
      } catch (err) {
        console.error("billing_sync_error", err);
        if (status !== "forbidden" && status !== "unauthorized") {
          setStatus("error");
        }
      }
    };

    const unsub = auth?.onIdTokenChanged?.((user) => {
      if (cancelled || ran) return;
      if (!user) {
        setStatus("unauthorized");
        return;
      }
      ran = true;
      run(user);
    });

    return () => {
      cancelled = true;
      try { unsub?.(); } catch {}
    };
  }, [sessionId, retryToken]);

  useEffect(() => {
    if (status !== "success" || !order?.priceId) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/billing/packages`);
        if (!res.ok) return;
        const data: BillingPackage[] = await res.json();
        const found = data.find((p) => p.priceId === order.priceId);
        if (found) setPkg(found);
      } catch (err) {
        console.error("failed_to_load_packages", err);
      }
    })();
  }, [status, order?.priceId]);

  useEffect(() => {
    if (status !== "success") return;
    (async () => {
      try {
        const user = auth?.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };

        // Refetch /me/entitlements
        await fetch(`${API_URL}/me/entitlements`, { headers, cache: 'no-store' });
        console.log('Refetched /me/entitlements after successful purchase.');
      } catch (err) {
        console.error("failed_to_refetch_entitlements", err);
      }
    })();
  }, [status]);

  const formatPrice = (price: number, currency: string) =>
    new Intl.NumberFormat("hr-HR", {
      style: "currency",
      currency,
    }).format(price / 100);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">
        {status === "processing"
          ? "Processing your purchase..."
          : status === "forbidden"
          ? "Access denied"
          : status === "unauthorized"
          ? "Not signed in"
          : status === "success"
          ? "Hvala na kupnji!"
          : "Payment verification failed"}
      </h1>
      {status === "success" && order && (
        <Card className="p-4 space-y-4">
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">Subscription ID:</span> {order.id}
            </p>
            <p>
              <span className="font-medium">Status:</span> {order.status}
            </p>
            {order.priceId && (
              <p>
                <span className="font-medium">Product:</span> {pkg?.name ?? order.priceId}
              </p>
            )}
            {pkg?.description && (
              <p>
                <span className="font-medium">Description:</span> {pkg.description}
              </p>
            )}
            {pkg?.price != null && pkg.currency && (
              <p>
                <span className="font-medium">Price:</span> {formatPrice(pkg.price, pkg.currency)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {appSlug && (
              <Link
                href={{ pathname: '/app', query: { slug: appSlug } }}
                className="inline-block"
              >
                <Button>Open app</Button>
              </Link>
            )}
            <Link href="/" className="inline-block">
              <Button variant={appSlug ? "secondary" : "default"}>
                Go to home
              </Button>
            </Link>
          </div>
        </Card>
      )}
      {status === "error" && (
        <>
          <p className="text-red-500">
            We couldn&apos;t verify your payment. If you were charged, please contact support.
          </p>
          <Button onClick={handleRetry} className="mt-4">
            Retry
          </Button>
        </>
      )}
      {status === "forbidden" && (
        <p className="text-red-500">
          This checkout session does not belong to you.
        </p>
      )}
      {status === "unauthorized" && (
        <p className="text-red-500">
          You must be signed in to verify this payment.
        </p>
      )}
    </div>
  );
}

