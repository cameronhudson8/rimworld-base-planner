import joi from "joi";
import {
  CellData,
  clone as cloneCell,
  dataSchema as cellDataSchema,
} from "./cell";
import {
  clone as cloneLink,
  dataSchema as linkDataSchema,
  LinkData,
} from "./link";
import {
  clone as cloneRoom,
  dataSchema as roomDataSchema,
  RoomData,
  RoomId,
  RoomName,
} from "./room";

export type GetEnergyOptions = {
  centerOfMassWeight?: number,
  interRoomWeight?: number,
  intraRoomWeight?: number,
};

export type BaseId = string;

export interface BaseData {
  cells: CellData[][];
  links: LinkData[];
  rooms: RoomData[];
};

export enum BaseError {
  NOT_ENOUGH_SPACE = 'NOT_ENOUGH_SPACE',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  TOO_MANY_CELLS_FOR_ROOM = 'TOO_MANY_CELLS_FOR_ROOM',
  UNUSABLE_CELL_WITH_ROOM_NAME = 'UNUSABLE_CELL_WITH_ROOM_NAME',
}
export function notEnoughSpaceError(roomName: string, cellsAvailable: number, cellsNeeded: number): { [key in keyof typeof BaseError]?: string } {
  return { [BaseError.NOT_ENOUGH_SPACE]: `Room '${roomName}' requires ${cellsNeeded} cell(s), but only ${cellsAvailable} cell(s) allow this room.` };
}
export function roomNotFoundError(message: string): { [key in keyof typeof BaseError]?: string } {
  return { [BaseError.ROOM_NOT_FOUND]: message };
}
export function tooManyCellsForRoom(roomName: RoomName, roomSize: number, cellCount: number): { [key in keyof typeof BaseError]?: string } {
  return { [BaseError.TOO_MANY_CELLS_FOR_ROOM]: `The room named '${roomName}' should have '${roomSize}' cells assigned to it, but it has '${cellCount}' cells assigned ot it.` };
}
export function unusableCellWithRoomName(coordinates: [i: number, j: number], roomName: string) {
  const [i, j] = coordinates;
  return { [BaseError.UNUSABLE_CELL_WITH_ROOM_NAME]: `The cell at coordinates [${i}, ${j}] is unusable, but it was also assigned the room name '${roomName}'.` };
}

export const dataSchema = joi.object<BaseData, true>({
  cells: joi.array<CellData[][]>().items(
    joi.array<CellData[]>().items(
      cellDataSchema,
    ),
  ),
  links: joi.array<LinkData[]>().items(
    linkDataSchema.concat(joi.object<LinkData, true>({
      roomIds: joi.object<{ 0: RoomId, 1: RoomId }, true>({
        0: joi.string().allow(joi.in('.....rooms', { adjust: (roomSpec: RoomData) => roomSpec.name })),
        1: joi.string().allow(joi.in('.....rooms', { adjust: (roomSpec: RoomData) => roomSpec.name })),
      }),
    })),
  ),
  rooms: joi.array<RoomData[]>().items(
    roomDataSchema,
  ),
})
  // Allow extraneous key-value pairs.
  .unknown()
  .custom((root: BaseData) => {
    if (!root.cells.every((cellRow) => cellRow.length === root.cells.length)) {
      throw new Error("The grid of cells must be square.");
    }
    return root;
  });

export class Base implements BaseData {

  cells: CellData[][];
  energy: number = 0;
  errors: { [key in keyof typeof BaseError]?: string }[];
  links: LinkData[];
  rooms: RoomData[];

  // The constructor does not preserve any references that are passed in.
  constructor();
  constructor({ cells, links, rooms }: Partial<BaseData>);
  constructor(baseData: Partial<BaseData> = {}) {
    const { cells, links, rooms } = validate(baseData);

    this.cells = cells
      ? cells.map((cellRow) => cellRow.map((cell) => cloneCell(cell)))
      : [[]];
    this.errors = [];
    this.links = links
      ? links.map((link) => cloneLink(link))
      : [];
    this.rooms = rooms
      ? rooms.map((room) => cloneRoom(room))
      : [];

    this.reconcile();
  }

  addLink(roomIds: { 0: RoomId, 1: RoomId }): Base {
    if (this.rooms.find((room) => room.id === roomIds[0]) === undefined) {
      throw new Error(`Can't create link between rooms with ids '${roomIds[0]}' and '${roomIds[1]}' because there is no room with id '${roomIds[0]}'.`);
    }
    if (this.rooms.find((room) => room.id === roomIds[1]) === undefined) {
      throw new Error(`Can't create link between rooms with ids '${roomIds[0]}' and '${roomIds[1]}' because there is no room with id '${roomIds[1]}'.`);
    }
    this.links.push({ roomIds });
    this.reconcile();
    return this;
  }

  addRoom(room: RoomData): Base {
    this.rooms.push(room);
    // If a cell has 0 rooms allowed, that's typically because the cell is not
    // usable at all, so don't make the new room allowed in cells that have 0
    // rooms allowed.
    // Similarly, if a cell only allows 1 room, that's typically because it's
    // contains a feature or item that can't be moved, so don't add the new
    // room to those cells, either.
    this.cells.forEach((cellRow) => cellRow.forEach((cell) => {
      if (cell.roomsAllowed.length > 1) {
        cell.roomsAllowed.push({ id: room.id });
      }
    }))
    this.reconcile();
    return this;
  }

  private computeEnergy(
    {
      centerOfMassWeight,
      interRoomWeight,
      intraRoomWeight,
    }: {
      centerOfMassWeight: number,
      interRoomWeight: number,
      intraRoomWeight: number,
    } = {
        centerOfMassWeight: 0.5,
        interRoomWeight: 1,
        intraRoomWeight: 2,
      }): Base {

    function makeEmptyEnergyStats() {
      return {
        centerOfMassStats: {
          count: 0,
          energy: 0,
        },
        intraRoomStats: {
          count: 0,
          energy: 0,
        },
        interRoomStats: {
          count: 0,
          energy: 0,
        },
      };
    }

    const cellEnergyStats = this.cells.map((cellRow1, cell1i) => {
      return cellRow1.map((cell1, cell1j) => {
        if (
          // Ignore unusable cells.
          cell1.roomsAllowed.length === 0
          // Ignore cells that don't have a room assigned.
          || cell1.roomId === undefined
        ) {
          return [makeEmptyEnergyStats()];
        }

        const cell1LinkedRoomIds = this.links
          .filter((link) => link.roomIds[0] === cell1.roomId || link.roomIds[1] === cell1.roomId)
          .map((link) => link.roomIds[0] === cell1.roomId ? link.roomIds[1] : link.roomIds[0]);

        return this.cells.map((cellRow2, cell2i) => {
          // We only want to compute each cell<->cell energy only once (~n^2/2, not n^2).
          // Therefore, return early depending on cell2i (and below, depending on cell2j).
          return cellRow2.map((cell2, cell2j) => {
            if (
              // Ignore unusable cells.
              cell1.roomsAllowed.length === 0
              // Ignore cells that don't have a room assigned.
              || cell2.roomId === undefined
              // We only want to compute each cell<->cell energy only once (~n^2/2, not n^2).
              // Therefore, return early depending on the coordinates of cell1 and cell2.
              || (cell2i < cell1i) || ((cell2i === cell1i) && (cell2j <= cell1j))
            ) {
              return makeEmptyEnergyStats();
            }

            const isSameRoom = cell1.roomId === cell2.roomId;
            const isLinkedRoom = cell1LinkedRoomIds.includes(cell2.roomId);

            const distance = Math.pow(Math.pow(cell2i - cell1i, 2) + Math.pow(cell2j - cell1j, 2), 0.5)
            const energy = Math.pow(distance, 2);
            return {
              centerOfMassStats: {
                count: 1,
                energy: energy,
              },
              intraRoomStats: {
                count: isSameRoom ? 1 : 0,
                energy: isSameRoom ? energy : 0,
              },
              interRoomStats: {
                count: isLinkedRoom ? 1 : 0,
                energy: isLinkedRoom ? energy : 0,
              },
            };

          });
        }).flat();
      }).flat();
    }).flat();

    const cumulativeEnergyStats = cellEnergyStats.reduce((cumulativeEnergyStats, cellEnergyStats) => ({
      centerOfMassStats: {
        count: cumulativeEnergyStats.centerOfMassStats.count + cellEnergyStats.centerOfMassStats.count,
        energy: cumulativeEnergyStats.centerOfMassStats.energy + cellEnergyStats.centerOfMassStats.energy,
      },
      intraRoomStats: {
        count: cumulativeEnergyStats.intraRoomStats.count + cellEnergyStats.intraRoomStats.count,
        energy: cumulativeEnergyStats.intraRoomStats.energy + cellEnergyStats.intraRoomStats.energy,
      },
      interRoomStats: {
        count: cumulativeEnergyStats.interRoomStats.count + cellEnergyStats.interRoomStats.count,
        energy: cumulativeEnergyStats.interRoomStats.energy + cellEnergyStats.interRoomStats.energy,
      },
    }),
      makeEmptyEnergyStats(),
    );

    const { centerOfMassStats, intraRoomStats, interRoomStats } = cumulativeEnergyStats;
    // We divide the energies by the counts in order to normalize the energies with respect to each other.
    const energy =
      (centerOfMassStats.count === 0 ? 0 : Math.pow(centerOfMassStats.energy / centerOfMassStats.count, centerOfMassWeight))
      + (intraRoomStats.count === 0 ? 0 : Math.pow(intraRoomStats.energy / intraRoomStats.count, intraRoomWeight))
      + (interRoomStats.count === 0 ? 0 : Math.pow(interRoomStats.energy / interRoomStats.count, interRoomWeight));

    this.energy = energy;
    return this;
  }

  deleteLink(index: number): Base {
    if (index > this.links.length - 1) {
      throw new Error(`Attempted to delete the link at index '${index}', but the current maximum index of the links is '${this.links.length - 1}'.`)
    }
    this.links = [
      ...this.links.slice(0, index),
      ...this.links.slice(index + 1),
    ];
    this.reconcile();
    return this;
  }

  deleteRoom(index: number): Base {
    if (index > this.rooms.length - 1) {
      throw new Error(`Attempted to delete the room at index '${index}', but the current maximum index of the rooms is '${this.rooms.length - 1}'.`)
    }
    const deletedRoom = this.rooms[index];
    this.links = this.links
      .filter((link) => link.roomIds[0] !== deletedRoom.id && link.roomIds[1] !== deletedRoom.id);
    this.cells.forEach((cellRow) => cellRow.forEach((cell) => {
      cell.roomsAllowed = cell.roomsAllowed.filter((roomAllowed) => roomAllowed.id !== deletedRoom.id);
    }));
    this.rooms = [
      ...this.rooms.slice(0, index),
      ...this.rooms.slice(index + 1),
    ];
    this.reconcile();
    return this;
  }

  optimize({ iterations } = { iterations: Math.pow(2, 12) }): Base {

    let nextBase = new Base(this);

    for (let iteration = 0; iteration < iterations; iteration += 1) {

      const candidateBase = new Base(nextBase);

      // Create a list of cells, including their coordinates, to facilitate
      // swapping later.
      // Each cells must allow at least 1 room, and we can exclude any cells
      // that allow a room that no other cell allows.
      const cellsWithCoordinates = candidateBase.cells
        .map((cellRow, i) => cellRow.map((cell, j) => ({
          cell,
          coordinates: {
            0: i,
            1: j,
          },
        })))
        .flat();
      const usableCells = cellsWithCoordinates.filter(({ cell }) => cell.roomsAllowed.length > 0);
      const swappableCells = usableCells
        .filter(({ cell }) => {
          if (cell.roomsAllowed.length > 1) {
            return true;
          }
          const allowedRoomId = cell.roomsAllowed[0].id;
          const numberOftherCellsThatAllowThisRoom = usableCells
            .filter(({ cell: c }) => c !== cell && c.roomsAllowed[0].id !== allowedRoomId)
            .length;
          if (numberOftherCellsThatAllowThisRoom === 0) {
            return false;
          }
          return true;
        });

      // Randomly select 2 cells, without replacement.
      // The two cells must allow the IDs of rooms that each other is currently
      // using (if any), and the two cells must not already have the same
      // room ID.
      const [cell1WithCoordinates] = swappableCells.splice(Math.floor(Math.random() * swappableCells.length), 1);
      const swappableCells2 = swappableCells
        .filter((cell2WithCoordinates) => cell2WithCoordinates.cell.roomId !== cell1WithCoordinates.cell.roomId)
        .filter((cell2WithCoordinates) => {
          const cell1RoomId = cell1WithCoordinates.cell.roomId;
          const cell2RoomId = cell2WithCoordinates.cell.roomId;
          if (
            cell1RoomId !== undefined
            && !cell2WithCoordinates.cell.roomsAllowed.some((room) => room.id === cell1RoomId)
          ) {
            return false;
          }
          if (
            cell2RoomId !== undefined
            && !cell1WithCoordinates.cell.roomsAllowed.some((room) => room.id === cell2RoomId)
          ) {
            return false;
          }
          return true;
        });

      if (swappableCells2.length === 0) {
        // There are no other cells that allow cell1's room ID, so this iteration ends.
        continue;
      }
      const [cell2WithCoordinates] = swappableCells2.splice(Math.floor(Math.random() * swappableCells2.length), 1);
      const {
        coordinates: {
          0: cell1i,
          1: cell1j,
        },
      } = cell1WithCoordinates;
      const {
        coordinates: {
          0: cell2i,
          1: cell2j,
        },
      } = cell2WithCoordinates;

      const cell1RoomId = candidateBase.cells[cell1i][cell1j].roomId;
      const cell2RoomId = candidateBase.cells[cell2i][cell2j].roomId;
      candidateBase.cells[cell1i][cell1j].roomId = cell2RoomId;
      candidateBase.cells[cell2i][cell2j].roomId = cell1RoomId;

      candidateBase.reconcile();

      const threshold = nextBase.energy * (1 + Math.pow((iterations - iteration) / iterations, Math.E));
      if (candidateBase.energy < threshold) {
        nextBase = candidateBase;
      }
    }

    if (nextBase.energy < this.energy) {
      nextBase.cells.forEach((cellRow, i) => cellRow.forEach((cell, j) => {
        this.cells[i][j].roomId = cell.roomId;
      }));
      this.energy = nextBase.energy;
    }

    return this;
  }

  unsetCellRoomId(i: number, j: number): Base {
    if (i > this.cells.length - 1 || j > this.cells[0].length - 1) {
      throw new Error(`Attempted to unset the roomId of the cell at [${i}, ${j}], but the current maximum indices of the cells are [${this.cells.length - 1}, ${this.cells[0].length - 1}].`)
    }
    delete this.cells[i][j].roomId;
    this.reconcile();
    return this;
  }

  setCellRoomId(i: number, j: number, roomId: RoomId): Base {
    if (i > this.cells.length - 1 || j > this.cells[0].length - 1) {
      throw new Error(`Attempted to set the roomId of the cell at [${i}, ${j}], but the current maximum indices of the cells are [${this.cells.length - 1}, ${this.cells[0].length - 1}].`)
    }
    if (!this.rooms.some((room) => room.id === roomId)) {
      throw new Error(`Attempted to allow cell [${i}, ${j}] to have roomId '${roomId}', but there is no room with this id.`);
    }
    this.cells[i][j].roomId = roomId;
    this.reconcile();
    return this;
  }

  setCellRoomsAllowed(i: number, j: number, roomsAllowed: { id: RoomId }[]): Base {
    if (i > this.cells.length - 1 || j > this.cells[0].length - 1) {
      throw new Error(`Attempted to set the roomsAllowed of the cell at [${i}, ${j}], but the current maximum indices of the cells are [${this.cells.length - 1}, ${this.cells[0].length - 1}].`)
    }
    for (const roomId in roomsAllowed.map((roomAllowed) => roomAllowed.id)) {
      if (!this.rooms.some((room) => room.id === roomId)) {
        throw new Error(`Attempted to allow cell [${i}, ${j}] to have roomId '${roomId}', but there is no room with this id.`);
      }
    };
    this.cells[i][j].roomsAllowed = roomsAllowed;
    this.reconcile();
    return this;
  }

  setLinkRoomIds(index: number, roomIds: { 0: RoomId; 1: RoomId; }): Base {
    if (index > this.links.length - 1) {
      throw new Error(`Attempted to set the roomIds of the link at index '${index}', but the current maximum index of the links is '${this.links.length - 1}'.`)
    }
    this.links[index].roomIds = roomIds;
    this.reconcile();
    return this;
  }

  setRoomColor(index: number, newRoomColor: string): Base {
    if (index > this.rooms.length - 1) {
      throw new Error(`Attempted to set the color of the room at index '${index}', but the current maximum index of the rooms is '${this.rooms.length - 1}'.`)
    }
    this.rooms[index].color = newRoomColor;
    return this;
  }

  setRoomName(index: number, newRoomName: string): Base {
    if (index > this.rooms.length - 1) {
      throw new Error(`Attempted to set the name of the room at index '${index}', but the current maximum index of the rooms is '${this.rooms.length - 1}'.`)
    }
    this.rooms[index].name = newRoomName;
    return this;
  }

  setRoomSize(index: number, newRoomSize: number): Base {
    if (index > this.rooms.length - 1) {
      throw new Error(`Attempted to set the size of the room at index '${index}', but the current maximum index of the rooms is '${this.rooms.length - 1}'.`)
    }
    this.rooms[index].size = newRoomSize;
    this.reconcile();
    return this;
  }

  /**
   * If the current grid is too SMALL:
   *   If the current size is EVEN,
   *     then add a row on the BOTTOM and a column on the LEFT.
   *   If the current size is ODD,
   *     then add a row on the TOP and a column on the RIGHT.
   * If the current grid is too BIG:
   *   If the current size is EVEN,
   *     then remove a row from the TOP and a column from the RIGHT.
   *   If the current size is ODD,
   *     then remove a row from the BOTTOM and a column from the LEFT.
   */
  setSize(newSize: number): Base {
    if (newSize < 0) {
      throw new Error(`Attempted to set the size of the base to '${newSize}', but the base size must be a non-negative number.`)
    }

    // Decreasing grid size
    while (this.cells.length > newSize) {
      if (this.cells.length % 2 === 0) {
        // Remove a row from the top.
        this.cells.shift();
      } else {
        // Remove a row from the bottom.
        this.cells.pop();
      }
    }
    for (let i = 0; i < this.cells.length; i += 1) {
      while (this.cells[i].length > newSize) {
        if (this.cells[i].length % 2 === 0) {
          // Remove a column from the right.
          this.cells[i].pop();
        } else {
          // Remove a column from the left.
          this.cells[i].shift();
        }
      }
    }

    // Increasing grid size
    while (this.cells.length < newSize) {
      if (this.cells.length % 2 === 0) {
        // Add a row to the bottom.
        this.cells.push([]);
      } else {
        // Add a row to the top.
        this.cells.unshift([]);
      }
    }
    for (let i = 0; i < newSize; i += 1) {
      while (this.cells[i].length < newSize) {
        if (this.cells[i].length % 2 === 0) {
          // Add a column on the left.
          this.cells[i].unshift({
            roomsAllowed: [],
          });
        } else {
          // Add a column on the right.
          this.cells[i].push({
            roomsAllowed: [],
          });
        }
      }
    }

    return this;
  }

  private reconcile(): Base {

    // Clear any existing errors.
    this.errors = [];

    // Reconcile the child resources in this order:
    // 1. The rooms.
    // 2. The links, which refer to the rooms.
    // 3. The cells, which refer to the rooms.
    // 4. The energy, which refers to the rooms, links, and cells.
    this.reconcileRooms();
    this.reconcileLinks();
    this.reconcileCells();
    this.computeEnergy();

    // Check for configuration problems that the user might have made.
    this.errors = this.errors.filter((error) => !(BaseError.NOT_ENOUGH_SPACE in error));
    for (let r = 0; r < this.rooms.length; r += 1) {
      const roomId = this.rooms[r].id;
      const cellsNeeded = this.rooms[r].size;
      const cellsAvailable = this.cells
        .flat()
        .filter((cell) => cell.roomsAllowed.some((room) => room.id === roomId))
        .length;
      if (cellsAvailable < cellsNeeded) {
        this.errors.push(notEnoughSpaceError(this.rooms[r].name, cellsAvailable, cellsNeeded));
      }
    }

    return this;
  }

  private reconcileCells(): Base {

    // For each index, confirm that a corresponding cell exists, and that its
    // CellSpec matches the CellSpec in the BaseSpec.
    for (const baseStatusCellRow of this.cells) {
      while (baseStatusCellRow.length > this.cells[0].length) {
        baseStatusCellRow.pop();
      }
    }
    for (let i = 0; i < this.cells.length; i += 1) {
      if (i > this.cells.length - 1) {
        this.cells.push([]);
      }
      for (let j = 0; j < this.cells[i].length; j += 1) {
        // If there is no cell at this index yet, then create one.
        if (j > this.cells[i].length - 1) {
          const newCell: CellData = {
            roomsAllowed: [],
          };
          this.cells[i].push(newCell);
        }

        // If this cell is assigned to a room that it's no longer allowed be
        // assigned to, then unassign it.
        if (this.cells[i][j].roomId !== undefined && !this.cells[i][j].roomsAllowed.some((room) => room.id === this.cells[i][j].roomId)) {
          const roomId = this.cells[i][j].roomId;
          const roomName = (() => {
            const room = this.rooms.find((room) => room.id === roomId);
            if (room === undefined) {
              throw new Error(`cell [${i}, ${j}] was assigned roomId ${roomId}, but there was no room with that id.`);
            }
            return room.name;
          })();
          console.warn(`cell [${i}, ${j}] was assigned roomId '${this.cells[i][j].roomId}', which corresponds to the room with name '${roomName}', but this cell isn't allowed to be assigned to that room.`);
          delete this.cells[i][j].roomId;
        }
      }
    }

    // Start a tally of how many have cells have been assigned to each room.
    const roomsToAssign: { [roomId: RoomId]: { sizeRemaining: number } } = this.rooms.reduce(
      (roomsToAssign, room) => {
        return {
          ...roomsToAssign,
          [room.id]: {
            sizeRemaining: room.size,
          },
        };
      },
      {},
    );

    // First loop: count the number of cells assigned to each room. If a room
    // has been over-assigned cells, then de-assign cell(s). (We'll assign
    // additional cells next.)
    for (let i = 0; i < this.cells.length; i += 1) {
      for (let j = 0; j < this.cells[i].length; j += 1) {
        const cell = this.cells[i][j];
        if (cell.roomsAllowed.length === 0) {
          delete cell.roomId;
          continue;
        }
        if (cell.roomId === undefined) {
          continue;
        }
        const roomIndex = this.rooms.findIndex((room) => room.id === cell.roomId);
        if (roomIndex < 0) {
          delete cell.roomId;
          continue;
        }
        if (roomsToAssign[cell.roomId].sizeRemaining <= 0) {
          delete cell.roomId;
          continue;
        }
        roomsToAssign[cell.roomId].sizeRemaining -= 1;
      }
    }

    const roomsToAssignQueue = Object.entries(roomsToAssign)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .filter(([_roomId, { sizeRemaining }]) => sizeRemaining > 0)
      .map(([roomId, { sizeRemaining }]) => ({
        roomId,
        sizeRemaining,
      }));
    if (roomsToAssignQueue.length === 0) {
      return this;
    }

    // Assign cells to rooms.
    for (let i = 0; i < this.cells.length; i += 1) {
      if (roomsToAssignQueue.length === 0) {
        break;
      }
      for (let j = 0; j < this.cells[i].length; j += 1) {
        if (roomsToAssignQueue.length === 0) {
          break;
        }

        const cell = this.cells[i][j];

        if (cell.roomId === undefined && cell.roomsAllowed.some((room) => room.id === roomsToAssignQueue[0].roomId)) {
          cell.roomId = roomsToAssignQueue[0].roomId;
          roomsToAssignQueue[0].sizeRemaining -= 1;
          if (roomsToAssignQueue[0].sizeRemaining <= 0) {
            roomsToAssignQueue.shift();
          }
        }

      }
    }
    return this;
  }

  private reconcileLinks(): Base {
    for (let i = this.links.length - 1; i >= 0; i -= 1) {
      const roomId1 = this.links[i].roomIds[0];
      const roomId2 = this.links[i].roomIds[1];
      if (!this.rooms.some((room) => room.id === roomId1)) {
        throw new Error(`Link ${i}'s roomIds[0] (${roomId1}) does not correspond to any room.`);
      }
      if (!this.rooms.some((room) => room.id === roomId2)) {
        throw new Error(`Link ${i}'s roomIds[1] (${roomId2}) does not correspond to any room.`);
      }
    }
    return this;
  }

  private reconcileRooms(): Base {
    return this;
  }

};

// This accepts an unknown variable, performs validation, and returns a class instance.
// It does not preserve references to any objects or sub-objects that are passed in.
export function validate(baseData: unknown): BaseData {
  const { error, value } = dataSchema.validate(baseData);
  if (error !== undefined) {
    throw error;
  }
  return value;
};

export function clone(base: BaseData): BaseData {
  return {
    cells: base.cells.map((baseSpecCellRow) => baseSpecCellRow.map((baseSpecCell) => ({
      roomsAllowed: baseSpecCell.roomsAllowed.map((allowedRoom) => ({
        id: allowedRoom.id,
      })),
    }))),
    links: base.links.map((link) => ({
      roomIds: {
        0: link.roomIds[0],
        1: link.roomIds[1],
      }
    })),
    rooms: base.rooms.map((room) => ({
      name: room.name,
      id: room.id,
      color: room.color,
      size: room.size,
    })),
  };
}
