// apps/web/check-firebase-env.js
require('dotenv').config({ path: './.env.local' });

const required = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
];

const results = required.map(key => {
  const value = process.env[key];
  return {
    key,
    exists: !!value,
    value: value || "(MISSING)"
  };
});

console.table(results);
