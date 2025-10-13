'use client';

import { useState, ChangeEvent, useEffect, useMemo, useRef, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { API_URL } from '@/lib/config';
import { apiGet, apiAuthedPost, apiPost, ApiError } from '@/lib/api';
import { joinUrl } from '@/lib/url';
import { useAuth, getDisplayName } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import ProgressModal, { BuildState } from '@/components/ProgressModal';
import { useI18n } from '@/lib/i18n-provider';
import {
  MAX_PREVIEW_SIZE_BYTES,
  PREVIEW_PRESET_PATHS,
  PreviewPresetPath,
  PreviewUploadError,
  uploadPreviewFile,
  uploadPresetPreview,
  createPresetPreviewFile,
} from '@/lib/previewClient';

// Temporary draft type for building manifest locally
interface ManifestDraft {
  name: string;
  description: string;
  permissions: {
    camera: boolean;
    microphone: boolean;
    webgl: boolean;
    download: boolean;
  };
}

type Mode = 'html' | 'react';
type SubmissionType = 'code' | 'bundle';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const [submissionType, setSubmissionType] = useState<SubmissionType>('code');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<Mode>('html');
  const [manifest, setManifest] = useState<ManifestDraft>({
    name: '',
    description: '',
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
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [bundleError, setBundleError] = useState('');
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [localJobLog, setLocalJobLog] = useState('');

  const [showAdvanced, setShowAdvanced] = useState(false);
  // Optional manual translations
  const [trEn, setTrEn] = useState({ title: '', description: '' });
  const [trDe, setTrDe] = useState({ title: '', description: '' });
  const [trHr, setTrHr] = useState({ title: '', description: '' });
  const [previewChoice, setPreviewChoice] = useState<'preset' | 'custom'>('preset');
  const [defaultPreset] = useState<PreviewPresetPath>(() => {
    const index = Math.floor(Math.random() * PREVIEW_PRESET_PATHS.length);
    return PREVIEW_PRESET_PATHS[index];
  });
  const [selectedPreset, setSelectedPreset] = useState<PreviewPresetPath>(defaultPreset);
  const [presetOverlay, setPresetOverlay] = useState('');
  const [customPreview, setCustomPreview] = useState<{ file: File; dataUrl: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewUploading, setPreviewUploading] = useState(false);
  const [previewAppliedSlug, setPreviewAppliedSlug] = useState<string | null>(null);
  const [storageEnabled, setStorageEnabled] = useState(false);
  const previewInputRef = useRef<HTMLInputElement | null>(null);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPreviewSlugRef = useRef<string | null>(null);
  const overlayMaxChars = 22;
  const maxPreviewMb = useMemo(
    () => Math.round((MAX_PREVIEW_SIZE_BYTES / (1024 * 1024)) * 10) / 10,
    []
  );
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

  const steps = useMemo(() => { return ['Izvor','Osnove'] as string[]; }, []);

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

  const clearBundleSelection = useCallback(() => {
    setBundleFile(null);
    setBundleError('');
    setLocalJobLog('');
    setLocalPreviewUrl(null);
    if (bundleInputRef.current) bundleInputRef.current.value = '';
  }, []);

  const handleSubmissionTypeChange = useCallback(
    (value: SubmissionType) => {
      setSubmissionType(value);
      setPublishError('');
      setBundleError('');
      setLocalJobLog('');
      setLocalPreviewUrl(null);
      if (value === 'code') {
        clearBundleSelection();
      }
    },
    [clearBundleSelection]
  );

  const handleBundleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        clearBundleSelection();
        return;
      }
      const name = file.name.toLowerCase();
      if (!name.endsWith('.zip')) {
        setBundleFile(null);
        setBundleError('PodrÅ¾avamo samo .zip pakete.');
        if (bundleInputRef.current) bundleInputRef.current.value = '';
        return;
      }
      setBundleFile(file);
      setBundleError('');
      setLocalJobLog('');
      setLocalPreviewUrl(null);
    },
    [clearBundleSelection]
  );

  const deriveAppId = useCallback(() => {
    const fallback = `app-${Date.now()}`;
    const raw = (manifest.name || '').toLowerCase().trim();
    const ascii = raw
      ? raw
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9-]+/g, '-')
      : '';
    const cleaned = ascii.replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
    return cleaned || fallback;
  }, [manifest.name]);

  const readFileAsDataUrl = useCallback(async (file: File) => {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read_error'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }, []);

  const handlePresetSelect = useCallback((preset: PreviewPresetPath) => {
    setPreviewChoice('preset');
    setSelectedPreset(preset);
    setCustomPreview(null);
    setPreviewAppliedSlug(null);
    setPreviewError('');
  }, []);

  const handleCustomPreview = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      previewInputRef.current = e.target;
      if (!file) return;

      setPreviewError('');
      setPreviewAppliedSlug(null);

      if (file.size > MAX_PREVIEW_SIZE_BYTES) {
        setCustomPreview(null);
        setPreviewChoice('preset');
        setPreviewError(`${tCreate('previewFileTooLarge')} ${maxPreviewMb}MB`);
        if (previewInputRef.current) previewInputRef.current.value = '';
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        setCustomPreview({ file, dataUrl });
        setPreviewChoice('custom');
      } catch {
        setCustomPreview(null);
        setPreviewChoice('preset');
        setPreviewError(tCreate('previewFileReadFailed'));
        if (previewInputRef.current) previewInputRef.current.value = '';
      }
    },
    [maxPreviewMb, readFileAsDataUrl, tCreate]
  );

  const resetCustomPreview = useCallback(() => {
    setCustomPreview(null);
    setPreviewChoice('preset');
    setPreviewAppliedSlug(null);
    setPreviewError('');
    if (previewInputRef.current) previewInputRef.current.value = '';
  }, []);

  const ensurePreviewForSlug = useCallback(
    async (slug: string): Promise<boolean> => {
      if (!slug) return false;
      if (previewAppliedSlug === slug) return true;

      const overlayText =
        previewChoice === 'preset' ? presetOverlay.trim().slice(0, overlayMaxChars) : '';
      const attempts = 3;

      setPreviewUploading(true);
      setPreviewError('');

      try {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            if (previewChoice === 'custom' && customPreview?.file) {
              await uploadPreviewFile(slug, customPreview.file);
            } else {
              await uploadPresetPreview(slug, selectedPreset, {
                overlayText: overlayText || undefined,
              });
            }
            setPreviewAppliedSlug(slug);
            return true;
          } catch (err: any) {
            const shouldRetry =
              err instanceof PreviewUploadError &&
              attempt < attempts &&
              [404, 409, 423, 425].includes(err.status);
            if (shouldRetry) {
              await sleep(500 * attempt);
              continue;
            }
            let message = tCreate('previewUploadFailed');
            if (err instanceof PreviewUploadError) {
              message = err.message || message;
            } else if (err instanceof Error) {
              message = err.message || message;
            }
            setPreviewError(message);
            return false;
          }
        }
        return false;
      } finally {
        setPreviewUploading(false);
      }
    },
    [
      customPreview?.file,
      overlayMaxChars,
      presetOverlay,
      previewChoice,
      previewAppliedSlug,
      selectedPreset,
      tCreate,
    ]
  );

  const previewDisplayUrl = useMemo(
    () =>
      previewChoice === 'custom' && customPreview?.dataUrl
        ? customPreview.dataUrl
        : selectedPreset,
    [customPreview?.dataUrl, previewChoice, selectedPreset]
  );

  const previewOverlayText = useMemo(
    () => (previewChoice === 'preset' ? presetOverlay.trim().slice(0, overlayMaxChars) : ''),
    [overlayMaxChars, presetOverlay, previewChoice]
  );
  const presetOverlayLabel = previewChoice === 'preset' ? previewOverlayText : '';

  const handleNext = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const watchLocalBundle = (appId: string, jobId: string) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setCurrentBuildId(null);
    setCurrentListingId(null);
    setBuildArtifacts(null);
    setStatus(null);
    setBuildError('');
    setBuildStep('queued');
    setBuildState('queued');
    setShowProgress(true);
    setPublishError('');
    setLocalJobLog('');
    setLocalPreviewUrl(null);
    setNetworkPolicy(null);
    setNetworkPolicyReason(null);

    const mapState = (state: string): BuildState => {
      if (state === 'waiting' || state === 'delayed' || state === 'waiting-children') return 'queued';
      if (state === 'active') return 'running';
      if (state === 'completed') return 'success';
      if (state === 'failed') return 'error';
      return 'running';
    };

    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const fetchStatus = async () => {
      try {
        const data = await apiGet<{
          status?: string;
          log?: string;
          listingId?: string | number;
          previewUrl?: string;
          slug?: string;
          buildId?: string;
        }>(`/apps/${appId}/build-status/${jobId}`, { auth: true });
        const raw = data.status || '';
        if (!raw) return;
        if (data.listingId) {
          setCurrentListingId(String(data.listingId));
        }
        if (data.previewUrl) {
          setLocalPreviewUrl(data.previewUrl);
        }
        setBuildStep(raw);
        const mapped = mapState(raw);
        setBuildState(mapped);
        if (mapped === 'success') {
          stop();
          setShowProgress(false);
          setPublishError('');
          if (!data.previewUrl) {
            setLocalPreviewUrl(joinUrl(API_URL, '/preview/', appId, '/'));
          }
          const slug = data.slug || pendingPreviewSlugRef.current;
          if (slug) {
            pendingPreviewSlugRef.current = slug;
            await ensurePreviewForSlug(slug);
          }
          router.push('/my?submitted=1');
        } else if (mapped === 'error') {
          stop();
          setShowProgress(false);
          setPublishError('Build nije uspio. Provjeri log ispod.');
          setLocalJobLog((data.log || '').trim());
        }
      } catch (err: any) {
        stop();
        setBuildState('error');
        setShowProgress(false);
        const message =
          err instanceof ApiError && err.message
            ? err.message
            : 'GreÅ¡ka pri praÄ‡enju builda.';
        setPublishError(message);
      }
    };

    void fetchStatus();
    pollRef.current = setInterval(() => {
      void fetchStatus();
    }, 1500);
  };

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
    setPreviewError('');
    setPreviewAppliedSlug(null);
    pendingPreviewSlugRef.current = null;
    setBundleError('');
    setLocalJobLog('');
    setLocalPreviewUrl(null);
    setStatus(null);
    setBuildArtifacts(null);
    setNetworkPolicy(null);
    setNetworkPolicyReason(null);
    setPublishing(true);
    try {
      if (!user) {
        setAuthError('Za objavu se prvo prijavi.');
        return;
      }

      const appId = deriveAppId();

      if (submissionType === 'bundle') {
        if (!bundleFile) {
          setBundleError('Odaberi ZIP datoteku.');
          return;
        }
        try {
          const form = new FormData();
          form.append('file', bundleFile, bundleFile.name);
          const upload = await apiPost<{ jobId?: string }>(
            `/apps/${appId}/upload`,
            form,
            { auth: true },
          );
          if (!upload?.jobId) {
            setPublishError('Upload paketa nije uspio. Pokušaj ponovno.');
            return;
          }
          watchLocalBundle(appId, upload.jobId);
        } catch (err) {
          if (err instanceof ApiError) {
            if (err.status === 401) {
              setAuthError('Nisi prijavljen ili je sesija istekla. Prijavi se i pokušaj ponovno.');
            } else {
              setPublishError(err.message || 'Upload nije uspio.');
            }
          } else {
            setPublishError(String(err));
          }
        }
        return;
      }

      const sesRe = /(\blockdown\s*\(|\brequire\s*\(\s*['"]ses['"]\s*\)|\bfrom\s+['"]ses['"]|import\s*\(\s*['"]ses['"]\s*\))/;
      if (sesRe.test(code)) {
        setPublishError('SES/lockdown nije podržan u browseru. Ukloni ga iz koda ili ga pokreni samo na serveru.');
        return;
      }

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

      let previewAttachment: { dataUrl: string } | null = null;
      try {
        if (previewChoice === 'custom' && customPreview?.dataUrl) {
          previewAttachment = { dataUrl: customPreview.dataUrl };
        } else {
          const file = await createPresetPreviewFile(selectedPreset, {
            overlayText: previewChoice === 'preset' ? previewOverlayText || undefined : undefined,
          });
          const dataUrl = await readFileAsDataUrl(file);
          previewAttachment = { dataUrl };
        }
      } catch {
        // Ignore preview prep failures; publish will fall back to default later
      }

      const capabilitiesPayload: Record<string, any> = {
        permissions: {
          camera: manifest.permissions.camera,
          microphone: manifest.permissions.microphone,
          webgl: manifest.permissions.webgl,
          fileDownload: manifest.permissions.download,
        },
      };
      if (storageEnabled) {
        capabilitiesPayload.storage = { enabled: true };
        capabilitiesPayload.features = ['storage'];
      }

      const payload = {
        id: appId,
        title: manifest.name,
        description: manifest.description,
        ...(Object.keys(translations).length ? { translations } : {}),
        author: {
          uid: auth?.currentUser?.uid || '',
          name: getDisplayName(auth?.currentUser || null),
          photo: auth?.currentUser?.photoURL || undefined,
          handle: (auth?.currentUser?.email || '').split('@')[0] || undefined,
        },
        capabilities: capabilitiesPayload,
        inlineCode: code,
        visibility: 'public',
        ...(previewAttachment ? { preview: previewAttachment } : {}),
      };
      try {
        const json = await apiAuthedPost<{
          buildId?: string;
          listingId?: string | number;
          slug?: string;
          error?: { errorCode?: string; message?: string };
        }>('/publish', payload);
        if (json.slug) {
          pendingPreviewSlugRef.current = json.slug;
        }
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
            setAuthError('Nisi prijavljen ili je sesija istekla. Prijavi se i pokušaj ponovno.');
            return;
          }
          const code = e.code as string | undefined;
          const friendly = (code && friendlyByCode[code]) || e.message || code || 'Greška pri objavi';
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
      </div>
      {steps[step] === 'Izvor' && (
        <div className="space-y-4">
          <h2 className="font-semibold">{tCreate('chooseSource') || 'Izvor aplikacije'}</h2>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="submission-type"
                value="code"
                checked={submissionType === 'code'}
                onChange={() => handleSubmissionTypeChange('code')}
              />
              <span>{tCreate('pasteCode')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="submission-type"
                value="bundle"
                checked={submissionType === 'bundle'}
                onChange={() => handleSubmissionTypeChange('bundle')}
              />
              <span>Upload paketa (.zip)</span>
            </label>
          </div>
          {submissionType === 'code' ? (
            <textarea
              value={code}
              onChange={handleCodeChange}
              className="w-full h-64 border rounded p-2 font-mono text-sm"
              placeholder={mode === 'html' ? tCreate('placeholderHtml') : tCreate('placeholderReact')}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                ZIP paket mora sadrÅ¾avati build izlaz zajedno s datotekama{' '}
                <code>package.json</code> i <code>pnpm-lock.yaml</code>. Worker Ä‡e ga lokalno
                instalirati i pokrenuti <code>pnpm run build</code>.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => bundleInputRef.current?.click()}
                  className="px-3 py-2 rounded border border-emerald-500 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition"
                >
                  Odaberi ZIP
                </button>
                <input
                  ref={bundleInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleBundleFileChange}
                />
                {bundleFile && (
                  <span className="text-sm text-gray-700 max-w-[220px] truncate">{bundleFile.name}</span>
                )}
                {bundleFile && (
                  <button
                    type="button"
                    className="text-xs text-gray-600 underline"
                    onClick={clearBundleSelection}
                  >
                    Ukloni
                  </button>
                )}
              </div>
              {bundleError && <p className="text-sm text-red-600">{bundleError}</p>}
              <p className="text-xs text-gray-500">
                Nakon uspjeÅ¡nog builda dobivaÅ¡ lokalni preview na API serveru prije slanja na
                administratorski pregled.
              </p>
            </div>
          )}
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
          <div className="mt-3 border rounded p-3 bg-gray-50">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={storageEnabled}
                onChange={(e) => setStorageEnabled(e.target.checked)}
              />
              <span>
                <span className="block font-medium">
                  Omogući Thesara Storage (za multi-user sobe i sesije)
                </span>
                <span className="block text-xs text-gray-600 mt-1 leading-relaxed">
                  Kada je uključeno, tvojoj aplikaciji je dostupan `thesara.storage` objekt
                  s asinhronim metodama `getItem`, `setItem` i `removeItem` za dijeljenje
                  podataka između soba ili korisnika preko našeg servera.
                </span>
              </span>
            </label>
          </div>
          <div className="mt-3 space-y-2">
            <h3 className="font-medium">Prijevodi (neobavezno)</h3>
            <p className="text-xs text-gray-600">Ako ostavite prazno, sustav ce automatski prevesti nakon odobrenja.</p>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>????</span>English</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Title" value={trEn.title} onChange={(e)=>setTrEn(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Description" value={trEn.description} onChange={(e)=>setTrEn(p=>({...p,description:e.target.value}))} />
              </div>
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>????</span>Deutsch</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Titel" value={trDe.title} onChange={(e)=>setTrDe(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Beschreibung" value={trDe.description} onChange={(e)=>setTrDe(p=>({...p,description:e.target.value}))} />
              </div>
              <div className="border rounded p-2">
                <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>????</span>Hrvatski</div>
                <input className="w-full border rounded p-1 text-sm mb-1" placeholder="Naziv (preveden)" value={trHr.title} onChange={(e)=>setTrHr(p=>({...p,title:e.target.value}))} />
                <textarea className="w-full border rounded p-1 text-sm" rows={3} placeholder="Opis (preveden)" value={trHr.description} onChange={(e)=>setTrHr(p=>({...p,description:e.target.value}))} />
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-900">
                {tCreate('previewGraphic')}
              </label>
              <p className="text-xs text-gray-600 mt-1">
                {tCreate('previewGraphicHint')}
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              {PREVIEW_PRESET_PATHS.map((preset) => {
                const isSelected = previewChoice === 'preset' && selectedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetSelect(preset)}
                    className={`relative rounded-lg overflow-hidden border transition shadow-sm ${
                      isSelected ? 'border-emerald-500 ring-2 ring-emerald-400' : 'border-gray-200 hover:border-emerald-300'
                    }`}
                  >
                    <img src={preset} alt="" className="w-full aspect-video object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-emerald-600/10 pointer-events-none" />
                    )}
                    {presetOverlayLabel && (
                      <div className="absolute inset-x-0 bottom-0 bg-slate-900/80 text-white text-xs font-semibold text-center leading-snug py-1.5 px-3 break-words">
                        {presetOverlayLabel}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {previewChoice === 'preset' && (
              <div>
                <label className="block text-xs font-semibold text-gray-700">
                  {tCreate('previewTitleLabel')}{' '}
                  <span className="font-normal text-gray-500">
                    ({overlayMaxChars} {tCreate('characters')})
                  </span>
                </label>
                <input
                  value={presetOverlay}
                  onChange={(e) => {
                    setPresetOverlay(e.target.value.slice(0, overlayMaxChars));
                    setPreviewError('');
                    setPreviewAppliedSlug(null);
                  }}
                  maxLength={overlayMaxChars}
                  className="mt-1 w-full border rounded px-3 py-2 text-sm focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder={tCreate('previewTitlePlaceholder')}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  {tCreate('previewTitleHint')}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => previewInputRef.current?.click()}
                className="px-3 py-2 rounded border border-emerald-500 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition"
              >
                {tCreate('chooseCustomGraphic')}
              </button>
              <input
                ref={previewInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCustomPreview}
              />
              {customPreview && (
                <button
                  type="button"
                  onClick={resetCustomPreview}
                  className="text-sm text-gray-600 underline"
                >
                  {tCreate('removeCustomGraphic')}
                </button>
              )}
              <span className="text-[11px] text-gray-500">
                {tCreate('customGraphicHint')} {maxPreviewMb}MB
              </span>
            </div>

            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="relative aspect-video bg-gray-100">
                <img
                  src={previewDisplayUrl}
                  alt="App preview"
                  className="w-full h-full object-cover"
                />
                {previewChoice === 'preset' && presetOverlayLabel && (
                  <div className="absolute inset-x-0 bottom-0 bg-slate-900/80 text-white text-sm font-semibold text-center leading-snug py-2 px-4 break-words">
                    {presetOverlayLabel}
                  </div>
                )}
              </div>
            </div>

            {previewUploading && (
              <p className="text-xs text-gray-500">{tCreate('previewUploading')}</p>
            )}
            {!previewUploading && previewAppliedSlug && !previewError && (
              <p className="text-xs text-emerald-600">{tCreate('previewUploadSuccess')}</p>
            )}
            {previewError && (
              <p className="text-sm text-red-600">{previewError}</p>
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
              disabled={
                publishing ||
                !user ||
                (submissionType === 'bundle' && !bundleFile)
              }
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
            {submissionType === 'bundle' && localPreviewUrl && (
              <p className="text-sm text-emerald-600 mt-2 text-right">
                Bundle je uspješno izgrađen.{' '}
                <a
                  href={localPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Otvori preview
                </a>
              </p>
            )}
            {submissionType === 'bundle' && localJobLog && (
              <pre className="mt-3 max-h-48 w-full overflow-y-auto whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 text-left">
                {localJobLog}
              </pre>
            )}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}










