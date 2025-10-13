export interface RoomsClientOptions {
  baseUrl?: string;
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

export declare class RoomsClient {
  constructor(options?: RoomsClientOptions);
  createRoom(body: CreateRoomRequest): Promise<RoomsAuth>;
  joinRoom(body: JoinRoomRequest): Promise<RoomsAuth>;
  getRoomState(params: {
    roomCode: string;
    token: string;
    since?: number;
    sinceVersion?: number;
  }): Promise<RoomState>;
  addItem(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    body: AddItemRequest;
  }): Promise<{ item: ItemSummary; room: RoomSummary }>;
  updateItem(params: {
    roomCode: string;
    itemId: string;
    token: string;
    expectedVersion: number;
    body: UpdateItemRequest;
  }): Promise<{ item: ItemSummary; room: RoomSummary }>;
  removeItem(params: {
    roomCode: string;
    itemId: string;
    token: string;
    expectedVersion: number;
  }): Promise<{ room: RoomSummary }>;
  finalizePurchase(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    body?: FinalizePurchaseRequest;
  }): Promise<{ purchase: PurchaseRecord; room: RoomSummary }>;
  rotatePin(params: {
    roomCode: string;
    token: string;
    expectedVersion: number;
    oldPin: string;
    newPin: string;
  }): Promise<{ room: RoomSummary }>;
}

declare global {
  interface Window {
    loopyway?: {
      kv: {
        get: (appId: string, key: string) => Promise<any>;
        set: (appId: string, key: string, value: any) => Promise<boolean>;
      };
      net: {
        fetch: (
          appId: string,
          url: string,
          options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: any;
          },
        ) => Promise<any>;
      };
      camera: {
        request: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
      };
      mic: { request: (constraints?: MediaStreamConstraints) => Promise<MediaStream> };
      score: {
        submit: (appId: string, score: number) => Promise<any>;
        leaderboard: (appId: string, limit?: number) => Promise<any[]>;
        flushPending: (appId: string) => void;
      };
      rooms?: {
        createRoom: (appId: string) => Promise<string>;
        joinRoom: (roomId: string, data?: any) => Promise<{ playerId: string }>;
        onPlayers: (roomId: string, cb: (players: any[]) => void) => () => void;
        updatePlayer: (
          roomId: string,
          playerId: string,
          data: any,
        ) => Promise<void>;
        sendEvent: (
          roomId: string,
          type: string,
          payload: any,
        ) => Promise<void>;
        onEvent: (roomId: string, cb: (event: any) => void) => () => void;
      };
    };
  }
}
