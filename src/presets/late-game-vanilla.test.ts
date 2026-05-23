import { createLateGameVanillaBase } from "./late-game-vanilla";

describe("createLateGameVanillaBase", () => {
  test("rooms fit inside 9x9 grid with breathing room for the optimizer", () => {
    const base = createLateGameVanillaBase();
    const totalSize = base.rooms.reduce((s, r) => s + r.size, 0);
    const capacity = 9 * 9;
    expect(base.cells.length).toBe(9);
    expect(base.cells[0].length).toBe(9);
    expect(totalSize).toBeLessThanOrEqual(capacity);
    // Want at least ~15% free cells so the optimizer has room to satisfy
    // adjacency without being forced into bad local minima.
    const free = capacity - totalSize;
    expect(free).toBeGreaterThanOrEqual(Math.floor(capacity * 0.15));
  });

  test("every link references existing rooms", () => {
    const base = createLateGameVanillaBase();
    const roomIds = new Set(base.rooms.map((r) => r.id));
    for (const link of base.links) {
      expect(roomIds.has(link.roomIds[0])).toBe(true);
      expect(roomIds.has(link.roomIds[1])).toBe(true);
    }
  });

  test("every room receives the cells it asks for after reconcile", () => {
    const base = createLateGameVanillaBase();
    const counts: Record<string, number> = {};
    for (const row of base.cells) {
      for (const cell of row) {
        if (cell.roomId !== undefined) {
          counts[cell.roomId] = (counts[cell.roomId] ?? 0) + 1;
        }
      }
    }
    const undersized = base.rooms
      .map((r) => ({ name: r.name, size: r.size, assigned: counts[r.id] ?? 0 }))
      .filter((r) => r.assigned < r.size);
    expect(undersized).toEqual([]);
  });

  test("food chain hard links are present (cultivos→congelador→cocina→nevera→comedor; cuerpos→carnicería→congelador)", () => {
    const base = createLateGameVanillaBase();
    const byId = Object.fromEntries(base.rooms.map((r) => [r.id, r.name]));
    const linkPairs = new Set(base.links.flatMap((l) => {
      const a = byId[l.roomIds[0]];
      const b = byId[l.roomIds[1]];
      const hard = l.hard === true;
      return hard ? [`${a}|${b}`, `${b}|${a}`] : [];
    }));
    // Cadena cultivo → cocción → comedor
    expect(linkPairs.has("Cultivos|Congelador")).toBe(true);
    expect(linkPairs.has("Cocina|Congelador")).toBe(true);
    expect(linkPairs.has("Cocina|Nevera")).toBe(true);
    expect(linkPairs.has("Nevera|Comedor")).toBe(true);
    // Cadena ganadería → procesado
    expect(linkPairs.has("Establo|Congelador Cuerpos")).toBe(true);
    expect(linkPairs.has("Carnicería|Congelador Cuerpos")).toBe(true);
    expect(linkPairs.has("Carnicería|Congelador")).toBe(true);
  });
});
