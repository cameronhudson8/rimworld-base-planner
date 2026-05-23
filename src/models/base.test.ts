import {
  Base,
  BaseData,
  validate,
} from './base';
import { Room } from './room';

describe('Base', () => {

  let baseData: BaseData;

  beforeEach(() => {
    const bedroom = new Room({
      color: "#000000",
      name: 'bedroom-0',
      size: 1,
    });
    const kitchen = new Room({
      color: "#123456",
      name: 'kitchen-0',
      size: 1,
    });
    const storage = new Room({
      color: "#FFFFFF",
      name: 'storage-0',
      size: 2,
    });
    const rooms = [
      bedroom,
      kitchen,
      storage,
    ];
    baseData = {
      cells: [
        [
          {
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
          },
          {
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
          },
        ],
        [
          {
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
          },
          {
            roomsAllowed: rooms.map((room) => ({ id: room.id })),
          },
        ],
      ],
      links: [
        {
          roomIds: {
            0: kitchen.id,
            1: storage.id,
          },
        },
      ],
      rooms,
    };
  });

  test('validation works', () => {
    const baseObject = JSON.parse(JSON.stringify(baseData));
    const baseData2 = validate(baseObject)
    expect(baseData2).toMatchObject(baseData);
  });

  test('validation accepts optional link weight and hard', () => {
    const withMeta = JSON.parse(JSON.stringify(baseData));
    withMeta.links[0].weight = 5;
    withMeta.links[0].hard = true;
    const validated = validate(withMeta);
    expect(validated.links[0].weight).toBe(5);
    expect(validated.links[0].hard).toBe(true);
  });

  test('adjacency-based cost: shared wall is cheaper than separated', () => {
    const kitchen = new Room({ name: 'kitchen', size: 1 });
    const freezer = new Room({ name: 'freezer', size: 1 });
    const filler = new Room({ name: 'filler', size: 1 });
    const rooms = [kitchen, freezer, filler];
    const all = rooms.map((r) => ({ id: r.id }));
    const makeBase = (kPos: [number, number], fPos: [number, number]) => {
      const cells = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ({
        roomsAllowed: all,
        roomId: (i === kPos[0] && j === kPos[1])
          ? kitchen.id
          : (i === fPos[0] && j === fPos[1])
            ? freezer.id
            : filler.id,
      })));
      return new Base({ cells, links: [{ roomIds: { 0: kitchen.id, 1: freezer.id } }], rooms });
    };
    const adjacent = makeBase([0, 0], [0, 1]);
    const separated = makeBase([0, 0], [0, 2]);
    expect(adjacent.linkReports[0].satisfied).toBe(true);
    expect(separated.linkReports[0].satisfied).toBe(false);
    expect(adjacent.energy).toBeLessThan(separated.energy);
  });

  test('optimize satisfies critical adjacencies on a small scenario', () => {
    // 6x6 base with a handful of small rooms and a few links that must end up
    // adjacent. This is small enough to be deterministic-ish and run fast.
    const kitchen = new Room({ name: 'kitchen', size: 2 });
    const freezer = new Room({ name: 'freezer', size: 2 });
    const dining = new Room({ name: 'dining', size: 4 });
    const hospital = new Room({ name: 'hospital', size: 4 });
    const surgery = new Room({ name: 'surgery', size: 2 });
    const workshop = new Room({ name: 'workshop', size: 4 });
    const supplies = new Room({ name: 'supplies', size: 2 });
    const products = new Room({ name: 'products', size: 2 });
    const filler = new Room({ name: 'filler', size: 14 });
    const rooms = [kitchen, freezer, dining, hospital, surgery, workshop, supplies, products, filler];
    const all = rooms.map((r) => ({ id: r.id }));
    const cells = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({
      roomsAllowed: all,
    })));
    const links = [
      { roomIds: { 0: kitchen.id, 1: freezer.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: hospital.id, 1: surgery.id }, weight: 10 },
      { roomIds: { 0: workshop.id, 1: supplies.id }, weight: 8 },
      { roomIds: { 0: workshop.id, 1: products.id }, weight: 8 },
    ];
    const base = new Base({ cells, links, rooms });
    base.optimize({ iterations: 8000, restarts: 3 });

    const findRep = (n1: string, n2: string) => base.linkReports.find((rep) => {
      const name = (id: string) => base.rooms.find((r) => r.id === id)!.name;
      const a = name(rep.roomIds[0]);
      const b = name(rep.roomIds[1]);
      return (a === n1 && b === n2) || (a === n2 && b === n1);
    })!;
    expect(findRep('kitchen', 'freezer').satisfied).toBe(true);
    expect(findRep('kitchen', 'dining').satisfied).toBe(true);
    expect(findRep('hospital', 'surgery').satisfied).toBe(true);
    expect(findRep('workshop', 'supplies').satisfied).toBe(true);
    expect(findRep('workshop', 'products').satisfied).toBe(true);
  }, 30000);

  test('optimize satisfies critical adjacencies on the full RimWorld colony scenario', () => {
    // ~25 colonist base described in the task brief.
    const kitchen = new Room({ name: 'kitchen', size: 6 });
    const freezer = new Room({ name: 'freezer', size: 9 });
    const dining = new Room({ name: 'dining', size: 16 });
    const storage = new Room({ name: 'main-storage', size: 16 });
    const smithy = new Room({ name: 'smithy', size: 9 });
    const smithySupplies = new Room({ name: 'smithy-supplies', size: 4 });
    const smithyProducts = new Room({ name: 'smithy-products', size: 4 });
    const tailor = new Room({ name: 'tailor', size: 9 });
    const tailorSupplies = new Room({ name: 'tailor-supplies', size: 4 });
    const tailorProducts = new Room({ name: 'tailor-products', size: 4 });
    const crafting = new Room({ name: 'crafting', size: 9 });
    const craftingSupplies = new Room({ name: 'crafting-supplies', size: 4 });
    const craftingProducts = new Room({ name: 'crafting-products', size: 4 });
    const hospital = new Room({ name: 'hospital', size: 12 });
    const surgery = new Room({ name: 'surgery', size: 6 });
    const prison = new Room({ name: 'prison', size: 8 });
    const rooms = [
      kitchen, freezer, dining, storage,
      smithy, smithySupplies, smithyProducts,
      tailor, tailorSupplies, tailorProducts,
      crafting, craftingSupplies, craftingProducts,
      hospital, surgery, prison,
    ];
    const totalSize = rooms.reduce((s, r) => s + r.size, 0);
    // Use a 14x14 grid (196 cells); plenty of slack.
    const N = 14;
    expect(totalSize).toBeLessThanOrEqual(N * N);
    const all = rooms.map((r) => ({ id: r.id }));
    const cells = Array.from({ length: N }, () =>
      Array.from({ length: N }, () => ({ roomsAllowed: all }))
    );
    const links = [
      { roomIds: { 0: kitchen.id, 1: freezer.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: smithy.id, 1: smithySupplies.id }, weight: 8 },
      { roomIds: { 0: smithy.id, 1: smithyProducts.id }, weight: 8 },
      { roomIds: { 0: tailor.id, 1: tailorSupplies.id }, weight: 8 },
      { roomIds: { 0: tailor.id, 1: tailorProducts.id }, weight: 8 },
      { roomIds: { 0: crafting.id, 1: craftingSupplies.id }, weight: 8 },
      { roomIds: { 0: crafting.id, 1: craftingProducts.id }, weight: 8 },
      { roomIds: { 0: hospital.id, 1: surgery.id }, weight: 10 },
    ];
    const base = new Base({ cells, links, rooms });
    base.optimize({ iterations: 25000, restarts: 4 });
    const unsatisfied = base.linkReports.filter((r) => !r.satisfied);
    if (unsatisfied.length > 0) {
      const names = (id: string) => base.rooms.find((r) => r.id === id)!.name;
      // eslint-disable-next-line no-console
      console.log('Unsatisfied links:', unsatisfied.map((u) => `${names(u.roomIds[0])} <-> ${names(u.roomIds[1])}`));
    }
    expect(unsatisfied.length).toBe(0);
  }, 120000);

  test('link weight scales the penalty when unsatisfied', () => {
    const a = new Room({ name: 'a', size: 1 });
    const b = new Room({ name: 'b', size: 1 });
    const filler = new Room({ name: 'filler', size: 1 });
    const rooms = [a, b, filler];
    const all = rooms.map((r) => ({ id: r.id }));
    const makeBase = (weight?: number) => {
      const cells = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ({
        roomsAllowed: all,
        roomId: (i === 0 && j === 0)
          ? a.id
          : (i === 0 && j === 2)
            ? b.id
            : filler.id,
      })));
      return new Base({
        cells,
        links: [{ roomIds: { 0: a.id, 1: b.id }, ...(weight !== undefined ? { weight } : {}) }],
        rooms,
      });
    };
    const w1 = makeBase(1);
    const w5 = makeBase(5);
    expect(w5.energy).toBeGreaterThan(w1.energy);
  });

  // ----- Connectivity / fragmentation -----
  // Helper: count 4-connected components of a given roomId in a Base.
  const countComponents = (base: Base, roomId: string): number => {
    const roomCells = new Set<string>();
    for (let i = 0; i < base.cells.length; i += 1) {
      for (let j = 0; j < base.cells[i].length; j += 1) {
        if (base.cells[i][j].roomId === roomId) {
          roomCells.add(`${i},${j}`);
        }
      }
    }
    const visited = new Set<string>();
    let components = 0;
    for (const cellStr of roomCells) {
      if (visited.has(cellStr)) continue;
      components += 1;
      const [si, sj] = cellStr.split(',').map(Number);
      const queue = [[si, sj]];
      while (queue.length > 0) {
        const [i, j] = queue.shift()!;
        const key = `${i},${j}`;
        if (visited.has(key)) continue;
        visited.add(key);
        for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          const nkey = `${ni},${nj}`;
          if (roomCells.has(nkey) && !visited.has(nkey)) {
            queue.push([ni, nj]);
          }
        }
      }
    }
    return components;
  };

  test('fragmented layout is strictly more expensive than contiguous (same rooms)', () => {
    // Two rooms of size 2, with no links between them. Whether they're
    // contiguous or split into singletons changes nothing for link cost.
    // The connectivity term must make the fragmented layout strictly worse.
    const a = new Room({ name: 'a', size: 2 });
    const b = new Room({ name: 'b', size: 2 });
    const rooms = [a, b];
    const all = rooms.map((r) => ({ id: r.id }));
    const make = (grid: string[][]) => {
      const cells = grid.map((row) => row.map((mark) => ({
        roomsAllowed: all,
        roomId: mark === 'A' ? a.id : mark === 'B' ? b.id : undefined,
      })));
      return new Base({ cells, links: [], rooms });
    };
    const contiguous = make([
      ['A', 'A', '.', '.'],
      ['.', '.', 'B', 'B'],
      ['.', '.', '.', '.'],
      ['.', '.', '.', '.'],
    ]);
    const fragmented = make([
      ['A', '.', '.', 'A'],
      ['B', '.', '.', 'B'],
      ['.', '.', '.', '.'],
      ['.', '.', '.', '.'],
    ]);
    expect(countComponents(contiguous, a.id)).toBe(1);
    expect(countComponents(fragmented, a.id)).toBe(2);
    // The fragmented layout MUST cost more than the contiguous one.
    expect(fragmented.energy).toBeGreaterThan(contiguous.energy);
  });

  test('optimize keeps small rooms contiguous in a tight, link-heavy grid', () => {
    // Stress case meant to reproduce the user-reported symptom: small rooms
    // shearing apart while the annealer chases high-weight links. The grid is
    // tight (no slack) and every small room is yanked by two competing links.
    const N = 6;
    const infirmary = new Room({ name: 'infirmary', size: 2 });
    const kitchen = new Room({ name: 'kitchen', size: 2 });
    const freezer = new Room({ name: 'freezer', size: 2 });
    const pantry = new Room({ name: 'pantry', size: 2 });
    const lab = new Room({ name: 'lab', size: 2 });
    const dining = new Room({ name: 'dining', size: 4 });
    const ward = new Room({ name: 'ward', size: 4 });
    const filler = new Room({ name: 'filler', size: N * N - (2 * 5 + 4 * 2) });
    const rooms = [infirmary, kitchen, freezer, pantry, lab, dining, ward, filler];
    const all = rooms.map((r) => ({ id: r.id }));
    const cells = Array.from({ length: N }, () =>
      Array.from({ length: N }, () => ({ roomsAllowed: all }))
    );
    const links = [
      // Each small room is pulled by two links — annealer is tempted to split them.
      { roomIds: { 0: infirmary.id, 1: ward.id }, weight: 10 },
      { roomIds: { 0: infirmary.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: freezer.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: pantry.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: pantry.id, 1: kitchen.id }, weight: 10 },
      { roomIds: { 0: lab.id, 1: ward.id }, weight: 10 },
      { roomIds: { 0: lab.id, 1: dining.id }, weight: 10 },
    ];
    const base = new Base({ cells, links, rooms });
    base.optimize({ iterations: 15000, restarts: 4 });

    const broken: string[] = [];
    for (const r of [infirmary, kitchen, freezer, pantry, lab, dining, ward]) {
      const components = countComponents(base, r.id);
      if (components > 1) broken.push(`${r.name} (${components} pieces)`);
    }
    expect(broken).toEqual([]);
  }, 60000);

  test('optimize keeps a small (size-2) room contiguous even when pulled by a distant link', () => {
    // 6x6 grid. A size-2 room ("infirmary") is linked to a far-away room.
    // The annealer's swap-based moves can shear it apart while chasing the
    // link. With a proper connectivity penalty, the room must stay as one
    // 4-connected block in the final layout.
    const infirmary = new Room({ name: 'infirmary', size: 2 });
    const kitchen = new Room({ name: 'kitchen', size: 2 });
    const freezer = new Room({ name: 'freezer', size: 2 });
    const dining = new Room({ name: 'dining', size: 4 });
    const filler = new Room({ name: 'filler', size: 26 });
    const rooms = [infirmary, kitchen, freezer, dining, filler];
    const all = rooms.map((r) => ({ id: r.id }));
    const cells = Array.from({ length: 6 }, () =>
      Array.from({ length: 6 }, () => ({ roomsAllowed: all }))
    );
    // High-weight links that pull the small rooms around the grid.
    const links = [
      { roomIds: { 0: infirmary.id, 1: dining.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: freezer.id }, weight: 10 },
      { roomIds: { 0: kitchen.id, 1: dining.id }, weight: 10 },
    ];
    const base = new Base({ cells, links, rooms });
    base.optimize({ iterations: 10000, restarts: 3 });

    // Every named room must be a single connected block (filler can split).
    for (const r of [infirmary, kitchen, freezer, dining]) {
      const components = countComponents(base, r.id);
      expect({ room: r.name, components }).toEqual({ room: r.name, components: 1 });
    }
  }, 30000);

});
