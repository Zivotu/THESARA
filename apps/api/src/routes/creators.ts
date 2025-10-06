import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getCreatorByHandle, upsertCreator, readApps, type App, type Creator } from '../db.js';
import { ensureCreatorAllAccessProductPrice } from '../billing/products.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { getCreatorSubscriptionMetrics, getConnectStatus } from '../billing/service.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';

export default async function creatorsRoutes(app: FastifyInstance) {
  // Return handle for a user by UID
  app.get(
    '/creators/id/:uid',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { uid } = req.params as { uid: string };
      const db = getFirestore();
      const userRef = db.collection('users').doc(uid);
      const snap = await userRef.get();
      if (!snap.exists) return reply.code(404).send({ error: 'not_found' });
      let { handle, displayName, email } = (snap.data() as any) || {};

      // If no handle, auto‑provision from displayName/email/uid
      if (!handle) {
        const baseFromName = (displayName || '')
          .toString()
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^a-z0-9 _-]+/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^[-_]+|[-_]+$/g, '');
        const baseFromEmail = (email || '')
          .toString()
          .toLowerCase()
          .split('@')[0]
          .replace(/[^a-z0-9_-]+/g, '')
          .slice(0, 20);
        let base = baseFromName || baseFromEmail || `user-${uid.slice(0, 6)}`;
        if (base.length < 3) base = `${base}-${uid.slice(0, 3)}`;
        base = base.replace(/[^a-z0-9_-]/g, '');
        if (base.length < 3) base = `u${uid.slice(0, 5)}`;

        // Ensure uniqueness across creators and users
        let candidate = base;
        let tries = 0;
        const maxTries = 50;
        async function exists(h: string): Promise<boolean> {
          const [cSnap, uSnap] = await Promise.all([
            db.collection('creators').where('handle', '==', h).limit(1).get(),
            db.collection('users').where('handle', '==', h).limit(1).get(),
          ]);
          const takenByOther =
            (!cSnap.empty && cSnap.docs[0].id !== uid) ||
            (!uSnap.empty && uSnap.docs[0].id !== uid);
          return takenByOther;
        }
        while (tries < maxTries && (await exists(candidate))) {
          tries += 1;
          const suffix = (Math.floor(Math.random() * 900) + 100).toString();
          candidate = `${base}-${suffix}`.slice(0, 30);
        }
        handle = candidate;
        try {
          await userRef.set({ handle }, { merge: true });
          await upsertCreator({ id: uid, handle } as any);
        } catch (e) {
          req.log.error({ e }, 'auto_handle_set_failed');
        }
      }
      return { handle };
    },
  );

  // Claim or change handle for current user
  app.patch(
    '/creators/me/handle',
    { preHandler: requireRole(['user', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const schema = z.object({ handle: z.string().regex(/^[a-z0-9_-]{3,}$/) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
      const uid = req.authUser!.uid;
      const newHandle = parsed.data.handle;
      const db = getFirestore();
      try {
        // Check creators collection
        const creatorsSnap = await db.collection('creators').where('handle', '==', newHandle).limit(1).get();
        if (!creatorsSnap.empty) {
          const ownerId = creatorsSnap.docs[0].id;
          if (ownerId !== uid) return reply.code(409).send({ ok: false, error: 'handle_taken' });
        }
        // Check users collection
        const usersSnap = await db.collection('users').where('handle', '==', newHandle).limit(1).get();
        if (!usersSnap.empty) {
          const ownerId = usersSnap.docs[0].id;
          if (ownerId !== uid) return reply.code(409).send({ ok: false, error: 'handle_taken' });
        }
        // Update users/{uid}
        await db.collection('users').doc(uid).set({ handle: newHandle }, { merge: true });
        // Upsert creator record
        await upsertCreator({ id: uid, handle: newHandle } as any);
        return reply.send({ ok: true, handle: newHandle });
      } catch (e) {
        req.log.error({ e }, 'handle_update_failed');
        return reply.code(500).send({ ok: false, error: 'handle_update_failed' });
      }
    },
  );

  // Return creator information with additional profile data
  app.get(
    '/creators/:handle',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { handle } = req.params as { handle: string };
      let creator = await getCreatorByHandle(handle);
      // Fallback: infer creator from existing apps if user/creators record is missing
      if (!creator) {
        try {
          const apps = await readApps();
          const fromApp = apps.find(
            (a: App) => (a.author?.handle && a.author.handle === handle),
          );
          if (fromApp?.author?.uid) {
            // Attempt to enrich from users collection
            try {
              const snap = await getFirestore().collection('users').doc(fromApp.author.uid).get();
              const data: any = snap.exists ? snap.data() : {};
              creator = {
                id: fromApp.author.uid,
                handle,
                displayName: data?.displayName,
                photoURL: data?.photoURL,
                allAccessPrice: typeof data?.allAccessPrice === 'number' ? data.allAccessPrice : undefined,
              } as any;
            } catch {
              creator = { id: fromApp.author.uid, handle } as any;
            }
          }
        } catch {}
      }
      if (!creator) return reply.code(404).send({ error: 'not_found' });

      let { displayName, photoURL, allAccessPrice } = creator as any;

      if (
        displayName === undefined ||
        photoURL === undefined ||
        typeof allAccessPrice !== 'number'
      ) {
        try {
          const snap = await getFirestore().collection('users').doc(creator.id).get();
          if (snap.exists) {
            const data = snap.data() as any;
            displayName ??= data?.displayName;
            photoURL ??= data?.photoURL;
            if (
              typeof allAccessPrice !== 'number' &&
              typeof data?.allAccessPrice === 'number'
            ) {
              allAccessPrice = data.allAccessPrice;
            }
          }
        } catch {}
      }

      return {
        ...creator,
        displayName,
        photoURL,
        allAccessPrice,
      };
    },
  );

  // Return public apps for a creator
  app.get(
    '/creators/:handle/apps',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { handle } = req.params as { handle: string };
      let creator = await getCreatorByHandle(handle);

      const apps = await readApps();
      // If creator not found, still allow listing by handle based on app data
      const items = apps.filter((a: App) => {
        const byHandle = a.author?.handle && a.author.handle === handle;
        const byUid = creator ? (!a.author?.handle && a.author?.uid === creator.id) : false;
        const isPublic = a.status === 'published' || (a as any).state === 'active';
        return (byHandle || byUid) && isPublic;
      });

      // If we still have no creator but apps exist, synthesize minimal creator payload for clients that may request it
      if (!creator && items.length > 0) {
        try {
          const uid = items[0]?.author?.uid;
          if (uid) {
            const snap = await getFirestore().collection('users').doc(uid).get();
            const data: any = snap.exists ? snap.data() : {};
            creator = { id: uid, handle, displayName: data?.displayName, photoURL: data?.photoURL } as any;
          }
        } catch {}
      }

      return { items };
    },
  );

  // Update creator settings (owner or admin)
  app.patch(
    '/creators/:handle',
    { preHandler: requireRole(['user', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { handle } = req.params as { handle: string };
      // Validate input
      const schema = z.object({
        displayName: z.string().min(1).max(100).optional(),
        photoURL: z.string().url().optional(),
        visibility: z.enum(['public', 'unlisted']).optional(),
        accessMode: z.string().optional(),
        allAccessPrice: z.number().min(0).max(10000).optional(),
        ads: z.boolean().optional(),
        // Accept pin as string or null; store raw for now (feature placeholder)
        pin: z.string().min(4).max(32).or(z.null()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });

      const existing = await getCreatorByHandle(handle);
      if (!existing) return reply.code(404).send({ ok: false, error: 'not_found' });

      const uid = req.authUser?.uid;
      const isAdmin = req.authUser?.role === 'admin' || (req.authUser as any)?.claims?.admin === true;
      if (!isAdmin && uid !== existing.id) {
        return reply.code(403).send({ ok: false, error: 'forbidden' });
      }

      const data = parsed.data;
      const next: Creator = { ...existing } as any;
      if (data.displayName !== undefined) (next as any).displayName = data.displayName;
      if (data.photoURL !== undefined) (next as any).photoURL = data.photoURL;
      if (data.visibility !== undefined) (next as any).visibility = data.visibility;
      if (data.accessMode !== undefined) (next as any).accessMode = data.accessMode;
      if (data.ads !== undefined) (next as any).ads = data.ads;
      if (data.pin !== undefined) (next as any).pin = data.pin;
      if (typeof data.allAccessPrice === 'number') {
        const prev = (next as any).allAccessPrice;
        (next as any).allAccessPrice = data.allAccessPrice;
        if (prev !== data.allAccessPrice) {
          (next as any).allAccessPriceUpdatedAt = Date.now();
        }
      }
      if (typeof (next as any).allAccessPrice === 'number' && (next as any).allAccessPrice > 0) {
        const status = await getConnectStatus(existing.id);
        if (!status.payouts_enabled || (status.requirements_due ?? 0) > 0) {
          req.log.warn({ creatorId: existing.id }, 'creator_not_onboarded');
          return reply
            .code(403)
            .send({ code: 'creator_not_onboarded', message: 'Finish Stripe onboarding to set prices.' });
        }
      }
      // Persist first, then ensure Stripe Product/Price if price provided
      await upsertCreator(next);
      if (typeof data.allAccessPrice === 'number' && data.allAccessPrice > 0) {
        try {
          await ensureCreatorAllAccessProductPrice(next);
        } catch (e) {
          req.log.error({ e }, 'ensure_creator_all_access_price_failed');
          // Non-fatal: client can retry later; keep creator update
        }
      }
      return reply.send({ ok: true, creator: next });
    },
  );

  // Metrics (owner or admin)
  app.get(
    '/creators/:handle/metrics',
    { preHandler: requireRole(['user', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { handle } = req.params as { handle: string };
      const creator = await getCreatorByHandle(handle);
      if (!creator) return reply.code(404).send({ ok: false, error: 'not_found' });
      const uid = req.authUser?.uid;
      const isAdmin = req.authUser?.role === 'admin' || (req.authUser as any)?.claims?.admin === true;
      if (!isAdmin && uid !== creator.id) {
        return reply.code(403).send({ ok: false, error: 'forbidden' });
      }
      try {
        const metrics = await getCreatorSubscriptionMetrics(creator.id);
        return reply.send({ ok: true, metrics });
      } catch (e) {
        req.log.error({ e }, 'creator_metrics_failed');
        return reply.code(500).send({ ok: false, error: 'metrics_failed' });
      }
    },
  );
}

