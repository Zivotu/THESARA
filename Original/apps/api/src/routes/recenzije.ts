import type { FastifyInstance } from 'fastify';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { Recenzija } from '../models/Recenzija.js';

async function getUidFromRequest(req: any): Promise<string | undefined> {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const decoded = await getAuth().verifyIdToken(token);
      return decoded.uid;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export default async function recenzijeRoutes(app: FastifyInstance) {
  const db = getFirestore();

  app.post('/recenzije', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });

    const { oglas, ocjena, komentar } = (req.body as any) || {};
    if (typeof oglas !== 'number' || typeof ocjena !== 'number') {
      return reply.code(400).send({ ok: false, error: 'invalid_input' });
    }

    const purchase = await db
      .collection('kupovine')
      .where('oglas', '==', oglas)
      .where('korisnik', '==', uid)
      .limit(1)
      .get();
    if (purchase.empty) {
      return reply.code(403).send({ ok: false, error: 'not_purchased' });
    }

    const rec: Recenzija = {
      oglas,
      korisnik: uid,
      ocjena,
      komentar: komentar || '',
      datum: new Date().toISOString(),
    };
    await db.collection('recenzije').add(rec);
    return { ok: true };
  });

  app.get('/recenzije/:oglasId', async (req) => {
    const oglasId = Number((req.params as any).oglasId);
    const snap = await db
      .collection('recenzije')
      .where('oglas', '==', oglasId)
      .get();
    const recenzije = snap.docs.map((d) => d.data() as Recenzija);
    const prosjek =
      recenzije.length > 0
        ? recenzije.reduce((s, r) => s + r.ocjena, 0) / recenzije.length
        : 0;

    const uid = await getUidFromRequest(req);
    let canReview = false;
    if (uid) {
      const purchase = await db
        .collection('kupovine')
        .where('oglas', '==', oglasId)
        .where('korisnik', '==', uid)
        .limit(1)
        .get();
      canReview = !purchase.empty;
    }

    return { recenzije, prosjek, canReview };
  });
}
