import argon2 from 'argon2';
import type {
  AddItemBody,
  CreateRoomBody,
  FinalizeBody,
  JoinRoomBody,
  MemberDto,
  ItemDto,
  PurchaseDto,
  RoomStateDto,
  RoomSummaryDto,
  UpdateItemBody,
  RotatePinBody,
} from './schema.js';
import { prisma } from '../../prisma/client.js';
import { getConfig } from '../../config.js';
import type { Prisma } from '@prisma/client';
import type { RoomSessionToken } from '../../plugins/jwt.js';

export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const config = getConfig();
const roomsConfig = config.ROOMS_V1;

function nowUtc(): Date {
  return new Date();
}

function toRoomSummary(room: Prisma.RoomGetPayload<{}>): RoomSummaryDto {
  return {
    id: room.id,
    roomCode: room.roomCode,
    version: room.version,
    tokenVersion: room.tokenVersion,
    updatedAt: room.updatedAt.toISOString(),
  };
}

function toMemberDto(member: Prisma.MemberGetPayload<{}>): MemberDto {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

function toItemDto(item: Prisma.ItemGetPayload<{}>): ItemDto {
  return {
    id: item.id,
    icon: item.icon,
    name: item.name,
    qty: item.qty,
    note: item.note ?? undefined,
    estPriceCents: item.estPriceCents ?? undefined,
    bought: item.bought,
    actualPriceCents: item.actualPriceCents ?? undefined,
    addedBy: item.addedBy,
    addedAt: item.addedAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function parsePurchaseItems(raw: unknown): PurchaseDto['items'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof (entry as any).id !== 'string' ||
        typeof (entry as any).name !== 'string'
      ) {
        return undefined;
      }
      return {
        id: String((entry as any).id),
        name: String((entry as any).name),
        qty: String((entry as any).qty ?? '1'),
        priceCents: Number((entry as any).priceCents ?? 0),
        icon: typeof (entry as any).icon === 'string' ? (entry as any).icon : '🛒',
        note: typeof (entry as any).note === 'string' ? (entry as any).note : undefined,
      };
    })
    .filter((entry): entry is PurchaseDto['items'][number] => Boolean(entry));
}

function toPurchaseDto(purchase: Prisma.PurchaseGetPayload<{}>): PurchaseDto {
  return {
    id: purchase.id,
    date: purchase.date.toISOString(),
    totalCents: purchase.totalCents,
    by: purchase.by,
    items: parsePurchaseItems(purchase.itemsJson as unknown[]),
  };
}

async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: roomsConfig.argon2.memoryCost,
    timeCost: roomsConfig.argon2.timeCost,
    parallelism: roomsConfig.argon2.parallelism,
  });
}

async function verifyPin(hash: string, pin: string): Promise<boolean> {
  return argon2.verify(hash, pin, {
    type: argon2.argon2id,
    memoryCost: roomsConfig.argon2.memoryCost,
    timeCost: roomsConfig.argon2.timeCost,
    parallelism: roomsConfig.argon2.parallelism,
  });
}

async function findRoomByCode(roomCode: string, tx = prisma) {
  const room = await tx.room.findUnique({
    where: { roomCode },
  });
  if (!room) {
    throw new HttpError(404, 'room_not_found', 'Room not found.');
  }
  return room;
}

async function checkIdempotency<T>(
  tx: Prisma.TransactionClient,
  key: string | undefined,
  scope: string,
): Promise<{ hit: boolean; data?: T }> {
  if (!key) return { hit: false };
  const record = await tx.idempotencyKey.findUnique({
    where: { key_scope: { key, scope } },
  });
  if (!record) return { hit: false };
  const ageMs = Date.now() - record.createdAt.getTime();
  if (ageMs > roomsConfig.idempotencyTtlMs) {
    await tx.idempotencyKey.delete({ where: { id: record.id } });
    return { hit: false };
  }
  return {
    hit: true,
    data: record.response as T,
  };
}

async function storeIdempotency<T>(
  tx: Prisma.TransactionClient,
  key: string | undefined,
  scope: string,
  payload: T,
): Promise<void> {
  if (!key) return;
  try {
    const serializable = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
    await tx.idempotencyKey.create({
      data: {
        key,
        scope,
        response: serializable,
      },
    });
  } catch (err: any) {
    if (err?.code !== 'P2002') {
      throw err;
    }
  }
}

function assertVersion(expected: number | undefined, actual: number) {
  if (expected === undefined) {
    throw new HttpError(
      428,
      'missing_if_match',
      'If-Match header with current room version is required.',
    );
  }
  if (expected !== actual) {
    throw new HttpError(409, 'version_conflict', 'Room state has changed. Refresh and retry.');
  }
}

function sanitizeName(name: string | undefined): string {
  const trimmed = (name || '').trim();
  return trimmed.length > 0 ? trimmed : 'anon';
}

export class RoomsService {
  private emitRoomEvent(roomId: string, event: { type: string; payload?: unknown }) {
    // Phase B placeholder: hook for SSE/WebSocket broadcasting.
    void roomId;
    void event;
  }

  async createRoom(body: CreateRoomBody): Promise<{
    room: RoomSummaryDto;
    member: MemberDto;
    token: RoomSessionToken;
  }> {
    const safeName = sanitizeName(body.name) || 'owner';
    const hashed = await hashPin(body.pin);
    try {
      const room = await prisma.room.create({
        data: {
          roomCode: body.roomCode,
          pinHash: hashed,
          members: {
            create: {
              name: safeName,
              role: 'OWNER',
            },
          },
        },
        include: {
          members: true,
        },
      });

      const owner = room.members.find((m) => m.role === 'OWNER') ?? room.members[0];
      const memberDto = toMemberDto(owner);
      const token: RoomSessionToken = {
        roomId: room.id,
        memberId: owner.id,
        role: owner.role,
        name: owner.name,
        tokenVersion: room.tokenVersion,
      };

      this.emitRoomEvent(room.id, {
        type: 'ROOM_CREATED',
        payload: { by: memberDto },
      });

      return {
        room: toRoomSummary(room),
        member: memberDto,
        token,
      };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new HttpError(409, 'room_exists', 'Room already exists.');
      }
      throw err;
    }
  }

  async joinRoom(body: JoinRoomBody, roomCode: string): Promise<{
    room: RoomSummaryDto;
    member: MemberDto;
    token: RoomSessionToken;
  }> {
    const room = await prisma.room.findUnique({
      where: { roomCode },
      include: { members: true },
    });
    if (!room) {
      throw new HttpError(404, 'room_not_found', 'Room not found.');
    }
    const pinOk = await verifyPin(room.pinHash, body.pin);
    if (!pinOk) {
      throw new HttpError(401, 'invalid_pin', 'Invalid PIN supplied.');
    }

    const member = await prisma.member.create({
      data: {
        roomId: room.id,
        name: sanitizeName(body.name),
        role: 'MEMBER',
      },
    });

    const token: RoomSessionToken = {
      roomId: room.id,
      memberId: member.id,
      role: member.role,
      name: member.name,
      tokenVersion: room.tokenVersion,
    };

    this.emitRoomEvent(room.id, {
      type: 'MEMBER_JOINED',
      payload: { member: toMemberDto(member) },
    });

    return {
      room: toRoomSummary(room),
      member: toMemberDto(member),
      token,
    };
  }

  async getRoomState(
    roomCode: string,
    filters: { since?: number; sinceVersion?: number },
  ): Promise<RoomStateDto> {
    const room = await prisma.room.findUnique({
      where: { roomCode },
      include: { members: true },
    });
    if (!room) {
      throw new HttpError(404, 'room_not_found', 'Room not found.');
    }

    if (filters.sinceVersion !== undefined && room.version <= filters.sinceVersion) {
      return {
        room: toRoomSummary(room),
        members: [],
        items: [],
        history: [],
      };
    }

    const items = await prisma.item.findMany({
      where: {
        roomId: room.id,
        ...(filters.since !== undefined
          ? { updatedAt: { gt: new Date(filters.since) } }
          : undefined),
      },
      orderBy: { updatedAt: 'desc' },
    });

    const purchases = await prisma.purchase.findMany({
      where: {
        roomId: room.id,
        ...(filters.since !== undefined
          ? { date: { gt: new Date(filters.since) } }
          : undefined),
      },
      orderBy: { date: 'desc' },
    });

    return {
      room: toRoomSummary(room),
      members: room.members.map(toMemberDto),
      items: items.map(toItemDto),
      history: purchases.map(toPurchaseDto),
    };
  }

  private async mutateRoom<T>({
    roomCode,
    expectedVersion,
    idempotencyKey,
    idempotencyScopeSuffix,
    executor,
  }: {
    roomCode: string;
    expectedVersion?: number;
    idempotencyKey?: string;
    idempotencyScopeSuffix: string;
    executor: (
      tx: Prisma.TransactionClient,
      room: Prisma.RoomGetPayload<{ include: { members: true } }>,
    ) => Promise<T>;
  }): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { roomCode },
        include: { members: true },
      });
      if (!room) {
        throw new HttpError(404, 'room_not_found', 'Room not found.');
      }
      assertVersion(expectedVersion, room.version);

      const scope = `${room.id}:${idempotencyScopeSuffix}`;
      if (idempotencyKey) {
        const hit = await checkIdempotency<T>(tx, idempotencyKey, scope);
        if (hit.hit && hit.data !== undefined) {
          return hit.data;
        }
      }

      const result = await executor(tx, room);
      await tx.room.update({
        where: { id: room.id },
        data: {
          version: { increment: 1 },
          updatedAt: nowUtc(),
        },
      });

      if (idempotencyKey) {
        await storeIdempotency(tx, idempotencyKey, scope, result);
      }

      return result;
    });
  }

  async addItem(
    roomCode: string,
    body: AddItemBody,
    audit: { expectedVersion?: number; idempotencyKey?: string; actor: MemberDto },
  ): Promise<{ item: ItemDto; room: RoomSummaryDto }> {
    const payload = await this.mutateRoom<ItemDto>({
      roomCode,
      expectedVersion: audit.expectedVersion,
      idempotencyKey: audit.idempotencyKey,
      idempotencyScopeSuffix: 'add-item',
      executor: async (tx, room) => {
        const item = await tx.item.create({
          data: {
            roomId: room.id,
            icon: body.icon,
            name: body.name.trim(),
            qty: body.qty.trim(),
            note: body.note,
            estPriceCents: body.estPriceCents,
            addedBy: audit.actor.name,
          },
        });
        return toItemDto(item);
      },
    });
    const roomState = await findRoomByCode(roomCode);
    this.emitRoomEvent(roomState.id, { type: 'ITEM_CREATED', payload: payload });
    return { item: payload, room: toRoomSummary(roomState) };
  }

  async updateItem(
    roomCode: string,
    itemId: string,
    body: UpdateItemBody,
    audit: { expectedVersion?: number },
  ): Promise<{ item: ItemDto; room: RoomSummaryDto }> {
    const result = await this.mutateRoom<ItemDto>({
      roomCode,
      expectedVersion: audit.expectedVersion,
      idempotencyScopeSuffix: `update-item:${itemId}`,
      executor: async (tx, room) => {
        const item = await tx.item.findUnique({ where: { id: itemId } });
        if (!item || item.roomId !== room.id) {
          throw new HttpError(404, 'item_not_found', 'Item not found in this room.');
        }
        const updated = await tx.item.update({
          where: { id: itemId },
          data: {
            icon: body.icon ?? item.icon,
            name: body.name?.trim() ?? item.name,
            qty: body.qty?.trim() ?? item.qty,
            note: body.note ?? item.note,
            estPriceCents: body.estPriceCents ?? item.estPriceCents,
            actualPriceCents:
              body.actualPriceCents !== undefined
                ? body.actualPriceCents
                : item.actualPriceCents,
            bought: body.bought ?? item.bought,
          },
        });
        return toItemDto(updated);
      },
    });
    const roomState = await findRoomByCode(roomCode);
    this.emitRoomEvent(roomState.id, { type: 'ITEM_UPDATED', payload: result });
    return { item: result, room: toRoomSummary(roomState) };
  }

  async deleteItem(
    roomCode: string,
    itemId: string,
    audit: { expectedVersion?: number },
  ): Promise<{ room: RoomSummaryDto }> {
    await this.mutateRoom<void>({
      roomCode,
      expectedVersion: audit.expectedVersion,
      idempotencyScopeSuffix: `delete-item:${itemId}`,
      executor: async (tx, room) => {
        const target = await tx.item.findUnique({ where: { id: itemId } });
        if (!target || target.roomId !== room.id) {
          throw new HttpError(404, 'item_not_found', 'Item not found in this room.');
        }
        await tx.item.delete({ where: { id: itemId } });
      },
    });
    const roomState = await findRoomByCode(roomCode);
    this.emitRoomEvent(roomState.id, { type: 'ITEM_DELETED', payload: { id: itemId } });
    return { room: toRoomSummary(roomState) };
  }

  async finalizePurchase(
    roomCode: string,
    body: FinalizeBody,
    audit: { expectedVersion?: number; idempotencyKey?: string; actor: MemberDto },
  ): Promise<{ purchase: PurchaseDto; itemsCleared: string[]; room: RoomSummaryDto }> {
    const result = await this.mutateRoom<{
      purchase: PurchaseDto;
      itemsCleared: string[];
    }>({
      roomCode,
      expectedVersion: audit.expectedVersion,
      idempotencyKey: audit.idempotencyKey,
      idempotencyScopeSuffix: 'finalize',
      executor: async (tx, room) => {
        const items = await tx.item.findMany({
          where: { roomId: room.id, bought: true },
        });
        if (items.length === 0) {
          throw new HttpError(400, 'nothing_to_finalize', 'No bought items to finalize.');
        }
        const purchaseItems = items.map((item) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          priceCents: item.actualPriceCents ?? item.estPriceCents ?? 0,
          icon: item.icon,
          note: item.note ?? undefined,
        }));
        const total = purchaseItems.reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
        const by = body.purchasedBy
          ? sanitizeName(body.purchasedBy)
          : audit.actor.name || 'anon';

        const purchase = await tx.purchase.create({
          data: {
            roomId: room.id,
            totalCents: total,
            by,
            itemsJson: purchaseItems as unknown as Prisma.JsonArray,
          },
        });
        const clearedIds = items.map((item) => item.id);
        await tx.item.deleteMany({
          where: { id: { in: clearedIds } },
        });

        return {
          purchase: toPurchaseDto(purchase),
          itemsCleared: clearedIds,
        };
      },
    });

    const updatedRoom = await findRoomByCode(roomCode);
    this.emitRoomEvent(updatedRoom.id, {
      type: 'PURCHASE_FINALIZED',
      payload: {
        purchase: result.purchase,
        cleared: result.itemsCleared,
      },
    });
    return {
      purchase: result.purchase,
      itemsCleared: result.itemsCleared,
      room: toRoomSummary(updatedRoom),
    };
  }

  async rotatePin(
    roomCode: string,
    body: RotatePinBody,
    actor: MemberDto,
    audit: { expectedVersion?: number },
  ): Promise<{ room: RoomSummaryDto }> {
    await this.mutateRoom<void>({
      roomCode,
      expectedVersion: audit.expectedVersion,
      idempotencyScopeSuffix: 'rotate-pin',
      executor: async (tx, room) => {
        if (actor.role !== 'OWNER') {
          throw new HttpError(403, 'forbidden', 'Only owners can rotate the PIN.');
        }
        const valid = await verifyPin(room.pinHash, body.oldPin);
        if (!valid) {
          throw new HttpError(401, 'invalid_pin', 'Old PIN is incorrect.');
        }
        const newHash = await hashPin(body.newPin);
        await tx.room.update({
          where: { id: room.id },
          data: {
            pinHash: newHash,
            tokenVersion: { increment: 1 },
          },
        });
        await tx.member.updateMany({
          where: { roomId: room.id },
          data: { joinedAt: nowUtc() },
        });
      },
    });
    const room = await findRoomByCode(roomCode);
    this.emitRoomEvent(room.id, { type: 'PIN_ROTATED' });
    return { room: toRoomSummary(room) };
  }

  async loadBridgeState(appId: string, userId: string, storageKey: string): Promise<string | null> {
    const existing = await prisma.roomBridge.findUnique({
      where: { appId_userId_storageKey: { appId, userId, storageKey } },
    });
    return existing?.payload ?? null;
  }

  async saveBridgeState(
    appId: string,
    userId: string,
    storageKey: string,
    payload: string | null,
  ): Promise<void> {
    if (!payload || !payload.trim()) {
      await prisma.roomBridge.deleteMany({
        where: { appId, userId, storageKey },
      });
      return;
    }
    await prisma.roomBridge.upsert({
      where: { appId_userId_storageKey: { appId, userId, storageKey } },
      create: { appId, userId, storageKey, payload },
      update: { payload },
    });
  }
}
