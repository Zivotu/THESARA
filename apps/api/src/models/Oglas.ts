export interface Oglas {
  id: number;
  title: string;
  lokacija: string;
  cijena: number;
  kategorija: string;
  slike: string[];
  opis: string;
  state: 'draft' | 'published' | 'inactive';
  ownerUid: string;
  moderation?: {
    by?: string;
    reasons?: string[];
    at?: number;
  };
  reports?: { by: string; reason?: string; at: number }[];
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
}
