'use client';

import Avatar from './Avatar';
import { useAuth, getDisplayName } from '@/lib/auth';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useI18n } from '@/lib/i18n-provider';

export default function UserSummary() {
  const { user } = useAuth();
  const { data: entitlements } = useEntitlements();
  const { locale } = useI18n();

  if (!user) return null;

  const subs: string[] = [];
  if (entitlements?.gold) subs.push('Gold');
  if (entitlements?.noAds) subs.push('No Ads');
  const purchases = entitlements?.purchases || [];
  if (purchases.length) {
    const appSubs = purchases.filter((p) => p === 'app-subscription').length;
    const creators = purchases.filter((p) => p === 'creator-all-access').length;
    const trials = purchases.filter((p) => p === 'app-trial').length;
    if (appSubs > 0) subs.push(locale === 'hr' ? `Pretplate na aplikacije: ${appSubs}` : `App subscriptions: ${appSubs}`);
    if (creators > 0) subs.push(locale === 'hr' ? `All‑access kreatori: ${creators}` : `All‑access creators: ${creators}`);
    if (trials > 0) subs.push(locale === 'hr' ? `Probna razdoblja: ${trials}` : `Trials: ${trials}`);
  }

  return (
    <div className="flex items-center gap-4 bg-white rounded-lg shadow p-4 max-w-md mx-auto">
      <Avatar uid={user.uid} src={user.photoURL} name={user.displayName} size={48} />
      <div className="flex-1">
        <div className="font-semibold text-gray-900">{getDisplayName(user)}</div>
        {subs.length > 0 && (
          <div className="text-sm text-gray-600">{locale === 'hr' ? 'Aktivne pretplate' : 'Active subscriptions'}: {subs.join(', ')}</div>
        )}
      </div>
    </div>
  );
}
