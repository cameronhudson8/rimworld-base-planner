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

});
