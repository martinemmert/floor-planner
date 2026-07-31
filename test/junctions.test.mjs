import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addFixture,
  addOpening,
  addRoomRect,
  addWall,
  createPlan,
  derived,
  findWall,
  fixturePlacement,
  healJunctions,
  healProject,
  livingArea,
  roomHeadroomBands,
  looseJunctions,
  nodeDegree,
  touch,
  wallCorners,
  wallLength,
} from '../src/app/model.js';
import { defaultFixture } from '../src/app/fixtures.js';
import { openingWidth } from '../src/app/openings.js';

function areas(plan) {
  return derived(plan)
    .rooms.map((r) => Math.round(r.areaMm2 / 1000) / 1000)
    .sort((a, b) => b - a);
}

// ---- T-junctions --------------------------------------------------------

test('a partition drawn onto the middle of a wall splits it', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 5000, { type: 'exterior', thickness: 300 });
  addWall(plan, 3200, 0, 3200, 5000, { type: 'partition', thickness: 115 });
  touch(plan);
  assert.deepEqual(looseJunctions(plan), { tees: 2, crossings: 0 });

  const before = areas(plan);
  const report = healJunctions(plan);
  assert.equal(report.tees, 2);
  assert.equal(plan.walls.length, 7, 'the two walls it landed on are now four');
  assert.deepEqual(looseJunctions(plan), { tees: 0, crossings: 0 });
  // The rooms were already right — the graph split internally — and stay right.
  assert.deepEqual(areas(plan), before);
});

test('the join is a real node, so the corner knows about it', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 6000, 0, { type: 'exterior', thickness: 300 });
  const partition = addWall(plan, 3000, 0, 3000, 3000, { type: 'partition', thickness: 115 });
  touch(plan);

  // Before healing the partition runs on into the wall it touches: nothing at its
  // end tells it to stop.
  const loose = wallCorners(plan, partition);
  assert.ok(loose.some((p) => Math.abs(p.y) < 1), 'the partition reaches the centre line');

  healJunctions(plan);
  const joined = wallCorners(plan, findWall(plan, partition.id));
  // Now it stops at the face of the wall it butts into: 150 mm short of the centre.
  const nearest = Math.min(...joined.map((p) => Math.abs(p.y)));
  assert.ok(nearest > 140 && nearest < 160, `partition stops at ${nearest} mm, want ~150`);
  assert.equal(nodeDegree(plan, partition.a), 3, 'three walls meet at the junction');
});

test('a wall landing near but not exactly on another is pulled onto it', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  const partition = addWall(plan, 3000, 18, 3000, 3000, { thickness: 115 }); // 18 mm short
  touch(plan);
  healJunctions(plan);
  const node = plan.nodes.find((n) => n.id === partition.a);
  assert.equal(Math.round(node.y), 0, 'the loose end was pulled onto the wall');
  assert.equal(nodeDegree(plan, node.id), 3);
});

test('a wall that stops just short of another is left alone', () => {
  // 300 mm away is a deliberate gap, not a missed join.
  const plan = createPlan();
  addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  addWall(plan, 3000, 300, 3000, 3000, { thickness: 115 });
  touch(plan);
  const report = healJunctions(plan);
  assert.equal(report.tees, 0);
  assert.equal(plan.walls.length, 2);
});

test('a junction too close to a corner is not split off as a stub', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  addWall(plan, 30, 0, 30, 3000, { thickness: 115 }); // 30 mm from the corner
  touch(plan);
  healJunctions(plan);
  assert.equal(plan.walls.length, 2, 'no 30 mm stub of wall was created');
});

// ---- crossings ----------------------------------------------------------

test('two walls crossing become four with a node in the middle', () => {
  const plan = createPlan();
  addWall(plan, 0, 2000, 8000, 2000, { thickness: 200 });
  addWall(plan, 4000, 0, 4000, 5000, { thickness: 200 });
  touch(plan);
  assert.deepEqual(looseJunctions(plan), { tees: 0, crossings: 1 });

  const report = healJunctions(plan);
  assert.equal(report.crossings, 1);
  assert.equal(plan.walls.length, 4);
  const centre = plan.nodes.find((n) => Math.round(n.x) === 4000 && Math.round(n.y) === 2000);
  assert.ok(centre, 'a node sits at the crossing');
  assert.equal(nodeDegree(plan, centre.id), 4);
  assert.deepEqual(looseJunctions(plan), { tees: 0, crossings: 0 });
});

test('a crossing inside a shell makes four rooms', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 6000, { type: 'exterior', thickness: 300 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'partition', thickness: 115 });
  addWall(plan, 0, 3000, 8000, 3000, { type: 'partition', thickness: 115 });
  touch(plan);
  healJunctions(plan);
  assert.equal(looseJunctions(plan).tees + looseJunctions(plan).crossings, 0);
  assert.equal(derived(plan).rooms.length, 4);
});

// ---- overlaps and duplicates -------------------------------------------

test('a wall drawn along another leaves one wall per stretch', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 5000, 0, { thickness: 115 });
  addWall(plan, 2000, 0, 8000, 0, { thickness: 300 });
  touch(plan);
  healJunctions(plan);
  const spans = plan.walls
    .map((w) => ({ len: Math.round(wallLength(plan, w)), t: w.thickness }))
    .sort((a, b) => a.len - b.len || a.t - b.t);
  assert.deepEqual(spans, [
    { len: 2000, t: 115 },
    { len: 3000, t: 300 },
    { len: 3000, t: 300 },
  ]);
  // The doubled middle stretch kept the thicker wall, not the partition.
  assert.equal(plan.walls.filter((w) => w.thickness === 115).length, 1);
});

test('two identical walls collapse to one', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 4000, 0, { thickness: 115 });
  // addWall itself refuses an exact repeat, so make it the hard way.
  plan.walls.push({ id: 'dup', a: plan.walls[0].a, b: plan.walls[0].b, thickness: 300, type: 'exterior' });
  touch(plan);
  const report = healJunctions(plan);
  assert.equal(report.merged, 1);
  assert.equal(plan.walls.length, 1);
  assert.equal(plan.walls[0].thickness, 300);
});

test('nodes on top of each other weld together', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  // A second wall starting 12 mm from the first one's end: a missed click.
  plan.nodes.push({ id: 'loose', x: 4000, y: 12 });
  plan.nodes.push({ id: 'far', x: 4000, y: 4000 });
  plan.walls.push({ id: 'w2', a: 'loose', b: 'far', thickness: 300, type: 'exterior' });
  touch(plan);
  const report = healJunctions(plan);
  assert.equal(report.welded, 1);
  assert.equal(nodeDegree(plan, plan.walls[0].b), 2, 'the corner now carries both walls');
});

// ---- what rides along the wall -----------------------------------------

test('a door and a socket stay where they were when their wall is split', () => {
  const plan = createPlan();
  const long = addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  addOpening(plan, long.id, 900, { kind: 'door', width: 900 });
  addOpening(plan, long.id, 4500, { kind: 'window', width: 1200 });
  const socket = addFixture(plan, { ...defaultFixture('socket'), wallId: long.id, offset: 5200, side: 1 });
  const before = fixturePlacement(plan, socket);
  addWall(plan, 3000, 0, 3000, 3000, { thickness: 115 });
  touch(plan);
  healJunctions(plan);

  // Each opening is on the piece it falls on, inside it and in the right order.
  const seats = plan.openings.map((o) => ({
    offset: Math.round(o.offset),
    hole: Math.round(openingWidth(o)),
    len: Math.round(wallLength(plan, findWall(plan, o.wallId))),
  }));
  assert.equal(seats.length, 2);
  for (const seat of seats) {
    assert.equal(seat.len, 3000);
    assert.ok(seat.offset >= 0 && seat.offset + seat.hole <= seat.len, JSON.stringify(seat));
  }
  assert.ok(seats[0].offset < seats[1].offset + 3000, 'still in order along the run');
  const after = fixturePlacement(plan, socket);
  assert.equal(Math.round(after.x), Math.round(before.x));
  assert.equal(Math.round(after.y), Math.round(before.y));
});

test('an opening straddling a new junction is pulled back inside its wall', () => {
  const plan = createPlan();
  const long = addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  addOpening(plan, long.id, 3000, { kind: 'window', width: 1200 }); // centred on the junction
  addWall(plan, 3000, 0, 3000, 3000, { thickness: 115 });
  touch(plan);
  healJunctions(plan);
  const opening = plan.openings[0];
  const len = wallLength(plan, findWall(plan, opening.wallId));
  const hole = openingWidth(opening);
  assert.ok(opening.offset >= 0 && opening.offset + hole <= len + 0.5, 'it fits its wall');
  assert.equal(Math.round(opening.offset + hole), 3000, 'flush against the junction');
});

// ---- idempotence and the whole project ---------------------------------

test('healing a healed drawing changes nothing', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 6000, { type: 'exterior', thickness: 300 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'partition', thickness: 115 });
  addWall(plan, 0, 3000, 4000, 3000, { type: 'partition', thickness: 115 });
  touch(plan);
  healJunctions(plan);
  const walls = plan.walls.length;
  const nodes = plan.nodes.length;
  const report = healJunctions(plan);
  assert.deepEqual(report, { welded: 0, tees: 0, crossings: 0, merged: 0 });
  assert.equal(plan.walls.length, walls);
  assert.equal(plan.nodes.length, nodes);
});

test('every floor of a project is healed', () => {
  const project = { plans: [createPlan(), createPlan()] };
  for (const plan of project.plans) {
    addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
    addWall(plan, 3000, 0, 3000, 3000, { thickness: 115 });
    touch(plan);
  }
  const report = healProject(project);
  assert.equal(report.tees, 2, 'one on each floor');
  for (const plan of project.plans) assert.equal(plan.walls.length, 3);
});

test('an empty or single-wall drawing is left alone', () => {
  const empty = createPlan();
  assert.deepEqual(healJunctions(empty), { welded: 0, tees: 0, crossings: 0, merged: 0 });
  const one = createPlan();
  addWall(one, 0, 0, 4000, 0, { thickness: 300 });
  touch(one);
  assert.deepEqual(healJunctions(one), { welded: 0, tees: 0, crossings: 0, merged: 0 });
  assert.equal(one.walls.length, 1);
});

test('splitting a wall keeps everything the wall was carrying', () => {
  const plan = createPlan();
  plan.height = 2750;
  const long = addWall(plan, 0, 0, 9000, 0, { type: 'exterior', thickness: 365 });
  Object.assign(long, { height: 500, pitch: 50, status: 'new' });
  addWall(plan, 4500, 0, 4500, 4000, { type: 'partition', thickness: 115 });
  touch(plan);
  healJunctions(plan);

  const pieces = plan.walls.filter((w) => w.thickness === 365);
  assert.equal(pieces.length, 2, 'the long wall was split in two');
  for (const piece of pieces) {
    assert.equal(piece.height, 500, 'the Drempel height');
    assert.equal(piece.pitch, 50, 'the roof pitch above it');
    assert.equal(piece.status, 'new', 'which side of the work it is on');
    assert.equal(piece.type, 'exterior');
  }
});

test('a Drempel behind a partition still governs both rooms', () => {
  // The bug this catches: a split wall lost its pitch, so the room beyond the
  // partition thought it had full headroom and its Wohnfläche came out too high.
  const plan = createPlan();
  plan.height = 2750;
  addRoomRect(plan, 0, 0, 9000, 7000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const at = (id) => plan.nodes.find((n) => n.id === id);
  for (const wall of plan.walls) {
    const a = at(wall.a);
    const b = at(wall.b);
    if (Math.abs(a.y) < 1 && Math.abs(b.y) < 1) Object.assign(wall, { height: 500, pitch: 50 });
    if (Math.abs(a.y - 7000) < 1 && Math.abs(b.y - 7000) < 1) Object.assign(wall, { height: 500, pitch: 30 });
  }
  touch(plan);
  const whole = livingArea(plan);

  addWall(plan, 4500, 0, 4500, 7000, { type: 'partition', thickness: 115 });
  healJunctions(plan);
  touch(plan);
  assert.equal(derived(plan).rooms.length, 2);
  const split = livingArea(plan);
  // Splitting the room in two takes the partition's own footprint out and nothing
  // else: the living area must not jump.
  assert.ok(Math.abs(whole - split) < 1e6, `${(whole / 1e6).toFixed(2)} against ${(split / 1e6).toFixed(2)} m²`);
  for (const room of derived(plan).rooms) {
    assert.equal(roomHeadroomBands(plan, room).slopes.length, 2, 'both Drempel still govern');
  }
});
