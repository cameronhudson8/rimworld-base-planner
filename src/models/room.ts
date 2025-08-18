import joi from "joi";

import { padWithZeros } from "../utils";

export type RoomId = string;

export type RoomName = string;

export interface RoomData {
  color: string;
  id: RoomId;
  name: RoomName;
  size: number;
};

export class Room implements RoomData {

  color: string;
  id: RoomId;
  name: RoomName;
  size: number;

  constructor();
  constructor(
    {
      color,
      id,
      name,
      size,
    }:
      {
        color?: string,
        id?: RoomId,
        name?: RoomName,
        size?: number,
      });
  constructor(
    {
      color,
      id,
      name,
      size,
    }:
      {
        color?: string,
        id?: RoomId,
        name?: RoomName,
        size?: number,
      } = {}) {
    this.color = color ?? randomColor();
    this.id = id ?? crypto.randomUUID()
    this.name = name ?? "";
    this.size = size ?? 0;
  }
};

export const dataSchema = joi.object<RoomData, true>({
  color: joi.string().regex(/#[a-f0-9]{6}/i),
  id: joi.string().min(0),
  name: joi.string().min(0),
  size: joi.number(),
});

// This returns a deep clone of an existing class instance. No object references are preserved.
export function clone(room: RoomData): RoomData {
  const clone: RoomData = {
    color: room.color,
    id: room.id,
    name: room.name,
    size: room.size,
  };
  return clone;
};

// This accepts an unknown variable, performs validation, and returns a class instance.
// It does not preserve references to any objects or sub-objects that are passed in.
export function validate(existingRoom: unknown): RoomData {
  const { error, value } = dataSchema.validate(existingRoom);
  if (error !== undefined) {
    throw error;
  }
  return value;
};

export function randomColor(): string {
  const colorsHex = Array.from(crypto.getRandomValues(new Uint8Array(3)))
    .map((color) => {
      const hex = Number(color).toString(16);
      const paddedHex = padWithZeros(hex, 2);
      return paddedHex;
    });
  return `#${colorsHex.join('')}`;
};
