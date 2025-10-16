import 'dotenv/config';
import nodemailer from 'nodemailer';
import { getConfig } from './config.js';
import { db } from './db.js';

// prvo probaj iz configa (ako postoji), a zatim fallback na .env varijable
const cfg = (() => {
  try {
    return getConfig();
  } catch {
    return { ADMIN_NOTIFIER: {} as any };
  }
})();

const fromCfg = cfg.ADMIN_NOTIFIER || {};
const SMTP_HOST = process.env.SMTP_HOST || fromCfg.smtpHost;
const SMTP_PORT = Number(process.env.SMTP_PORT || fromCfg.smtpPort);
const SMTP_USER = process.env.SMTP_USER || fromCfg.smtpUser;
const SMTP_PASS = process.env.SMTP_PASS || fromCfg.smtpPass;
const EMAIL_FROM = process.env.ADMIN_EMAIL_FROM || fromCfg.emailFrom;
const ADMIN_EMAIL_TO = process.env.ADMIN_EMAIL_TO || 'info@neurobiz.me';

// pomoÄ‡na funkcija da vidimo Å¡to fali (bez da ispisujemo tajne)
function missingFields() {
  const miss: string[] = [];
  if (!SMTP_HOST) miss.push('SMTP_HOST');
  if (!SMTP_PORT) miss.push('SMTP_PORT');
  if (!SMTP_USER) miss.push('SMTP_USER');
  if (!SMTP_PASS) miss.push('SMTP_PASS');
  if (!EMAIL_FROM) miss.push('ADMIN_EMAIL_FROM');
  if (!ADMIN_EMAIL_TO) miss.push('ADMIN_EMAIL_TO');
  return miss;
}

export async function notifyAdmins(subject: string, body: string): Promise<void> {
  const miss = missingFields();
  if (miss.length) {
    console.warn({ subject, missing: miss }, 'admin_notifier_not_configured');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: ADMIN_EMAIL_TO,
    subject,
    text: body,
  });
}

export async function notifyUser(uid: string, subject: string, body: string): Promise<void> {
  const miss = missingFields();
  if (miss.length) {
    console.warn({ subject, missing: miss }, 'user_notifier_not_configured');
    return;
  }
  try {
    const snap = await db.collection('users').doc(uid).get();
    const email = (snap.data() as any)?.email;
    if (!email) return;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({ from: EMAIL_FROM, to: email, subject, text: body });
  } catch (err) {
    console.error(err, 'notify_user_failed');
  }
}

// Generic helper to send an email to an arbitrary address
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const miss = missingFields();
  if (miss.length) {
    console.warn({ subject, missing: miss }, 'generic_mail_not_configured');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({ from: EMAIL_FROM, to, subject, text: body });
}
