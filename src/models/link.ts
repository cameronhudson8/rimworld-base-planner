import joi from "joi";

import { RoomId } from "./room";

export const DEFAULT_LINK_WEIGHT = 1;

export interface LinkData {
  roomIds: {
    0: RoomId;
    1: RoomId;
  };
  // Relative importance of this link. Higher means the optimizer will sacrifice
  // weaker links before this one. If omitted, defaults to DEFAULT_LINK_WEIGHT.
  weight?: number;
  // If true, the adjacency is treated as a hard requirement (very large
  // penalty when not satisfied). Defaults to false.
  hard?: boolean;
};

export type Link = LinkData

export const dataSchema = joi.object<LinkData, true>({
  roomIds: joi.object<{ 0: RoomId, 1: RoomId }, true>({
    0: joi.string().min(0),
    1: joi.string().min(0),
  }).assert('.0', joi.invalid(joi.ref('.1'))),
  weight: joi.number().min(0).optional(),
  hard: joi.boolean().optional(),
});

export function clone(link: LinkData): LinkData {
  return {
    roomIds: {
      0: link.roomIds[0],
      1: link.roomIds[1],
    },
    ...(link.weight !== undefined ? { weight: link.weight } : {}),
    ...(link.hard !== undefined ? { hard: link.hard } : {}),
  }
};

export function getWeight(link: LinkData): number {
  return link.weight ?? DEFAULT_LINK_WEIGHT;
};

export function isHard(link: LinkData): boolean {
  return link.hard === true;
};

export function equal(link1: LinkData, link2: LinkData): boolean {
  return (link1.roomIds[0] === link2.roomIds[0] && link1.roomIds[1] === link2.roomIds[1])
    || (link1.roomIds[0] === link2.roomIds[1] && link1.roomIds[1] === link2.roomIds[0]);
};

// This accepts an unknown variable, performs validation, and returns a class instance.
// It does not preserve references to any objects or sub-objects that are passed in.
export function validate(existingLink: unknown): LinkData {
  const { error, value } = dataSchema.validate(existingLink);
  if (error !== undefined) {
    throw error;
  }
  return value;
};
