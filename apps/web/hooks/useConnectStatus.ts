'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { apiGet, apiPost } from '@/lib/api';

export type ConnectStatus = {
  onboarded?: boolean;
  payouts_enabled?: boolean;
  requirements_due?: number;
};

export function useConnectStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectStatus | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    apiGet<ConnectStatus>(
      `/billing/connect/status?creatorId=${encodeURIComponent(user.uid)}`,
      { auth: true },
    )
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [user]);

  return status;
}

export async function startStripeOnboarding(creatorId: string, handle: string) {
  const returnUrl = `${window.location.origin}/u/${handle}/finances?onboarding=1`;
  const res = await apiPost<{ url?: string }>(
    `/billing/connect/onboard`,
    { creatorId, returnUrl },
    { auth: true },
  );
  if (res.url) {
    window.location.assign(res.url);
  }
}

export async function openStripeDashboard(creatorId: string) {
  const res = await apiPost<{ url?: string }>(
    `/billing/connect/dashboard`,
    { creatorId },
    { auth: true },
  );
  if (res.url) {
    window.location.assign(res.url);
  }
}

