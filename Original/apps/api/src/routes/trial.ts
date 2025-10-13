import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, randomInt } from 'node:crypto';
import { requireRole } from '../middleware/auth.js';
import { upsertEntitlement, readApps } from '../db.js';
import { getConfig } from '../config.js';
import { createHmac } from 'node:crypto';
import { notifyUser, sendEmail } from '../notifier.js';

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

export default async function trialRoutes(app: FastifyInstance) {
  const db = getFirestore();

  // Check current trial code status for an app/user
  app.get('/trial/status', { preHandler: requireRole(['user']) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ appId: z.string().min(1) });
    const parsed = schema.safeParse((req as any).query);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { appId } = parsed.data;
    const uid = req.authUser!.uid;
    try {
      const docId = `${appId}_${uid}`;
      const ref = db.collection('trial_codes').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return reply.send({ ok: true, exists: false });
      const data = snap.data() as any;
      return reply.send({
        ok: true,
        exists: true,
        verified: !!data.verifiedAt,
        validUntil: Number(data.validUntil || 0),
        attempts: Number(data.attempts || 0),
        createdAt: Number(data.createdAt || 0),
      });
    } catch (e) {
      app.log.error(e, 'trial_status_failed');
      return reply.code(500).send({ ok: false, error: 'trial_status_failed' });
    }
  });

  // Request a trial code for an app (one per user per app)
  app.post('/trial/request', { preHandler: requireRole(['user']) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ appId: z.string().min(1), email: z.string().email().optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { appId, email } = parsed.data;
    const uid = req.authUser!.uid;
    try {
      const docId = `${appId}_${uid}`;
      const ref = db.collection('trial_codes').doc(docId);
      const prev = await ref.get();
      if (prev.exists) {
        const d = prev.data() as any;
        if (d.verifiedAt || d.attempts >= 3) {
          return reply.code(429).send({ ok: false, error: 'trial_already_used' });
        }
      }
      const code = String(randomInt(0, 100000000)).padStart(8, '0');
      const validForMs = 24 * 60 * 60 * 1000; // 24 hours
      await ref.set({
        userId: uid,
        appId,
        email: email || null,
        codeHash: hashCode(code),
        createdAt: Date.now(),
        validUntil: Date.now() + validForMs,
        attempts: 0,
      });
      const subject = 'Your THESARA trial code';
      const body = `Your trial code is: ${code}\n\nIt expires in 24 hours.\nApp: ${appId}`;
      try {
        if (email) {
          await sendEmail(email, subject, body);
        } else {
          await notifyUser(uid, subject, body);
        }
        app.log.info({ to: email || '(user email on file)', code, appId, uid }, 'trial_code_sent');
      } catch (mailErr) {
        app.log.error(mailErr, 'trial_code_email_failed');
      }
      return reply.send({ ok: true });
    } catch (e) {
      app.log.error(e, 'trial_request_failed');
      return reply.code(500).send({ ok: false, error: 'trial_request_failed' });
    }
  });

  // Verify a trial code and grant 24h entitlement
  app.post('/trial/verify', { preHandler: requireRole(['user']) }, async (req: FastifyRequest, reply: FastifyReply) => {
    const schema = z.object({ appId: z.string().min(1), code: z.string().min(6).max(12) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { appId, code } = parsed.data;
    const uid = req.authUser!.uid;
    try {
      const docId = `${appId}_${uid}`;
      const ref = db.collection('trial_codes').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return reply.code(404).send({ ok: false, error: 'code_not_found' });
      const data = snap.data() as any;
      if (data.verifiedAt) return reply.code(429).send({ ok: false, error: 'already_verified' });
      if (Date.now() > Number(data.validUntil || 0)) return reply.code(400).send({ ok: false, error: 'code_expired' });
      const expected = String(data.codeHash || '');
      // Normalize user input: trim, and if only digits with <8 length, pad leading zeros
      let input = code.trim();
      if (/^\d{1,8}$/.test(input) && input.length < 8) input = input.padStart(8, '0');
      const hash = hashCode(input);
      if (hash !== expected) {
        await ref.set({ attempts: Number(data.attempts || 0) + 1 }, { merge: true });
        return reply.code(400).send({ ok: false, error: 'bad_code' });
      }
      const trialMs = 24 * 60 * 60 * 1000;
      const expiresAt = Date.now() + trialMs;
      // Resolve numeric appId so entitlement matches public route checks
      let numericAppId: number | undefined;
      try {
        const apps = await readApps();
        const found = apps.find((a: any) => String(a.id) === appId || a.slug === appId);
        if (found?.id != null) numericAppId = Number(found.id);
      } catch {}
      await upsertEntitlement({
        id: `trial-${appId}-${uid}`,
        userId: uid,
        feature: 'app-trial' as any,
        active: true,
        data: { appId: numericAppId ?? appId, expiresAt },
      });
      await ref.set({ verifiedAt: Date.now() }, { merge: true });
      // Set a lightweight signed session cookie so /app/:slug can identify the user in iframe requests
      try {
        const cfg = getConfig();
        const payload = JSON.stringify({ uid, appId: numericAppId ?? appId, exp: Date.now() + trialMs });
        const sig = createHmac('sha256', cfg.IP_SALT).update(payload).digest('hex');
        const value = Buffer.from(`${payload}.${sig}`).toString('base64url');
        reply.setCookie('cx_trial', value, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: Math.floor(trialMs / 1000),
          secure: cfg.NODE_ENV === 'production',
        });
      } catch {}
      return reply.send({ ok: true, expiresAt });
    } catch (e) {
      app.log.error(e, 'trial_verify_failed');
      return reply.code(500).send({ ok: false, error: 'trial_verify_failed' });
    }
  });
}
