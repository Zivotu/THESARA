// apps/api/scripts/test-notify.ts
import 'dotenv/config';
import { notifyAdmins } from '../src/notifier.js';

(async () => {
  await notifyAdmins('Test poruka', 'Ovo je test.');
  console.log('poslano');
})();
