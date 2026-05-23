import { Base } from "../models";
import { Room, RoomId } from "../models/room";

// Preset de base RimWorld late-game VAINILLA (sin DLCs) para 25-30 colonos
// (capacidad 48 con margen). Grid 9x9 = 81 celdas; ~54 ocupadas y ~27 libres
// para dar holgura al optimizador y dejar espacio para pasillos/expansión.
//
// Convenciones:
// - "celda" = ZONA 19x19 del juego (361 tiles). 1 celda da para una cocina
//   completa, un comedor pequeño o una habitación grande. 1 celda de dormitorio
//   contiene 4 habitaciones de 8x8 con cama doble = 8 colonos.
// - hard: true = adyacencia obligatoria (penalización enorme si no se cumple).
// - weight = importancia relativa entre soft-links; mayor = se respeta antes.
//
// Sin contenido de DLC (no hay Sala Niños/Biotech, Templo/Ideology, ni Sala
// Trono o Meditación/Royalty).

interface RoomSpec {
  name: string;
  size: number;
  color: string;
}

interface LinkSpec {
  a: string;
  b: string;
  weight?: number;
  hard?: boolean;
}

const ROOM_SPECS: RoomSpec[] = [
  // --- DESCANSO ---
  // 3 cells de dormitorios × 8 colonos/cell = 24 cap por bloque (48 total).
  { name: "Bloque Dormitorios 1", size: 3, color: "#3b8132" },
  { name: "Bloque Dormitorios 2", size: 3, color: "#4ea342" },
  { name: "Sala Recreativa",      size: 2, color: "#9cd986" },

  // --- COMIDA ---
  // Cadena: Cultivos → Congelador / Establo → Depósito Frigorífico → Carnicería
  // → Congelador / Congelador → Cocina → Nevera → Comedor
  { name: "Cultivos 1",             size: 1, color: "#7ed957" },
  { name: "Cultivos 2",             size: 1, color: "#7ed957" },
  { name: "Congelador",           size: 2, color: "#5fa3d8" },
  { name: "Depósito Frigorífico",   size: 1, color: "#404060" },
  { name: "Carnicería",           size: 1, color: "#b03030" },
  { name: "Cocina",               size: 1, color: "#ff7373" },
  { name: "Nevera",               size: 1, color: "#a8d6f0" },
  { name: "Comedor",              size: 2, color: "#d96b3d" },

  // --- ALCOHOL ---
  { name: "Cervecería",           size: 1, color: "#c9a14a" },
  { name: "Almacén Alcohol",      size: 1, color: "#d4b876" },

  // --- MÉDICO ---
  { name: "Enfermería",           size: 2, color: "#ffffff" },
  { name: "Quirófano",            size: 1, color: "#e0f0ff" },
  { name: "Farmacia",             size: 1, color: "#d9eaf7" },

  // --- PRISIÓN ---
  { name: "Prisión",              size: 1, color: "#555555" },

  // --- TEXTIL / ROPA ---
  { name: "Sastrería",            size: 1, color: "#b88dc1" },
  { name: "Ropero",               size: 1, color: "#c9aacf" },
  { name: "Almacén Telas",        size: 1, color: "#dac4dd" },
  { name: "Almacén Armaduras",    size: 1, color: "#8a7090" },

  // --- PIEDRA / CONSTRUCCIÓN ---
  { name: "Cantería",             size: 1, color: "#8a8478" },
  { name: "Almacén Trozos",       size: 1, color: "#a0998a" },
  { name: "Almacén Piedra Pulida",size: 1, color: "#c0b8a8" },

  // --- ESCULTURA / ARTE ---
  { name: "Escultor",             size: 1, color: "#cdb78a" },
  { name: "Almacén Esculturas",   size: 1, color: "#e0cfa8" },

  // --- METAL ---
  { name: "Fundición",            size: 1, color: "#a04a2a" },
  { name: "Mecanología",          size: 1, color: "#7a5040" },

  // --- DROGAS / MEDICAMENTOS ---
  { name: "Laboratorio Drogas",   size: 1, color: "#6abf69" },
  { name: "Almacén Drogas",       size: 1, color: "#92d391" },

  // --- ENERGÍA / QUÍMICA ---
  { name: "Refinería Chemfuel",   size: 1, color: "#f0a050" },
  { name: "Crematorio",           size: 1, color: "#2a2a2a" },

  // --- ALMACENES PRINCIPALES ---
  { name: "Almacén General",      size: 3, color: "#a08060" },
  { name: "Almacén Armas",        size: 1, color: "#603020" },
  { name: "Almacén Munición",     size: 1, color: "#503028" },

  // --- INVESTIGACIÓN / COMUNICACIONES ---
  { name: "Investigador",         size: 1, color: "#8060a0" },
  { name: "Sala Servidores",      size: 1, color: "#5040a0" },
  { name: "Sala Comms",           size: 1, color: "#4080c0" },

  // --- INFRAESTRUCTURA ---
  { name: "Sala Baterías",        size: 1, color: "#ffd700" },
  { name: "Vestíbulo",            size: 1, color: "#909090" },
  { name: "Sala Defensa",         size: 2, color: "#a02020" },

  // --- ANIMALES ---
  { name: "Establo",              size: 2, color: "#a07050" },
];

const LINK_SPECS: LinkSpec[] = [
  // Cadena alimentación (hards)
  // Cultivos → Congelador
  { a: "Cultivos 1",            b: "Congelador",          hard: true },
  { a: "Cultivos 2",            b: "Congelador",          hard: true },
  // Caza/Ganadería → Depósito Frigorífico → Carnicería → Congelador
  { a: "Establo",             b: "Depósito Frigorífico",  hard: true },
  { a: "Carnicería",          b: "Depósito Frigorífico",  hard: true },
  { a: "Carnicería",          b: "Congelador",          hard: true },
  // Congelador → Cocina → Nevera → Comedor
  { a: "Cocina",              b: "Congelador",          hard: true },
  { a: "Cocina",              b: "Nevera",              hard: true },
  { a: "Nevera",              b: "Comedor",             hard: true },
  
  // Comedor / social
  { a: "Comedor",             b: "Bloque Dormitorios 1" },
  { a: "Comedor",             b: "Bloque Dormitorios 2" },
  { a: "Comedor",             b: "Sala Recreativa" },
  { a: "Sala Recreativa",     b: "Bloque Dormitorios 1" },
  { a: "Sala Recreativa",     b: "Bloque Dormitorios 2" },

  // Cervecería
  { a: "Cervecería",          b: "Almacén Alcohol",     hard: true },
  { a: "Almacén Alcohol",     b: "Comedor" },

  // Médico
  { a: "Enfermería",          b: "Farmacia",            hard: true },
  { a: "Quirófano",            b: "Farmacia",           hard: true },
  { a: "Enfermería",          b: "Bloque Dormitorios 1" },
  { a: "Enfermería",          b: "Bloque Dormitorios 2" },

  // Textiles
  { a: "Sastrería",           b: "Almacén Telas",       hard: true },
  { a: "Sastrería",           b: "Ropero",              hard: true },
  { a: "Sastrería",           b: "Almacén Armaduras",   hard: true },
  { a: "Almacén Telas",       b: "Almacén General" },
  { a: "Ropero",              b: "Almacén General" },
  { a: "Almacén Armaduras",   b: "Almacén General" },

  // Piedra
  { a: "Cantería",            b: "Almacén Trozos",      hard: true },
  { a: "Cantería",            b: "Almacén Piedra Pulida", hard: true },
  { a: "Cantería",            b: "Almacén General" },

  // Escultura
  { a: "Escultor",            b: "Almacén Esculturas",  hard: true },
  { a: "Escultor",            b: "Almacén Piedra Pulida" },
  { a: "Escultor",            b: "Almacén General" },

  // Metal
  { a: "Fundición",           b: "Almacén General" },
  { a: "Mecanología",         b: "Almacén Armas",       hard: true },
  { a: "Mecanología",         b: "Almacén Munición",    hard: true },
  { a: "Mecanología",         b: "Almacén General" },

  // Drogas
  { a: "Laboratorio Drogas",  b: "Almacén Drogas",      hard: true },
  { a: "Laboratorio Drogas",  b: "Almacén General" },

  // Energía / chemfuel
  { a: "Refinería Chemfuel",  b: "Sala Baterías" },
  { a: "Refinería Chemfuel",  b: "Almacén General" },

  // Investigación
  { a: "Investigador",        b: "Sala Servidores",     hard: true },
  { a: "Investigador",        b: "Sala Comms" },
  { a: "Sala Baterías",       b: "Sala Servidores" },
  { a: "Sala Baterías",       b: "Sala Comms" },

  // Defensa
  { a: "Sala Defensa",        b: "Vestíbulo",           hard: true },
  { a: "Sala Defensa",        b: "Almacén Armas",       hard: true },
  { a: "Sala Defensa",        b: "Almacén Munición",    hard: true },

  // Vestíbulo (entrada controlada)
  { a: "Vestíbulo",           b: "Comedor",             weight: 0.5 },
  { a: "Vestíbulo",           b: "Establo" },
];

const GRID_SIZE = 9;

export function createLateGameVanillaBase(): Base {
  const rooms = ROOM_SPECS.map((spec) => new Room(spec));

  const totalSize = rooms.reduce((s, r) => s + r.size, 0);
  if (totalSize > GRID_SIZE * GRID_SIZE) {
    // Hard invariant: can't request more cells than the grid has.
    throw new Error(`Late-game preset: room sizes sum to ${totalSize}, exceeds grid capacity ${GRID_SIZE * GRID_SIZE}.`);
  }

  const byName: Record<string, RoomId> = Object.fromEntries(rooms.map((r) => [r.name, r.id]));

  const links = LINK_SPECS.map(({ a, b, weight, hard }) => {
    const aId = byName[a];
    const bId = byName[b];
    if (aId === undefined) throw new Error(`Late-game preset: link references unknown room '${a}'`);
    if (bId === undefined) throw new Error(`Late-game preset: link references unknown room '${b}'`);
    return {
      roomIds: { 0: aId, 1: bId },
      ...(weight !== undefined ? { weight } : {}),
      ...(hard !== undefined ? { hard } : {}),
    };
  });

  const allIds = rooms.map((r) => ({ id: r.id }));
  const cells = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ roomsAllowed: allIds.map((x) => ({ ...x })) }))
  );

  return new Base({ cells, links, rooms });
}
