import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { getConfig } from '../config.js';
import type { AppRecord } from '../types.js';

function looksLikeImageAsset(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^data:image\//i.test(trimmed)) return true;
  const withoutQuery = trimmed.split(/[?#]/)[0];
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(withoutQuery);
}

export function ensureListingPreview(record: AppRecord): { next: AppRecord; changed: boolean } {
  const current = (record.previewUrl || '').trim();
  const deprecated = current.startsWith('/builds/') || current.startsWith('/play/');
  if (!current || deprecated || !looksLikeImageAsset(current)) {
    if (!current) {
      return { next: record, changed: false };
    }
    const next: AppRecord = { ...record };
    delete (next as any).previewUrl;
    return { next, changed: next.previewUrl !== record.previewUrl };
  }
  return { next: record, changed: false };
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
