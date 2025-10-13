import { Storage } from '@google-cloud/storage';
import { getConfig } from './config.js';

let storage: Storage | undefined;

export function getBucket() {
  const { FIREBASE } = getConfig();
  if (!storage) {
    const options: any = { projectId: FIREBASE.projectId };
    if (FIREBASE.clientEmail && FIREBASE.privateKey) {
      options.credentials = {
        client_email: FIREBASE.clientEmail,
        private_key: FIREBASE.privateKey,
      };
    }
    storage = new Storage(options);
  }
  return storage.bucket(FIREBASE.storageBucket);
}
