import { randomUUID } from './util/randomId';

export interface RoomsClientOptions {
  /**
   * Base URL of the Thesara API (e.g. https://api.thesara.space/api).
   * Defaults to window.THESARA_API_BASE or '/api'.
   */
  baseUrl?: string;
  /**
   * Optional fetch implementation (defaults to global fetch).
   */
  fetch?: typeof fetch;
}

export interface CreateRoomRequest {
  roomCode: string;
  pin: string;
  name?: string;
}

export interface JoinRoomRequest {
  roomCode: string;
  pin: string;
  name?: string;
}

export interface RoomSummary {
  id: string;
  roomCode: string;
  version: number;
  tokenVersion: number;
  updatedAt: string;
}

export interface MemberSummary {
  id: string;
  name: string;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
}

export interface ItemSummary {
  id: string;
  icon: string;
  name: string;
  qty: string;
  note?: string;
  estPriceCents?: number;
  actualPriceCents?: number;
  bought: boolean;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export interface PurchaseRecord {
  id: string;
  date: string;
  totalCents: number;
  by: string;
  items: Array<{
    id: string;
    name: string;
    qty: string;
    priceCents: number;
    icon: string;
    note?: string;
  }>;
}

export interface RoomState {
  room: RoomSummary;
  members: MemberSummary[];
  items: ItemSummary[];
  history: PurchaseRecord[];
}

export interface RoomsAuth {
  token: string;
  member: MemberSummary;
  room: RoomSummary;
}

export interface AddItemRequest {
  icon: string;
  name: string;
  qty: string;
  estPriceCents?: number;
  note?: string;
}

export interface UpdateItemRequest {
  icon?: string;
  name?: string;
  qty?: string;
  estPriceCents?: number;
  actualPriceCents?: number;
  note?: string;
  bought?: boolean;
}

export interface FinalizePurchaseRequest {
  purchasedBy?: string;
}

export interface RoomsFetchError extends Error {
  status: number;
  code?: string;
  details?: unknown;
}

function resolveBaseUrl(options?: RoomsClientOptions): string {
  if (options?.baseUrl) return options.baseUrl.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const fromWindow =
      (window as any).__THESARA_API_BASE__ ||
      (window as any).THESARA_API_BASE ||
      (window as any).NEXT_PUBLIC_API_URL;
    if (typeof fromWindow === 'string' && fromWindow.trim()) {
      return fromWindow.replace(/\/+$/, '');
    }
  }
  return '/api';
}

async function parseResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  const txt = await res.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new Error(txt || `Unexpected response (status ${res.status})`);
  }
}

function createError(res: Response, body: any): RoomsFetchError {
  const err: RoomsFetchError = new Error(
    body?.message ||
      body?.error ||
      `Request failed with status ${res.status}`,
  ) as RoomsFetchError;
  err.status = res.status;
  if (body?.code) err.code = body.code;
  if (body?.details) err.details = body.details;
  return err;
}

export class RoomsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: RoomsClientOptions) {
    this.baseUrl = resolveBaseUrl(options);
    this.fetchImpl = options?.fetch ?? fetch;
  }

  private roomsUrl(roomCode?: string): string {
    return roomCode
      ? `${this.baseUrl}/rooms/v1/${encodeURIComponent(roomCode)}`
      : `${this.baseUrl}/rooms/v1`;
  }

  private async request<T>(
    input: RequestInfo,
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.fetchImpl(input, init);
    const data = await parseResponse<any>(res).catch((err) => {
      if (!res.ok) {
        throw createError(res, { message: err?.message });
      }
      throw err;
    });
    if (!res.ok) {
      throw createError(res, data);
    }
    return data as T;
  }

  async createRoom(body: CreateRoomRequest): Promise<RoomsAuth> {
    const data = await this.request<{ token: string; room: RoomSummary; member: MemberSummary }>(
      this.roomsUrl(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return { token: data.token, member: data.member, room: data.room };
  }

  async joinRoom(body: JoinRoomRequest): Promise<RoomsAuth> {
    const data = await this.request<{ token: string; room: RoomSummary; member: MemberSummary }>(
      this.roomsUrl(`${body.roomCode}/join`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: body.pin, name: body.name }),
      },
    );
    return { token: data.token, member: data.member, room: data.room };
  }

  async getRoomState(params: {
    roomCode: string;
    token: string;
    since?: number;
    sinceVersion?: number;
  }): Promise<RoomState> {
    let url = this.roomsUrl(params.roomCode);
    const search = new URLSearchParams();
    if (params.since != null) {
      search.set('since', String(params.since));
    }
    if (params.sinceVersion != null) {
      search.set('sinceVersion', String(params.sinceVersion));
    }
    const qs = search.toString();
    if (qs) url += url.includes('?') ? `&${qs}` : `?${qs}`;
    const res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${params.token}` },
    });
    const data = await parseResponse<any>(res).catch((err) => {
      if (!res.ok) {
        throw createError(res, { message: err?.message });
      }
      throw err;
    });
    if (!res.ok) {
      throw createError(res, data);
    }
    return data as RoomState;
  }

  private withDefaultHeaders(token: string, extra?: Record<string, string>) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async addItem(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    body: AddItemRequest;
  }): Promise<{ item: ItemSummary; room: RoomSummary }> {
    const idempotencyKey = randomUUID();
    return this.request<{ item: ItemSummary; room: RoomSummary }>(
      this.roomsUrl(`${params.roomCode}/items`),
      {
        method: 'POST',
        headers: this.withDefaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
          'x-idempotency-key': idempotencyKey,
        }),
        body: JSON.stringify(params.body),
      },
    );
  }

  async updateItem(params: {
    roomCode: string;
    itemId: string;
    token: string;
    expectedVersion: number;
    body: UpdateItemRequest;
  }): Promise<{ item: ItemSummary; room: RoomSummary }> {
    return this.request<{ item: ItemSummary; room: RoomSummary }>(
      this.roomsUrl(`${params.roomCode}/items/${encodeURIComponent(params.itemId)}`),
      {
        method: 'PATCH',
        headers: this.withDefaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
        body: JSON.stringify(params.body),
      },
    );
  }

  async removeItem(params: {
    roomCode: string;
    itemId: string;
    token: string;
    expectedVersion: number;
  }): Promise<RoomSummary> {
    const res = await this.fetchImpl(
      this.roomsUrl(`${params.roomCode}/items/${encodeURIComponent(params.itemId)}`),
      {
        method: 'DELETE',
        headers: this.withDefaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
      },
    );
    if (res.status === 204) {
      // No payload; call getRoomState to retrieve latest summary
      const state = await this.getRoomState({
        roomCode: params.roomCode,
        token: params.token,
      });
      return state.room;
    }
    const body = await parseResponse<any>(res).catch((err) => {
      if (!res.ok) throw createError(res, { message: err?.message });
      throw err;
    });
    if (!res.ok) throw createError(res, body);
    return (body?.room ?? body) as RoomSummary;
  }

  async finalizePurchase(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    body?: FinalizePurchaseRequest;
  }): Promise<{ purchase: PurchaseRecord; room: RoomSummary }> {
    const idempotencyKey = randomUUID();
    return this.request<{ purchase: PurchaseRecord; room: RoomSummary }>(
      this.roomsUrl(`${params.roomCode}/finalize`),
      {
        method: 'POST',
        headers: this.withDefaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
          'x-idempotency-key': idempotencyKey,
        }),
        body: JSON.stringify(params.body ?? {}),
      },
    );
  }

  async rotatePin(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    oldPin: string;
    newPin: string;
  }): Promise<RoomSummary> {
    const data = await this.request<{ room: RoomSummary }>(
      this.roomsUrl(`${params.roomCode}/rotate-pin`),
      {
        method: 'POST',
        headers: this.withDefaultHeaders(params.token, {
          'If-Match': String(params.expectedVersion),
        }),
        body: JSON.stringify({ oldPin: params.oldPin, newPin: params.newPin }),
      },
    );
    return data.room;
  }
}
