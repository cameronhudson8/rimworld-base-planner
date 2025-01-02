import { Publisher, UnsubscribeFunc } from "../events/publisher";
import { BaseData, BaseError, BaseId, BaseState, notEnoughSpaceError, roomNotFoundError, clone as cloneBase, tooManyCellsForRoom, unusableCellWithRoomName } from "../models/base";
import { CellData, CellOwnerType, clone as cloneCell } from "../models/cell";
import { LinkData, LinkOwnerType } from "../models/link";
import { RoomData, RoomName, RoomOwnerType } from "../models/room";
import { Database } from "../storage/database";
import { StateData } from "../views/base/base-view";

type Subscription<T> = {
  publisher: Publisher<T>,
  unsubscribe: UnsubscribeFunc,
};

export class BaseReconciler {

  baseDb: Database<BaseData>;
  cellDb: Database<CellData>;
  linkDb: Database<LinkData>;
  roomDb: Database<RoomData>;
  persist: (data: StateData) => void;
  private subscriptions: Subscription<unknown>[] = [];
  reconciliationInProgress: boolean = false;
  queue: BaseId[] = [];

  constructor(
    {
      baseDb,
      cellDb,
      linkDb,
      roomDb,

    }:
      {
        baseDb: Database<BaseData>,
        cellDb: Database<CellData>,
        linkDb: Database<LinkData>,
        roomDb: Database<RoomData>,
      },
    persist: (data: StateData) => void,
  ) {
    this.baseDb = baseDb;
    this.cellDb = cellDb;
    this.linkDb = linkDb;
    this.roomDb = roomDb;
    this.persist = persist;

    // Subscribe to database change events.
    this.subscribe(baseDb);
    // this.subscribe(cellDb);
    // this.subscribe(linkDb);
    // this.subscribe(roomDb);

  }

  optimize(baseId: BaseId, { iterations } = { iterations: Math.pow(2, 6) }): { baseDbData: BaseData[], cellDbData: CellData[] } {

    const base = this.baseDb.get(baseId);
    const cells = base.status.cells.map((baseStatusCellRow) => baseStatusCellRow.map((baseStatusCell) => this.cellDb.get(baseStatusCell.id)));

    let nextBase = cloneBase(base);
    let nextCells = cells.map((cellRow) => cellRow.map((cell) => cloneCell(cell)));

    for (let iteration = 0; iteration < iterations; iteration += 1) {

      const candidateBase = cloneBase(nextBase);
      const candidateCells = nextCells.map((cellRow) => cellRow.map((cell) => cloneCell(cell)));

      // Create a list of usable, unlocked cells, including their coordinates, to facilitate swapping later.
      const usableCells = candidateBase.spec.cells
        .map((baseSpecCellRow, i) => baseSpecCellRow
          .map((baseSpecCell, j) => ({
            isLocked: baseSpecCell.roomName !== undefined,
            cell: this.cellDb.get(candidateBase.status.cells[i][j].id),
            coordinates: {
              0: i,
              1: j,
            },
          }))
        )
        .flat()
        .filter((cellWithCoordinates) => cellWithCoordinates.isLocked === false)
        .filter((cellWithCoordinates) => cellWithCoordinates.cell.spec.usable === true);

      // Randomly select 2 sets of coordinates, without replacement.
      const [cell1WithCoordinates] = usableCells.splice(Math.floor(Math.random() * usableCells.length), 1);
      const [cell2WithCoordinates] = usableCells.splice(Math.floor(Math.random() * usableCells.length), 1);
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

      // We want to swap 3 things:
      // 1. If present, the roomName(s) in the CellSpecs of the BaseSpec.
      //    (There aren't corresponding roomId(s) in the the CellStatuses of the BaseStatus.)
      // 2. The roomName(s) in the CellSpecs of the cells.
      // 3. The roomIds(s) in the CellStatuses of the cells.
      const baseSpecCell1RoomName = candidateBase.spec.cells[cell1i][cell1j].roomName;
      const baseSpecCell2RoomName = candidateBase.spec.cells[cell2i][cell2j].roomName;
      candidateBase.spec.cells[cell1i][cell1j].roomName = baseSpecCell2RoomName;
      candidateBase.spec.cells[cell1i][cell1j].roomName = baseSpecCell1RoomName;

      const cell1SpecRoomName = candidateCells[cell1i][cell1j].spec.roomName;
      const cell2SpecRoomName = candidateCells[cell2i][cell2j].spec.roomName;
      candidateCells[cell1i][cell1j].spec.roomName = cell2SpecRoomName;
      candidateCells[cell2i][cell2j].spec.roomName = cell1SpecRoomName;

      const cell1StatusRoomId = candidateCells[cell1i][cell1j].status.roomId;
      const cell2StatusRoomId = candidateCells[cell2i][cell2j].status.roomId;
      candidateCells[cell1i][cell1j].status.roomId = cell2StatusRoomId;
      candidateCells[cell2i][cell2j].status.roomId = cell1StatusRoomId;

      // Create a temporary "database" (not saved to local storage) that we will use for the energy computation.
      const cellDb = new Database<CellData>(candidateCells.flat());

      candidateBase.status.energy = this.computeEnergy(candidateBase, { cellDb });

      // Parabolic
      const threshold = nextBase.status.energy * (1 + Math.pow((iterations - iteration) / iterations, Math.E));

      if (candidateBase.status.energy < threshold) {
        nextBase = candidateBase;
        nextCells = candidateCells;
      }
    }

    nextBase = nextBase.status.energy < base.status.energy ? nextBase : base;
    nextCells = nextBase.status.energy < base.status.energy ? nextCells : cells;
    nextBase.status.state = BaseState.READY;

    return {
      baseDbData: [nextBase],
      cellDbData: nextCells.flat(),
    };
  }

  reconcile(baseId: BaseId): BaseData {

    // Clear any existing errors.
    let base = this.baseDb.get(baseId);
    base.status.errors = [];
    this.baseDb.put(base);

    // Reconcile the child resources in this order:
    // 1. The rooms.
    // 2. The links, which refer to the rooms.
    // 3. The cells, which refer to the rooms.
    this.reconcileRooms(this.baseDb.get(baseId));
    this.reconcileLinks(this.baseDb.get(baseId));
    this.reconcileCells(this.baseDb.get(baseId));

    base = this.baseDb.get(baseId);

    const cellsNeeded = base.spec.rooms.reduce((cellsNeeded, room) => cellsNeeded + room.size, 0)
    const cellsAvailable = base.spec.cells.reduce(
      (cellsAvailable, cellRow) => {
        return cellsAvailable + cellRow.filter((cell) => cell.usable === true).length;
      },
      0,
    );
    base.status.errors = base.status.errors.filter((error) => !(BaseError.NOT_ENOUGH_SPACE in error));
    if (cellsAvailable < cellsNeeded) {
      base.status.errors.push(notEnoughSpaceError(cellsAvailable, cellsNeeded));
      this.baseDb.put(base);
    }
    base.status.energy = this.computeEnergy(base);
    base.status.state = BaseState.READY;
    this.baseDb.put(base);
    return base;
  }

  private computeEnergy(
    base: BaseData,
    {
      cellDb = this.cellDb,
      centerOfMassWeight = 0.5,
      interRoomWeight = 1,
      intraRoomWeight = 2,
      linkDb = this.linkDb,
    } = {
        cellDb: this.cellDb,
        centerOfMassWeight: 0.5,
        interRoomWeight: 1,
        intraRoomWeight: 2,
        linkDb: this.linkDb,
      }
  ): number {

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

    const baseLinks = base.status.links.map((baseStatusLink) => linkDb.get(baseStatusLink.id));

    const cellEnergyStats = base.status.cells.map((baseStatusCellRow1, cell1i) => {
      return baseStatusCellRow1.map((baseStatusCell1, cell1j) => {
        const cell1 = cellDb.get(baseStatusCell1.id);
        if (
          // Ignore unusable cells.
          cell1.spec.usable === false
          // Ignore cells that don't have a room assigned.
          || cell1.status.roomId === undefined
        ) {
          return [makeEmptyEnergyStats()];
        }

        const cell1LinkedRoomIds = baseLinks
          .filter((link) => link.status.roomIds[0] === cell1.status.roomId || link.status.roomIds[1] === cell1.status.roomId)
          .map((link) => link.status.roomIds[0] === cell1.status.roomId ? link.status.roomIds[1] : link.status.roomIds[0]);

        return base.status.cells.map((baseStatusCellRow2, cell2i) => {
          // We only want to compute each cell<->cell energy only once (~n^2/2, not n^2).
          // Therefore, return early depending on cell2i (and below, depending on cell2j).
          return baseStatusCellRow2.map((baseStatusCell2, cell2j) => {
            const cell2 = cellDb.get(baseStatusCell2.id);
            if (
              // Ignore unusable cells.
              cell1.spec.usable === false
              // Ignore cells that don't have a room assigned.
              || cell2.status.roomId === undefined
              // We only want to compute each cell<->cell energy only once (~n^2/2, not n^2).
              // Therefore, return early depending on the coordinates of cell1 and cell2.
              || (cell2i < cell1i) || ((cell2i === cell1i) && (cell2j <= cell1j))
            ) {
              return makeEmptyEnergyStats();
            }

            const isSameRoom = cell1.status.roomId === cell2.status.roomId;
            const isLinkedRoom = cell1LinkedRoomIds.includes(cell2.status.roomId);

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
    return energy;
  }

  private reconcileCells(base: BaseData): void {

    // At the end, we will delete any cells that are owned by this base, but
    // that are no longer used.
    let cellsToDelete = this.cellDb.list([
      (cell) => cell.metadata.owner?.type === CellOwnerType.BASE && cell.metadata.owner?.id === base.id,
    ]);

    // Start a tally of how many have cells have been assigned to each room.
    const roomsToAssign: { [roomName: RoomName]: { name: RoomName, sizeRemaining: number } } = base.spec.rooms.reduce((roomsToAssign, roomSpec, i) => ({
      ...roomsToAssign,
      [base.status.rooms[i].id]: {
        name: roomSpec.name,
        sizeRemaining: roomSpec.size,
      },
    }), {});

    for (const [i, cellSpecRow] of base.spec.cells.entries()) {

      // If the status array is too small, then we will need to add a new row.
      if (i > (base.status.cells.length - 1)) {
        base.status.cells.push([]);
      }

      for (const [j, cellSpec] of cellSpecRow.entries()) {

        // If the status[i] array is too small, then we will need to add a new cell.
        if (j > (base.status.cells[i].length - 1)) {
          let roomId;
          if (cellSpec.roomName !== undefined) {
            const roomIndex = base.spec.rooms.findIndex((room) => room.name === cellSpec.roomName);
            if (roomIndex < 0) {
              base.status.errors.push(roomNotFoundError(`The cell at coordinates [${i}, ${j}] is assigned to a room with name '${cellSpec.roomName}', but there is no such room.`));
              this.baseDb.put(base);
              continue;
            }
            roomId = base.status.rooms[roomIndex].id;
          }
          const newCell = this.cellDb.create({
            metadata: {
              owner: {
                type: CellOwnerType.BASE,
                id: base.id,
              },
            },
            spec: cellSpec,
            status: {
              roomId,
            },
          });
          base.status.cells[i].push({ id: newCell.id });
          this.baseDb.put(base);
        }

        // Get the cell.
        const cellId = base.status.cells[i][j].id;
        const cell = this.cellDb.get(cellId);
        cellsToDelete = cellsToDelete.filter((cellToDelete) => cellToDelete.id !== cell.id);

        // If the cell is different in any way, then update it.
        cell.metadata = {
          owner: {
            type: CellOwnerType.BASE,
            id: base.id,
          },
        };

        if (cellSpec.usable === true && cellSpec.roomName === undefined) {
          cell.spec.usable = cellSpec.usable;
          // Don't clear the cell's existing roomName and roomId,
          // in case it was previously auto-assigned a room.
          // delete cell.spec.roomName;
          // delete cell.status.roomId;

        } else if (cellSpec.usable === true && cellSpec.roomName !== undefined) {
          const roomIndex = base.spec.rooms.findIndex((room) => room.name === cellSpec.roomName);
          if (roomIndex < 0) {
            base.status.errors = base.status.errors.filter((error) => !Object.keys(error).includes(BaseError.ROOM_NOT_FOUND));
            base.status.errors.push(roomNotFoundError(`The cell at coordinates [${i}, ${j}] is assigned to a room with name '${cellSpec.roomName}', but there is no such room.`));
            this.baseDb.put(base);
            continue;
          };
          const roomId = base.status.rooms[roomIndex].id;
          cell.spec.usable = cellSpec.usable;
          cell.spec.roomName = cellSpec.roomName;
          cell.status.roomId = roomId;
          roomsToAssign[roomId].sizeRemaining -= 1;
          if (roomsToAssign[roomId].sizeRemaining < 0) {
            const room = this.roomDb.get(roomId);
            base.status.errors = base.status.errors.filter((error) => !Object.keys(error).includes(BaseError.TOO_MANY_CELLS_FOR_ROOM));
            base.status.errors.push(tooManyCellsForRoom(cellSpec.roomName, room.spec.size, room.spec.size - roomsToAssign[roomId].sizeRemaining));
            this.baseDb.put(base);
          }

        } else if (cellSpec.usable === false && cellSpec.roomName === undefined) {
          cell.spec.usable = cellSpec.usable;
          delete cell.spec.roomName;
          delete cell.status.roomId;

        } else if (cellSpec.usable === false && cellSpec.roomName !== undefined) {
          base.status.errors = base.status.errors.filter((error) => !Object.keys(error).includes(BaseError.UNUSABLE_CELL_WITH_ROOM_NAME));
          base.status.errors.push(unusableCellWithRoomName([i, j], cellSpec.roomName));
          this.baseDb.put(base);
        }
        this.cellDb.put(cell);

      }

      // It's possible that the BaseSpec has decreased in size.
      // Therefore, shrink the BaseStatus accordingly.
      base.status.cells[i].splice(base.spec.cells[i].length, (base.status.cells[i].length - base.spec.cells[i].length));
      this.baseDb.put(base);

    }

    // It's possible that the BaseSpec has decreased in size.
    // Therefore, shrink the BaseStatus accordingly.
    base.status.cells.splice(base.spec.cells.length, (base.status.cells.length - base.spec.cells.length));
    this.baseDb.put(base);

    // Delete any lingering cells that are owned by this base.
    cellsToDelete.forEach((existingCell) => {
      this.cellDb.delete(existingCell.id);
    });

    // Automatically assign cells. (Do not modify those that we previously
    // counted because they were explicitly assigned a room in the BaseSpec by
    // the user.)
    // First, determine how many more cells we need to assign to each room.
    // If we find that any rooms have too many cells assigned,
    // or if we find cells that were previously assigned to a roomId that no
    // longer exists, then unassign cells as necessary.
    for (let i = 0; i < base.status.cells.length; i += 1) {
      for (let j = 0; j < base.status.cells[i].length; j += 1) {
        const cellId = base.status.cells[i][j].id;
        const cell = this.cellDb.get(cellId);
        if (base.spec.cells[i][j].usable === false) {
          cell.spec.usable = false;
          delete cell.spec.roomName;
          delete cell.status.roomId;
          this.cellDb.put(cell);
          continue;
        }
        if (cell.spec.roomName === undefined) {
          delete cell.status.roomId;
          this.cellDb.put(cell);
          continue;
        }
        const roomIndex = base.spec.rooms.findIndex((room) => room.name === cell.spec.roomName);
        if (roomIndex < 0) {
          delete cell.spec.roomName;
          delete cell.status.roomId;
          this.cellDb.put(cell);
          continue;
        }
        const roomId = base.status.rooms[roomIndex].id;
        // If this cell was explicitly assigned to a room, then skip it,
        // since we counted those earlier.
        if (base.spec.cells[i][j].roomName !== undefined) {
          continue;
        }

        // If there are too many cells assigned this room, then unassign this
        // cell, as long as it's not explicitly assigned to this room in the
        // BaseSpec.
        if (roomsToAssign[roomId].sizeRemaining <= 0 && base.spec.cells[i][j].roomName !== cell.spec.roomName) {
          delete cell.status.roomId;
          delete cell.spec.roomName;
          this.cellDb.put(cell);
          continue;
        }
        cell.status.roomId = roomId;
        this.cellDb.put(cell);
        roomsToAssign[cell.status.roomId].sizeRemaining -= 1;
      }
    }
    // Now assign the remaining usable cells to rooms.
    const roomsToAssignQueue = Object.entries(roomsToAssign)
      .filter(([, room]) => room.sizeRemaining > 0)
      .map(([roomId, room]) => ({
        id: roomId,
        name: room.name,
        sizeRemaining: room.sizeRemaining,
      }));
    for (let i = 0; i < base.status.cells.length; i += 1) {
      if (roomsToAssignQueue.length <= 0) {
        break;
      }
      for (let j = 0; j < base.status.cells[i].length; j += 1) {
        if (roomsToAssignQueue.length <= 0) {
          break;
        }
        const cellId = base.status.cells[i][j].id;
        const cell = this.cellDb.get(cellId);
        if (cell.spec.usable === false) {
          continue;
        }
        if (cell.spec.roomName !== undefined) {
          continue;
        }
        const roomToAssign = roomsToAssignQueue[0];
        cell.spec.roomName = roomToAssign.name;
        cell.status.roomId = roomToAssign.id;
        this.cellDb.put(cell);
        roomToAssign.sizeRemaining -= 1;
        if (roomToAssign.sizeRemaining <= 0) {
          roomsToAssignQueue.shift();
        }
      }
    }

  }

  private reconcileLinks(base: BaseData): void {

    // At the end, we will delete any links that are owned by this base, but
    // that are no longer used.
    let linksToDelete = this.linkDb.list([
      (link) => link.metadata.owner?.type === LinkOwnerType.BASE && link.metadata.owner?.id === base.id,
    ]);

    for (const [i, linkSpec] of base.spec.links.entries()) {

      // If the status array is too small, then we will need to add a new link.
      if (i > base.status.links.length - 1) {
        const room0Index = base.spec.rooms.findIndex((room) => room.name === linkSpec.roomNames[0]);
        if (room0Index < 0) {
          base.status.errors.push(roomNotFoundError(`A link connects rooms with names '${linkSpec.roomNames[0]}' and '${linkSpec.roomNames[1]}', but there is no room with the name '${linkSpec.roomNames[0]}'.`));
          this.baseDb.put(base);
          continue;
        }
        const room1Index = base.spec.rooms.findIndex((room) => room.name === linkSpec.roomNames[1]);
        if (room1Index < 0) {
          base.status.errors.push(roomNotFoundError(`A link connects rooms with names '${linkSpec.roomNames[0]}' and '${linkSpec.roomNames[1]}', but there is no room with the name '${linkSpec.roomNames[1]}'.`));
          this.baseDb.put(base);
          continue;
        }
        const room0Id = base.status.rooms[room0Index].id;
        const room1Id = base.status.rooms[room1Index].id;
        const newLink = this.linkDb.create({
          metadata: {
            owner: {
              type: LinkOwnerType.BASE,
              id: base.id,
            },
          },
          spec: linkSpec,
          status: {
            roomIds: {
              0: room0Id,
              1: room1Id,
            }
          },
        });
        base.status.links.push({ id: newLink.id });
        this.baseDb.put(base);
      }

      // Get the link.
      const linkId = base.status.links[i].id;
      const link = this.linkDb.get(linkId);
      linksToDelete = linksToDelete.filter((linkToDelete) => linkToDelete.id !== link.id);

      // Look up rooms with matching room names. This is not
      // 100% accurate because the user could have 2 rooms with the same name.
      const room0Index = base.spec.rooms.findIndex((room) => room.name === linkSpec.roomNames[0]);
      if (room0Index < 0) {
        base.status.errors.push(roomNotFoundError(`A link connects rooms with names '${linkSpec.roomNames[0]}' and '${linkSpec.roomNames[1]}', but there is no room with the name '${linkSpec.roomNames[0]}'.`));
        this.baseDb.put(base);
        continue;
      }
      const room1Index = base.spec.rooms.findIndex((room) => room.name === linkSpec.roomNames[1]);
      if (room1Index < 0) {
        base.status.errors.push(roomNotFoundError(`A link connects rooms with names '${linkSpec.roomNames[0]}' and '${linkSpec.roomNames[1]}', but there is no room with the name '${linkSpec.roomNames[1]}'.`));
        this.baseDb.put(base);
        continue;
      }
      const room0Id = base.status.rooms[room0Index].id;
      const room1Id = base.status.rooms[room1Index].id;

      // If the link is different in any way, then update it.
      link.metadata = {
        owner: {
          type: LinkOwnerType.BASE,
          id: base.id,
        },
      };
      this.linkDb.put(link);
      link.spec = {
        roomNames: {
          0: linkSpec.roomNames[0],
          1: linkSpec.roomNames[1],
        },
      };
      link.status = {
        roomIds: {
          0: room0Id,
          1: room1Id,
        }
      };
      this.linkDb.put(link);
    }

    // It's possible that the BaseSpec has decreased in size.
    // Therefore, shrink the BaseStatus accordingly.
    base.status.links.splice(base.spec.links.length, (base.status.links.length - base.spec.links.length));
    this.baseDb.put(base);

    // Delete any lingering links that are owned by this base.
    linksToDelete.forEach((existingLink) => {
      this.linkDb.delete(existingLink.id);
    });
  }

  private reconcileRooms(base: BaseData): void {

    // At the end, we will delete any rooms that are owned by this base, but
    // that are no longer used.
    let roomsToDelete = this.roomDb.list([
      (room) => room.metadata.owner?.type === RoomOwnerType.BASE && room.metadata.owner?.id === base.id,
    ]);

    for (const [i, roomSpec] of base.spec.rooms.entries()) {

      // If the status array is too small, then we will need to create a new room.
      if (i > (base.status.rooms.length - 1)) {
        const newRoom = this.roomDb.create({
          metadata: {
            owner: {
              type: RoomOwnerType.BASE,
              id: base.id,
            },
          },
          spec: roomSpec,
          status: {},
        });
        base.status.rooms.push({ id: newRoom.id });
        this.baseDb.put(base);
      }

      // Get the room.
      const roomId = base.status.rooms[i].id;
      const room = this.roomDb.get(roomId);
      roomsToDelete = roomsToDelete.filter((roomToDelete) => roomToDelete.id !== room.id);

      // If the room is different in any way, then update it.
      room.metadata = {
        owner: {
          type: RoomOwnerType.BASE,
          id: base.id,
        }
      };
      room.spec = {
        color: roomSpec.color,
        name: roomSpec.name,
        size: roomSpec.size,
      };
      room.status = {};
      this.roomDb.put(room);
    }

    // It's possible that the BaseSpec has decreased in size.
    // Therefore, shrink the BaseStatus accordingly.
    base.status.rooms.splice(base.spec.rooms.length, (base.status.rooms.length - base.spec.rooms.length));
    this.baseDb.put(base);

    // Delete any lingering rooms that are owned by this base.
    roomsToDelete.forEach((roomToDelete) => {
      this.roomDb.delete(roomToDelete.id);
    });
  }

  private subscribe<T>(publisher: Publisher<T>): void {
    const unsubscribe = publisher.addSubscriber(() => {
      // TODO This is naive for now. I don't have a good way of knowing what data type
      // the record was, let alone which base(s) it affects.

      // Begin critical section
      // This only works because there is only one instance of this BaseReconciler in existence at any time.
      if (this.reconciliationInProgress === true) {
        return;
      }
      this.reconciliationInProgress = true;
      for (const base of this.baseDb.list()) {
        base.status.state = BaseState.RECONCILING;
        this.baseDb.put(base);
        this.queue.push(base.id);
      }
      try {
        for (const baseId of this.queue) {
          const base = this.baseDb.get(baseId);
          switch (base.status.state) {
            case BaseState.READY: {
              continue;
            }
            case BaseState.RECONCILING: {
              this.reconcile(base.id);
              continue;
            }
            default: {
              throw new Error(`Unknown base state '${base.status.state}'.`);
            }
          }
        }
      } finally {
        this.persist({
          baseDbData: Object.values(this.baseDb.records),
          cellDbData: Object.values(this.cellDb.records),
          linkDbData: Object.values(this.linkDb.records),
          roomDbData: Object.values(this.roomDb.records),
        });
        this.reconciliationInProgress = false;
      }
    });
    this.subscriptions.push({
      publisher,
      unsubscribe,
    });
  }

}
