import joi from "joi";

import {
  RoomId,
} from "./room";

export interface CellData {
  roomsAllowed: {
    id: RoomId,
  }[];
  roomId?: RoomId;
};

export const dataSchema = joi.object<CellData, true>({
  roomsAllowed: joi.array<{ id: RoomId }[]>().items(
    joi.object<{ id: RoomId }, true>({
      id: joi.string(),
    }),
  ),
  roomId: joi.string().optional(),
});

export type Cell = CellData;

export function clone(cell: CellData): CellData {
  const clone: CellData = {
    roomsAllowed: cell.roomsAllowed.map((allowedRoom) => ({
      id: allowedRoom.id,
    })),
    roomId: cell.roomId,
  };
  return clone;
};

export function validate(existingCell: unknown): CellData {
  const { error, value } = dataSchema.validate(existingCell);
  if (error !== undefined) {
    throw error;
  }
  return value;
};
