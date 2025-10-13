'use client';

import { useEffect, useState } from 'react';
import { SAFE_PUBLISH_ENABLED } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { translateReason } from '@/lib/reviewReasons';
import { apiGet, apiPost, ApiError } from '@/lib/api';

type PendingApp = {
  id: string;
  title: string;
  author?: { uid?: string; name?: string };
  capabilities?: any;
  moderation?: { reasons?: string[]; status?: string; notes?: string };
};

export default function ModerationPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<PendingApp[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>('');
  const [telemetry, setTelemetry] = useState<any>(null);

  useEffect(() => {
    if (!SAFE_PUBLISH_ENABLED) return;
    const load = async () => {
      try {
        const json = await apiGet<{ items?: PendingApp[] }>('/apps/pending', { auth: true });
        setItems(json.items || []);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setError('forbidden');
        } else {
          console.error('Failed to load pending apps', e);
        }
      }
    };
    load();
    const loadTelemetry = async () => {
      try {
        const json = await apiGet('/review/telemetry', { auth: true });
        setTelemetry(json);
      } catch (e) {
        console.error('Failed to load telemetry', e);
      }
    };
    loadTelemetry();
  }, [user]);

  const approve = async (id: string) => {
    await apiPost(`/apps/${id}/approve`, {}, { auth: true });
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const reject = async (id: string) => {
    const reason = reasons[id] || '';
    await apiPost(`/apps/${id}/reject`, { reason }, { auth: true });
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  if (!SAFE_PUBLISH_ENABLED) {
    return <div className="p-4">Moderation disabled.</div>;
  }
  if (error === 'forbidden') {
    return <div className="p-4">Access denied.</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Pending Review</h1>
      <ul className="space-y-4">
        {items.map((it) => (
          <li key={it.id} className="border p-4 rounded space-y-2">
            <div className="font-semibold">{it.title}</div>
            <div className="text-sm text-gray-600">
              Author: {it.author?.name || it.author?.uid || 'unknown'}
            </div>
            {it.capabilities && (
              <div className="text-sm space-y-1">
                <div>
                  <span className="font-semibold">Permissions:</span>{' '}
                  {Object.entries(it.capabilities.permissions || {})
                    .filter(([, v]: any) => v)
                    .map(([k]) => k)
                    .join(', ') || 'none'}
                </div>
                <div>
                  <span className="font-semibold">Network:</span> {it.capabilities.network?.access}
                </div>
              </div>
            )}
            {it.moderation?.reasons?.length && (
              <div className="text-sm">
                Razlozi: {it.moderation.reasons.map((r) => translateReason(r)).join(', ')}
              </div>
            )}
            {it.moderation?.notes && (
              <div className="text-sm">LLM review: {it.moderation.notes}</div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => approve(it.id)}
                className="px-3 py-1 bg-emerald-600 text-white rounded"
              >
                Approve
              </button>
              <input
                value={reasons[it.id] || ''}
                onChange={(e) => setReasons((r) => ({ ...r, [it.id]: e.target.value }))}
                placeholder="Reason"
                className="border px-2 py-1 rounded flex-1"
              />
              <button
                onClick={() => reject(it.id)}
                className="px-3 py-1 bg-red-600 text-white rounded"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      {telemetry && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold">Telemetry</h2>
          <div>
            <h3 className="font-semibold">Proxy Fetch Calls</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">App</th>
                  <th className="text-left">Count</th>
                  <th className="text-left">Hosts</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(telemetry.proxyFetch || {}).map(([appId, info]: any) => (
                  <tr key={appId} className="border-t">
                    <td className="pr-2">{appId}</td>
                    <td className="pr-2">{info.count}</td>
                    <td>{(info.hosts || []).map((h: any) => h.host).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-semibold">Rooms</h3>
            <div>Active rooms: {telemetry.rooms?.activeRooms || 0}</div>
            <div>Active players: {telemetry.rooms?.activePlayers || 0}</div>
          </div>
          <div>
            <h3 className="font-semibold">Apps per User</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">User</th>
                  <th className="text-left">Apps</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(telemetry.userApps || {}).map(([uid, count]: any) => (
                  <tr key={uid} className="border-t">
                    <td className="pr-2">{uid}</td>
                    <td>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
