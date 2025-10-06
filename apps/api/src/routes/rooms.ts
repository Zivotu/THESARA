import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  HookHandlerDoneFunction,
} from 'fastify';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomUUID, createHash } from 'node:crypto';
import { getConfig } from '../config.js';

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

export default async function roomsRoutes(app: FastifyInstance) {
  const db = getFirestore();
  const {
    ROOMS_ENABLED,
    MAX_ROOMS_PER_APP,
    MAX_PLAYERS_PER_ROOM,
    ROOM_JOIN_MAX_PER_5MIN,
    SAFE_PUBLISH_ENABLED,
    RATE_LIMIT,
    ROOM_EVENTS_RPS_PER_ROOM,
    ROOM_EVENTS_BURST_PER_ROOM,
  } = getConfig();
  const rateLimitCollection = RATE_LIMIT.collection || 'rate_limits';

  const eventsRateLimit = new Map<string, { tokens: number; last: number }>();

  function isEventsRateLimited(roomId: string, ip: string): boolean {
    const key = `${roomId}:${ip}`;
    const now = Date.now();
    const bucket = eventsRateLimit.get(key) || {
      tokens: ROOM_EVENTS_BURST_PER_ROOM,
      last: now,
    };
    const elapsed = (now - bucket.last) / 1000;
    bucket.tokens = Math.min(
      ROOM_EVENTS_BURST_PER_ROOM,
      bucket.tokens + elapsed * ROOM_EVENTS_RPS_PER_ROOM,
    );
    bucket.last = now;
    if (bucket.tokens < 1) {
      eventsRateLimit.set(key, bucket);
      return true;
    }
    bucket.tokens -= 1;
    eventsRateLimit.set(key, bucket);
    return false;
  }

  if (!ROOMS_ENABLED) {
    app.addHook(
      'onRequest',
      (
        _req: FastifyRequest,
        reply: FastifyReply,
        done: HookHandlerDoneFunction,
      ) => {
        reply.code(404).send({ ok: false, error: 'rooms_disabled' });
        done();
      },
    );
    return;
  }

  app.post('/rooms/create', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });
    const { appId } = (req.body as any) || {};
    if (typeof appId !== 'string') return reply.code(400).send({ ok: false, error: 'invalid_app' });
    const existing = await db.collection('rooms').where('appId', '==', appId).get();
    if (existing.size >= MAX_ROOMS_PER_APP) {
      if (SAFE_PUBLISH_ENABLED) {
        await db
          .collection('telemetry')
          .doc('rooms')
          .set({ limitBreaches: FieldValue.increment(1) }, { merge: true });
      }
      return reply
        .code(400)
        .send({ ok: false, error: 'room_limit', message: `Dosegnut maksimalan broj soba (${MAX_ROOMS_PER_APP})` });
    }
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    const now = Date.now();
    const joinToken = randomUUID();
    const joinTokenHash = createHash('sha256').update(joinToken).digest('hex');
    await db.collection('rooms').doc(id).set({
      appId,
      hostId: uid,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60 * 1000,
      joinTokenHash,
      joinTokenExpiresAt: now + 30 * 60 * 1000,
    });
    if (SAFE_PUBLISH_ENABLED) {
      await db
        .collection('telemetry')
        .doc('rooms')
        .set({ activeRooms: FieldValue.increment(1) }, { merge: true });
    }
    return { ok: true, roomId: id, joinToken };
  });

  app.post('/rooms/:id/join', async (req, reply) => {
    const roomId = (req.params as any).id;
    const { name, joinToken } = (req.body as any) || {};
    if (typeof joinToken !== 'string') {
      return reply.code(401).send({ ok: false, error: 'invalid_token' });
    }
    const roomRef = db.collection('rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) return reply.code(404).send({ ok: false, error: 'not_found' });
    const room = roomSnap.data()!;
    const tokenHash = createHash('sha256').update(joinToken).digest('hex');
    if (room.joinTokenHash !== tokenHash || Date.now() > room.joinTokenExpiresAt) {
      return reply
        .code(401)
        .send({ ok: false, error: 'invalid_token', message: 'Join token je nevažeći ili je istekao.' });
    }

    const ip = req.ip || 'unknown';
    const rlKey = `roomJoin:${ip}:${room.appId}`;
    const now = Date.now();
    const rlRef = db.collection(rateLimitCollection).doc(rlKey);
    let limited = false;
    await db.runTransaction(async (t) => {
      const snap = await t.get(rlRef);
      let data = snap.exists ? (snap.data() as any) : { count: 0, resetAt: now + 5 * 60 * 1000 };
      if (now > data.resetAt) {
        data = { count: 0, resetAt: now + 5 * 60 * 1000 };
      }
      if (data.count >= ROOM_JOIN_MAX_PER_5MIN) {
        limited = true;
      } else {
        data.count++;
        t.set(rlRef, { ...data, expiresAt: new Date(data.resetAt) });
      }
    });
    if (limited) {
      if (SAFE_PUBLISH_ENABLED) {
        await db
          .collection('telemetry')
          .doc('rooms')
          .set({ limitBreaches: FieldValue.increment(1) }, { merge: true });
      }
      return reply
        .code(429)
        .send({
          ok: false,
          error: 'rate_limit',
          message: `Prekoračen maksimalan broj pridruživanja (${ROOM_JOIN_MAX_PER_5MIN}/5min).`,
        });
    }

    const uid = await getUidFromRequest(req);
    const playerId = uid || randomUUID();
    const player = {
      uid: uid || null,
      name: typeof name === 'string' ? name : '',
      score: 0,
      state: 'joined',
    };
    const playersSnap = await roomRef.collection('players').get();
    if (playersSnap.size >= MAX_PLAYERS_PER_ROOM) {
      if (SAFE_PUBLISH_ENABLED) {
        await db
          .collection('telemetry')
          .doc('rooms')
          .set({ limitBreaches: FieldValue.increment(1) }, { merge: true });
      }
      return reply
        .code(400)
        .send({
          ok: false,
          error: 'player_limit',
          message: `Dosegnut maksimalan broj igrača (${MAX_PLAYERS_PER_ROOM})`,
        });
    }
    await roomRef.collection('players').doc(playerId).set(player);
    if (SAFE_PUBLISH_ENABLED) {
      await db
        .collection('telemetry')
        .doc('rooms')
        .set({ activePlayers: FieldValue.increment(1) }, { merge: true });
    }
    return { ok: true, playerId };
  });

  app.post('/rooms/:id/close', async (req, reply) => {
    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });
    const roomId = (req.params as any).id;
    const roomRef = db.collection('rooms').doc(roomId);
    const snap = await roomRef.get();
    if (!snap.exists) return reply.code(404).send({ ok: false, error: 'not_found' });
    const data = snap.data()!;
    if (data.hostId !== uid) return reply.code(403).send({ ok: false, error: 'forbidden' });
    const playersSnap = await roomRef.collection('players').get();
    const playerCount = playersSnap.size;
    await roomRef.delete();
    if (SAFE_PUBLISH_ENABLED) {
      await db
        .collection('telemetry')
        .doc('rooms')
        .set(
          {
            activeRooms: FieldValue.increment(-1),
            activePlayers: FieldValue.increment(-playerCount),
          },
          { merge: true }
        );
    }
    return { ok: true };
  });

  app.get('/rooms/:id/players', async (req) => {
    const roomId = (req.params as any).id;
    const snap = await db.collection('rooms').doc(roomId).collection('players').get();
    const players = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    return { players };
  });

  app.patch('/rooms/:id/players/:playerId', async (req, reply) => {
    const roomId = (req.params as any).id;
    const playerId = (req.params as any).playerId;
    const uid = await getUidFromRequest(req);
    const roomSnap = await db.collection('rooms').doc(roomId).get();
    if (!roomSnap.exists) return reply.code(404).send({ ok: false, error: 'not_found' });
    const room = roomSnap.data()!;
    const headerId = req.headers['x-player-id'];
    if (uid !== room.hostId && headerId !== playerId) {
      return reply.code(403).send({ ok: false, error: 'forbidden' });
    }
    await db
      .collection('rooms')
      .doc(roomId)
      .collection('players')
      .doc(playerId)
      .set(req.body as any, { merge: true });
    return { ok: true };
  });

  app.post('/rooms/:id/events', async (req, reply) => {
    const roomId = (req.params as any).id;
    const ip = req.ip || 'unknown';
    if (isEventsRateLimited(roomId, ip)) {
      if (SAFE_PUBLISH_ENABLED) {
        await db
          .collection('telemetry')
          .doc('rooms')
          .set({ eventsThrottled: FieldValue.increment(1) }, { merge: true });
      } else {
        await db
          .collection('telemetry')
          .doc('rooms')
          .set({ eventsThrottled: FieldValue.increment(1) }, { merge: true });
      }
      return reply
        .code(429)
        .send({
          ok: false,
          error: 'rate_limit',
          message: 'Previše događaja u kratkom vremenu. Pokušaj ponovno kasnije.',
        });
    }

    const uid = await getUidFromRequest(req);
    if (!uid) return reply.code(401).send({ ok: false, error: 'unauthenticated' });
    const roomSnap = await db.collection('rooms').doc(roomId).get();
    if (!roomSnap.exists) return reply.code(404).send({ ok: false, error: 'not_found' });
    const room = roomSnap.data()!;
    if (room.hostId !== uid) return reply.code(403).send({ ok: false, error: 'forbidden' });
    const event = { ...(req.body as any), createdAt: Date.now() };
    const doc = await db.collection('rooms').doc(roomId).collection('events').add(event);
    return { ok: true, eventId: doc.id };
  });

  app.get('/rooms/:id/events', async (req) => {
    const roomId = (req.params as any).id;
    const since = Number((req.query as any).since || 0);
    let q = db.collection('rooms').doc(roomId).collection('events').orderBy('createdAt');
    if (since) q = q.where('createdAt', '>', since);
    const snap = await q.get();
    const events = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    return { events };
  });
}

