import { z } from 'zod';

export const AccessModeSchema = z.enum(['public', 'pin', 'invite', 'private']);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export interface Author {
  uid?: string;
  name?: string;
  handle?: string;
  photo?: string;
}

export interface AppCapabilities {
  permissions?: {
    camera?: boolean;
    microphone?: boolean;
    webgl?: boolean;
    fileDownload?: boolean;
    [key: string]: any;
  };
  network?: {
    access?: 'no-net' | 'media-only' | 'proxy-net' | 'open-net' | 'reviewed-open-net';
    mediaDomains?: string[];
    domains?: string[];
    [key: string]: any;
  };
  storage?: {
    enabled?: boolean;
    rooms?: boolean;
    [key: string]: any;
  };
  features?: string[];
  [key: string]: any;
}

export interface AppRecord {
  id: string;
  slug: string;
  buildId?: string;
  pendingBuildId?: string;
  pendingVersion?: number;
  title: string;
  description: string;
  tags: string[];
  visibility: 'public' | 'unlisted';
  accessMode: AccessMode;
  author?: Author;
  allowlist?: string[];
  capabilities?: AppCapabilities;
  createdAt: number;
  updatedAt?: number;
  publishedAt?: number;
  playUrl: string;
  previewUrl?: string | null;
  likesCount?: number;
  playsCount?: number;
  // Localized fields stored per locale: { [locale]: { title, description } }
  translations?: Record<string, { title?: string; description?: string }>;
  status?: 'draft' | 'published' | 'pending-review' | 'rejected';
  state?: 'draft' | 'active' | 'inactive' | 'quarantined';
  moderation?: { by?: string; reasons?: string[]; status?: string; at?: number; notes?: string };
  reports?: { by: string; reason?: string; at: number }[];
  appeals?: { by: string; reason?: string; at: number }[];
  domainsSeen?: string[];
  version?: number;
  archivedVersions?: ArchivedVersion[];
  [key: string]: any;
}

export interface ArchivedVersion {
  buildId: string;
  version: number;
  archivedAt: number;
}
