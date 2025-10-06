export type AccessMode = 'public' | 'pin' | 'invite' | 'private';

export type Listing = {
  id: string;
  slug: string;
  title: string;
  name?: string;
  description?: string;
  shortDescription?: string;
  previewUrl?: string;
  image?: string;
  logo?: string;
  thumbnail?: string;
  icon?: string;
  href?: string | null;
  link?: string | null;
  url?: string | null;
  homepage?: string | null;
  category?: string | null;
  tags?: string[];
  version?: string | null;
  ownerUid?: string | null;
  published?: boolean;
  visibility?: 'public' | 'private' | string;
  state?: 'ACTIVE' | string;
  approved?: boolean;
  createdAt?: string;
  updatedAt?: string;
  author?: {
    uid?: string;
    name?: string;
    handle?: string;
    photo?: string;
  };
};
