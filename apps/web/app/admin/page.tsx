'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { apiGet, apiGetRaw, apiPost, ApiError } from '@/lib/api';
import { joinUrl } from '@/lib/url';
import { auth } from '@/lib/firebase';
import { API_URL } from '@/lib/config';
import Logo from '@/components/Logo';
import { resolvePreviewUrl } from '@/lib/preview';

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

type LlmReport = {
  provider?: string;
  model?: string;
  status: 'not_ready' | 'generating' | 'complete' | 'error';
  createdAt?: string;
  error?: { code: string; detail?: string };
  data?: {
    summary?: string;
    publishRecommendation?: 'approve' | 'review' | 'reject';
    confidence?: number;
    risks?: { id?: string; severity: 'low' | 'med' | 'high' | 'critical'; title: string; detail?: string }[];
    questions?: { q: string; where?: string }[];
    suggested_manifest_patch?: Record<string, any>;
    suggested_transform_flags?: Record<string, any>;
  };
};

type ReviewItem = {
  id: string;
  title: string;
  description?: string;
  previewUrl?: string;
  ownerEmail?: string;
  submittedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
  appId?: string;
  slug?: string;
  version?: number;
  playUrl?: string;
  visibility?: string;
  accessMode?: string;
  author?: { uid?: string; name?: string; handle?: string };
  llm?: LlmReport;
  llmAttempts?: number;
  networkPolicy?: string;
  networkDomains?: string[];
  networkPolicyReason?: string;
};

type BuildState =
  | 'queued'
  | 'init'
  | 'analyze'
  | 'build'
  | 'bundle'
  | 'verify'
  | 'ai_scan'
  | 'llm_waiting'
  | 'llm_generating'
  | 'pending_review'
  | 'pending_review_llm'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'failed';

type TimelineEntry = { state: BuildState; at: number };

const friendlyErrorByCode: Record<string, string> = {
  LLM_MISSING_API_KEY: 'Nedostaje LLM API ključ.',
  LLM_INVALID_JSON: 'LLM je vratio neispravan JSON.',
  LLM_UNREACHABLE: 'AI servis nije dostupan.',
  MISSING_ARTIFACT: 'Nedostaju artefakti – pokrenite cijeli build (pnpm run createx:build).',
};

function timelineClass(state: BuildState): string {
  if (state === 'llm_waiting') return 'timeline-step timeline-step-waiting';
  if (state === 'llm_generating') return 'timeline-step timeline-step-generating';
  return 'timeline-step timeline-step-active';
}

export default function AdminDashboard() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState('');
  const [report, setReport] = useState<LlmReport | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentItem, setCurrentItem] = useState<ReviewItem | null>(null);
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [search, setSearch] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [zipReady, setZipReady] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [llmTimeout, setLlmTimeout] = useState(false);
  const [policy, setPolicy] = useState<{ camera?: boolean; microphone?: boolean; geolocation?: boolean; clipboardRead?: boolean; clipboardWrite?: boolean } | null>(null);
  const [policySaving, setPolicySaving] = useState(false);


  const viewReport = async (id: string) => {
    setCurrentId(id);
    setCurrentItem(items.find((it) => it.id === id) || null);
    setShowRaw(false);
    setReport(null);
    setPreviewSrc(null);
    setZipReady(false);
    setTimeline([]);
    setLlmTimeout(false);
    try {
      let idx: any = {};
      try {
        idx = await apiGet<any>(`/review/artifacts/${id}`, { auth: true });
      } catch {}
      setZipReady(Boolean(idx.bundle?.exists));
      if (!idx.bundle?.exists) pollZip(id);
      const preview = idx.preview?.exists
        ? idx.preview.url?.startsWith('http')
          ? idx.preview.url
          : joinUrl(API_URL, idx.preview.url)
        : joinUrl(API_URL, '/assets/preview-placeholder.svg');
      setPreviewSrc(preview);
      try {
        const buildJson = await apiGet<any>(`/review/builds/${id}`, { auth: true });
        setTimeline(buildJson.timeline || []);
      } catch {}
      try {
        const pol = await apiGet<any>(`/review/builds/${id}/policy`, { auth: true });
        setPolicy(pol || {});
      } catch {}
      try {
        const json = await apiGet<any>(`/review/builds/${id}/llm`, { auth: true });
        setReport(json);
        if (json.status === 'generating') {
          pollReport(id);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 404) {
            setReport({ status: 'not_ready' });
          } else if (e.status === 503) {
            setReport({ status: 'generating' });
            pollReport(id);
          }
        }
      }
    } catch {}
  };

  const pollReport = (id: string, attempt = 0): void => {
    if (attempt >= 30) {
      setRegeneratingId(null);
      setLlmTimeout(true);
      return;
    }
    setTimeout(async () => {
      try {
        const json = await apiGet<any>(`/review/builds/${id}/llm`, { auth: true });
        if (json.status === 'generating') {
          setReport(json);
          pollReport(id, attempt + 1);
        } else {
          setReport(json);
          setRegeneratingId(null);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          setReport({ status: 'generating' });
        }
        pollReport(id, attempt + 1);
      }
    }, 2000);
  };

  const pollZip = (id: string, attempt = 0): void => {
    if (attempt >= 30 || id !== currentId) return;
    setTimeout(async () => {
      try {
        const idx = await apiGet<any>(`/review/artifacts/${id}`, { auth: true });
        if (idx.bundle?.exists) {
          setZipReady(true);
        } else {
          pollZip(id, attempt + 1);
        }
      } catch {
        pollZip(id, attempt + 1);
      }
    }, 2000);
  };

  async function downloadCode(id: string) {
    const res = await apiGetRaw(`/review/code/${id}`, { auth: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.tar.gz`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const triggerLlm = async (id: string) => {
    setRegeneratingId(id);
    setLlmTimeout(false);
    try {
      await apiPost(`/review/builds/${id}/llm`, {}, { auth: true });
      if (id === currentId) pollReport(id);
      await load();
      if (id === currentId) await viewReport(id);
    } catch (e) {
      if (id === currentId)
        setReport({ status: 'error', error: { code: e instanceof ApiError && e.code ? e.code : 'UNKNOWN' } });
      setRegeneratingId(null);
    }
  };

  const regenerate = async () => {
    if (currentId) await triggerLlm(currentId);
  };

  const load = useCallback(async (cursor?: string): Promise<number | undefined> => {
    try {
      let url = '/review/builds';
      const params = new URLSearchParams();
      params.set('status', tab);
      if (cursor) params.set('cursor', cursor);
      const q = params.toString();
      if (q) url += `?${q}`;
      const json = await apiGet<any>(url, { auth: true });
      setItems((prev) => (cursor ? [...prev, ...(json.items || [])] : json.items || []));
      setNextCursor(json.nextCursor || null);
      setError('');
      return 200;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          return 401;
        }
        if (e.status === 403) {
          setError('Access denied – sign in as admin or ask to be whitelisted.');
          return 403;
        }
        setError('Failed to load');
        return e.status;
      }
      setError('Failed to load');
    }
  }, [tab]);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const token = await user.getIdTokenResult();
          setIsAdmin(Boolean(token.claims?.admin));
        } catch {
          setIsAdmin(false);
        }
        let status = await load();
        if (status === 401) {
          try {
            await auth?.currentUser?.getIdToken(true);
          } catch {}
          status = await load();
          if (status === 401) {
            setError('Access denied – sign in as admin or ask to be whitelisted.');
          }
        }
      } else {
        setIsAdmin(false);
      }
    });
    return () => unsubscribe();
  }, [tab, load]);

  useEffect(() => {
    const t = setInterval(() => {
      load();
    }, 10000);
    return () => clearInterval(t);
  }, [tab, load]);

  const approve = async (id: string) => {
    await apiPost(`/review/approve/${id}`, {}, { auth: true });
    setItems((prev) => prev.filter((it) => it.id !== id));
    alert('Approved');
    setTab('approved');
    if (items.length === 1 && nextCursor) {
      await load(nextCursor);
    }
  };

  const reject = async (id: string) => {
    const reason = prompt('Reason for rejection?') || 'No reason provided';
    await apiPost(`/review/reject/${id}`, { reason }, { auth: true });
    alert('Rejected');
    await load();
  };

const filtered = items.filter((it) =>
  (it.title || '').toLowerCase().includes(search.toLowerCase()) ||
  (it.ownerEmail || '').toLowerCase().includes(search.toLowerCase()),
);

if (error)
  return (
    <div className="p-4 space-y-4">
      <div>{error}</div>
      {error ===
        'Access denied – sign in as admin or ask to be whitelisted.' &&
        isAdmin === false && (
          <div className="flex gap-2">
            <button
              onClick={() => auth?.signOut()}
              className="px-2 py-1 border rounded"
            >
              Logout
            </button>
            <button
              onClick={() => {
                window.location.href = '/login';
              }}
              className="px-2 py-1 border rounded"
            >
              Login
            </button>
          </div>
        )}
    </div>
  );

return (
  <>
      <div className="w-full border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto p-3">
          <Logo />
        </div>
      </div>
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">Admin Review</h1>
        <div className="flex gap-4">
          {(['pending', 'approved', 'rejected'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded ${tab === t ? 'bg-emerald-600 text-white' : 'bg-gray-200'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="ml-auto border px-2 py-1 rounded"
          />
          <button onClick={() => load()} className="px-2 py-1 border rounded">
            Refresh
          </button>
        </div>
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className="text-left p-2">App ID</th>
              <th className="text-left p-2">Preview</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Owner Email</th>
              <th className="text-left p-2">Submitted</th>
              <th className="text-left p-2">Network</th>
              <th className="text-left p-2">LLM</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => {
              const imgSrc = resolvePreviewUrl(it.previewUrl);
              const hasPreview = Boolean(imgSrc);
              return (
                <tr key={it.id} className="border-t">
                  <td className="p-2">{it.id}</td>
                  <td className="p-2">
                    {hasPreview ? (
                      <Image
                        src={imgSrc}
                        alt="preview"
                        width={40}
                        height={40}
                        unoptimized
                        style={{ color: 'transparent' }}
                        className="w-10 h-10 object-cover rounded"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-slate-100 text-slate-500 text-[10px] font-medium grid place-items-center">
                        Bez
                      </div>
                    )}
                  </td>
                  <td className="p-2">{it.title}</td>
                  <td className="p-2">{it.ownerEmail || '-'}</td>
                  <td className="p-2">{it.submittedAt ? new Date(it.submittedAt).toLocaleString() : '-'}</td>
                  <td className="p-2">
                    {it.networkPolicy || '-'}
                    {it.networkDomains && it.networkDomains.length > 0 && (
                      <div className="text-xs text-gray-600">
                        {it.networkDomains
                          .map((d) => `fetch prema ${d}`)
                          .join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {it.llm?.status === 'complete' ? (
                      <>
                        {it.llm.data?.publishRecommendation && (
                          <span
                            className={`px-1 text-xs rounded ${
                              it.llm.data.publishRecommendation === 'approve'
                                ? 'bg-green-100 text-green-800'
                                : it.llm.data.publishRecommendation === 'reject'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            AI preporuka: {it.llm.data.publishRecommendation}
                          </span>
                        )}
                        {it.llm.data?.summary && (
                          <div className="text-xs mt-1">{it.llm.data.summary}</div>
                        )}
                        <div className="w-24 bg-gray-200 h-2 rounded mt-1">
                          <div
                            className="h-2 bg-emerald-600 rounded"
                            style={{ width: `${(it.llm.data?.confidence || 0) * 100}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {it.llm.data?.risks?.map((r) => (
                            <span
                              key={r.id || r.title}
                              className="px-1 text-xs rounded bg-red-100 text-red-800"
                            >
                              {r.title}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">
                          LLM waiting{it.llmAttempts ? ` (${it.llmAttempts})` : ''}
                        </span>
                        <button
                          onClick={() => triggerLlm(it.id)}
                          className="px-2 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                          disabled={regeneratingId === it.id}
                        >
                          {regeneratingId === it.id ? 'Running...' : 'Try again'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="p-2 flex gap-2">
                    <button
                      onClick={() => approve(it.id)}
                      className="px-2 py-1 bg-emerald-600 text-white rounded"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => reject(it.id)}
                      className="px-2 py-1 bg-red-600 text-white rounded"
                    >
                      Reject
                    </button>
                    {regeneratingId === it.id ? (
                      <span className="inline-block w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <button
                        onClick={() => viewReport(it.id)}
                        className="px-2 py-1 bg-gray-200 rounded"
                      >
                        Details
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const sure = window.confirm('PERMANENTLY DELETE this app and its build? This cannot be undone.');
                        if (!sure) return;
                        try {
                          await apiPost(`/review/builds/${it.id}/delete`, {}, { auth: true });
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                          alert('Deleted');
                        } catch (e) {
                          alert('Failed to delete');
                        }
                      }}
                      className="px-2 py-1 bg-black text-white rounded"
                      title="Permanently delete"
                    >
                      Delete Permanently
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {nextCursor && (
          <div className="text-center mt-4">
            <button
              onClick={() => load(nextCursor)}
              className="px-2 py-1 border rounded"
            >
              Load more
            </button>
          </div>
        )}
      </div>
      {report && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 max-w-2xl max-h-[80vh] overflow-auto rounded space-y-2">
            <button
              className="mb-2 text-sm text-red-600"
              onClick={() => {
                setReport(null);
                setShowRaw(false);
              }}
            >
              Close
            </button>
            {previewSrc && (
              <Image
                src={previewSrc}
                alt="preview"
                width={128}
                height={128}
                unoptimized
                style={{ color: 'transparent' }}
                className="w-32 h-32 object-cover mb-2"
              />
            )}
            {currentItem && (
              <div className="text-sm mb-3 space-y-1">
                <div className="font-semibold">{currentItem.title}</div>
                {currentItem.description && (
                  <div className="text-gray-700 whitespace-pre-wrap">{currentItem.description}</div>
                )}
                <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                  {currentItem.appId && <span>App ID: {currentItem.appId}</span>}
                  {currentItem.slug && <span>Slug: {currentItem.slug}</span>}
                  {currentItem.version !== undefined && (
                    <span>Verzija: {currentItem.version}</span>
                  )}
                  {currentItem.ownerEmail && <span>Owner: {currentItem.ownerEmail}</span>}
                  {(currentItem.author?.handle || currentItem.author?.name) && (
                    <span>
                      Autor: {currentItem.author?.name || currentItem.author?.handle}
                    </span>
                  )}
                  {currentItem.visibility && <span>Vidljivost: {currentItem.visibility}</span>}
                  {currentItem.accessMode && <span>Pristup: {currentItem.accessMode}</span>}
                </div>
                <div className="text-xs text-gray-600 flex flex-col gap-0.5 mt-1">
                  {currentItem.createdAt && (
                    <span>Kreirano: {new Date(currentItem.createdAt).toLocaleString()}</span>
                  )}
                  {currentItem.submittedAt && (
                    <span>Poslano na review: {new Date(currentItem.submittedAt).toLocaleString()}</span>
                  )}
                  {currentItem.updatedAt && (
                    <span>Zadnje ažurirano: {new Date(currentItem.updatedAt).toLocaleString()}</span>
                  )}
                  {currentItem.publishedAt && (
                    <span>Objavljeno: {new Date(currentItem.publishedAt).toLocaleString()}</span>
                  )}
                </div>
                {currentItem.playUrl && (
                  <div className="text-xs mt-1">
                    <a href={currentItem.playUrl} target="_blank" className="text-emerald-600 underline">
                      Otvori play URL
                    </a>
                  </div>
                )}
              </div>
            )}
            {currentId && (
              zipReady ? (
                <button
                  onClick={() => downloadCode(currentId!)}
                  className="text-sm underline block mb-2 text-emerald-600"
                >
                  Download code
                </button>
              ) : (
                <div
                  className="text-sm text-gray-400 mb-2 flex items-center"
                  title="Bundle not ready"
                >
                  <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin mr-2"></span>
                  Preparing bundle…
                </div>
              )
            )}
            {timeline.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mb-2">
                {timeline.map((t, idx) => (
                  <div key={t.at} className="flex items-center">
                    <span className={timelineClass(t.state)}>{t.state}</span>
                    {idx < timeline.length - 1 && (
                      <span className="timeline-arrow timeline-arrow-active">→</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {currentItem?.networkPolicy && (
              <div className="text-sm mb-2">
                <div>
                  Automatska mrežna politika: {currentItem.networkPolicy}
                </div>
                {currentItem.networkPolicyReason && (
                  <div className="text-xs text-gray-600">
                    {currentItem.networkPolicyReason}
                  </div>
                )}
                {currentItem.networkDomains && currentItem.networkDomains.length > 0 && (
                  <ul className="list-disc list-inside text-xs text-gray-600 mt-1">
                    {currentItem.networkDomains.map((d) => (
                      <li key={d}>fetch prema {d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {currentId && (
              <div className="text-sm mb-2">
                <div className="font-semibold">Dozvole (Permissions-Policy)</div>
                <div className="flex flex-wrap gap-3 mt-1">
                  {['camera','microphone','geolocation','clipboardRead','clipboardWrite'].map((k) => (
                    <label key={k} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean((policy as any)?.[k])}
                        onChange={(e) => setPolicy((p) => ({ ...(p||{}), [k]: e.target.checked }))}
                      />
                      <span>{k}</span>
                    </label>
                  ))}
                </div>
                {report?.status === 'complete' && (report.data?.suggested_manifest_patch as any)?.permissionsPolicy && (
                  <div className="mt-2 text-xs text-gray-700">
                    <div className="font-medium mb-1">AI prijedlog dozvola:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(((report.data?.suggested_manifest_patch as any)?.permissionsPolicy) || {}).map(([k, v]) => (
                        <span key={k} className={`px-1 rounded ${v ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-700'}`}>
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const ai = (report?.data?.suggested_manifest_patch as any)?.permissionsPolicy;
                        if (ai) setPolicy((p) => ({ ...(p || {}), ...ai }));
                      }}
                      className="mt-2 px-2 py-1 border rounded"
                    >
                      Primijeni AI prijedlog
                    </button>
                  </div>
                )}
                <div className="mt-2">
                  <button
                    onClick={async () => {
                      if (!currentId || !policy) return;
                      setPolicySaving(true);
                      try {
                        await fetch(`${API_URL}/review/builds/${currentId}/policy`, {
                          method: 'POST',
                          credentials: 'include',
                          headers: await buildHeaders(true),
                          body: JSON.stringify(policy),
                        });
                      } catch (e) {
                        console.error(e);
                        alert('Spremanje nije uspjelo');
                      } finally {
                        setPolicySaving(false);
                      }
                    }}
                    className="px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                    disabled={policySaving}
                  >
                    {policySaving ? 'Spremam…' : 'Spremi dozvole'}
                  </button>
                </div>
              </div>
            )}
            {currentItem?.llmAttempts !== undefined && (
              <div className="text-sm mb-2">LLM attempts: {currentItem.llmAttempts}</div>
            )}
            {(regeneratingId === currentId || report?.status === 'generating') && (
              llmTimeout ? (
                <div className="space-y-2">
                  <div className="text-sm">Čekamo AI servis…</div>
                  <button
                    onClick={() => {
                      if (currentId) pollReport(currentId);
                      setLlmTimeout(false);
                    }}
                    className="px-2 py-1 bg-emerald-600 text-white rounded"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></span>
                  <span className="text-sm">Analiza u tijeku…</span>
                </div>
              )
            )}
            {report?.status === 'not_ready' && (
              <div className="space-y-2">
                <p className="text-sm">No report available.</p>
                <button
                  onClick={regenerate}
                  className="px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                  disabled={regeneratingId === currentId}
                >
                  {regeneratingId === currentId ? 'Analiza…' : 'Pokreni LLM analizu'}
                </button>
              </div>
            )}
            {report?.status === 'complete' && (
              <>
                  <p className="text-sm text-gray-600">
                    Provider: {report.provider} / {report.model}
                  </p>
                  {report.data?.publishRecommendation && (
                    <div className="text-sm font-semibold mt-1">
                      AI preporuka: {report.data.publishRecommendation}
                    </div>
                  )}
                  {report.data?.summary && (
                    <p className="text-sm mt-1">{report.data.summary}</p>
                  )}
                  {report.data?.confidence !== undefined && (
                    <div className="w-32 bg-gray-200 h-2 rounded">
                      <div
                        className="h-2 bg-emerald-600 rounded"
                        style={{ width: `${(report.data?.confidence || 0) * 100}%` }}
                      />
                    </div>
                  )}
                  {(report.data?.risks?.length ?? 0) > 0 && (
                    <ul className="list-disc list-inside text-sm mt-2">
                      {(report.data?.risks ?? []).map((r) => (
                        <li key={r.title}>{r.title}</li>
                      ))}
                    </ul>
                  )}
                  {(report.data?.questions?.length ?? 0) > 0 && (
                    <ul className="list-disc list-inside text-sm mt-2">
                      {(report.data?.questions ?? []).map((q) => (
                        <li key={q.q}>{q.q}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    className="text-xs text-emerald-600 underline mt-2"
                    onClick={() => setShowRaw((s) => !s)}
                  >
                    {showRaw ? 'Hide JSON' : 'Show JSON'}
                  </button>
                  {showRaw && (
                    <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                      {JSON.stringify(report, null, 2)}
                    </pre>
                  )}
                </>
              )}
            {report?.status === 'error' && (
              <div className="space-y-2">
                <div className="text-sm text-red-600">
                  {friendlyErrorByCode[report.error?.code || ''] ||
                    report.error?.code ||
                    'LLM review failed'}
                </div>
                <button
                  onClick={regenerate}
                  className="px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50"
                  disabled={regeneratingId === currentId}
                >
                  {regeneratingId === currentId ? 'Analiza…' : 'Run again'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
