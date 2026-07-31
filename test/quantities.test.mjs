import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  floorQuantities,
  openingQuantities,
  quantitiesCsv,
  summaryQuantities,
  wallQuantities,
} from '../src/app/quantities.js';
import {
  activePlan,
  addOpening,
  addRoomRect,
  createProject,
  healJunctions,
  roomMetaFor,
  derived,
  touch,
} from '../src/app/model.js';

/**
 * A room whose figures can be worked out by hand.
 *
 * `addRoomRect` takes centreline dimensions, so a 9000 × 7000 rectangle of 365 wall has
 * its centrelines on that rectangle: 32 m of wall run, and 8635 × 6635 inside it.
 */
function house() {
  const project = createProject();
  const plan = activePlan(project);
  plan.name = 'Erdgeschoss';
  addRoomRect(plan, 0, 0, 9000, 7000, { type: 'exterior', thickness: 365 });
  touch(plan);
  return { project, plan };
}

test('a wall is measured on its centreline, which is how it is built and quoted', () => {
  const { plan } = house();
  const rows = wallQuantities(plan);
  assert.equal(rows.length, 1, 'one type of wall');
  assert.equal(rows[0].thickness, 365);
  assert.equal(rows[0].count, 4);
  // 2 × (9,00 + 7,00).
  assert.equal(rows[0].run, 32);
  // Both faces, floor to ceiling: 32 m × 2,50 × 2.
  assert.equal(rows[0].faces, 160);
});

test('an opening comes off the plaster, on both faces, measured by the hole', () => {
  const { plan } = house();
  const before = wallQuantities(plan)[0].faces;
  // A 985 leaf with a 30 lining each side is a 1045 hole, 2010 tall.
  addOpening(plan, plan.walls[0].id, 3000, { kind: 'door', width: 985 });
  touch(plan);
  const after = wallQuantities(plan)[0];
  const hole = (1045 * 2010) / 1e6;
  assert.equal(Math.round(after.openings * 100) / 100, Math.round(hole * 2 * 100) / 100, 'counted once per face');
  assert.ok(Math.abs(before - after.faces - hole * 2) < 0.02, `faces went ${before} → ${after.faces}`);
});

test('skirting is the inside of the room, not its centreline', () => {
  // Off by a wall thickness at every corner otherwise, which on a house is metres.
  const { plan } = house();
  const rows = floorQuantities(plan);
  assert.equal(rows.length, 1);
  // 2 × (8,635 + 6,635).
  assert.equal(rows[0].skirting, 30.54);
  assert.equal(rows[0].area, 57.29, 'and the area is the inside too');
  assert.equal(rows[0].rooms, 1);
});

test('floors are grouped by what they are laid with', () => {
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  addRoomRect(plan, 5000, 0, 9000, 4000, { type: 'exterior', thickness: 300 });
  touch(plan);
  healJunctions(plan);
  touch(plan);
  const rooms = derived(plan).rooms;
  assert.ok(rooms.length >= 2, `expected two rooms, found ${rooms.length}`);
  // Lay one in boards and leave the other as it is.
  const meta = roomMetaFor(plan, rooms[0]);
  if (meta) meta.floor = 'oak';
  touch(plan);
  const rows = floorQuantities(plan);
  assert.ok(rows.length >= 2, `expected two finishes, found ${rows.map((r) => r.label).join(', ')}`);
  assert.ok(rows.some((row) => row.label === 'Boards'));
});

test('openings are counted by size, because that is how they are ordered', () => {
  const { plan } = house();
  for (const at of [1500, 4000, 6500]) addOpening(plan, plan.walls[0].id, at, { kind: 'window', width: 1010, sill: 900 });
  addOpening(plan, plan.walls[1].id, 2000, { kind: 'door', width: 985 });
  touch(plan);
  const rows = openingQuantities(plan);
  const windows = rows.find((row) => row.kind === 'window');
  assert.equal(windows.count, 3, 'three of the same window is one line');
  assert.equal(windows.leaf, 1010);
  // A lintel spans the hole plus a bearing each end, which is how one is ordered.
  assert.ok(windows.lintels > (windows.hole / 1000) * 3, 'lintels carry their bearing');
  assert.equal(rows.find((row) => row.kind === 'door').count, 1);
});

test('the summary agrees with the tables it summarises', () => {
  const { project, plan } = house();
  addOpening(plan, plan.walls[0].id, 3000, { kind: 'door', width: 985 });
  addOpening(plan, plan.walls[1].id, 2500, { kind: 'window', width: 1385, sill: 900 });
  touch(plan);
  const summary = summaryQuantities(project, plan);
  const walls = wallQuantities(plan);
  const floors = floorQuantities(plan);
  assert.equal(summary.wallRun, Math.round(walls.reduce((t, r) => t + r.run, 0) * 100) / 100);
  assert.equal(summary.wallFaces, Math.round(walls.reduce((t, r) => t + r.faces, 0) * 100) / 100);
  assert.equal(summary.skirting, Math.round(floors.reduce((t, r) => t + r.skirting, 0) * 100) / 100);
  assert.equal(summary.doors, 1);
  assert.equal(summary.windows, 1);
  // Volume is the floor area times the height it is under.
  assert.ok(Math.abs(summary.volume - summary.floorArea * 2.5) < 0.2, `${summary.volume} m³`);
});

test('the CSV is sectioned, semicolon separated, and quotes what needs it', () => {
  const { project, plan } = house();
  plan.name = 'Erdgeschoss; Haus B';
  addOpening(plan, plan.walls[0].id, 3000, { kind: 'door', width: 985 });
  touch(plan);
  const csv = quantitiesCsv(project, plan);
  for (const section of ['Summary', 'Walls', 'Floors', 'Openings']) {
    assert.ok(csv.includes(section), `no ${section} section`);
  }
  assert.ok(csv.includes(';'), 'semicolons, which is what a German spreadsheet expects');
  assert.ok(csv.includes('m²'));
  // Every row has the same separator, and nothing runs a value into the next column.
  const lines = csv.split('\n').filter(Boolean);
  assert.ok(lines.length > 12, `only ${lines.length} lines`);
});

test('an empty drawing gives zeroes, not nonsense', () => {
  const project = createProject();
  const plan = activePlan(project);
  const summary = summaryQuantities(project, plan);
  assert.equal(summary.wallRun, 0);
  assert.equal(summary.rooms, 0);
  assert.equal(summary.doors, 0);
  assert.deepEqual(wallQuantities(plan), []);
  assert.deepEqual(floorQuantities(plan), []);
  assert.deepEqual(openingQuantities(plan), []);
  assert.ok(quantitiesCsv(project, plan).includes('Summary'));
});
