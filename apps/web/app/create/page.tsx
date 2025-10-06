'use client';

import { useState, ChangeEvent, useEffect, useMemo, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { API_URL } from '@/lib/config';
import { apiGet, apiAuthedPost, ApiError } from '@/lib/api';
import { joinUrl } from '@/lib/url';
import { useAuth, getDisplayName } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import ProgressModal, { BuildState } from '@/components/ProgressModal';
import { useI18n } from '@/lib/i18n-provider';

// Temporary draft type for building manifest locally
interface ManifestDraft {
  name: string;
  description: string;
  iconUrl: string;
  permissions: {
    camera: boolean;
    microphone: boolean;
    webgl: boolean;
    download: boolean;
  };
}

type Mode = 'html' | 'react';

const friendlyByCode: Record<string, string> = {
  NET_OPEN_NEEDS_DOMAINS: 'Dodaj barem jednu domenu (npr. api.example.com).',
  NET_DOMAIN_NOT_ALLOWED: 'Ta domena nije dopuÅ¡tena.',
  LLM_MISSING_API_KEY: 'Nedostaje LLM API kljuÄ.',
  LLM_INVALID_JSON: 'LLM je vratio neispravan JSON.',
  LLM_UNREACHABLE: 'AI servis nije dostupan.',
  BUILD_PUBLISH_RENAME_FAILED: 'Objavljivanje nije uspjelo. PokuÅ¡aj ponovno.',
  ses_lockdown: 'SES/lockdown nije podrÅ¾an u browseru. Ukloni ga ili pokreni samo na serveru.',
  ses_compartment: 'Kod koristi SES Compartment â€“ potrebno je ruÄno odobrenje.',
  max_apps: 'Dosegnut je maksimalan broj aplikacija za tvoj plan.'
};
export default function CreatePage() {
  const { messages } = useI18n();
  const tCreate = (k: string) => messages[`Create.${k}`] || k;
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<Mode>('html');
  const [manifest, setManifest] = useState<ManifestDraft>({
    name: '',
    description: '',
    iconUrl: '',
    permissions: {
      camera: false,
      microphone: false,
      webgl: false,
      download: false,
    },
  });
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<
    | null
    | {
        type: 'pending-review' | 'rejected' | 'published' | 'failed';
        reason?: string;
        url?: string;
      }
  >(null);
  const [authError, setAuthError] = useState('');
  const { user } = useAuth();
  const router = useRouter();
  const [showProgress, setShowProgress] = useState(false);
  const [buildState, setBuildState] = useState<BuildState | null>(null);
  const [buildError, setBuildError] = useState('');
  const [buildStep, setBuildStep] = useState('');
  const [currentBuildId, setCurrentBuildId] = useState<string | null>(null);
  // listingId of the published app; don't confuse with buildId above
  const [currentListingId, setCurrentListingId] = useState<string | null>(null);
  const [buildArtifacts, setBuildArtifacts] = useState<any | null>(null);
  const [networkPolicy, setNetworkPolicy] = useState<string | null>(null);
  const [networkPolicyReason, setNetworkPolicyReason] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  // Optional manual translations
  const [trEn, setTrEn] = useState({ title: '', description: '' });
  const [trDe, setTrDe] = useState({ title: '', description: '' });
  const [trHr, setTrHr] = useState({ title: '', description: '' });
  // Handle icon file -> data URL
  const onIconFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((res, rej) => {
        reader.onerror = () => rej(new Error('read_error'));
        reader.onload = () => res(String(reader.result || ''));
        reader.readAsDataURL(f);
      });
      setManifest((prev) => ({ ...prev, iconUrl: dataUrl }));
    } catch {}
  };

  // basic static analysis of pasted code
  useEffect(() => {
    const permissions = { camera: false, microphone: false, webgl: false, download: false };
    const gum = /navigator\.mediaDevices\.getUserMedia\s*\(([^)]*)\)/s.exec(code);
    if (gum) {
      const args = gum[1];
      const hasVideo = /video\s*:/s.test(args);
      const hasAudio = /audio\s*:/s.test(args);
      permissions.camera = hasVideo || (!hasVideo && !hasAudio);
      permissions.microphone = hasAudio || (!hasVideo && !hasAudio);
    }
    if (/getContext\s*\(\s*['"]webgl2?['"]/.test(code)) permissions.webgl = true;
    setManifest((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, ...permissions },
    }));
  }, [code]);

  const permissionNeeded = useMemo(
    () => Object.values(manifest.permissions).some(Boolean),
    [manifest.permissions]
  );

  const steps = useMemo(() => { return ['Kod','Osnove'] as string[]; }, []);

  useEffect(() => {
    if (step >= steps.length) setStep(steps.length - 1);
  }, [steps, step]);

  const detectMode = (value: string): Mode =>
    value.trim().startsWith('<') ? 'html' : 'react';

  const handleCodeChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setCode(value);
    setMode(detectMode(value));
  };

  const handleNext = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const watchBuild = (buildId: string) => {
    if (esRef.current) return;
    setBuildError('');
    setBuildState('queued');
    setBuildStep('queued');
    setShowProgress(true);
    setCurrentBuildId(buildId);
    setCurrentListingId(null);
    setBuildArtifacts(null);
    setStatus(null);
  };

  const pollListing = (buildId: string) => {
    const start = Date.now();
    const timeout = 60_000; // 60s
    let listingId: string | null = currentListingId;
    const iv = setInterval(async () => {
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        setStatus({ type: 'failed' });
        return;
      }
      try {
        const status = await apiGet<any>(`/build/${buildId}/status`);
        const st = status?.status || status?.state;
        if (!listingId && status?.listingId) {
          listingId = String(status.listingId);
          setCurrentListingId(listingId);
        }
        if (st === 'completed' || st === 'failed') {
          clearInterval(iv);
          if (listingId) {
            try {
              const listingResp = await apiGet<{ item?: any }>(`/listing/${listingId}`);
              const item = listingResp.item || listingResp;
              if (st === 'failed') {
                setStatus({ type: 'failed', reason: item.moderation?.reasons?.[0] });
              } else if (item.status === 'pending-review') {
                setStatus({ type: 'pending-review' });
              } else if (item.status === 'rejected') {
                setStatus({ type: 'rejected', reason: item.moderation?.reasons?.[0] });
              } else if (item.status === 'published') {
                setStatus({ type: 'published', url: item.playUrl });
              } else {
                setStatus({ type: 'failed' });
              }
            } catch {
              setStatus({ type: 'failed' });
            }
          } else {
            setStatus({ type: 'failed' });
          }
        }
      } catch {
        /* ignore */
      }
    }, 1000);
  };

  useEffect(() => {
    if (!currentBuildId || esRef.current) return;
    const eventsUrl = joinUrl(API_URL, '/build/', currentBuildId, '/events');

    const normalizeArtifacts = (a: any | undefined) => {
      if (!a) return undefined;
      const preview: string | undefined = a.preview;
      const absPreview =
        preview && typeof preview === 'string'
          ? preview.startsWith('http')
            ? preview
            : joinUrl(API_URL, preview)
          : preview;
      return { ...a, preview: absPreview };
    };

    const fetchManifestInfo = async () => {
      try {
        const res = await fetch(
          joinUrl(API_URL, '/builds/', currentBuildId, '/build/manifest_v1.json'),
          { credentials: 'include' },
        );
        if (res.ok) {
          const m = await res.json();
          setNetworkPolicy(m.networkPolicy || null);
          setNetworkPolicyReason(m.networkPolicyReason || null);
        }
      } catch {}
    };

    const cleanup = () => {
      esRef.current?.close();
      esRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const mapState = (s: string): BuildState => {
      if (s === 'queued' || s === 'init') return 'queued';
      if (s === 'published' || s === 'completed' || s.startsWith('pending_review')) return 'success';
      if (s === 'failed' || s === 'rejected') return 'error';
      if (s === 'success') return 'success';
      if (s === 'error') return 'error';
      return 'running';
    };

    const handle = (rawState: string, artifacts?: any, err?: string) => {
      setBuildStep(rawState);
      const state = mapState(rawState);
      setBuildState(state);
      if (artifacts) {
        setBuildArtifacts(normalizeArtifacts(artifacts));
        if (artifacts.files?.includes('build/manifest_v1.json')) {
          void fetchManifestInfo();
        }
      }
      if (state === 'error' && err) {
        setBuildError(friendlyByCode[err] || err || 'GreÅ¡ka');
      }
      if (state === 'success') {
        setShowProgress(false);
        router.push('/my?submitted=1');
      }
      if (state === 'success' || state === 'error') {
        cleanup();
      }
    };

    const fetchStatus = async () => {
      try {
        const j = await apiGet<any>(`/build/${currentBuildId}/status`);
        if (j.networkPolicy) setNetworkPolicy(j.networkPolicy);
        if (j.networkPolicyReason) setNetworkPolicyReason(j.networkPolicyReason);
        if (j.listingId) setCurrentListingId(String(j.listingId));
        const st = j.status || j.state;
        if (st) {
          handle(st, j.artifacts, j.error?.errorCode ?? j.error);
        }
        return j;
      } catch {
        /* noop */
      }
    };

    let finalReceived = false;

    const startPolling = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(async () => {
        const j = await fetchStatus();
        const raw = j?.status || j?.state;
        const state = raw ? mapState(raw) : undefined;
        if (state && (state === 'success' || state === 'error')) {
          cleanup();
        }
      }, 1500);
    };

    esRef.current = new EventSource(eventsUrl, { withCredentials: true });
    esRef.current.addEventListener('state', async (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handle(data.state);
      } catch {}
      await fetchStatus();
    });
    esRef.current.addEventListener('final', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        handle(data.state, data.artifacts, data.error?.errorCode ?? data.error);
      } catch {}
      finalReceived = true;
      cleanup();
    });
    esRef.current.onerror = () => {
      cleanup();
      if (!finalReceived) startPolling();
    };

    void fetchStatus();

    return () => {
      cleanup();
    };
  }, [currentBuildId]);

  const publish = async () => {
    setPublishError('');
    setAuthError('');
    setPublishing(true);
    try {
      // Client-side quick check: block SES/lockdown in browser code early
      const sesRe = /(\blockdown\s*\(|\brequire\s*\(\s*['\"]ses['\"]\s*\)|\bfrom\s+['\"]ses['\"]|import\s*\(\s*['\"]ses['\"]\s*\))/;
      if (sesRe.test(code)) {
        setPublishError('SES/lockdown nije podrÅ¾an u browseru. Ukloni ga iz koda ili ga pokreni samo na serveru.');
        return;
      }
      if (!user) {
        setAuthError('Za objavu se prvo prijavi.');
        return;
      }
      // Build translations payload only for locales with provided content
      const translations: Record<string, { title?: string; description?: string }> = {};
      const norm = (s: string) => s.trim();
      if (norm(trEn.title) || norm(trEn.description)) {
        translations.en = { ...(norm(trEn.title) ? { title: norm(trEn.title) } : {}), ...(norm(trEn.description) ? { description: norm(trEn.description) } : {}) };
      }
      if (norm(trDe.title) || norm(trDe.description)) {
        translations.de = { ...(norm(trDe.title) ? { title: norm(trDe.title) } : {}), ...(norm(trDe.description) ? { description: norm(trDe.description) } : {}) };
      }
      if (norm(trHr.title) || norm(trHr.description)) {
        translations.hr = { ...(norm(trHr.title) ? { title: norm(trHr.title) } : {}), ...(norm(trHr.description) ? { description: norm(trHr.description) } : {}) };
      }

      const payload = {
        id:
          manifest.name.trim().toLowerCase().replace(/\s+/g, '-') ||
          `app-${Date.now()}`,
        title: manifest.name,
        description: manifest.description,
        ...(Object.keys(translations).length ? { translations } : {}),
        author: { uid: auth?.currentUser?.uid || '', name: getDisplayName(auth?.currentUser || null), photo: auth?.currentUser?.photoURL || undefined, handle: (auth?.currentUser?.email || '').split('@')[0] || undefined },
        capabilities: {
          permissions: {
            camera: manifest.permissions.camera,
            microphone: manifest.permissions.microphone,
            webgl: manifest.permissions.webgl,
            fileDownload: manifest.permissions.download,
          },
        },
        inlineCode: code,
        visibility: 'public',
      };
      try {
        const json = await apiAuthedPost<{
          buildId?: string;
          listingId?: string | number;
          error?: { errorCode?: string; message?: string };
        }>('/publish', payload);
        if (json.buildId) {
          watchBuild(json.buildId);
          if (json.listingId) {
            setCurrentListingId(String(json.listingId));
          }
          void pollListing(json.buildId);
          return;
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            setAuthError('Nisi prijavljen ili je sesija istekla. Prijavi se i pokuÅ¡aj ponovno.');
            return;
          }
          const code = e.code as string | undefined;
          const friendly = (code && friendlyByCode[code]) || e.message || code || 'GreÅ¡ka pri objavi';
          setPublishError(friendly);
        } else {
          setPublishError(String(e));
        }
        return;
      }
    } catch (e) {
      setPublishError(String(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden">
      {showProgress && (
        <ProgressModal
          state={buildState}
          error={buildError}
          previewUrl={buildArtifacts?.preview}
          step={buildStep}
          onClose={() => setShowProgress(false)}
        />
      )}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Stepper */}
      <div className="flex items-center">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div
              className={
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ' +
                (i <= step ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600')
              }
            >
              {i}
            </div>
            <span className="ml-2 text-sm">{label}</span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-300 mx-2" />}
          </div>
        ))}
      </div>      {steps[step] === 'Kod' && (
        <div>
          <h2 className="font-semibold mb-2">{tCreate('pasteCode')}</h2>
          <textarea
            value={code}
            onChange={handleCodeChange}
            className="w-full h-64 border rounded p-2 font-mono text-sm"
            placeholder={mode === 'html' ? tCreate('placeholderHtml') : tCreate('placeholderReact')}
          />
        </div>
      )}
      {steps[step] === 'Osnove' && (
        <div className="space-y-2">
          <h2 className="font-semibold">{tCreate('basics')}</h2>
          <div>
            <label className="block text-sm font-medium">{tCreate('name')}</label>
            <input
              className="w-full border rounded p-1 text-sm"
              value={manifest.name}
              onChange={(e) => setManifest({ ...manifest, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">{tCreate('description')}</label>
            <textarea
              className="w-full border rounded p-1 text-sm"
              value={manifest.description}
              onChange={(e) => setManifest({ ...manifest, description: e.target.value })}
            />
          </div>
          <div className="mt-3 space-y-2">
            <h3 className="font-medium">Prijevodi (neobavezno)</h3>
            <p className="text-xs text-gray-600">Ako ostavite prazno, sustav će automatski prevesti nakon odobrenja.</p>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇬🇧</span>English</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Title" value={trEn.title} onChange={(e)=>setTrEn(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Description" value={trEn.description} onChange={(e)=>setTrEn(p=>({...p,description:e.target.value}))} />
              </div>
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇩🇪</span>Deutsch</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Titel" value={trDe.title} onChange={(e)=>setTrDe(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Beschreibung" value={trDe.description} onChange={(e)=>setTrDe(p=>({...p,description:e.target.value}))} />
              </div>
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇭🇷</span>Hrvatski</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Naziv (preveden)" value={trHr.title} onChange={(e)=>setTrHr(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Opis (preveden)" value={trHr.description} onChange={(e)=>setTrHr(p=>({...p,description:e.target.value}))} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium">{tCreate('icon')}</label>
            <div className="flex items-center gap-3">
              <input
                className="flex-1 border rounded p-1 text-sm"
                placeholder="https://example.com/icon.png"
                value={manifest.iconUrl}
                onChange={(e) => setManifest({ ...manifest, iconUrl: e.target.value })}
              />
              <label className="px-2 py-1 border rounded cursor-pointer bg-gray-50 hover:bg-gray-100 text-sm">
                {tCreate('choose')}
                <input type="file" accept="image/*" className="hidden" onChange={onIconFile} />
              </label>
            </div>
            {manifest.iconUrl && (
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <img src={manifest.iconUrl} alt="icon" className="w-10 h-10 object-cover rounded border" />
                <button
                  className="px-2 py-1 border rounded hover:bg-gray-50"
                  onClick={() => setManifest((p) => ({ ...p, iconUrl: '' }))}
                >
                  {tCreate('remove')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <button
          onClick={handleBack}
          disabled={step === 0}
          className="px-4 py-2 border rounded disabled:opacity-50"
        >
          {tCreate('back')}
        </button>
        {step < steps.length - 1 ? (
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-emerald-600 text-white rounded"
          >
            {tCreate('next')}
          </button>
        ) : (
          <div className="flex flex-col items-end">
            <button
              onClick={publish}
              disabled={publishing || !user}
              className="px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
            >
              {tCreate('publish')}
            </button>
            {publishError && (
              <p className="text-sm text-red-600 mt-2 max-w-prose text-right">
                {publishError}
              </p>
            )}
            {!user && (
              <p className="text-sm text-red-600 mt-2">
                {tCreate('mustSignIn')}{' '}
                <a href="/login" className="underline">{tCreate('login')}</a>
              </p>
            )}
            {authError && (
              <p className="text-sm text-red-600 mt-2">
                {authError} <a href="/login" className="underline">{tCreate('login')}</a>
              </p>
            )}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}








