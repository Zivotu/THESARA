import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getConfig } from './config.js';

function unescapePrivateKey(key?: string | null): string | undefined {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
}

export function ensureFirebaseApp(): void {
  if (getApps().length) return;

  let FIREBASE: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
    storageBucket?: string;
  } = {};

  try {
    FIREBASE = getConfig().FIREBASE;
  } catch {
    FIREBASE = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    };
  }

  const projectId = FIREBASE.projectId || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = FIREBASE.clientEmail || process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = unescapePrivateKey(FIREBASE.privateKey || process.env.FIREBASE_PRIVATE_KEY);
  const storageBucket =
    FIREBASE.storageBucket ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (projectId && clientEmail && privateKey) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
      storageBucket,
    });
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({
      credential: applicationDefault() as any,
      projectId,
      storageBucket,
    });
    return;
  }

  console.error(
    '[FIREBASE] Missing credentials: set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or GOOGLE_APPLICATION_CREDENTIALS.',
  );
  process.exit(1);
}
