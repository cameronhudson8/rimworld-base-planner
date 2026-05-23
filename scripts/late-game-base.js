/* eslint-disable no-undef */
/*
 * Genera una configuración completa de base RimWorld late-game VAINILLA
 * (sin DLCs) para 25-30 colonos (capacidad ~96) y la guarda en localStorage
 * del navegador, sustituyendo la base actual. Pensado para pegar entero en
 * la consola del navegador (DevTools → Console) y ejecutar.
 *
 * ANTES DE EJECUTAR: haz backup con  copy(localStorage.getItem('base'))
 *
 * Convenciones:
 * - "celda" = módulo arquitectónico que en el juego se construye con varios
 *   tiles. 1 celda de dormitorio = 4 habitaciones con cama doble = 8 colonos.
 * - Grid 9x9 = 81 celdas. Suma de tamaños de salas = 81 (sin huecos).
 * - 'hard: true' = adyacencia obligatoria (penalización enorme).
 * - 'weight' = importancia relativa entre soft-links; mayor = se respeta antes.
 *
 * Sin contenido de DLC (no hay Sala Niños/Biotech, Templo/Ideology, ni
 * Sala Trono o Meditación/Royalty).
 */
(() => {
  const rooms = [
    // --- DESCANSO ---
    { name: 'Bloque Dormitorios 1', size: 6, color: '#3b8132' },
    { name: 'Bloque Dormitorios 2', size: 6, color: '#4ea342' },
    { name: 'Sala Recreativa',      size: 4, color: '#9cd986' },

    // --- COMIDA ---
    { name: 'Comedor',              size: 7, color: '#d96b3d' },
    { name: 'Cocina',               size: 1, color: '#ff7373' },
    { name: 'Nevera',               size: 2, color: '#a8d6f0' },
    { name: 'Congelador',           size: 4, color: '#5fa3d8' },
    { name: 'Carnicería',           size: 1, color: '#b03030' },
    { name: 'Congelador Cuerpos',   size: 2, color: '#404060' },
    { name: 'Hidropónica',          size: 3, color: '#7ed957' },

    // --- ALCOHOL ---
    { name: 'Cervecería',           size: 1, color: '#c9a14a' },
    { name: 'Almacén Alcohol',      size: 1, color: '#d4b876' },

    // --- MÉDICO ---
    { name: 'Enfermería',           size: 6, color: '#ffffff' },
    { name: 'Quirófano',            size: 1, color: '#e0f0ff' },
    { name: 'Farmacia',             size: 1, color: '#d9eaf7' },

    // --- PRISIÓN ---
    { name: 'Prisión',              size: 2, color: '#555555' },

    // --- TEXTIL / ROPA ---
    { name: 'Sastrería',            size: 1, color: '#b88dc1' },
    { name: 'Ropero',               size: 1, color: '#c9aacf' },
    { name: 'Almacén Telas',        size: 1, color: '#dac4dd' },
    { name: 'Almacén Armaduras',    size: 1, color: '#8a7090' },

    // --- PIEDRA / CONSTRUCCIÓN ---
    { name: 'Cantería',             size: 1, color: '#8a8478' },
    { name: 'Almacén Trozos',       size: 1, color: '#a0998a' },
    { name: 'Almacén Piedra Pulida',size: 1, color: '#c0b8a8' },

    // --- ESCULTURA / ARTE ---
    { name: 'Escultor',             size: 1, color: '#cdb78a' },
    { name: 'Almacén Esculturas',   size: 1, color: '#e0cfa8' },

    // --- METAL ---
    { name: 'Fundición',            size: 1, color: '#a04a2a' },
    { name: 'Mecanología',          size: 1, color: '#7a5040' },

    // --- DROGAS / MEDICAMENTOS ---
    { name: 'Laboratorio Drogas',   size: 1, color: '#6abf69' },
    { name: 'Almacén Drogas',       size: 1, color: '#92d391' },

    // --- ENERGÍA / QUÍMICA ---
    { name: 'Refinería Chemfuel',   size: 1, color: '#f0a050' },
    { name: 'Crematorio',           size: 1, color: '#2a2a2a' },

    // --- ALMACENES PRINCIPALES ---
    { name: 'Almacén General',      size: 5, color: '#a08060' },
    { name: 'Almacén Armas',        size: 1, color: '#603020' },
    { name: 'Almacén Munición',     size: 1, color: '#503028' },

    // --- INVESTIGACIÓN / COMUNICACIONES ---
    { name: 'Investigador',         size: 2, color: '#8060a0' },
    { name: 'Sala Servidores',      size: 1, color: '#5040a0' },
    { name: 'Sala Comms',           size: 1, color: '#4080c0' },

    // --- INFRAESTRUCTURA ---
    { name: 'Sala Baterías',        size: 1, color: '#ffd700' },
    { name: 'Vestíbulo',            size: 1, color: '#909090' },
    { name: 'Sala Defensa',         size: 2, color: '#a02020' },

    // --- ANIMALES ---
    { name: 'Establo',              size: 3, color: '#a07050' },
  ].map((r) => ({ ...r, id: crypto.randomUUID() }));

  const totalSize = rooms.reduce((s, r) => s + r.size, 0);
  console.log(`Total cells de salas: ${totalSize}`);

  const byName = Object.fromEntries(rooms.map((r) => [r.name, r.id]));

  const linkSpecs = [
    // Cadena alimentación (hards)
    { a: 'Cocina',              b: 'Nevera',              hard: true },
    { a: 'Cocina',              b: 'Congelador',          hard: true },
    { a: 'Nevera',              b: 'Comedor',             hard: true },
    { a: 'Nevera',              b: 'Congelador',          hard: true },
    { a: 'Carnicería',          b: 'Congelador',          hard: true },
    { a: 'Carnicería',          b: 'Congelador Cuerpos',  hard: true },
    { a: 'Crematorio',          b: 'Congelador Cuerpos',  hard: true },

    // Comedor / social
    { a: 'Comedor',             b: 'Bloque Dormitorios 1' },
    { a: 'Comedor',             b: 'Bloque Dormitorios 2' },
    { a: 'Comedor',             b: 'Sala Recreativa' },
    { a: 'Sala Recreativa',     b: 'Bloque Dormitorios 1' },
    { a: 'Sala Recreativa',     b: 'Bloque Dormitorios 2' },

    // Hidropónica
    { a: 'Hidropónica',         b: 'Cocina' },

    // Cervecería
    { a: 'Cervecería',          b: 'Almacén Alcohol',     hard: true },
    { a: 'Almacén Alcohol',     b: 'Comedor' },

    // Médico
    { a: 'Enfermería',          b: 'Farmacia',            hard: true },
    { a: 'Enfermería',          b: 'Quirófano',           hard: true },
    { a: 'Farmacia',            b: 'Quirófano',           hard: true },
    { a: 'Enfermería',          b: 'Bloque Dormitorios 1' },
    { a: 'Enfermería',          b: 'Bloque Dormitorios 2' },

    // Textiles
    { a: 'Sastrería',           b: 'Almacén Telas',       hard: true },
    { a: 'Sastrería',           b: 'Ropero',              hard: true },
    { a: 'Sastrería',           b: 'Almacén Armaduras',   hard: true },
    { a: 'Almacén Telas',       b: 'Almacén General' },
    { a: 'Ropero',              b: 'Almacén General' },
    { a: 'Almacén Armaduras',   b: 'Almacén General' },

    // Piedra
    { a: 'Cantería',            b: 'Almacén Trozos',      hard: true },
    { a: 'Cantería',            b: 'Almacén Piedra Pulida', hard: true },
    { a: 'Cantería',            b: 'Almacén General' },

    // Escultura
    { a: 'Escultor',            b: 'Almacén Esculturas',  hard: true },
    { a: 'Escultor',            b: 'Almacén Piedra Pulida' },
    { a: 'Escultor',            b: 'Almacén General' },

    // Metal
    { a: 'Fundición',           b: 'Almacén General' },
    { a: 'Mecanología',         b: 'Almacén Armas',       hard: true },
    { a: 'Mecanología',         b: 'Almacén Munición',    hard: true },
    { a: 'Mecanología',         b: 'Almacén General' },

    // Drogas
    { a: 'Laboratorio Drogas',  b: 'Almacén Drogas',      hard: true },
    { a: 'Laboratorio Drogas',  b: 'Almacén General' },

    // Energía / chemfuel
    { a: 'Refinería Chemfuel',  b: 'Sala Baterías' },
    { a: 'Refinería Chemfuel',  b: 'Almacén General' },

    // Investigación
    { a: 'Investigador',        b: 'Sala Servidores',     hard: true },
    { a: 'Investigador',        b: 'Sala Comms' },
    { a: 'Sala Baterías',       b: 'Sala Servidores' },
    { a: 'Sala Baterías',       b: 'Sala Comms' },

    // Defensa
    { a: 'Sala Defensa',        b: 'Vestíbulo',           hard: true },
    { a: 'Sala Defensa',        b: 'Almacén Armas',       hard: true },
    { a: 'Sala Defensa',        b: 'Almacén Munición',    hard: true },

    // Vestíbulo (entrada controlada)
    { a: 'Vestíbulo',           b: 'Comedor',             weight: 0.5 },
    { a: 'Vestíbulo',           b: 'Establo' },
  ];

  const links = linkSpecs.map(({ a, b, weight, hard }) => {
    if (byName[a] === undefined) throw new Error(`Link referencia sala desconocida: '${a}'`);
    if (byName[b] === undefined) throw new Error(`Link referencia sala desconocida: '${b}'`);
    const link = { roomIds: { 0: byName[a], 1: byName[b] } };
    if (weight !== undefined) link.weight = weight;
    if (hard !== undefined) link.hard = hard;
    return link;
  });

  const N = 9;
  if (totalSize !== N * N) {
    console.warn(`La suma de tamaños (${totalSize}) no coincide con N*N (${N * N}). Habrá cells sin asignar o salas sin sitio.`);
  }
  const allIds = rooms.map((r) => ({ id: r.id }));
  const cells = Array.from({ length: N }, () =>
    Array.from({ length: N }, () => ({ roomsAllowed: allIds.map((x) => ({ ...x })) }))
  );

  const baseData = { cells, links, rooms };
  localStorage.setItem('base', JSON.stringify(baseData));
  console.log(`Base late-game vainilla guardada: ${rooms.length} salas, ${links.length} links, grid ${N}x${N}.`);
  console.log('Recargando...');
  location.reload();
})();
