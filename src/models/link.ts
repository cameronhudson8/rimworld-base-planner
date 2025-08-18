import joi from "joi";

import { RoomId } from "./room";

export interface LinkData {
  roomIds: {
    0: RoomId;
    1: RoomId;
  };
};

export type Link = LinkData

export const dataSchema = joi.object<LinkData, true>({
  roomIds: joi.object<{ 0: RoomId, 1: RoomId }, true>({
    0: joi.string().min(0),
    1: joi.string().min(0),
  }).assert('.0', joi.invalid(joi.ref('.1')))
});

export function clone(link: LinkData): LinkData {
  return {
    roomIds: {
      0: link.roomIds[0],
      1: link.roomIds[1],
    },
  }
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
