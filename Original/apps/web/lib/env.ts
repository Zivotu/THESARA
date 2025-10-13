export const REQUIRED_FIREBASE_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export type FirebaseKey = (typeof REQUIRED_FIREBASE_KEYS)[number];

export type FirebaseEnv = Record<FirebaseKey, string | undefined>;

export function readPublicEnv(
  env: Record<string, string | undefined> = process.env,
): FirebaseEnv {
  return Object.fromEntries(
    REQUIRED_FIREBASE_KEYS.map((key) => [key, env[key]]),
  ) as FirebaseEnv;
}

export function getMissingFirebaseEnv(
  env: Record<string, string | undefined> = process.env,
): FirebaseKey[] {
  const publicEnv = readPublicEnv(env);
  return REQUIRED_FIREBASE_KEYS.filter((key) => !publicEnv[key]);
}
