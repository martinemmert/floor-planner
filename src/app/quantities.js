// What the drawing adds up to, in the terms somebody would price it in.
//
// A schedule says what things are; a quantity says how much of them there is. These are
// the figures a builder or a trade asks for first — how many square metres of wall to
// plaster, how many of floor to lay, how much skirting, how many doors of each size —
// and working them off a drawing by hand is where the mistakes come from.
//
// Everything is measured off the drawing rather than entered, so it cannot disagree with
// what is drawn. Nothing here knows about money: a rate is a thing you are quoted, not a
// thing a drawing can tell you.

import {
  derived,
  floorToFloor,
  inPhase,
  openingGeometry,
  phaseWalls,
  roomFloorArea,
  roomHeight,
  roomMetaFor,
  totalArea,
  wallHeight,
  wallLengths,
  wallTypeFor,
} from './model.js';
import { FLOOR_FINISHES } from './materials.js';
import { openingHeight, openingWidth } from './openings.js';

const m2 = (mm2) => Math.round((mm2 / 1e6) * 100) / 100;
const m = (mm) => Math.round((mm / 1000) * 100) / 100;

/**
 * The walls, by type: how long they run and how much face there is on them.
 *
 * Both faces, because both get plastered, less the openings — which are counted once
 * for the two faces they interrupt. Measured on the centreline for the run, because that
 * is how a wall is built and quoted; the faces differ by the corners and nobody prices
 * a corner.
 */
export function wallQuantities(plan) {
  const groups = new Map();
  for (const wall of phaseWalls(plan)) {
    const lengths = wallLengths(plan, wall);
    if (!lengths) continue;
    const type = wall.type ?? 'partition';
    const key = `${type}|${wall.thickness}`;
    const found = groups.get(key) ?? {
      key,
      type,
      label: wallTypeFor(type).label ?? type,
      thickness: wall.thickness,
      count: 0,
      run: 0,
      faces: 0,
      openings: 0,
    };
    const tall = wallHeight(plan, wall);
    found.count += 1;
    found.run += lengths.centre;
    found.faces += lengths.centre * tall * 2;

    for (const opening of plan.openings ?? []) {
      if (opening.wallId !== wall.id) continue;
      // The hole, not the leaf: it is the hole that is missing from the plaster.
      const hole = openingWidth(opening) * openingHeight(opening);
      found.openings += hole * 2;
    }
    groups.set(key, found);
  }
  return [...groups.values()]
    .map((row) => ({
      ...row,
      run: m(row.run),
      faces: m2(Math.max(0, row.faces - row.openings)),
      openings: m2(row.openings),
    }))
    .sort((a, b) => b.thickness - a.thickness);
}

/** The floors, by the finish they are laid with, and the skirting round each. */
export function floorQuantities(plan) {
  const groups = new Map();
  for (const room of derived(plan).rooms) {
    if (room.kept === false) continue;
    const meta = roomMetaFor(plan, room);
    const finish = FLOOR_FINISHES.find((f) => f.id === (meta?.floor ?? 'screed')) ?? FLOOR_FINISHES[0];
    const found = groups.get(finish.id) ?? { id: finish.id, label: finish.label, rooms: 0, area: 0, skirting: 0, walls: 0 };
    found.rooms += 1;
    found.area += roomFloorArea(plan, room);
    // Skirting runs round the room, less the doorways it cannot cross.
    let perimeter = 0;
    for (let i = 0; i < room.inner.length; i++) {
      const a = room.inner[i];
      const b = room.inner[(i + 1) % room.inner.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    found.skirting += perimeter;
    found.walls += perimeter * roomHeight(plan, room);
    groups.set(finish.id, found);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, area: m2(row.area), skirting: m(row.skirting), walls: m2(row.walls) }))
    .sort((a, b) => b.area - a.area);
}

/**
 * What has to be ordered, counted the way it is ordered.
 *
 * A door is one door however many times the same size appears, so these are counts by
 * size — the same grouping the schedule uses, since it is the same question asked for a
 * different purpose.
 */
export function openingQuantities(plan) {
  const groups = new Map();
  for (const opening of plan.openings ?? []) {
    if (!inPhase(plan, opening.wallId)) continue;
    const key = `${opening.kind}|${Math.round(opening.width)}|${openingHeight(opening)}`;
    const found = groups.get(key) ?? {
      kind: opening.kind,
      leaf: Math.round(opening.width),
      hole: Math.round(openingWidth(opening)),
      height: openingHeight(opening),
      count: 0,
      lintels: 0,
    };
    found.count += 1;
    // A lintel spans the hole plus a bearing each end, which is how one is ordered.
    found.lintels += openingWidth(opening) + 250;
    groups.set(key, found);
  }
  return [...groups.values()]
    .map((row) => ({ ...row, lintels: m(row.lintels) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.leaf - b.leaf);
}

/** The one-line answers: the figures somebody asks for before any of the detail. */
export function summaryQuantities(project, plan) {
  const walls = wallQuantities(plan);
  const floors = floorQuantities(plan);
  const openings = openingQuantities(plan);
  const rooms = derived(plan).rooms.filter((room) => room.kept !== false);
  let volume = 0;
  for (const room of rooms) volume += roomFloorArea(plan, room) * roomHeight(plan, room);
  return {
    rooms: rooms.length,
    floorArea: m2(totalArea(plan)),
    volume: Math.round((volume / 1e9) * 10) / 10,
    wallRun: Math.round(walls.reduce((total, row) => total + row.run, 0) * 100) / 100,
    wallFaces: Math.round(walls.reduce((total, row) => total + row.faces, 0) * 100) / 100,
    skirting: Math.round(floors.reduce((total, row) => total + row.skirting, 0) * 100) / 100,
    doors: openings.filter((row) => row.kind === 'door').reduce((total, row) => total + row.count, 0),
    windows: openings.filter((row) => row.kind === 'window').reduce((total, row) => total + row.count, 0),
    storeyHeight: m(floorToFloor(plan)),
  };
}

/** The lot as one CSV, in sections, which is how a spreadsheet wants it. */
export function quantitiesCsv(project, plan) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [];
  const section = (title, header, lines) => {
    rows.push([title]);
    rows.push(header);
    for (const line of lines) rows.push(line);
    rows.push([]);
  };

  const summary = summaryQuantities(project, plan);
  section('Summary', ['Item', 'Quantity', 'Unit'], [
    ['Rooms', summary.rooms, 'no.'],
    ['Floor area', summary.floorArea, 'm²'],
    ['Volume', summary.volume, 'm³'],
    ['Wall run', summary.wallRun, 'm'],
    ['Wall faces to finish', summary.wallFaces, 'm²'],
    ['Skirting', summary.skirting, 'm'],
    ['Doors', summary.doors, 'no.'],
    ['Windows', summary.windows, 'no.'],
    ['Floor to floor', summary.storeyHeight, 'm'],
  ]);

  section(
    'Walls',
    ['Type', 'Thickness mm', 'Walls', 'Run m', 'Faces m²', 'Openings deducted m²'],
    wallQuantities(plan).map((row) => [row.label, row.thickness, row.count, row.run, row.faces, row.openings])
  );

  section(
    'Floors',
    ['Finish', 'Rooms', 'Area m²', 'Skirting m', 'Wall surface m²'],
    floorQuantities(plan).map((row) => [row.label, row.rooms, row.area, row.skirting, row.walls])
  );

  section(
    'Openings',
    ['Kind', 'Leaf mm', 'Hole mm', 'Height mm', 'Number', 'Lintels m'],
    openingQuantities(plan).map((row) => [row.kind, row.leaf, row.hole, row.height, row.count, row.lintels])
  );

  return rows.map((row) => row.map(cell).join(';')).join('\n');
}
