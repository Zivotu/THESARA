import type { AppRecord } from '../types.js';

function normalize(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function extractFromPlayUrl(playUrl?: string | null): string | undefined {
  if (!playUrl) return undefined;
  const match = /\/play\/([^/]+)(?:\/|$)/i.exec(playUrl);
  return match?.[1]?.trim() || undefined;
}

export function getBuildIdCandidates(
  record: Pick<AppRecord, 'id' | 'slug' | 'buildId' | 'pendingBuildId' | 'playUrl'>,
): string[] {
  const candidates: string[] = [];
  const push = (value?: string | null) => {
    const normalized = normalize(value);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  push(record.buildId);
  push(record.pendingBuildId);
  push(extractFromPlayUrl(record.playUrl));
  push(record.id);
  push(record.slug);

  return candidates;
}

export function resolveBuildId(
  record: Pick<AppRecord, 'id' | 'slug' | 'buildId' | 'pendingBuildId' | 'playUrl'>,
): string | undefined {
  const [first] = getBuildIdCandidates(record);
  return first;
}
