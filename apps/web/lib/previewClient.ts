import { API_URL } from './config';

import { auth } from './firebase';

export class PreviewUploadError extends Error {

  status: number;

  code?: string;

  constructor(status: number, message: string, code?: string) {

    super(message);

    this.status = status;

    this.code = code;

  }

}

const buildPreviewUrl = (slug: string) => `${API_URL}/listing/${encodeURIComponent(slug)}/preview`;

async function buildAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {

  const headers: Record<string, string> = { Accept: 'application/json' };

  try {

    const token = await auth?.currentUser?.getIdToken(forceRefresh);

    if (token) headers['Authorization'] = `Bearer ${token}`;

  } catch {

    // ignore; API will respond with 401 which callers can handle

  }

  return headers;

}

export async function uploadPreviewFile(slug: string, file: File) {
  if (file.size > MAX_PREVIEW_SIZE_BYTES) {
    const maxMb = Math.round((MAX_PREVIEW_SIZE_BYTES / (1024 * 1024)) * 10) / 10;
    throw new PreviewUploadError(
      400,
      `Preview image must be ${maxMb}MB or smaller`,
      'preview_too_large'
    );
  }

  const headers = await buildAuthHeaders();

  const form = new FormData();

  form.append('image', file, file.name || 'preview.png');

  const res = await fetch(buildPreviewUrl(slug), {

    method: 'POST',

    credentials: 'include',

    headers,

    body: form,

  });

  let json: any = null;

  try {

    json = await res.clone().json();

  } catch {

    // ignore — not every response is JSON

  }

  if (!res.ok) {

    const message = json?.message || `Failed to upload preview (${res.status})`;

    throw new PreviewUploadError(res.status, message, json?.error);

  }

  return json ?? (await res.json().catch(() => ({})));

}

const ensureLeadingSlash = (value: string) => (value.startsWith('/') ? value : `/${value}`);

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {

  return await new Promise((resolve, reject) => {

    const url = URL.createObjectURL(blob);

    const img = new Image();

    img.decoding = 'async';

    img.onload = () => {

      URL.revokeObjectURL(url);

      resolve(img);

    };

    img.onerror = () => {

      URL.revokeObjectURL(url);

      reject(new Error('preset_image_load_failed'));

    };

    img.src = url;

  });

}

async function renderOverlay(blob: Blob, text: string): Promise<Blob> {
  const trimmed = text.trim();
  if (!trimmed) return blob;

  const img = await loadImageFromBlob(blob);
  const width = img.naturalWidth || img.width || 1280;
  const height = img.naturalHeight || img.height || 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('preset_canvas_unavailable');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const padding = Math.max(Math.round(height * 0.05), 24);
  const maxWidth = width - padding * 2;
  let fontSize = Math.max(Math.round(height * 0.085), 28);
  const fontFamily = "'Inter', 'Segoe UI', Arial, sans-serif";
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  while (ctx.measureText(trimmed).width > maxWidth && fontSize > 18) {
    fontSize -= 2;
    ctx.font = `700 ${fontSize}px ${fontFamily}`;
  }

  const overlayHeight = fontSize + Math.round(padding * 0.8);
  const blockHeight = overlayHeight + Math.round(padding * 0.4);
  const blockTop = Math.max(height - blockHeight, 0);
  const blockCenterY = blockTop + blockHeight / 2;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  ctx.fillRect(0, blockTop, width, blockHeight);

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  ctx.fillText(trimmed, width / 2, blockCenterY);

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('preset_overlay_to_blob_failed'));
        }
      },
      'image/png'
    );
  });
}

async function preparePresetFile(presetPath: string, overlayText?: string): Promise<File> {
  const normalized = ensureLeadingSlash(presetPath);
  const presetUrl = normalized;
  const res = await fetch(presetUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new PreviewUploadError(res.status, 'Preset image is not available', 'preset_missing');
  }
  const blob = await res.blob();
  let processedBlob: Blob = blob;
  const trimmedOverlay = overlayText?.trim();
  if (trimmedOverlay) {
    try {
      processedBlob = await renderOverlay(blob, trimmedOverlay);
    } catch (err) {
      console.warn('preset-overlay-failed', err);
      processedBlob = blob;
    }
  }
  const name = normalized.split('/').pop() || 'preset.png';
  const mimeType =
    processedBlob.type && processedBlob.type !== 'application/octet-stream'
      ? processedBlob.type
      : 'image/png';
  return new File([processedBlob], name, { type: mimeType });
}

async function applyPresetPreviewPath(slug: string, presetPath: string) {
  const headers = await buildAuthHeaders();
  headers['Content-Type'] = 'application/json';
  const res = await fetch(buildPreviewUrl(slug), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ path: presetPath }),
  });
  if (!res.ok) {
    let message = `Failed to apply preset preview (${res.status})`;
    try {
      const j = await res.clone().json();
      message = j?.message || message;
    } catch {}
    throw new PreviewUploadError(res.status, message);
  }
  return res.json().catch(() => ({}));
}

export async function uploadPresetPreview(slug: string, presetPath: string, opts: { overlayText?: string } = {}) {
  const trimmed = (opts.overlayText || '').trim();
  if (!trimmed) {
    // No overlay requested: avoid duplicating assets by referencing preset path directly
    return applyPresetPreviewPath(slug, ensureLeadingSlash(presetPath));
  }
  const file = await preparePresetFile(presetPath, trimmed);
  return uploadPreviewFile(slug, file);
}

export async function createPresetPreviewFile(presetPath: string, opts: { overlayText?: string } = {}) {
  return preparePresetFile(presetPath, opts.overlayText);
}

export const PREVIEW_PRESET_PATHS = [

  '/preview-presets/thesara_screenshot_1.png',

  '/preview-presets/thesara_screenshot_2.png',

  '/preview-presets/thesara_screenshot_3.png',

  '/preview-presets/thesara_screenshot_4.png',

  '/preview-presets/thesara_screenshot_5.png',

] as const;

export const MAX_PREVIEW_SIZE_BYTES = 1 * 1024 * 1024; // 1MB

export type PreviewPresetPath = typeof PREVIEW_PRESET_PATHS[number];

