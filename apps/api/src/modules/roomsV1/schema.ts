import { z } from 'zod';
import type { Role } from '@prisma/client';

export const roomCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, {
    message: 'roomCode must contain lowercase letters, digits or dashes.',
  });

export const pinSchema = z
  .string()
  .min(4)
  .max(8)
  .regex(/^\d{4,8}$/, { message: 'PIN must be 4–8 digits.' });

const optionalName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .optional()
  .transform((value) => value?.trim() || undefined);

const centsSchema = z
  .number()
  .int('Value must be an integer number of cents.')
  .min(0, 'Value must be positive.');

export const createRoomBodySchema = z.object({
  roomCode: roomCodeSchema,
  pin: pinSchema,
  name: optionalName,
});

export type CreateRoomBody = z.infer<typeof createRoomBodySchema>;

export const joinRoomBodySchema = z.object({
  pin: pinSchema,
  name: optionalName,
});

export type JoinRoomBody = z.infer<typeof joinRoomBodySchema>;

export const addItemBodySchema = z.object({
  icon: z.string().min(1).max(16),
  name: z.string().trim().min(1).max(180),
  qty: z.string().trim().min(1).max(60),
  note: z
    .string()
    .trim()
    .max(240)
    .optional()
    .transform((value) => (value ? value.trim() : undefined)),
  estPriceCents: centsSchema.optional(),
});

export type AddItemBody = z.infer<typeof addItemBodySchema>;

export const updateItemBodySchema = z
  .object({
    icon: z.string().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(180).optional(),
    qty: z.string().trim().min(1).max(60).optional(),
    note: z
      .string()
      .trim()
      .max(240)
      .optional()
      .transform((value) => (value ? value.trim() : undefined)),
    estPriceCents: centsSchema.optional(),
    actualPriceCents: centsSchema.optional(),
    bought: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.icon !== undefined ||
      data.name !== undefined ||
      data.qty !== undefined ||
      data.note !== undefined ||
      data.estPriceCents !== undefined ||
      data.actualPriceCents !== undefined ||
      data.bought !== undefined,
    {
      message: 'At least one field must be provided.',
      path: [],
    },
  );

export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;

export const finalizeBodySchema = z.object({
  purchasedBy: z.string().trim().max(120).optional(),
});

export type FinalizeBody = z.infer<typeof finalizeBodySchema>;

export const rotatePinBodySchema = z.object({
  oldPin: pinSchema,
  newPin: pinSchema,
});

export type RotatePinBody = z.infer<typeof rotatePinBodySchema>;

export interface RoomSummaryDto {
  id: string;
  roomCode: string;
  version: number;
  tokenVersion: number;
  updatedAt: string;
}

export interface MemberDto {
  id: string;
  name: string;
  role: Role;
  joinedAt: string;
}

export interface ItemDto {
  id: string;
  icon: string;
  name: string;
  qty: string;
  note?: string;
  estPriceCents?: number;
  bought: boolean;
  actualPriceCents?: number;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export interface PurchaseItemDto {
  id: string;
  name: string;
  qty: string;
  priceCents: number;
  icon: string;
  note?: string;
}

export interface PurchaseDto {
  id: string;
  date: string;
  totalCents: number;
  by: string;
  items: PurchaseItemDto[];
}

export interface RoomStateDto {
  room: RoomSummaryDto;
  members: MemberDto[];
  items: ItemDto[];
  history: PurchaseDto[];
}
