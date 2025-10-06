import type { Oglas } from './models/Oglas.js';
import { readOglasi } from './db.js';

export async function filterOglasi(params: {
  lokacija?: string;
  cijenaMin?: number;
  cijenaMax?: number;
  kategorija?: string;
  ownerUid?: string;
  requestUid?: string;
}): Promise<Oglas[]> {
  const oglasi = await readOglasi();
  return oglasi.filter((o) => {
    if (params.ownerUid) {
      if (o.ownerUid !== params.ownerUid) return false;
      if (params.requestUid !== params.ownerUid && o.state !== 'published') return false;
    } else if (o.state !== 'published') {
      return false;
    }
    if (
      params.lokacija &&
      (typeof o.lokacija !== 'string' || o.lokacija.toLowerCase() !== params.lokacija.toLowerCase())
    )
      return false;
    if (
      params.kategorija &&
      (typeof o.kategorija !== 'string' || o.kategorija.toLowerCase() !== params.kategorija.toLowerCase())
    )
      return false;
    if (params.cijenaMin !== undefined && o.cijena < params.cijenaMin) return false;
    if (params.cijenaMax !== undefined && o.cijena > params.cijenaMax) return false;
    return true;
  });
}
