import joi from "joi";
import {
  CellData,
  clone as cloneCell,
  dataSchema as cellDataSchema,
} from "./cell";
import {
  clone as cloneLink,
  dataSchema as linkDataSchema,
  getWeight as getLinkWeight,
  isHard as isLinkHard,
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
  intraRoomWeight?: number,
  adjacencyWeight?: number,
  missingAdjacencyPenalty?: number,
  hardAdjacencyPenalty?: number,
};

export type BaseId = string;

export interface LinkReport {
  roomIds: { 0: RoomId, 1: RoomId };
  weight: number;
  hard: boolean;
  sharedSides: number;
  satisfied: boolean;
};

export interface OptimizeOptions {
  iterations?: number;
  restarts?: number;
  t0?: number;
  tFinal?: number;
  coolingRate?: number;
  // Optional callback fired after each restart. Called with (completed, total).
  onProgress?: (completedRestarts: number, totalRestarts: number) => void;
};

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
      weight: joi.number().min(0).optional(),
      hard: joi.boolean().optional(),
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
  linkReports: LinkReport[] = [];
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
      intraRoomWeight,
      adjacencyWeight,
      missingAdjacencyPenalty,
      hardAdjacencyPenalty,
    }: {
      centerOfMassWeight: number,
      intraRoomWeight: number,
      adjacencyWeight: number,
      missingAdjacencyPenalty: number,
      hardAdjacencyPenalty: number,
    } = {
        centerOfMassWeight: 0.5,
        intraRoomWeight: 2,
        adjacencyWeight: 1,
        // Constant added per missing soft-link adjacency (before weight). This
        // dominates any centroid-distance term so "near but not touching" is
        // strictly worse than "touching".
        missingAdjacencyPenalty: 1000,
        // Constant added per missing hard-link adjacency (before weight).
        hardAdjacencyPenalty: 100000,
      }): Base {

    // --- Center-of-mass + intra-room energy (compactness) -------------------
    // For every pair of assigned cells, accumulate squared euclidean distance:
    //   - centerOfMassStats: all pairs (keeps the base compact)
    //   - intraRoomStats:    pairs of cells in the same room (keeps each room
    //                        connected/compact)
    // Inter-room (linked) cost is no longer based on centroid distance — see
    // the adjacency term below.

    let comEnergy = 0;
    let comCount = 0;
    let intraEnergy = 0;
    let intraCount = 0;

    for (let i1 = 0; i1 < this.cells.length; i1 += 1) {
      const row1 = this.cells[i1];
      for (let j1 = 0; j1 < row1.length; j1 += 1) {
        const cell1 = row1[j1];
        if (cell1.roomsAllowed.length === 0 || cell1.roomId === undefined) {
          continue;
        }
        for (let i2 = i1; i2 < this.cells.length; i2 += 1) {
          const row2 = this.cells[i2];
          const jStart = i2 === i1 ? j1 + 1 : 0;
          for (let j2 = jStart; j2 < row2.length; j2 += 1) {
            const cell2 = row2[j2];
            if (cell2.roomId === undefined) {
              continue;
            }
            const di = i2 - i1;
            const dj = j2 - j1;
            const sqDist = di * di + dj * dj;
            comEnergy += sqDist;
            comCount += 1;
            if (cell1.roomId === cell2.roomId) {
              intraEnergy += sqDist;
              intraCount += 1;
            }
          }
        }
      }
    }

    // --- Adjacency energy (per link) ---------------------------------------
    // For each link, count how many 4-connected cell pairs sit on the boundary
    // between the two rooms. A link is "satisfied" when at least one such pair
    // exists. Unsatisfied links pay a flat penalty (so 'close but no shared
    // wall' is strictly worse than touching) PLUS the manhattan distance
    // between the rooms' closest cells (gives the annealer a gradient toward
    // the other room).

    const cellsByRoom = new Map<RoomId, Array<{ i: number, j: number }>>();
    for (let i = 0; i < this.cells.length; i += 1) {
      for (let j = 0; j < this.cells[i].length; j += 1) {
        const cell = this.cells[i][j];
        if (cell.roomId !== undefined) {
          let arr = cellsByRoom.get(cell.roomId);
          if (arr === undefined) {
            arr = [];
            cellsByRoom.set(cell.roomId, arr);
          }
          arr.push({ i, j });
        }
      }
    }

    const linkReports: LinkReport[] = [];
    let adjacencyEnergy = 0;

    for (const link of this.links) {
      const roomAId = link.roomIds[0];
      const roomBId = link.roomIds[1];
      const cellsA = cellsByRoom.get(roomAId) ?? [];
      const cellsB = cellsByRoom.get(roomBId) ?? [];
      const weight = getLinkWeight(link);
      const hard = isLinkHard(link);

      // Count 4-connected shared sides between roomA and roomB.
      let sharedSides = 0;
      if (cellsA.length > 0 && cellsB.length > 0) {
        const setB = new Set<string>(cellsB.map((c) => `${c.i},${c.j}`));
        for (const a of cellsA) {
          if (setB.has(`${a.i - 1},${a.j}`)) sharedSides += 1;
          if (setB.has(`${a.i + 1},${a.j}`)) sharedSides += 1;
          if (setB.has(`${a.i},${a.j - 1}`)) sharedSides += 1;
          if (setB.has(`${a.i},${a.j + 1}`)) sharedSides += 1;
        }
      }

      // Minimum manhattan distance between any cell in A and any cell in B.
      // Only computed when no shared sides — used as a gradient term to pull
      // unsatisfied links together.
      let minManhattan = 0;
      let linkEnergy = 0;
      if (sharedSides === 0) {
        if (cellsA.length === 0 || cellsB.length === 0) {
          // One of the rooms hasn't been placed yet — no spatial term to add.
          minManhattan = 0;
        } else {
          minManhattan = Number.POSITIVE_INFINITY;
          for (const a of cellsA) {
            for (const b of cellsB) {
              const d = Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
              if (d < minManhattan) {
                minManhattan = d;
              }
            }
          }
        }
        const flat = hard ? hardAdjacencyPenalty : missingAdjacencyPenalty;
        linkEnergy = weight * (flat + minManhattan * minManhattan);
      }
      // When sharedSides >= 1 the link is satisfied: no penalty. We deliberately
      // don't reward extra shared sides — that would distort other constraints.

      adjacencyEnergy += linkEnergy;
      linkReports.push({
        roomIds: { 0: roomAId, 1: roomBId },
        weight,
        hard,
        sharedSides,
        satisfied: sharedSides > 0,
      });
    }

    // --- Intra-room connectivity (keep each room as one contiguous block) ----
    // For each room: find its largest 4-connected component. Cells in the
    // minority components are "isolated". For every isolated cell we add
    //   (manhattan_distance_to_main_component + 1) * connectivityWeightPerCell
    // The "+1" is a flat per-isolated-cell penalty; the manhattan distance is
    // what gives the annealer a continuous gradient toward reabsorbing the
    // stray cell into the main block (a step closer = strictly lower energy).
    let connectivityPenalty = 0;
    // 5000 means a stray cell at manhattan-distance 1 costs 10,000 — strictly
    // more than satisfying a single soft link of weight 10. Rationale: in the
    // actual game, colonists cannot walk between the two pieces of a
    // "fragmented" room, so the room isn't really a room. Better to lose a
    // soft adjacency than to ship a layout the player can't actually build.
    const connectivityWeightPerCell = 5000;
    for (const room of this.rooms) {
      const roomCellsList = cellsByRoom.get(room.id) ?? [];
      if (roomCellsList.length <= 1) continue;

      const cellSet = new Set(roomCellsList.map((c) => `${c.i},${c.j}`));
      const visited = new Set<string>();
      // Each component as the set of its member-cell keys.
      const components: Array<Array<{ i: number, j: number }>> = [];
      for (const start of roomCellsList) {
        const startKey = `${start.i},${start.j}`;
        if (visited.has(startKey)) continue;
        const component: Array<{ i: number, j: number }> = [];
        const queue: Array<{ i: number, j: number }> = [start];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          const k = `${cur.i},${cur.j}`;
          if (visited.has(k)) continue;
          visited.add(k);
          component.push(cur);
          for (const [ni, nj] of [[cur.i - 1, cur.j], [cur.i + 1, cur.j], [cur.i, cur.j - 1], [cur.i, cur.j + 1]]) {
            const nkey = `${ni},${nj}`;
            if (cellSet.has(nkey) && !visited.has(nkey)) {
              queue.push({ i: ni, j: nj });
            }
          }
        }
        components.push(component);
      }
      if (components.length <= 1) continue;

      // Largest component (by cell count) wins ties by being the first found.
      let mainIdx = 0;
      for (let k = 1; k < components.length; k += 1) {
        if (components[k].length > components[mainIdx].length) {
          mainIdx = k;
        }
      }
      const mainComponent = components[mainIdx];

      for (let k = 0; k < components.length; k += 1) {
        if (k === mainIdx) continue;
        for (const stray of components[k]) {
          let minDist = Number.POSITIVE_INFINITY;
          for (const target of mainComponent) {
            const d = Math.abs(stray.i - target.i) + Math.abs(stray.j - target.j);
            if (d < minDist) minDist = d;
          }
          connectivityPenalty += (minDist + 1) * connectivityWeightPerCell;
        }
      }
    }

    // Combine. Center-of-mass and intra-room use the original mean^power form
    // (they're well-behaved, low-magnitude terms). Adjacency is added linearly
    // — its constants are already large enough to dominate when violated.
    // Connectivity penalty is also linear.
    const energy =
      (comCount === 0 ? 0 : Math.pow(comEnergy / comCount, centerOfMassWeight))
      + (intraCount === 0 ? 0 : Math.pow(intraEnergy / intraCount, intraRoomWeight))
      + adjacencyWeight * adjacencyEnergy
      + connectivityPenalty;

    this.energy = energy;
    this.linkReports = linkReports;
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

  // Cells whose roomId may flip during optimization, with their roomsAllowed
  // pre-indexed for fast swap legality checks.
  private _buildSwappableRefs(): Array<{ i: number, j: number, allowedRoomIds: Set<RoomId> }> {
    const refs: Array<{ i: number, j: number, allowedRoomIds: Set<RoomId> }> = [];
    for (let i = 0; i < this.cells.length; i += 1) {
      for (let j = 0; j < this.cells[i].length; j += 1) {
        const cell = this.cells[i][j];
        if (cell.roomsAllowed.length === 0) continue;
        if (cell.roomsAllowed.length === 1) continue;
        refs.push({
          i,
          j,
          allowedRoomIds: new Set(cell.roomsAllowed.map((r) => r.id)),
        });
      }
    }
    return refs;
  }

  // Deterministic local-minimum polish: try every pair of swappable cells and
  // accept any swap that strictly lowers energy. Repeat until a full pass
  // finds no improvement. This closes the "obvious local minima" the
  // randomized annealer often leaves on the table (e.g. a fragmented room
  // whose stray cell could absorb back with a single swap that the annealer
  // never sampled, or a soft link that could be satisfied for free).
  //
  // Cost: each pass is O(swappable² × energyEvalCost). For ~80 swappable cells
  // and 9×9 grid that's a few seconds at most. The pass count is bounded by
  // MAX_PASSES as a safety, though in practice it converges in 2-4 passes.
  greedyImprove(): { passes: number, swaps: number, threeCycles: number, deltaEnergy: number } {
    const MAX_PASSES = 12;
    const swappable = this._buildSwappableRefs();
    if (swappable.length < 2) return { passes: 0, swaps: 0, threeCycles: 0, deltaEnergy: 0 };

    const startEnergy = this.energy;
    let totalSwaps = 0;
    let totalThreeCycles = 0;
    let passes = 0;

    // --- Pass A: 2-swap until convergence -----------------------------------
    let improved = true;
    while (improved && passes < MAX_PASSES) {
      improved = false;
      passes += 1;
      for (let i = 0; i < swappable.length; i += 1) {
        for (let j = i + 1; j < swappable.length; j += 1) {
          const a = swappable[i];
          const b = swappable[j];
          const cellA = this.cells[a.i][a.j];
          const cellB = this.cells[b.i][b.j];
          const aRoomId = cellA.roomId;
          const bRoomId = cellB.roomId;
          if (aRoomId === bRoomId) continue;
          if (aRoomId !== undefined && !b.allowedRoomIds.has(aRoomId)) continue;
          if (bRoomId !== undefined && !a.allowedRoomIds.has(bRoomId)) continue;

          const energyBefore = this.energy;
          cellA.roomId = bRoomId;
          cellB.roomId = aRoomId;
          this.reconcile();
          if (this.energy < energyBefore) {
            improved = true;
            totalSwaps += 1;
          } else {
            cellA.roomId = aRoomId;
            cellB.roomId = bRoomId;
            this.reconcile();
          }
        }
      }
    }

    // --- Pass B: 3-cycle moves to escape pairwise local minima --------------
    // For each triple of swappable cells with three distinct rooms, try both
    // cyclic rotations (the only non-swap permutations of 3 items). A 3-cycle
    // can free up fragmented rooms whose unfragmentation would require
    // breaking a hard link if done with a single 2-swap.
    //
    // Naive O(N³) would mean ~165k triples × reconcile (~10ms) = minutes.
    // We restrict to triples whose 3 cells fit inside a manhattan-diameter
    // window — useful 3-cycles for fragmentation and adjacency are always
    // geographically local. Diameter 4 ≈ a 5x5 spatial window, big enough to
    // hop a single cell across a hard-link wall.
    const TRIPLE_MAX_DIAMETER = 4;
    const manh = (p: { i: number, j: number }, q: { i: number, j: number }) =>
      Math.abs(p.i - q.i) + Math.abs(p.j - q.j);

    let outerImproved = true;
    let outerPasses = 0;
    while (outerImproved && outerPasses < 4) {
      outerImproved = false;
      outerPasses += 1;
      for (let i = 0; i < swappable.length; i += 1) {
        for (let j = i + 1; j < swappable.length; j += 1) {
          if (manh(swappable[i], swappable[j]) > TRIPLE_MAX_DIAMETER) continue;
          for (let k = j + 1; k < swappable.length; k += 1) {
            if (manh(swappable[i], swappable[k]) > TRIPLE_MAX_DIAMETER) continue;
            if (manh(swappable[j], swappable[k]) > TRIPLE_MAX_DIAMETER) continue;
            const a = swappable[i];
            const b = swappable[j];
            const c = swappable[k];
            const cellA = this.cells[a.i][a.j];
            const cellB = this.cells[b.i][b.j];
            const cellC = this.cells[c.i][c.j];
            const rA = cellA.roomId;
            const rB = cellB.roomId;
            const rC = cellC.roomId;
            // Require three distinct rooms (otherwise a 3-cycle reduces to a 2-swap).
            if (rA === rB || rB === rC || rA === rC) continue;

            const energyBefore = this.energy;

            // Cycle 1: A←rC, B←rA, C←rB
            if ((rC === undefined || a.allowedRoomIds.has(rC))
              && (rA === undefined || b.allowedRoomIds.has(rA))
              && (rB === undefined || c.allowedRoomIds.has(rB))) {
              cellA.roomId = rC;
              cellB.roomId = rA;
              cellC.roomId = rB;
              this.reconcile();
              if (this.energy < energyBefore) {
                totalThreeCycles += 1;
                outerImproved = true;
                continue;
              }
              cellA.roomId = rA;
              cellB.roomId = rB;
              cellC.roomId = rC;
              this.reconcile();
            }

            // Cycle 2: A←rB, B←rC, C←rA
            if ((rB === undefined || a.allowedRoomIds.has(rB))
              && (rC === undefined || b.allowedRoomIds.has(rC))
              && (rA === undefined || c.allowedRoomIds.has(rA))) {
              cellA.roomId = rB;
              cellB.roomId = rC;
              cellC.roomId = rA;
              this.reconcile();
              if (this.energy < energyBefore) {
                totalThreeCycles += 1;
                outerImproved = true;
                continue;
              }
              cellA.roomId = rA;
              cellB.roomId = rB;
              cellC.roomId = rC;
              this.reconcile();
            }
          }
        }
      }

      // After each successful 3-cycle pass, run 2-swap to convergence again.
      if (outerImproved) {
        let innerImproved = true;
        while (innerImproved && passes < MAX_PASSES) {
          innerImproved = false;
          passes += 1;
          for (let i = 0; i < swappable.length; i += 1) {
            for (let j = i + 1; j < swappable.length; j += 1) {
              const a = swappable[i];
              const b = swappable[j];
              const cellA = this.cells[a.i][a.j];
              const cellB = this.cells[b.i][b.j];
              const aRoomId = cellA.roomId;
              const bRoomId = cellB.roomId;
              if (aRoomId === bRoomId) continue;
              if (aRoomId !== undefined && !b.allowedRoomIds.has(aRoomId)) continue;
              if (bRoomId !== undefined && !a.allowedRoomIds.has(bRoomId)) continue;
              const energyBefore = this.energy;
              cellA.roomId = bRoomId;
              cellB.roomId = aRoomId;
              this.reconcile();
              if (this.energy < energyBefore) {
                innerImproved = true;
                totalSwaps += 1;
              } else {
                cellA.roomId = aRoomId;
                cellB.roomId = bRoomId;
                this.reconcile();
              }
            }
          }
        }
      }
    }

    return { passes, swaps: totalSwaps, threeCycles: totalThreeCycles, deltaEnergy: this.energy - startEnergy };
  }

  // Re-randomize a fraction p of swappable cells: pick a random allowed room
  // (different from current) for each chosen cell. Used between restarts to
  // perturb a good solution and explore nearby basins.
  private _perturb(p: number): void {
    const swappable = this._buildSwappableRefs();
    for (const ref of swappable) {
      if (Math.random() >= p) continue;
      const cell = this.cells[ref.i][ref.j];
      const options = cell.roomsAllowed.filter((r) => r.id !== cell.roomId);
      if (options.length === 0) continue;
      cell.roomId = options[(Math.random() * options.length) | 0].id;
    }
    this.reconcile();
  }

  // Runs a single annealing trajectory from the current state of `seed` (a
  // fresh copy is made internally) and returns the lowest-energy snapshot
  // found. Shared by sync `optimize` and async `optimizeAsync` so their
  // per-restart behavior is identical.
  private _runOneRestart(iterations: number, t0: number, coolingRate: number, seed: Base = this): { best: Base, bestEnergy: number } {
    const current = new Base(seed);
    let currentEnergy = current.energy;
    let bestThisRun = new Base(current);
    let bestEnergyThisRun = currentEnergy;
    const swappable = current._buildSwappableRefs();

    if (swappable.length < 2) {
      return { best: bestThisRun, bestEnergy: bestEnergyThisRun };
    }

    let temperature = t0;
    for (let iter = 0; iter < iterations; iter += 1) {
      const a = swappable[(Math.random() * swappable.length) | 0];
      const b = swappable[(Math.random() * swappable.length) | 0];
      if (a === b) {
        temperature *= coolingRate;
        continue;
      }
      const cellA = current.cells[a.i][a.j];
      const cellB = current.cells[b.i][b.j];
      const aRoomId = cellA.roomId;
      const bRoomId = cellB.roomId;
      if (aRoomId === bRoomId) {
        temperature *= coolingRate;
        continue;
      }
      if (aRoomId !== undefined && !b.allowedRoomIds.has(aRoomId)) {
        temperature *= coolingRate;
        continue;
      }
      if (bRoomId !== undefined && !a.allowedRoomIds.has(bRoomId)) {
        temperature *= coolingRate;
        continue;
      }

      cellA.roomId = bRoomId;
      cellB.roomId = aRoomId;
      current.reconcile();
      const newEnergy = current.energy;

      const dE = newEnergy - currentEnergy;
      const accept = dE <= 0 || Math.random() < Math.exp(-dE / Math.max(temperature, 1e-12));
      if (accept) {
        currentEnergy = newEnergy;
        if (newEnergy < bestEnergyThisRun) {
          bestEnergyThisRun = newEnergy;
          bestThisRun = new Base(current);
        }
      } else {
        cellA.roomId = aRoomId;
        cellB.roomId = bRoomId;
        current.reconcile();
      }

      temperature *= coolingRate;
    }

    return { best: bestThisRun, bestEnergy: bestEnergyThisRun };
  }

  private _commitGlobalBest(globalBest: Base, globalBestEnergy: number): void {
    if (globalBestEnergy < this.energy) {
      globalBest.cells.forEach((cellRow, i) => cellRow.forEach((cell, j) => {
        this.cells[i][j].roomId = cell.roomId;
      }));
      this.reconcile();
    }
  }

  private _resolveOptimizeParams(options: OptimizeOptions): { iterations: number, restarts: number, t0: number, coolingRate: number } {
    const iterations = options.iterations ?? 50000;
    const restarts = options.restarts ?? 10;
    const t0 = options.t0 ?? 1.0;
    const tFinal = options.tFinal ?? 1e-4;
    // Geometric cooling: T(k) = t0 * coolingRate^k, choose coolingRate so we
    // land on tFinal at the last iteration.
    const coolingRate = options.coolingRate
      ?? Math.pow(tFinal / t0, 1 / Math.max(1, iterations - 1));
    return { iterations, restarts, t0, coolingRate };
  }

  optimize(options: OptimizeOptions = {}): Base {
    const { iterations, restarts, t0, coolingRate } = this._resolveOptimizeParams(options);

    let globalBest: Base = new Base(this);
    let globalBestEnergy = globalBest.energy;

    // Restart strategy:
    //  - restart 0: raw initial state (explore the assignment basin).
    //  - subsequent restarts: perturbative from global best (refine).
    //  - if 2 consecutive restarts find no improvement, force a raw restart
    //    so we escape the basin of the current global best entirely.
    let perturbationP = 0.15;
    let consecutiveStale = 0;
    for (let restart = 0; restart < restarts; restart += 1) {
      let seed: Base;
      if (restart === 0 || consecutiveStale >= 2) {
        seed = this;
        consecutiveStale = 0;
      } else {
        seed = new Base(globalBest);
        seed._perturb(perturbationP);
      }
      const { best, bestEnergy } = this._runOneRestart(iterations, t0, coolingRate, seed);
      if (bestEnergy < globalBestEnergy) {
        globalBest = best;
        globalBestEnergy = bestEnergy;
        perturbationP = 0.15;
        consecutiveStale = 0;
      } else {
        consecutiveStale += 1;
        perturbationP = Math.min(0.5, 0.15 + 0.1 * consecutiveStale);
      }
      if (options.onProgress) {
        options.onProgress(restart + 1, restarts);
      }
    }

    // Polish the best-of-restarts with deterministic local search.
    globalBest.greedyImprove();
    globalBestEnergy = globalBest.energy;

    this._commitGlobalBest(globalBest, globalBestEnergy);
    return this;
  }

  // Same algorithm as `optimize`, but yields to the event loop between
  // restarts so a UI can repaint progress and stay responsive. Use this from
  // the browser; tests can keep using sync `optimize`.
  async optimizeAsync(options: OptimizeOptions = {}): Promise<Base> {
    const { iterations, restarts, t0, coolingRate } = this._resolveOptimizeParams(options);
    const t0wallStart = (typeof performance !== "undefined" ? performance.now() : Date.now());

    let globalBest: Base = new Base(this);
    let globalBestEnergy = globalBest.energy;

    /* eslint-disable no-console */
    console.log(`[optimize] start: ${iterations} iter × ${restarts} restarts, T0=${t0}, cooling=${coolingRate.toFixed(6)}; initial energy=${Math.round(globalBestEnergy).toLocaleString("en-US")}`);

    let perturbationP = 0.15;
    let consecutiveStale = 0;
    for (let restart = 0; restart < restarts; restart += 1) {
      const tStart = (typeof performance !== "undefined" ? performance.now() : Date.now());
      let seed: Base;
      let seedNote = "raw";
      if (restart === 0 || consecutiveStale >= 2) {
        seed = this;
        if (consecutiveStale >= 2) seedNote = "raw (escape)";
        consecutiveStale = 0;
      } else {
        seed = new Base(globalBest);
        seed._perturb(perturbationP);
        seedNote = `from-best p=${perturbationP.toFixed(2)}`;
      }
      const { best, bestEnergy } = this._runOneRestart(iterations, t0, coolingRate, seed);
      const tEnd = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const improved = bestEnergy < globalBestEnergy;
      if (improved) {
        globalBest = best;
        globalBestEnergy = bestEnergy;
        perturbationP = 0.15;
        consecutiveStale = 0;
      } else {
        consecutiveStale += 1;
        perturbationP = Math.min(0.5, 0.15 + 0.1 * consecutiveStale);
      }
      console.log(
        `[optimize] restart ${restart + 1}/${restarts} (${seedNote}): this=${Math.round(bestEnergy).toLocaleString("en-US")} `
        + `global=${Math.round(globalBestEnergy).toLocaleString("en-US")}${improved ? " ↓" : ""} `
        + `(${((tEnd - tStart) / 1000).toFixed(1)}s)`
      );
      if (options.onProgress) {
        options.onProgress(restart + 1, restarts);
      }
      // Yield to the event loop so React can repaint the progress message.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Deterministic polish: try every swap pair and accept any improvement.
    // Cleans up obvious local minima the annealer left behind.
    const greedyStart = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const greedyResult = globalBest.greedyImprove();
    const greedyEnd = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (greedyResult.swaps > 0 || greedyResult.threeCycles > 0) {
      console.log(
        `[optimize] greedy polish: ${greedyResult.swaps} swap(s) + ${greedyResult.threeCycles} 3-cycle(s) in ${greedyResult.passes} pass(es), `
        + `energy ${Math.round(globalBestEnergy).toLocaleString("en-US")} → ${Math.round(globalBest.energy).toLocaleString("en-US")} `
        + `(${((greedyEnd - greedyStart) / 1000).toFixed(1)}s)`
      );
      globalBestEnergy = globalBest.energy;
    } else {
      console.log(`[optimize] greedy polish: no improvement (${greedyResult.passes} pass(es), ${((greedyEnd - greedyStart) / 1000).toFixed(1)}s)`);
    }

    this._commitGlobalBest(globalBest, globalBestEnergy);

    // Final summary including link breakdown.
    const t0wallEnd = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const unsat = this.linkReports.filter((r) => !r.satisfied);
    const unsatHard = unsat.filter((r) => r.hard);
    console.log(
      `[optimize] done in ${((t0wallEnd - t0wallStart) / 1000).toFixed(1)}s: energy=${Math.round(this.energy).toLocaleString("en-US")}, `
      + `links ${this.linkReports.length - unsat.length}/${this.linkReports.length} satisfied `
      + `(${unsatHard.length} hard unsatisfied)`
    );
    if (unsat.length > 0) {
      const byName = (id: string) => this.rooms.find((r) => r.id === id)?.name ?? id;
      console.log("[optimize] unsatisfied links:");
      for (const r of unsat) {
        console.log(`  ${r.hard ? "[HARD]" : "      "} ${byName(r.roomIds[0])} ↔ ${byName(r.roomIds[1])}  (weight ${r.weight})`);
      }
    }
    /* eslint-enable no-console */

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

  setLinkWeight(index: number, weight: number): Base {
    if (index > this.links.length - 1) {
      throw new Error(`Attempted to set the weight of the link at index '${index}', but the current maximum index of the links is '${this.links.length - 1}'.`);
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Link weight must be a non-negative finite number; got '${weight}'.`);
    }
    this.links[index].weight = weight;
    this.reconcile();
    return this;
  }

  setLinkHard(index: number, hard: boolean): Base {
    if (index > this.links.length - 1) {
      throw new Error(`Attempted to set the hard flag of the link at index '${index}', but the current maximum index of the links is '${this.links.length - 1}'.`);
    }
    this.links[index].hard = hard;
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
