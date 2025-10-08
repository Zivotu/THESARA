import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { getConfig } from '../config.js';
import type { AppRecord } from '../types.js';

export const PREVIEW_PRESET_PATHS = [
  '/preview-presets/thesara_screenshot_1.png',
  '/preview-presets/thesara_screenshot_2.png',
  '/preview-presets/thesara_screenshot_3.png',
  '/preview-presets/thesara_screenshot_4.png',
  '/preview-presets/thesara_screenshot_5.png',
] as const;

function hashKey(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  // Use first 4 bytes for a stable positive integer
  return hash.readUInt32BE(0);
}

function fallbackPreviewPath(slug?: string, id?: string): string {
  const key = (slug || id || randomBytes(4).toString('hex')).toLowerCase();
  const idx = hashKey(key) % PREVIEW_PRESET_PATHS.length;
  return PREVIEW_PRESET_PATHS[idx];
}

export function ensureListingPreview(record: AppRecord): { next: AppRecord; changed: boolean } {
  const current = (record.previewUrl || '').trim();
  const deprecated = current.startsWith('/builds/') || current.startsWith('/play/');
  if (current && !deprecated) {
    return { next: record, changed: false };
  }
  const next: AppRecord = {
    ...record,
    previewUrl: fallbackPreviewPath(record.slug, record.id),
  };
  return { next, changed: true };
}

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || randomBytes(4).toString('hex');
}

export async function removeExistingPreviewFile(prevUrl: string | null | undefined): Promise<void> {
  if (!prevUrl) return;
  if (!prevUrl.startsWith('/uploads/')) return;
  try {
    const cfg = getConfig();
    const rel = prevUrl.replace(/^\/+/, '');
    const abs = path.join(cfg.LOCAL_STORAGE_DIR, rel.replace(/^uploads\//, ''));
    await fs.unlink(abs);
  } catch {
    // Ignore cleanup failures
  }
}

export async function saveListingPreviewFile(options: {
  listingId: string;
  slug?: string;
  buffer: Buffer;
  mimeType?: string;
  previousUrl?: string | null;
}): Promise<string> {
  const { listingId, slug, buffer, mimeType, previousUrl } = options;
  const safeSegment = sanitizeSegment(listingId || slug || randomBytes(4).toString('hex'));
  const cfg = getConfig();
  const ext =
    mimeType && /^image\/jpe?g/i.test(mimeType)
      ? '.jpg'
      : mimeType && /^image\/png/i.test(mimeType)
      ? '.png'
      : '.png';
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  const dir = path.join(cfg.LOCAL_STORAGE_DIR, 'listings', safeSegment);
  await fs.mkdir(dir, { recursive: true });
  const abs = path.join(dir, filename);
  await fs.writeFile(abs, buffer);
  // Remove the previous preview if it pointed to uploads/
  await removeExistingPreviewFile(previousUrl);
  return `/uploads/listings/${safeSegment}/${filename}`;
}
