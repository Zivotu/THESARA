export const ROOMS_CLIENT_SHIM = `// createx rooms client (ESM)
// Minimal wrapper around platform /rooms API. Works in the browser.

const base = (() => {
  try {
    // Use same-origin API base
    const u = new URL(window.location.origin);
    return u.origin;
  } catch {
    return '';
  }
})();

async function j(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((body && (body.error||body.message)) || res.statusText);
    err.status = res.status; // @ts-ignore
    err.body = body; // @ts-ignore
    throw err;
  }
  return body;
}

/**
 * Host: create a room for this app.
 * @param {string} appId
 * @param {string} idToken - Firebase ID token (or platform session bearer if applicable)
 */
export async function createRoom(appId, idToken) {
  if (!appId) throw new Error('appId required');
  const url = base + '/rooms/create';
  return j(url, {
    method: 'POST',
    headers: idToken ? { Authorization: 'Bearer ' + idToken } : {},
    body: JSON.stringify({ appId }),
  });
}

/**
 * Player: join by roomId + joinToken issued by host.
 */
export async function joinRoom(roomId, { name, joinToken }) {
  if (!roomId) throw new Error('roomId required');
  if (!joinToken) throw new Error('joinToken required');
  const url = base + '/rooms/' + encodeURIComponent(roomId) + '/join';
  return j(url, {
    method: 'POST',
    body: JSON.stringify({ name: name || '', joinToken }),
  });
}

export async function listPlayers(roomId) {
  const url = base + '/rooms/' + encodeURIComponent(roomId) + '/players';
  return j(url);
}

/**
 * Host-only: append an event. Requires Authorization bearer.
 */
export async function postEvent(roomId, event, idToken) {
  const url = base + '/rooms/' + encodeURIComponent(roomId) + '/events';
  return j(url, {
    method: 'POST',
    headers: idToken ? { Authorization: 'Bearer ' + idToken } : {},
    body: JSON.stringify(event || {}),
  });
}

export async function getEvents(roomId, since) {
  const q = since ? ('?since=' + encodeURIComponent(String(since))) : '';
  const url = base + '/rooms/' + encodeURIComponent(roomId) + '/events' + q;
  return j(url);
}

/**
 * Simple polling helper: calls onEvents with new events.
 */
export function pollEvents(roomId, { intervalMs = 1000, onEvents } = {}) {
  let since = 0;
  let stop = false;
  async function tick() {
    if (stop) return;
    try {
      const res = await getEvents(roomId, since);
      const evs = Array.isArray(res?.events) ? res.events : [];
      if (evs.length) {
        since = Math.max(since, ...evs.map(e => e.createdAt || 0));
        onEvents && onEvents(evs);
      }
    } catch {}
    setTimeout(tick, intervalMs);
  }
  tick();
  return () => { stop = true; };
}
`;
