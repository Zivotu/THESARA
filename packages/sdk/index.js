(function (global) {
  if (global.loopyway) return; // idempotent
  function resolveBase() {
    try {
      const s = document.currentScript;
      if (s) {
        const attr = s.getAttribute('data-api-base');
        if (attr) return attr;
        if (s.src) {
          const u = new URL(s.src);
          return `${u.origin}`;
        }
      }
    } catch {}
    if (global.LOOPYWAY_API_BASE) return global.LOOPYWAY_API_BASE;
    if (global.NEXT_PUBLIC_API_URL) return global.NEXT_PUBLIC_API_URL;
    return location.origin;
  }
  const API_BASE = resolveBase();

  const CONFIG = global.__CREATE_APP_CONFIG__ || {};
  const APP_ID = CONFIG.appId || (function(){
    try {
      const parts = location.pathname.split('/').filter(Boolean);
      return parts[1] || '';
    } catch {
      return '';
    }
  })();
  const NET = CONFIG.network || { access: 'proxy-net', mediaDomains: [], allowlist: [] };
  const origFetch = global.fetch.bind(global);

  async function kvGet(appId, key) {
    const url = `${API_BASE}/kv/${encodeURIComponent(appId)}?key=${encodeURIComponent(key)}`;
    const res = await origFetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error('kv.get failed');
    const json = await res.json();
    return json?.value;
  }

  async function kvSet(appId, key, value) {
    const res = await origFetch(`${API_BASE}/kv/${encodeURIComponent(appId)}`,{
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ key, value })
    });
    if (!res.ok) throw new Error('kv.set failed');
    const json = await res.json();
    return !!json?.ok;
  }

  // net.fetch with policy enforcement
  async function netFetch(appId, url, options = {}) {
    if (NET.access === 'no-net' || NET.access === 'media-only') {
      throw new Error('Network disabled by policy');
    }
    if (NET.access === 'open-net') {
      const u = new URL(url, location.href);
      const allow = Array.isArray(NET.allowlist) ? NET.allowlist : [];
      const ok = allow.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
      if (!ok) {
        try {
          await origFetch(`${API_BASE}/apps/${encodeURIComponent(appId)}/pending-network`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: u.hostname }),
            keepalive: true,
          });
        } catch {}
        throw new Error('Domain not allowed by policy');
      }
      return origFetch(u.href, options);
    }
    const payload = {
      appId,
      url,
      method: options.method || 'GET',
      headers: Object.fromEntries(
        Object.entries(options.headers || {}).filter(([h]) => !/^authorization$/i.test(h))
      ),
      body: options.body ?? null,
    };
    const res = await origFetch(`${API_BASE}/proxy/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('proxy.fetch failed');
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await res.json();
    if (ct.startsWith('image/')) return await res.arrayBuffer();
    return await res.text();
  }

  async function cameraRequest(constraints = { video: true }) {
    return navigator.mediaDevices.getUserMedia({ video: true, ...constraints });
  }

  async function micRequest(constraints = { audio: true }) {
    return navigator.mediaDevices.getUserMedia({ audio: true, ...constraints });
  }

  // --- score helpers ---
  async function scoreSubmit(appId, score) {
    const res = await origFetch(`${API_BASE}/apps/${encodeURIComponent(appId)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ score }),
    });
    if (res.status === 401) {
      try {
        localStorage.setItem(`pendingScore-${appId}`, String(score));
      } catch {}
      global.dispatchEvent(
        new CustomEvent('loopyway:login-required', { detail: { appId, score } })
      );
      return { ok: false, pending: true };
    }
    if (!res.ok) throw new Error('score.submit failed');
    return await res.json();
  }

  async function scoreLeaderboard(appId, limit = 10) {
    const res = await origFetch(
      `${API_BASE}/apps/${encodeURIComponent(appId)}/leaderboard?limit=${limit}`,
      { credentials: 'include' }
    );
    if (!res.ok) throw new Error('score.leaderboard failed');
    const json = await res.json();
    return json?.scores || [];
  }

    function flushPendingScore(appId) {
      try {
        const key = `pendingScore-${appId}`;
        const val = localStorage.getItem(key);
        if (val != null) {
          scoreSubmit(appId, Number(val)).finally(() => {
            try {
              localStorage.removeItem(key);
            } catch {}
          });
        }
      } catch {}
    }

    // --- rooms helpers ---
    async function roomsCreate(appId) {
      const res = await origFetch(`${API_BASE}/rooms/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ appId }),
      });
      if (!res.ok) throw new Error('rooms.create failed');
      const json = await res.json();
      return json.roomId;
    }

    async function roomsJoin(roomId, data = {}) {
      const res = await origFetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('rooms.join failed');
      return await res.json();
    }

    function roomsOnPlayers(roomId, cb) {
      let stopped = false;
      async function poll() {
        try {
          const res = await origFetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/players`, {
            credentials: 'include',
            cache: 'no-store',
          });
          if (res.ok) {
            const json = await res.json();
            cb(json.players || []);
          }
        } catch {}
        if (!stopped) setTimeout(poll, 1000);
      }
      poll();
      return () => {
        stopped = true;
      };
    }

    async function roomsUpdatePlayer(roomId, playerId, data) {
      const res = await origFetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/players/${encodeURIComponent(playerId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-player-id': playerId },
        credentials: 'include',
        body: JSON.stringify(data || {}),
      });
      if (!res.ok) throw new Error('rooms.updatePlayer failed');
    }

    async function roomsSendEvent(roomId, type, payload) {
      const res = await origFetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, payload }),
      });
      if (!res.ok) throw new Error('rooms.sendEvent failed');
    }

    function roomsOnEvent(roomId, cb) {
      let stopped = false;
      let since = 0;
      async function poll() {
        try {
          const res = await origFetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/events?since=${since}`, {
            credentials: 'include',
            cache: 'no-store',
          });
          if (res.ok) {
            const json = await res.json();
            (json.events || []).forEach((e) => {
              cb(e);
              if (e.createdAt && e.createdAt > since) since = e.createdAt;
            });
          }
        } catch {}
        if (!stopped) setTimeout(poll, 1000);
      }
      poll();
      return () => {
        stopped = true;
      };
    }

    global.loopyway = {
      kv: { get: kvGet, set: kvSet },
      net: { fetch: netFetch },
      camera: { request: cameraRequest },
      mic: { request: micRequest },
      score: {
        submit: scoreSubmit,
        leaderboard: scoreLeaderboard,
        flushPending: flushPendingScore,
      },
      rooms: {
        createRoom: roomsCreate,
        joinRoom: roomsJoin,
        onPlayers: roomsOnPlayers,
        updatePlayer: roomsUpdatePlayer,
        sendEvent: roomsSendEvent,
        onEvent: roomsOnEvent,
      },
    };

  function enforceNetwork() {
    const deny = () => Promise.reject(new Error('Network disabled by policy'));
    const block = (msg) => function () { throw new Error(msg); };
    const toUrl = (input) => {
      if (typeof input === 'string' || input instanceof URL) return input;
      return input && input.url ? input.url : String(input);
    };
    if (NET.access === 'proxy-net' || NET.access === 'reviewed-open-net') {
      const msg = "U 'Proxy-Net' režimu mreža je dopuštena samo preko /proxy/fetch.";
      global.fetch = (input, init) => {
        const url = toUrl(input);
        if (!(url.startsWith('/proxy/fetch') || url.startsWith(`${API_BASE}/proxy/fetch`))) {
          try {
            origFetch(`${API_BASE}/telemetry`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appId: APP_ID, url, timestamp: Date.now() }),
              keepalive: true,
            });
          } catch {}
          throw new Error(msg);
        }
        return origFetch(url, init);
      };
      const blocker = block(msg);
      global.XMLHttpRequest = blocker;
      global.WebSocket = blocker;
      global.EventSource = blocker;
    } else if (NET.access === 'open-net') {
      const blocker = block('Network disabled by policy');
      global.fetch = (input, init) => netFetch(APP_ID, toUrl(input), init || {});
      global.XMLHttpRequest = blocker;
      global.WebSocket = blocker;
      global.EventSource = blocker;
    } else {
      const blocker = block('Network disabled by policy');
      global.fetch = deny;
      global.XMLHttpRequest = blocker;
      global.WebSocket = blocker;
      global.EventSource = blocker;
      global.loopyway.net.fetch = () => Promise.reject(new Error('Network disabled by policy'));
    }
  }
    enforceNetwork();

    async function devProxyNetTest() {
      const testUrl = 'https://example.com';
      try {
        await fetch(testUrl);
        console.log('[proxy-net test] unexpected direct fetch success');
      } catch (err) {
        console.log('[proxy-net test] direct fetch blocked as expected', err && err.message);
      }
      try {
        const res = await fetch(`${API_BASE}/proxy/fetch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: APP_ID, url: testUrl }),
        });
        console.log('[proxy-net test] proxy fetch status', res.status);
      } catch (err) {
        console.log('[proxy-net test] proxy fetch failed', err && err.message);
      }
    }
    if ((NET.access === 'proxy-net' || NET.access === 'reviewed-open-net') && CONFIG.devProxyNetTest) {
      devProxyNetTest();
    }

    // --- heartbeat for PIN sessions ---
  function startHeartbeat() {
    try {
      const parts = location.pathname.split('/').filter(Boolean);
      const appId = parts[1];
      if (!appId) return;
      const cookies = document.cookie.split(';').reduce((acc, c) => {
        const [k, v] = c.trim().split('=');
        if (k) acc[k] = v;
        return acc;
      }, {});
      const sid = cookies[`PINSESSION_${appId}`];
      if (!sid) return;
      const url = `${API_BASE}/app/${appId}/pin/heartbeat`;
      const send = () => {
        const payload = JSON.stringify({ sessionId: sid });
        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
          } else {
            origFetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true,
              credentials: 'omit',
            });
          }
        } catch {}
      };
      send();
      setInterval(send, 60_000);
    } catch {}
  }
  startHeartbeat();
})(window);
