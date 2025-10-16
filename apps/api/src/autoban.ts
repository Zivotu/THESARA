import { db, readApps, writeApps } from './db.js';
import type { App } from './db.js';
import { notifyAdmins } from './notifier.js';

export async function logAuditEntry(entry: Record<string, any>): Promise<void> {
  await db.collection('auditLogs').add({ ...entry, at: entry.at ?? Date.now() });
}

/**
 * Disable a user account, deactivate their apps, notify admins
 * and write an audit log.
 */
export async function autobanUser(uid: string, reason: string): Promise<void> {
  // Mark user as disabled
  await db.collection('users').doc(uid).set(
    { disabled: true, disabledAt: Date.now() },
    { merge: true }
  );
  console.log({ uid, reason }, 'user_disabled');

  // Deactivate all apps owned by this user
  const apps = await readApps();
  let changed = false;
  for (const app of apps) {
    if ((app as any).ownerUid === uid && app.state !== 'inactive') {
      (app as App).state = 'inactive';
      changed = true;
    }
  }
  if (changed) {
    await writeApps(apps);
  }

  // Send admin notification
  try {
    await notifyAdmins('user_autobanned', `user ${uid} auto-banned (${reason})`);
  } catch (err) {
    console.error({ err, uid }, 'notify_admins_failed');
  }

  // Persist audit entry
  await logAuditEntry({ type: 'autoban', uid, reason });
}

export default autobanUser;
