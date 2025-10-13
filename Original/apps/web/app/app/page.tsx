'use client';

import { Suspense, useEffect, useMemo, useState, useRef, useCallback, ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteParam } from '@/hooks/useRouteParam';
import Link from 'next/link';
import { API_URL } from '@/lib/config';
import { useAuth, getDisplayName } from '@/lib/auth';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import Avatar from '@/components/Avatar';
import { useI18n } from '@/lib/i18n-provider';
import AdSlot from '@/components/AdSlot';
import { checkAccess } from '@/lib/access';
import type { AccessMode } from '@/lib/types';
import { handleFetchError } from '@/lib/handleFetchError';
import { translateReason } from '@/lib/reviewReasons';
import { getCreatorHandle } from '@/lib/creators';
import {
  useConnectStatus,
  startStripeOnboarding,
} from '@/hooks/useConnectStatus';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import {
  MAX_PREVIEW_SIZE_BYTES,
  PREVIEW_PRESET_PATHS,
  PreviewPresetPath,
  PreviewUploadError,
  uploadPreviewFile,
  uploadPresetPreview,
} from '@/lib/previewClient';
import { resolvePreviewUrl } from '@/lib/preview';

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------
type Listing = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  tags?: string[];
  visibility: 'public' | 'unlisted';
  accessMode?: AccessMode;
  playUrl: string;
  previewUrl?: string | null;
  createdAt?: number;
  author?: { uid?: string; name?: string; photo?: string; handle?: string };
  likesCount?: number;
  likedByMe?: boolean;
  playsCount?: number;
  maxConcurrentPins?: number;
  state?: 'active' | 'inactive';
  pin?: string;
  price?: number;
  status?: 'draft' | 'published' | 'approved' | 'pending-review' | 'rejected';
  moderation?: { status?: string; reasons?: string[] };
  translations?: Record<string, { title?: string; description?: string }>;
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function timeSince(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}

// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Badges for build/network policy
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
function BuildBadges({ playUrl }: { playUrl: string }) {
  const [policy, setPolicy] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]);

  useEffect(() => {
    const m = /\/play\/([^/]+)\//.exec(playUrl);
    const appId = m?.[1];
    if (!appId) return;
    const safeAppId = encodeURIComponent(appId);
    let cancelled = false;
    (async () => {
      try {
        const ls = await fetch(`${API_URL}/listing/${safeAppId}`, { credentials: 'include', cache: 'no-store' });
        const lj = ls.ok ? await ls.json() : null;
        const buildId = lj?.item?.buildId;
        if (!buildId) return;
        const safeId = encodeURIComponent(buildId);
        const st = await fetch(`${API_URL}/build/${safeId}/status`, { credentials: 'include', cache: 'no-store' });
        const js = st.ok ? await st.json() : null;
        if (cancelled) return;
        const pol = js?.artifacts?.networkPolicy || null;
        setPolicy(pol);
        try {
          const man = await fetch(`${API_URL}/builds/${safeId}/build/manifest_v1.json`, { credentials: 'include', cache: 'no-store' });
          if (man.ok) {
            const mj = await man.json();
            if (Array.isArray(mj?.networkDomains)) setDomains(mj.networkDomains);
          }
        } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [playUrl]);

  if (!policy) return null;
  const pill = (text: string, tone: 'gray'|'green'|'yellow'|'red' = 'gray', title?: string) => (
    <span
      title={title || text}
      className={
        `inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border mr-1 ` +
        (tone==='green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
         tone==='yellow'? 'bg-amber-50 text-amber-700 border-amber-200' :
         tone==='red'   ? 'bg-rose-50 text-rose-700 border-rose-200' :
                          'bg-gray-50 text-gray-700 border-gray-200')
      }
    >{text}</span>
  );
  const polUp = String(policy).toUpperCase();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {polUp === 'NO_NET' && pill('No Net', 'green', 'bez mreÅ¾nih poziva')}
      {polUp === 'MEDIA_ONLY' && pill('Media Only', 'yellow', 'samo slike/video/CDN')}
      {polUp === 'OPEN_NET' && pill('Open Net', 'red', (domains.length? `domene: ${domains.join(', ')}` : 'Å¡iroki pristup mreÅ¾i'))}
    </div>
  );
}

// ------------------------------------------------------------------
// Modal Component
// ------------------------------------------------------------------
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmTone = 'danger',
  requireText,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: 'danger' | 'default';
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => cancelBtnRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const confirmDisabled = requireText ? text.trim() !== requireText : false;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 animate-fadeIn"
    >
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      
      {/* Panel with animation */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6 animate-slideUp">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <div className="mt-3 text-gray-600">{message}</div>

        {requireText && (
          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-600 mb-2">
              For safety, type <span className="font-mono px-2 py-1 bg-red-50 text-red-700 rounded">{requireText}</span> to confirm:
            </label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full border-2 rounded-lg px-3 py-2 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition-all"
              placeholder={requireText}
              autoComplete="off"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            ref={cancelBtnRef}
            onClick={onClose}
            className="px-5 py-2.5 rounded-full border border-gray-300 hover:bg-gray-50 transition-all duration-200 font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={cn(
              'px-5 py-2.5 rounded-full text-white font-medium transition-all duration-200',
              confirmDisabled
                ? 'bg-gray-400 cursor-not-allowed'
                : confirmTone === 'danger'
                ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 shadow-md hover:shadow-lg'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-md hover:shadow-lg'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Notification Toast Component
// ------------------------------------------------------------------
function Toast({ message, type = 'success', onClose }: { 
  message: string; 
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: 'from-emerald-500 to-green-600',
    error: 'from-red-500 to-red-600',
    info: 'from-blue-500 to-blue-600',
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-slideInRight">
      <div className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-lg',
        `bg-gradient-to-r ${colors[type]}`
      )}>
        {type === 'success' && (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {type === 'error' && (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Main Component
// ------------------------------------------------------------------
export default function AppDetailPage() {
  return (
    <Suspense fallback={null}>
      <AppDetailClient />
    </Suspense>
  );
}

function AppDetailClient() {
  const slug = useRouteParam('slug', (segments) => {
    if (segments.length > 1 && segments[0] === 'app') {
      return segments[1] ?? '';
    }
    return undefined;
  });
  const router = useRouter();
  const { user } = useAuth();
  const name = getDisplayName(user);
  const { messages } = useI18n();
  const tApp = (k: string) => messages[`App.${k}`] || k;

  const [item, setItem] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [authorHandle, setAuthorHandle] = useState<string | undefined>(undefined);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Optional manual translations for UI editing
  const [trEn, setTrEn] = useState({ title: '', description: '' });
  const [trDe, setTrDe] = useState({ title: '', description: '' });
  const [trHr, setTrHr] = useState({ title: '', description: '' });
  const [tags, setTags] = useState('');
  const [price, setPrice] = useState('');
  const [priceMin, setPriceMin] = useState(0.5);
  const [priceMax, setPriceMax] = useState(1000);
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [accessMode, setAccessMode] = useState<AccessMode>('public');
  const [pin, setPin] = useState('');
  const [maxPins, setMaxPins] = useState(1);
  const [appState, setAppState] = useState<'active' | 'inactive'>('active');
  const [sessions, setSessions] = useState<Array<{ sessionId: string; anonId?: string; ipHash: string; createdAt: number; lastSeenAt: number }>>([]);
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [lastSessionsRefresh, setLastSessionsRefresh] = useState<number | null>(null);
  const [rotatingPin, setRotatingPin] = useState(false);

  // Modal states
  const [showSoftDialog, setShowSoftDialog] = useState(false);
  const [showHardDialog, setShowHardDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Like state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);

  const previewInputRef = useRef<HTMLInputElement | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);
  const [allowed, setAllowed] = useState(true);
  const overlayMaxChars = 22;
  const maxPreviewMb = useMemo(
    () => Math.round((MAX_PREVIEW_SIZE_BYTES / (1024 * 1024)) * 10) / 10,
    []
  );
  const [previewChoice, setPreviewChoice] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<PreviewPresetPath>(PREVIEW_PRESET_PATHS[0]);
  const [presetOverlay, setPresetOverlay] = useState('');
  const [customPreview, setCustomPreview] = useState<{ file: File; dataUrl: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewApplied, setPreviewApplied] = useState(false);
  const [previewDisplayFailed, setPreviewDisplayFailed] = useState(false);
  const relativeCreated = useRelativeTime(item?.createdAt ?? null, timeSince);

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
    setPreviewApplied(false);
    setPreviewError('');
  }, []);

  const handleCustomPreview = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      previewInputRef.current = e.target;
      if (!file) return;

      setPreviewApplied(false);
      setPreviewError('');

      if (file.size > MAX_PREVIEW_SIZE_BYTES) {
        setPreviewError(`${tApp('previewFileTooLarge')} ${maxPreviewMb}MB`);
        setCustomPreview(null);
        setPreviewChoice('preset');
        if (previewInputRef.current) previewInputRef.current.value = '';
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        setCustomPreview({ file, dataUrl });
        setPreviewChoice('custom');
      } catch {
        setPreviewError(tApp('previewFileReadFailed'));
        setCustomPreview(null);
        setPreviewChoice('preset');
        if (previewInputRef.current) previewInputRef.current.value = '';
      }
    },
    [maxPreviewMb, readFileAsDataUrl, tApp]
  );

  const resetCustomPreview = useCallback(() => {
    setCustomPreview(null);
    setPreviewChoice('preset');
    setPreviewApplied(false);
    setPreviewError('');
    if (previewInputRef.current) previewInputRef.current.value = '';
  }, []);

  const [showPayModal, setShowPayModal] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Report issue modal state
  const [showReport, setShowReport] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      let adminClaim = false;
      if (user) {
        try {
          const tok = await auth?.currentUser?.getIdTokenResult(true);
          adminClaim =
            !!tok?.claims?.admin ||
            tok?.claims?.role === 'admin' ||
            !!tok?.claims?.isAdmin;
        } catch {
          adminClaim = false;
        }
      }
      if (!cancelled) setIsAdmin(adminClaim);
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [user]);

useEffect(() => {
  if (item?.id && item.price && item.price > 0) {
    checkAccess(item.id).then(setAllowed).catch(() => setAllowed(false));
  }
}, [item?.id, item?.price]);

  const canEdit = !!user && !!item?.author?.uid && item.author.uid === user.uid;
  const connect = useConnectStatus();
  const canMonetize =
    connect?.payouts_enabled && (connect.requirements_due ?? 0) === 0;
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

  useEffect(() => {
    setPreviewDisplayFailed(false);
  }, [item?.previewUrl, imgVersion]);

  const applySelectedPreview = useCallback(async () => {
    if (!item || !canEdit || previewBusy) return;
    if (previewChoice === 'custom' && !customPreview?.file) {
      setPreviewError(tApp('previewSelectFileFirst'));
      return;
    }

    setPreviewBusy(true);
    setPreviewApplied(false);
    setPreviewError('');

    try {
      let response: any;
      if (previewChoice === 'custom' && customPreview?.file) {
        response = await uploadPreviewFile(item.slug, customPreview.file);
      } else {
        response = await uploadPresetPreview(item.slug, selectedPreset, {
          overlayText: previewOverlayText,
        });
      }
      if (response?.previewUrl) {
        setItem((prev) => (prev ? { ...prev, previewUrl: response.previewUrl } : prev));
      }
      setImgVersion((v) => v + 1);
      setPreviewApplied(true);
      setToast({ message: tApp('previewUploadSuccess'), type: 'success' });
    } catch (err: any) {
      let message = tApp('previewUploadFailed');
      if (err instanceof PreviewUploadError) {
        message = err.message || message;
      } else if (err instanceof Error) {
        message = err.message || message;
      }
      setPreviewError(message);
      setToast({ message, type: 'error' });
    } finally {
      setPreviewBusy(false);
    }
  }, [canEdit, customPreview?.file, item, previewBusy, previewChoice, previewOverlayText, selectedPreset, tApp]);

  useEffect(() => {
    if (item?.author?.handle) {
      setAuthorHandle(item.author.handle);
      return;
    }
    let cancelled = false;
    if (item?.author?.uid) {
      getCreatorHandle(item.author.uid).then((h) => {
        if (!cancelled && h) setAuthorHandle(h);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [item?.author?.handle, item?.author?.uid]);

  // Load liked state
  useEffect(() => {
    if (item) {
      setLiked(!!item.likedByMe);
      setLikeCount(item.likesCount || 0);
    }
  }, [item]);

  // Build headers for API requests
  const buildHeaders = useCallback(
    async (withJson: boolean): Promise<Record<string, string>> => {
      const headers: Record<string, string> = withJson ? { 'Content-Type': 'application/json' } : {};
      try {
        const token = await (user as any)?.getIdToken?.();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      } catch {
        // ignore
      }
      return headers;
    },
    [user]
  );

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_URL}/config`, { credentials: 'include' });
        if (res.ok) {
          const json = await res.json();
          if (typeof json.priceMin === 'number') setPriceMin(json.priceMin);
          if (typeof json.priceMax === 'number') setPriceMax(json.priceMax);
        }
      } catch {
        // ignore
      }
    };
    fetchConfig();
  }, []);

  // Toggle like
  const toggleLike = useCallback(
    async () => {
      if (!item || likeBusy) return;
      setLikeBusy(true);
      try {
        const newLike = !liked;
        const res = await fetch(`${API_URL}/listing/${item.slug}/like`, {
          method: 'POST',
          credentials: 'include',
          headers: await buildHeaders(true),
          body: JSON.stringify({ uid: user?.uid, like: newLike }),
        });
        if (res.status === 401) {
          if (auth) await signOut(auth);
          router.push('/login');
          return;
        }
        if (res.status === 429) {
          setToast({ message: 'Polako ðŸ™‚', type: 'info' });
          return;
        }
        if (!res.ok) throw new Error(`POST ${res.status}`);
        await res.json();
        setLiked(newLike);
        setLikeCount((prev) => {
          const delta = newLike ? 1 : -1;
          return Math.max(0, prev + delta);
        });
        setItem((prev) =>
          prev
            ? {
                ...prev,
                likedByMe: newLike,
                likesCount: Math.max(0, (prev.likesCount || 0) + (newLike ? 1 : -1)),
              }
            : prev
        );
        const el = document.getElementById('like-button');
        if (el) {
          el.classList.add('animate-bounce');
          setTimeout(() => el.classList.remove('animate-bounce'), 500);
        }
      } catch (e) {
        handleFetchError(e, 'Failed to toggle like');
        setToast({
          message: 'Unable to like this app. Please check the API URL and server status.',
          type: 'error',
        });
      } finally {
        setLikeBusy(false);
      }
    },
    [item, likeBusy, router, buildHeaders, liked, user]
  );

  // Load listing data
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const url = `${API_URL}/listing/${slug}${user?.uid ? `?uid=${user.uid}` : ''}`;
        const res = await fetch(url, {
          cache: 'no-store',
          credentials: 'include',
          headers: await buildHeaders(false),
        });
        if (res.status === 401) {
          const err = await res.json().catch(() => null);
          if (err?.error === 'pin_required') {
            router.replace(slug ? `/paywall?slug=${encodeURIComponent(slug)}` : '/paywall');
            return;
          }
          throw new Error(`GET failed ${res.status}`);
        }
        if (res.status === 403) {
          router.replace(`/paywall?slug=${encodeURIComponent(slug)}&e=forbidden`);
          return;
        }
        if (!res.ok) throw new Error(`GET failed ${res.status}`);
        const json = await res.json();
        const it: Listing | undefined = json.item;
        if (it) {
          setItem(it);
          setPreviewApplied(Boolean(it.previewUrl));
          setTitle(it.title ?? '');
          setDescription(it.description ?? '');
          try {
            const tr = (it as any).translations || {};
            setTrEn({ title: tr?.en?.title || '', description: tr?.en?.description || '' });
            setTrDe({ title: tr?.de?.title || '', description: tr?.de?.description || '' });
            setTrHr({ title: tr?.hr?.title || '', description: tr?.hr?.description || '' });
          } catch {}
          setTags((it.tags ?? []).join(', '));
          setPrice(typeof it.price === 'number' ? String(it.price) : '');
          setVisibility((it.visibility as any) ?? 'public');
          setAccessMode((it.accessMode as any) ?? 'public');
          setMaxPins(typeof it.maxConcurrentPins === 'number' ? it.maxConcurrentPins : 1);
          setAppState((it.state as any) ?? 'active');
          setPin(it.pin ?? '');
        } else {
          setItem(null);
        }
      } catch (e) {
        handleFetchError(e, 'Failed to load app details');
        setItem(null);
        setToast({
          message: 'Failed to load app details. Please check the API URL and server status.',
          type: 'error',
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [slug, buildHeaders, user?.uid, router]);

  const imgSrc = useMemo(() => {
    const shouldForcePlaceholder = Boolean(
      item?.status && !['published', 'approved'].includes(item.status) && !canEdit,
    );
    if (shouldForcePlaceholder) {
      return `${API_URL}/assets/preview-placeholder.svg`;
    }
    const resolved = resolvePreviewUrl(item?.previewUrl);
    if (item?.previewUrl?.startsWith('/uploads/')) {
      const separator = resolved.includes('?') ? '&' : '?';
      return `${resolved}${separator}v=${imgVersion}`;
    }
    return resolved;
  }, [canEdit, item?.status, item?.previewUrl, imgVersion]);

  const hasUnsavedPreview = useMemo(() => {
    if (!canEdit) return false;
    if (previewChoice === 'custom') return !!customPreview;
    if (previewChoice === 'preset') return !previewApplied;
    return false;
  }, [canEdit, customPreview, previewChoice, previewApplied]);

  const useEditorPreview = hasUnsavedPreview || (!imgSrc && canEdit);
  const activePreviewSrc = useEditorPreview ? previewDisplayUrl : imgSrc;
  const activeOverlayLabel =
    useEditorPreview && previewChoice === 'preset' ? presetOverlayLabel : '';

  useEffect(() => {
    if (useEditorPreview) {
      setPreviewDisplayFailed(false);
    }
  }, [useEditorPreview]);

  async function loadSessions() {
    setRefreshingSessions(true);
    try {
      const res = await fetch(`${API_URL}/app/${slug}/pin/sessions`, {
        cache: 'no-store',
        credentials: 'include',
        headers: await buildHeaders(false),
      });
      if (res.ok) {
        const json = await res.json();
        setSessions(Array.isArray(json.sessions) ? json.sessions : []);
      }
    } catch (e) {
      handleFetchError(e, 'Failed to load sessions');
      setToast({
        message: 'Failed to load sessions. Please check the API URL and server status.',
        type: 'error',
      });
    } finally {
      setRefreshingSessions(false);
      setLastSessionsRefresh(Date.now());
    }
  }

  async function revokeSession(sessionId: string) {
    try {
      const res = await fetch(`${API_URL}/app/${slug}/pin/sessions/${sessionId}/revoke`, {
        method: 'POST',
        credentials: 'include',
        headers: await buildHeaders(false),
      });
      if (res.ok) {
        setToast({ message: 'Session revoked', type: 'success' });
        loadSessions();
      } else {
        setToast({ message: 'Failed to revoke session', type: 'error' });
      }
    } catch (e) {
      handleFetchError(e, 'Failed to revoke session');
      setToast({
        message: 'Failed to revoke session. Please check the API URL and server status.',
        type: 'error',
      });
    }
  }

  async function rotatePin() {
    setRotatingPin(true);
    try {
      const res = await fetch(`${API_URL}/app/${slug}/pin/rotate`, {
        method: 'POST',
        credentials: 'include',
        headers: await buildHeaders(false),
      });
      const json = await res.json();
      if (res.ok) {
        setToast({ message: `New PIN: ${json.pin}`, type: 'success' });
        loadSessions();
      } else {
        setToast({ message: json.error || 'Failed to rotate PIN', type: 'error' });
      }
    } catch (e) {
      handleFetchError(e, 'Failed to rotate PIN');
      setToast({
        message: 'Failed to rotate PIN. Please check the API URL and server status.',
        type: 'error',
      });
    } finally {
      setRotatingPin(false);
    }
  }

  useEffect(() => {
    if (!item || (user?.uid !== item.author?.uid && !isAdmin)) return;
    loadSessions();
    const intervalId = setInterval(loadSessions, 30000);
    return () => clearInterval(intervalId);
  }, [item, slug, buildHeaders, user?.uid, isAdmin]);



  // Save changes
  const onSave = async (
    overrides: Partial<
      Pick<
        Listing,
        'title' | 'description' | 'tags' | 'visibility' | 'accessMode' | 'price'
      >
    > & { pin?: string | null; maxConcurrentPins?: number } = {}
  ) => {
    if (!canEdit || !item) return;

    setSaving(true);
    const parsedTags =
      typeof overrides.tags === 'string'
        ? (overrides.tags as unknown as string)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : tags.split(',').map((t) => t.trim()).filter(Boolean);

    // Build translations object with only non-empty fields
    const norm = (s: string) => s.trim();
    const translations: Record<string, { title?: string; description?: string }> = {};
    if (norm(trEn.title) || norm(trEn.description)) {
      translations.en = { ...(norm(trEn.title) ? { title: norm(trEn.title) } : {}), ...(norm(trEn.description) ? { description: norm(trEn.description) } : {}) };
    }
    if (norm(trDe.title) || norm(trDe.description)) {
      translations.de = { ...(norm(trDe.title) ? { title: norm(trDe.title) } : {}), ...(norm(trDe.description) ? { description: norm(trDe.description) } : {}) };
    }
    if (norm(trHr.title) || norm(trHr.description)) {
      translations.hr = { ...(norm(trHr.title) ? { title: norm(trHr.title) } : {}), ...(norm(trHr.description) ? { description: norm(trHr.description) } : {}) };
    }

    const body: any = {
      title,
      description,
      tags: parsedTags,
      visibility,
      accessMode,
      maxConcurrentPins: maxPins,
      authorUid: user?.uid,
      ...overrides,
      ...(Object.keys(translations).length ? { translations } : {}),
    };
    const parsedPrice =
      typeof overrides.price === 'number' ? overrides.price : Number(price);
    if (!isNaN(parsedPrice)) {
      if (parsedPrice < priceMin || parsedPrice > priceMax) {
        setToast({
          message: `Price must be between ${priceMin} and ${priceMax}`,
          type: 'error',
        });
        setSaving(false);
        return;
      }
      body.price = parsedPrice;
    }
    if ('pin' in overrides) body.pin = overrides.pin;

    try {
      const res = await fetch(`${API_URL}/listing/${item.slug}`, {
        method: 'PATCH',
        headers: await buildHeaders(true),
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`PATCH failed ${res.status}: ${txt}`);
      }
      const json = await res.json();
      if (json?.ok) {
        setItem(json.item);
        if (typeof json.item?.price === 'number') setPrice(String(json.item.price));
        if (overrides.visibility) setVisibility(overrides.visibility);
        if (overrides.accessMode) setAccessMode(overrides.accessMode);
        if ('pin' in overrides) setPin(json.item?.pin ?? '');
        if (typeof overrides.title === 'string') setTitle(overrides.title);
        if (typeof overrides.description === 'string') setDescription(overrides.description);
        if (Array.isArray(overrides.tags)) setTags(overrides.tags.join(', '));
        if (typeof overrides.maxConcurrentPins === 'number') setMaxPins(overrides.maxConcurrentPins);
        setToast({ message: 'Changes saved successfully!', type: 'success' });
      } else {
        throw new Error(json?.error || 'Failed to save changes');
      }
    } catch (err: any) {
      handleFetchError(err, 'Failed to save changes');
      setToast({
        message: 'Failed to save changes. Please check the API URL and server status.',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Toggle visibility
  const onToggleVisibility = async () => {
    if (!item) return;
    const next = visibility === 'public' ? 'unlisted' : 'public';
    await onSave({ visibility: next });
  };

  // Toggle active/inactive state
  const onToggleState = async () => {
    if (!item) return;
    const next = appState === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`${API_URL}/app/${item.slug}/state`, {
        method: 'PATCH',
        headers: await buildHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ state: next }),
      });
      if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
      const json = await res.json();
      if (json?.ok) {
        setAppState(next);
        setItem((prev) => (prev ? { ...prev, state: next } : prev));
        setToast({
          message: next === 'inactive' ? 'App deactivated' : 'App activated',
          type: 'success',
        });
      } else {
        throw new Error(json?.error || 'Failed to toggle state');
      }
    } catch (err: any) {
      handleFetchError(err, 'Failed to toggle state');
      setToast({
        message: 'Failed to toggle state. Please check the API URL and server status.',
        type: 'error',
      });
    }
  };

  // Delete app
  const performDelete = async (hard: boolean) => {
    if (!item || !canEdit) return;
    if (deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/listing/${item.slug}?hard=${hard ? 'true' : 'false'}`, {
        method: 'DELETE',
        headers: await buildHeaders(false),
        credentials: 'include',
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`DELETE failed ${res.status}: ${txt}`);
      }
      const json = await res.json();
      if (json?.ok) {
        setToast({ message: 'App deleted successfully', type: 'success' });
        setTimeout(() => router.push('/my?deleted=1'), 1000);
      } else {
        throw new Error(json?.error || 'Failed to delete app');
      }
    } catch (err: any) {
      handleFetchError(err, 'Failed to delete app');
      setToast({
        message: 'Failed to delete app. Please check the API URL and server status.',
        type: 'error',
      });
    } finally {
      setDeleting(false);
      setShowSoftDialog(false);
      setShowHardDialog(false);
    }
  };

  // Copy link to clipboard
  const copyLink = useCallback(() => {
    if (!item) return;
    const url = new URL('/play', window.location.origin);
    url.searchParams.set('appId', item.id);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopySuccess(true);
      setToast({ message: 'Link copied to clipboard!', type: 'success' });
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }, [item]);

  // Submit issue report
  const submitReport = useCallback(async () => {
    if (!item) return;
    const msg = reportText.trim();
    if (msg.length < 10) {
      setToast({ message: 'Molimo opišite problem (min 10 znakova).', type: 'error' });
      return;
    }
    setReportBusy(true);
    try {
      const res = await fetch(`${API_URL}/listing/${encodeURIComponent(item.slug)}/report-issue`, {
        method: 'POST',
        headers: await buildHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ reason: msg }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`http_${res.status}:${txt}`);
      }
      setToast({ message: 'Hvala! Zaprimili smo prijavu.', type: 'success' });
      setShowReport(false);
      setReportText('');
    } catch (e) {
      handleFetchError(e, 'Slanje prijave nije uspjelo');
      setToast((t) => t ?? { message: 'Neuspješno slanje prijave. Provjerite mrežu/API.', type: 'error' });
    } finally {
      setReportBusy(false);
    }
  }, [item, reportText, buildHeaders]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-emerald-50/30 to-white">
        <div className="max-w-6xl mx-auto p-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="grid md:grid-cols-2 gap-8">
              <div className="aspect-video bg-gray-200 rounded-2xl"></div>
              <div className="space-y-4">
                <div className="h-10 bg-gray-200 rounded"></div>
                <div className="h-20 bg-gray-200 rounded"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-white via-emerald-50/30 to-white flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{tApp('notFound')}</h2>
          <p className="text-gray-600 mb-6">The app you&apos;re looking for doesn&apos;t exist or has been removed.</p>
          <Link href="/" className="px-6 py-3 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition inline-block">
            {tApp('backToMarketplace')}
          </Link>
        </div>
      </div>
    );
  }

  const isNew = item.createdAt && Date.now() - item.createdAt < 1000 * 60 * 60 * 24 * 7;
  const isHot = likeCount > 100;

  // ------------------------------------------------------------------
  // Main UI
  // ------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-emerald-50/30 to-white">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-100/40 via-white to-white" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-200/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl" />
      </div>

      {/* Header */}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4 md:p-8">
        <AdSlot className="mb-6" />
        {/* App Info Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl md:text-4xl font-black text-gray-900">{item.title}</h1>
                {isNew && (
                  <span className="px-3 py-1 rounded-full bg-emerald-600 text-white text-xs font-bold animate-pulse">NEW</span>
                )}
                {isHot && (
                  <span className="px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-bold">ðŸ”¥ HOT</span>
                )}
                {visibility === 'unlisted' && (
                  <span className="px-3 py-1 rounded-full bg-gray-700 text-white text-xs font-bold">UNLISTED</span>
                )}
                {appState === 'inactive' && (
                  <span className="px-3 py-1 rounded-full bg-red-600 text-white text-xs font-bold">INACTIVE</span>
                )}
                <span className="px-3 py-1 rounded-full bg-gray-900 text-white text-xs font-semibold">
                  {typeof item.price === 'number' && item.price > 0
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.price) + '/mo'
                    : 'FREE'}
                </span>
              </div>
              
              <div className="flex items-center gap-4 text-sm text-gray-600">
                {item.author && (
                  authorHandle ? (
                    <div className="flex items-center gap-2">
                      {item.author.photo && (
                        <Link href={`/u/${authorHandle}`}>
                          <Avatar
                            uid={item.author.uid}
                            src={item.author.photo}
                            name={item.author.name}
                            size={24}
                          />
                        </Link>
                      )}
                      <span>
                        by{' '}
                        <Link
                          href={`/u/${authorHandle}`}
                          className="font-medium text-gray-900 hover:underline"
                        >
                          @{authorHandle}
                        </Link>
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {item.author.photo && (
                        <Avatar
                          uid={item.author.uid}
                          src={item.author.photo}
                          name={item.author.name}
                          size={24}
                        />
                      )}
                      <span>
                        by <span className="font-medium text-gray-900">{item.author.name || 'Anonymous'}</span>
                      </span>
                    </div>
                  )
                )}
                {item.createdAt && (
                  <>
                    <span>•</span>
                    <time title={new Date(item.createdAt).toLocaleString()}>
                      {relativeCreated || ''}
                    </time>
                  </>
                )}
                {typeof item.playsCount === 'number' && (
                  <>
                    <span>•</span>
                    <span>Plays: {item.playsCount}</span>
                  </>
                )}
              </div>
              {/* Build/network badges */}
              <BuildBadges playUrl={item.playUrl} />
            </div>

            <div className="flex items-center gap-3">
              <button
                id="like-button"
                onClick={toggleLike}
                disabled={likeBusy}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-200',
                  liked
                    ? 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
                    : 'bg-white border-gray-300 hover:bg-gray-50',
                  likeBusy && 'opacity-50 cursor-not-allowed'
                )}
              >
                <svg className="w-5 h-5" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                <span className="font-medium">{likeCount}</span>
              </button>

              {(!user) ? (
                    <button
                      onClick={() => setShowLoginPrompt(true)}
                      className="px-5 py-2.5 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700"
                    >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {tApp('playNow')}
                  </span>
                </button>
              ) : item.price && !allowed ? (
                <button
                  onClick={() => setShowPayModal(true)}
                  className="px-5 py-2.5 rounded-full bg-gray-300 text-gray-500 cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {tApp('playNow')}
                  </span>
                </button>
              ) : (
                <a
                  href={`/play?appId=${encodeURIComponent(item.id)}&run=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-5 py-2.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-medium hover:from-emerald-700 hover:to-emerald-800 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {tApp('playNow')}
                  </span>
                </a>
              )}

              <button
                onClick={copyLink}
                className={cn(
                  'px-4 py-2.5 rounded-full border transition-all duration-200',
                  copySuccess
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'border-gray-300 hover:bg-gray-50 text-gray-700'
                )}
              >
                {copySuccess ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Link
                  </span>
                )}
              </button>
              {canEdit && (
                <>
                  <Link
                    href={`/create?slug=${item.slug}`}
                    className="px-4 py-2.5 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 transition-all duration-200"
                  >
                    Update Version
                  </Link>
                  <button
                    onClick={onToggleState}
                    className="px-4 py-2.5 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 transition-all duration-200"
                  >
                    {appState === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => setShowReport(true)}
                    className="px-4 py-2.5 rounded-full border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-all duration-200"
                    title="Ako aplikacija ne radi kako očekujete, prijavite nam problem."
                  >
                    Prijavi poteškoće
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        { canEdit && (item.status === 'pending-review' || item.status === 'rejected') && (
          <div
            className={`mb-8 p-4 rounded-xl border ${
              item.status === 'rejected'
                ? 'border-red-300 bg-red-50'
                : 'border-amber-300 bg-amber-50'
            }`}
          >
            <h2
              className={`font-semibold mb-2 ${
                item.status === 'rejected' ? 'text-red-800' : 'text-amber-800'
              }`}
            >
              Sigurnosna provjera
            </h2>
            <ul
              className={`list-disc list-inside text-sm ${
                item.status === 'rejected' ? 'text-red-700' : 'text-amber-700'
              }`}
            >
              {item.moderation?.reasons?.map((r, i) => (
                <li key={i}>{translateReason(r)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Main Grid */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Preview */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
              <div className="relative">
                {activePreviewSrc && !previewDisplayFailed ? (
                  <img
                    src={activePreviewSrc}
                    alt={item.title}
                    className="w-full aspect-video object-cover"
                    onError={useEditorPreview ? undefined : () => setPreviewDisplayFailed(true)}
                  />
                ) : (
                  <div className="w-full aspect-video bg-slate-100 flex items-center justify-center text-slate-500 text-sm font-medium">
                    {tApp('previewGraphicHint')}
                  </div>
                )}
                {activeOverlayLabel && (
                  <div className="absolute inset-x-0 bottom-0 bg-slate-900/80 text-white text-sm font-semibold text-center leading-snug py-2 px-4 break-words">
                    {activeOverlayLabel}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300 flex items-end justify-center pb-8 z-10">
                  {user ? (
                    <a
                      href={`/play?appId=${encodeURIComponent(item.id)}&run=1`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-6 py-3 rounded-full bg-white/95 backdrop-blur text-gray-900 font-medium shadow-lg hover:bg-white transform hover:scale-105 transition"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        {tApp('playInNewTab')}
                      </span>
                    </a>
                  ) : (
                    <button
                      onClick={() => setShowLoginPrompt(true)}
                      className="px-6 py-3 rounded-full bg-white/95 backdrop-blur text-gray-900 font-medium shadow-lg hover:bg-white transform hover:scale-105 transition"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        {tApp('playInNewTab')}
                      </span>
                    </button>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="border-t border-gray-200 bg-white">
                  <input
                    ref={previewInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCustomPreview}
                  />
                  <div className="p-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{tApp('previewGraphic')}</h3>
                      <p className="text-xs text-gray-600 mt-1">{tApp('previewGraphicHint')}</p>
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
                        {isSelected && <div className="absolute inset-0 bg-emerald-600/10 pointer-events-none" />}
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
                          {tApp('previewTitleLabel')}{' '}
                          <span className="font-normal text-gray-500">
                            ({overlayMaxChars} {tApp('characters')})
                          </span>
                        </label>
                        <input
                          value={presetOverlay}
                          onChange={(e) => {
                            setPresetOverlay(e.target.value.slice(0, overlayMaxChars));
                            setPreviewApplied(false);
                            setPreviewError('');
                          }}
                          maxLength={overlayMaxChars}
                          className="mt-1 w-full border rounded px-3 py-2 text-sm focus:ring-emerald-500 focus:border-emerald-500"
                          placeholder={tApp('previewTitlePlaceholder')}
                        />
                        <p className="text-[11px] text-gray-500 mt-1">{tApp('previewTitleHint')}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => previewInputRef.current?.click()}
                        className="px-3 py-2 rounded border border-emerald-500 text-emerald-700 text-sm font-medium hover:bg-emerald-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={previewBusy}
                      >
                        {tApp('chooseCustomGraphic')}
                      </button>
                      {customPreview && (
                        <button
                          type="button"
                          onClick={resetCustomPreview}
                          className="text-sm text-gray-600 underline disabled:opacity-60"
                          disabled={previewBusy}
                        >
                          {tApp('removeCustomGraphic')}
                        </button>
                      )}
                      <span className="text-[11px] text-gray-500">
                        {tApp('customGraphicHint')} {maxPreviewMb}MB
                      </span>
                    </div>
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                  {previewChoice === 'custom' && customPreview?.dataUrl ? (
                    <div className="relative aspect-video bg-gray-100">
                      <img
                        src={customPreview.dataUrl}
                        alt="Custom preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="relative aspect-video bg-gray-100 bg-[radial-gradient(circle_at_center,_rgba(15,23,42,0.12),_transparent_55%)] border border-dashed border-slate-300 text-slate-500 flex flex-col items-center justify-center text-xs uppercase tracking-wide">
                      <span className="font-semibold">{tApp('previewGraphicHint')}</span>
                      <span className="mt-1 text-[11px] text-slate-400">
                        {tApp('chooseCustomGraphic')}
                      </span>
                    </div>
                  )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={applySelectedPreview}
                        disabled={
                          previewBusy ||
                          !canEdit ||
                          (previewChoice === 'custom' && !customPreview?.file)
                        }
                        className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:bg-emerald-700 transition"
                      >
                        {previewBusy ? tApp('savingGraphic') : tApp('saveGraphic')}
                      </button>
                      {!previewBusy && previewApplied && !previewError && (
                      <span className="text-xs text-emerald-600">{tApp('previewUploadSuccess')}</span>
                      )}
                      {previewBusy && (
                        <span className="text-xs text-gray-500">{tApp('previewUploading')}</span>
                      )}
                    </div>
                    {previewError && <p className="text-sm text-red-600">{previewError}</p>}
                  </div>
                  <div className="px-4 pb-4 bg-gray-50/50">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-700 font-medium">App ID:</span>
                      <code className="font-mono bg-gray-900 text-emerald-400 px-3 py-1 rounded border border-gray-700">
                        {item.slug}
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tags Display */}
            {item.tags && item.tags.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map(tag => (
                    <Link
                      key={tag}
                      href={`/?tag=${tag}`}
                      className="px-3 py-1.5 rounded-full bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-300 text-sm font-medium text-gray-800 hover:from-emerald-50 hover:to-green-50 hover:border-emerald-400 hover:text-emerald-700 transition-all duration-200"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canEdit && (
          <div className="space-y-6">
            {/* Edit Form */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                App Details
              </h2>

              <div className="space-y-5">
                {/* Title */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 bg-white placeholder-gray-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all duration-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    disabled={!canEdit}
                    placeholder="Enter app title..."
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 bg-white placeholder-gray-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all duration-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed resize-none"
                    rows={4}
                    disabled={!canEdit}
                    placeholder="Describe your app..."
                  />
                  <p className="mt-1 text-xs text-gray-600 font-medium">{description.length}/500 characters</p>
                </div>

                {/* Translations (optional) */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Translations (optional)</label>
                  <p className="text-xs text-gray-600 mb-2">If you leave these blank, the system will auto-translate after approval.</p>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="border rounded-lg p-3">
                      <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇬🇧</span>English</div>
                      <input
                        value={trEn.title}
                        onChange={(e)=>setTrEn(p=>({...p,title:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm mb-1"
                        placeholder="Title"
                      />
                      <textarea
                        value={trEn.description}
                        onChange={(e)=>setTrEn(p=>({...p,description:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm"
                        rows={3}
                        placeholder="Description"
                      />
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇩🇪</span>Deutsch</div>
                      <input
                        value={trDe.title}
                        onChange={(e)=>setTrDe(p=>({...p,title:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm mb-1"
                        placeholder="Titel"
                      />
                      <textarea
                        value={trDe.description}
                        onChange={(e)=>setTrDe(p=>({...p,description:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm"
                        rows={3}
                        placeholder="Beschreibung"
                      />
                    </div>
                    <div className="border rounded-lg p-3">
                      <div className="text-xs font-semibold mb-1"><span className="mr-1" aria-hidden>🇭🇷</span>Hrvatski</div>
                      <input
                        value={trHr.title}
                        onChange={(e)=>setTrHr(p=>({...p,title:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm mb-1"
                        placeholder="Naziv"
                      />
                      <textarea
                        value={trHr.description}
                        onChange={(e)=>setTrHr(p=>({...p,description:e.target.value}))}
                        disabled={!canEdit}
                        className="w-full border rounded px-2 py-1 text-sm"
                        rows={3}
                        placeholder="Opis"
                      />
                    </div>
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Tags <span className="text-gray-600 font-normal">(comma-separated)</span>
                  </label>
                  <input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 bg-white placeholder-gray-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all duration-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    disabled={!canEdit}
                    placeholder="e.g., game, puzzle, education"
                  />
                  <p className="mt-1 text-xs text-gray-600 font-medium">Add tags to help users discover your app</p>
                </div>

                {/* Price */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Price (€)
                  </label>
                  {!canMonetize && (
                    <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded">
                      <p className="text-sm mb-2">
                        Postavljanje cijena je zaključano dok ne dovršiš Stripe onboarding.
                      </p>
                      {user && (
                        <button
                          onClick={() => authorHandle && startStripeOnboarding(user.uid, authorHandle)}
                          className="px-3 py-1 bg-blue-600 text-white rounded"
                        >
                          Podesi isplate (Stripe)
                        </button>
                      )}
                    </div>
                  )}
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 bg-white placeholder-gray-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all duration-200 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                    disabled={!canEdit || !canMonetize}
                    type="number"
                    min={priceMin}
                    max={priceMax}
                    step="0.01"
                  />
                </div>

                {/* Visibility */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Visibility
                  </label>
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <button
                      onClick={() => canEdit && setVisibility('public')}
                      disabled={!canEdit}
                      className={cn(
                        'flex-1 py-2.5 px-4 rounded-lg font-medium transition-all duration-200',
                        visibility === 'public'
                          ? 'bg-white text-emerald-700 shadow-sm border-2 border-emerald-500'
                          : 'text-gray-700 hover:bg-white/50 border border-transparent',
                        !canEdit && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Public
                      </span>
                    </button>
                    <button
                      onClick={() => canEdit && setVisibility('unlisted')}
                      disabled={!canEdit}
                      className={cn(
                        'flex-1 py-2.5 px-4 rounded-lg font-medium transition-all duration-200',
                        visibility === 'unlisted'
                          ? 'bg-white text-gray-900 shadow-sm border-2 border-gray-500'
                          : 'text-gray-700 hover:bg-white/50 border border-transparent',
                        !canEdit && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                        Unlisted
                      </span>
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600 font-medium">
                    {visibility === 'public' 
                      ? '✅ Your app will appear in the marketplace and search results' 
                      : '🔐 Your app will be hidden from the marketplace but accessible via direct link'}
                  </p>
                </div>

                {/* Action Buttons */}
                {canEdit && (
                  <div className="flex items-center justify-between pt-4 border-t">
                    <button
                      onClick={onToggleVisibility}
                      className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-all duration-200 text-sm font-medium"
                    >
                      Quick Toggle: {visibility === 'public' ? 'Make Unlisted' : 'Make Public'}
                    </button>
                    
                    <button
                      onClick={() => onSave()}
                      disabled={saving}
                      className={cn(
                        'px-6 py-2.5 rounded-full font-medium transition-all duration-200 shadow-md hover:shadow-lg',
                        saving
                          ? 'bg-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-emerald-600 to-emerald-700 text-white hover:from-emerald-700 hover:to-emerald-800'
                      )}
                    >
                      {saving ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Saving...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Save Changes
                        </span>
                      )}
                    </button>
                  </div>
                )}

                {!canEdit && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800 flex items-start gap-2">
                      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      You don&apos;t have permission to edit this app. Only the owner can make changes.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* PIN Settings */}
            {canEdit && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6 mb-8">
                <h2 className="text-lg font-bold text-gray-900 mb-4">PIN Settings</h2>

                <div className="mb-4 flex items-end gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Access mode
                    </label>
                    <select
                      value={accessMode}
                      onChange={(e) => setAccessMode(e.target.value as AccessMode)}
                      className="border rounded px-2 py-1"
                    >
                      <option value="public">public</option>
                      <option value="pin">pin</option>
                      <option value="invite">invite</option>
                      <option value="private">private</option>
                    </select>
                  </div>
                  <button
                    onClick={() => onSave({ accessMode })}
                    disabled={saving}
                    className="px-4 py-2 rounded bg-emerald-600 text-white text-sm mt-5"
                  >
                    Save
                  </button>
                </div>

                {accessMode === 'pin' && (
                  <div className="mb-4 flex items-end gap-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
                      <input
                        type="text"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        className="w-32 border rounded px-2 py-1"
                      />
                    </div>
                    <button
                      onClick={() => onSave({ pin })}
                      disabled={saving}
                      className="px-4 py-2 rounded bg-emerald-600 text-white text-sm mt-5"
                    >
                      Set
                    </button>
                    <button
                      onClick={() => onSave({ pin: null })}
                      disabled={saving}
                      className="px-4 py-2 rounded bg-gray-200 text-sm mt-5"
                    >
                      Clear
                    </button>
                  </div>
                )}

                <div className="mb-4 flex items-end gap-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Max concurrent PINs
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={maxPins}
                      onChange={(e) => setMaxPins(parseInt(e.target.value) || 0)}
                      className="w-32 border rounded px-2 py-1"
                    />
                  </div>
                  <button
                    onClick={() => onSave({ maxConcurrentPins: maxPins })}
                    disabled={saving}
                    className="px-4 py-2 rounded bg-emerald-600 text-white text-sm mt-5"
                  >
                    Save
                  </button>
                  <button
                    onClick={rotatePin}
                    disabled={rotatingPin}
                    className="px-4 py-2 rounded bg-blue-600 text-white text-sm mt-5"
                  >
                    {rotatingPin ? 'Rotatingâ€¦' : 'Rotate PIN'}
                  </button>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">Active PIN sessions</h3>
                    <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                      {sessions.length}
                    </span>
                    <button
                      onClick={loadSessions}
                      disabled={refreshingSessions}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      {refreshingSessions ? 'Refreshingâ€¦' : 'Refresh'}
                    </button>
                    {lastSessionsRefresh && (
                      <span className="text-xs text-gray-500 ml-auto">
                        Updated {new Date(lastSessionsRefresh).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-1 pr-2">Anon ID</th>
                        <th className="py-1 pr-2">IP</th>
                        <th className="py-1 pr-2">Created</th>
                        <th className="py-1 pr-2">Last seen</th>
                        <th className="py-1 pr-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-2 text-center text-gray-500">
                            No active sessions
                          </td>
                        </tr>
                      )}
                      {sessions.map((s) => (
                        <tr key={s.sessionId} className="border-b">
                          <td className="py-1 pr-2">{s.anonId || '-'}</td>
                          <td className="py-1 pr-2">{s.ipHash?.slice(0, 8)}</td>
                          <td className="py-1 pr-2">{new Date(s.createdAt).toLocaleTimeString()}</td>
                          <td className="py-1 pr-2">{new Date(s.lastSeenAt).toLocaleTimeString()}</td>
                          <td className="py-1 pr-2 text-right">
                            <button
                              onClick={() => revokeSession(s.sessionId)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          {/* Danger Zone */}
          {canEdit && (
            <div className="bg-white rounded-2xl border border-red-200 shadow-lg p-6">
                <h2 className="text-lg font-bold text-red-900 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Danger Zone
                </h2>
                
                <div className="space-y-4">
                  <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                    <h3 className="font-medium text-red-900 mb-1">Remove from Marketplace</h3>
                    <p className="text-sm text-red-700 mb-3">
                      This will hide your app from the marketplace but keep the play URL active.
                    </p>
                    <button
                      onClick={() => setShowSoftDialog(true)}
                      disabled={deleting}
                      className="px-4 py-2 rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-50 transition-all duration-200 font-medium"
                    >
                      Remove from Marketplace
                    </button>
                  </div>

                  <div className="p-4 bg-red-50 rounded-lg border border-red-300">
                    <h3 className="font-medium text-red-900 mb-1">Delete App Permanently</h3>
                    <p className="text-sm text-red-700 mb-3">
                      <strong>This action cannot be undone.</strong> This will permanently delete your app and all associated files.
                    </p>
                    <button
                      onClick={() => setShowHardDialog(true)}
                      disabled={deleting}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all duration-200 font-medium"
                    >
                      Delete Permanently
                    </button>
                  </div>
                </div>
              </div>
            )}

          {/* Viewer-only details (non-creators) moved below */}
          </div>
          )}
          {/* Details for viewers (outside canEdit block) */}
          {!canEdit && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-2">{tApp('about')}</h2>
                {item.description ? (
                  <p className="text-gray-700 whitespace-pre-wrap break-words">{item.description}</p>
                ) : (
                  <p className="text-gray-500 italic">{tApp('noDescription')}</p>
                )}
                {typeof item.price === 'number' && item.price > 0 && (
                  <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1z" opacity=".1"/><path d="M12 6a1 1 0 011 1v1.1c1.69.21 3 1.65 3 3.4a1 1 0 11-2 0 1.5 1.5 0 10-1.5-1.5H11a1 1 0 110-2h1V7a1 1 0 011-1zm-2 8a1 1 0 100 2h4a1 1 0 100-2h-4z"/></svg>
                    Price: €{Number(item.price).toFixed(2)}
                  </div>
                )}
              </div>
              {item.author && (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Creator</h3>
                  <div className="flex items-center gap-3">
                    {item.author.photo && (
                      <Avatar uid={item.author.uid} src={item.author.photo} name={item.author.name} size={36} />
                    )}
                    <div className="flex flex-col">
                      {authorHandle ? (
                        <Link href={`/u/${authorHandle}`} className="font-medium text-gray-900 hover:underline">
                          @{authorHandle}
                        </Link>
                      ) : (
                        <span className="font-medium text-gray-900">{item.author.name || 'Anonymous'}</span>
                      )}
                      {item.createdAt && (
                        <span className="text-xs text-gray-500">Published {relativeCreated || ''}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Dialogs */}
      <ConfirmDialog
        open={showLoginPrompt}
        title="Sign in required"
        message="To play this app, please sign in or create an account."
        confirmLabel="Go to Login"
        confirmTone="default"
        onConfirm={() => router.push(`/login?next=${encodeURIComponent(slug ? `/app?slug=${encodeURIComponent(slug)}` : '/app')}`)}
        onClose={() => setShowLoginPrompt(false)}
      />
      <ConfirmDialog
        open={showSoftDialog}
        title="Remove from Marketplace?"
        message={
          <div>
            This will remove <span className="font-semibold">{item.title}</span> from the marketplace listings.
            <br />
            <br />
            The play URL will remain active and accessible to anyone with the link.
          </div>
        }
        confirmLabel="Remove from Marketplace"
        confirmTone="default"
        onConfirm={() => performDelete(false)}
        onClose={() => setShowSoftDialog(false)}
      />

      <ConfirmDialog
        open={showHardDialog}
        title="Permanently Delete App?"
        message={
          <div className="space-y-3">
            <p className="text-red-700 font-medium">
              ⚠️ This action cannot be undone!
            </p>
            <p>
              You are about to permanently delete <span className="font-semibold">{item.title}</span>.
            </p>
            <p>This will remove:</p>
            <ul className="list-disc pl-5 text-sm space-y-1">
              <li>The marketplace listing</li>
              <li>All hosted files and bundles</li>
              <li>The play URL and all access to the app</li>
            </ul>
          </div>
        }
        confirmLabel={deleting ? 'Deletingâ€¦' : 'Delete Permanently'}
        confirmTone="danger"
        requireText="DELETE"
        onConfirm={() => performDelete(true)}
        onClose={() => setShowHardDialog(false)}
      />

      {/* Report Issue Modal */}
      <ReportIssueModal
        open={showReport}
        onClose={() => !reportBusy && setShowReport(false)}
        onSubmit={submitReport}
        busy={reportBusy}
        value={reportText}
        setValue={setReportText}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {showPayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm text-center shadow-lg">
            <p className="text-gray-600 mb-4">This app is paid. Please purchase to unlock.</p>
            <div className="flex justify-center gap-4">
              <button disabled className="px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed">
                Purchase
              </button>
              <button onClick={() => setShowPayModal(false)} className="px-4 py-2 border rounded-lg">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add CSS animations */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from { 
            opacity: 0;
            transform: translateY(20px);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slideInRight {
          from { 
            opacity: 0;
            transform: translateX(100px);
          }
          to { 
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        
        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }
        
        .animate-slideInRight {
          animation: slideInRight 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}

// Simple modal for reporting issues
function ReportIssueModal({
  open,
  onClose,
  onSubmit,
  busy,
  value,
  setValue,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  value: string;
  setValue: (v: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-xl p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Prijavi poteškoće s mojom aplikacijom</h3>
        <p className="text-sm text-gray-600 mb-4">
          Ako aplikacija ne radi ili ne radi očekivano, možete nam prijaviti problem putem ovog obrasca. Mi ćemo ručno provjeriti aplikaciju i javiti vam kad otklonimo kvar.
        </p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full border rounded-lg p-3 h-32"
          placeholder="Ukratko opišite problem (koraci do greške, očekivano ponašanje, poruke o greški)"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">Zatvori</button>
          <button
            onClick={onSubmit}
            disabled={busy || value.trim().length < 10}
            className={cn(
              'px-4 py-2 rounded-lg text-white',
              busy || value.trim().length < 10
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700'
            )}
          >
            {busy ? 'Slanje…' : 'Pošalji prijavu'}
          </button>
        </div>
      </div>
    </div>
  );
}
