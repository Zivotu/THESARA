const { randomUUID } = require('./rooms-util');

function resolveBaseUrl(baseUrl) {
  if (baseUrl) return baseUrl.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const fromWindow =
      window.__THESARA_API_BASE__ ||
      window.THESARA_API_BASE ||
      window.NEXT_PUBLIC_API_URL;
    if (typeof fromWindow === 'string' && fromWindow.trim()) {
      return fromWindow.replace(/\/+$/, '');
    }
  }
  return '/api';
}

async function parseResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error(txt || `Unexpected response (status ${res.status})`);
  }
}

function createError(res, body) {
  const err = new Error(
    (body && (body.message || body.error)) ||
      `Request failed with status ${res.status}`,
  );
  err.status = res.status;
  if (body && body.code) err.code = body.code;
  if (body && body.details) err.details = body.details;
  return err;
}

class RoomsClient {
  constructor(options = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch || fetch;
  }

  roomsUrl(roomCode) {
    return roomCode
      ? `${this.baseUrl}/rooms/v1/${encodeURIComponent(roomCode)}`
      : `${this.baseUrl}/rooms/v1`;
  }

  async request(input, init) {
    const res = await this.fetchImpl(input, init);
    const data = await parseResponse(res).catch((err) => {
      if (!res.ok) {
        throw createError(res, { message: err && err.message });
      }
      throw err;
    });
    if (!res.ok) {
      throw createError(res, data);
    }
    return data;
  }

  async createRoom(body) {
    const data = await this.request(this.roomsUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      token: data.token,
      member: data.member,
      room: data.room,
    };
  }

  async joinRoom(body) {
    const data = await this.request(this.roomsUrl(`${body.roomCode}/join`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: body.pin, name: body.name }),
    });
    return {
      token: data.token,
      member: data.member,
      room: data.room,
    };
  }

  async getRoomState(params) {
    let url = this.roomsUrl(params.roomCode);
    const qs = new URLSearchParams();
    if (params.since != null) qs.set('since', String(params.since));
    if (params.sinceVersion != null) qs.set('sinceVersion', String(params.sinceVersion));
    const query = qs.toString();
    if (query) url += url.includes('?') ? `&${query}` : `?${query}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${params.token}` },
    });
    const data = await parseResponse(res).catch((err) => {
      if (!res.ok) throw createError(res, { message: err && err.message });
      throw err;
    });
    if (!res.ok) throw createError(res, data);
    return data;
  }

  defaultHeaders(token, extra) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(extra || {}),
    };
  }

  async addItem(params) {
    const data = await this.request(
      this.roomsUrl(`${params.roomCode}/items`),
      {
        method: 'POST',
        headers: this.defaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
          'x-idempotency-key': randomUUID(),
        }),
        body: JSON.stringify(params.body),
      },
    );
    return data;
  }

  async updateItem(params) {
    const data = await this.request(
      this.roomsUrl(
        `${params.roomCode}/items/${encodeURIComponent(params.itemId)}`,
      ),
      {
        method: 'PATCH',
        headers: this.defaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
        body: JSON.stringify(params.body),
      },
    );
    return data;
  }

  async removeItem(params) {
    const res = await this.fetchImpl(
      this.roomsUrl(
        `${params.roomCode}/items/${encodeURIComponent(params.itemId)}`,
      ),
      {
        method: 'DELETE',
        headers: this.defaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
      },
    );
    if (res.status === 204) {
      const state = await this.getRoomState({
        roomCode: params.roomCode,
        token: params.token,
      });
      return { room: state.room };
    }
    const body = await parseResponse(res).catch((err) => {
      if (!res.ok) throw createError(res, { message: err && err.message });
      throw err;
    });
    if (!res.ok) throw createError(res, body);
    return body;
  }

  async finalizePurchase(params) {
    const data = await this.request(
      this.roomsUrl(`${params.roomCode}/finalize`),
      {
        method: 'POST',
        headers: this.defaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
          'x-idempotency-key': randomUUID(),
        }),
        body: JSON.stringify(params.body || {}),
      },
    );
    return data;
  }

  async rotatePin(params) {
    const data = await this.request(
      this.roomsUrl(`${params.roomCode}/rotate-pin`),
      {
        method: 'POST',
        headers: this.defaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
        body: JSON.stringify({ oldPin: params.oldPin, newPin: params.newPin }),
      },
    );
    return data;
  }
}

module.exports = { RoomsClient };
