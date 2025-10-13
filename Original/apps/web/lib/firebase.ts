'use client';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getConfig } from './config';

const cfg = getConfig();

let app: ReturnType<typeof initializeApp> | undefined;

if (cfg) {
  app = getApps().length ? getApp() : initializeApp(cfg.firebase);
} else {
  console.error(
    'Missing Firebase configuration. Skipping Firebase initialization. Set NEXT_PUBLIC_FIREBASE_* env vars.',
  );
}

export const auth = app ? getAuth(app) : null;
if (auth) setPersistence(auth, browserLocalPersistence).catch(() => {});
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
