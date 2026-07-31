import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addRoomRect,
  addVoid,
  addWall,
  createPlan,
  createProject,
  derived,
  findVoid,
  healJunctions,
  phaseOf,
  phaseWalls,
  pointInVoid,
  roomFloorArea,
  roomFloorPieces,
  stairHeadroom,
  statusCounts,
  storeyAbove,
  storeyBelow,
  totalArea,
  touch,
  voidCorners,
  wallInPhase,
  wallStatus,
} from '../src/app/model.js';
import { normaliseProject } from '../src/app/export.js';

const m2 = (mm2) => Number((mm2 / 1e6).toFixed(2));

// ---- openings in the floor ----------------------------------------------

function storey(name = 'EG', height = 2750) {
  const plan = createPlan({ name });
  plan.height = height;
  plan.floorThickness = 250;
  addRoomRect(plan, 0, 0, 5000, 6000, { type: 'exterior', thickness: 300 });
  touch(plan);
  return plan;
}

test('an opening in the floor takes its area out of the room', () => {
  const plan = storey();
  const room = derived(plan).rooms[0];
  const whole = roomFloorArea(plan, room);
  addVoid(plan, 2500, 3000, { w: 1100, h: 3000 });
  touch(plan);
  const after = roomFloorArea(plan, derived(plan).rooms[0]);
  assert.equal(m2(whole - after), m2(1100 * 3000));
  assert.equal(m2(totalArea(plan)), m2(after));
  // The floor is now a ring of pieces round the hole.
  assert.equal(roomFloorPieces(plan, derived(plan).rooms[0]).length, 4);
});

test('an opening running off the edge only takes the part that overlaps', () => {
  const plan = storey();
  // Half of this one hangs outside the room.
  addVoid(plan, 300, 3000, { w: 2000, h: 2000 });
  touch(plan);
  const room = derived(plan).rooms[0];
  const lost = Math.abs(derived(plan).rooms[0].areaMm2) - roomFloorArea(plan, room);
  assert.ok(lost > 0 && lost < 2000 * 2000, `${m2(lost)} lost of a possible ${m2(2000 * 2000)}`);
});

test('a turned opening is still a rectangle in the right place', () => {
  const plan = storey();
  const item = addVoid(plan, 2500, 3000, { w: 2000, h: 1000, rotation: 90 });
  const corners = voidCorners(item);
  const xs = corners.map((p) => Math.round(p.x));
  const ys = corners.map((p) => Math.round(p.y));
  // Turned a quarter, so its width now runs down the page.
  assert.equal(Math.max(...xs) - Math.min(...xs), 1000);
  assert.equal(Math.max(...ys) - Math.min(...ys), 2000);
  assert.equal(pointInVoid(item, 2500, 3800), true);
  assert.equal(pointInVoid(item, 2500, 4200), false);
});

test('openings survive a save and load, and rubbish in them is squared up', () => {
  const plan = storey();
  addVoid(plan, 2500, 3000, { w: 1100, h: 2900 });
  plan.voids.push({ id: 'odd', x: 0, y: 0 });
  const project = normaliseProject({ plans: [plan], activePlanId: plan.id });
  const kept = project.plans[0].voids;
  assert.equal(kept.length, 2);
  for (const item of kept) {
    assert.ok(item.w >= 200 && item.h >= 200, 'given a workable size');
    assert.equal(typeof item.rotation, 'number');
  }
});

// ---- headroom ------------------------------------------------------------

function withStair() {
  const project = createProject();
  const eg = project.plans[0];
  eg.height = 2750;
  eg.floorThickness = 250;
  addRoomRect(eg, 0, 0, 5000, 6000, { type: 'exterior', thickness: 300 });
  const stair = {
    id: 'st',
    x: 500,
    y: 500,
    rotation: 0,
    shape: 'straight',
    width: 1000,
    treadDepth: 280,
    steps: 16,
    rise: 3000,
    direction: 'up',
    turn: 'right',
    landingAfter: 8,
    winderSteps: 3,
    newel: 200,
  };
  eg.stairs.push(stair);
  touch(eg);
  const og = createPlan({ name: 'OG' });
  og.height = 2500;
  project.plans.push(og);
  return { project, eg, og, stair };
}

test('a flight with no opening above it runs into the slab', () => {
  const { project, eg, stair } = withStair();
  const head = stairHeadroom(project, eg, stair);
  assert.equal(head.ok, false);
  assert.ok(head.worst.headroom <= 0, `${head.worst.headroom} mm at step ${head.worst.step}`);
  assert.ok(head.shortFrom < head.shortTo, 'a run of steps is short, not just one');
  assert.ok(head.needsOpening, 'and it can say what opening would fix it');
});

test('cutting the opening it asks for is enough to clear two metres', () => {
  const { project, eg, og, stair } = withStair();
  const need = stairHeadroom(project, eg, stair).needsOpening;
  addVoid(og, need.x, need.y, need);
  touch(og);
  const after = stairHeadroom(project, eg, stair);
  assert.equal(after.ok, true);
  assert.ok(after.worst.headroom >= 2000, `${after.worst.headroom} mm`);
});

test('the opening it asks for is square to the flight', () => {
  const { project, eg, stair } = withStair();
  stair.rotation = 30;
  touch(eg);
  const need = stairHeadroom(project, eg, stair).needsOpening;
  assert.equal(need.rotation, 30);
  assert.ok(need.w > 0 && need.h > 0);
  // Wide enough for the flight, and no wider than it needs to be.
  assert.ok(need.h >= stair.width && need.h < stair.width + 400, `${need.h} for a ${stair.width} flight`);
});

test('an opening somewhere else does not help', () => {
  const { project, eg, og, stair } = withStair();
  addVoid(og, 4500, 5500, { w: 1000, h: 1000 });
  touch(og);
  assert.equal(stairHeadroom(project, eg, stair).ok, false);
});

test('a flight in a tall storey clears its own headroom', () => {
  const { project, eg, stair } = withStair();
  // Only four steps up into a very tall room: nothing to hit.
  stair.steps = 4;
  stair.rise = 600;
  eg.height = 3000;
  touch(eg);
  const head = stairHeadroom(project, eg, stair);
  assert.equal(head.ok, true);
  assert.equal(head.needsOpening, null);
});

test('which storey is above and below is where you would expect', () => {
  const { project, eg, og } = withStair();
  assert.equal(storeyAbove(project, eg)?.id, og.id);
  assert.equal(storeyAbove(project, og), null);
  assert.equal(storeyBelow(project, og)?.id, eg.id);
  assert.equal(storeyBelow(project, eg), null);
});

// ---- existing, to come out, going in ------------------------------------

function renovation() {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 5000, { type: 'exterior', thickness: 300 });
  addWall(plan, 4000, 0, 4000, 5000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  for (const wall of plan.walls) if (wall.thickness === 175) wall.status = 'remove';
  touch(plan);
  return plan;
}

test('an unmarked wall is simply there already', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  assert.equal(wallStatus(wall), 'existing');
  assert.equal(wallInPhase(wall, 'built'), true);
  assert.equal(wallInPhase(wall, 'planned'), true);
  assert.equal(wallInPhase(wall, 'all'), true);
});

test('what shows depends on the phase', () => {
  const going = { status: 'remove' };
  const coming = { status: 'new' };
  assert.equal(wallInPhase(going, 'built'), true, 'still standing today');
  assert.equal(wallInPhase(going, 'planned'), false, 'gone when the work is done');
  assert.equal(wallInPhase(coming, 'built'), false, 'not built yet');
  assert.equal(wallInPhase(coming, 'planned'), true);
  for (const wall of [going, coming]) assert.equal(wallInPhase(wall, 'all'), true);
});

test('knocking a wall through turns two rooms into one', () => {
  const plan = renovation();
  plan.phase = 'built';
  touch(plan);
  const before = derived(plan).rooms;
  assert.equal(before.length, 2);

  plan.phase = 'planned';
  touch(plan);
  const after = derived(plan).rooms;
  assert.equal(after.length, 1, 'the partition is gone, so the space is one room');
  // And nothing is lost: the one room is the two plus the wall that stood between.
  const sum = before.reduce((total, room) => total + room.areaMm2, 0);
  assert.ok(after[0].areaMm2 > sum, `${m2(after[0].areaMm2)} against ${m2(sum)}`);
});

test('a wall going in only appears once the work is done', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 5000, { type: 'exterior', thickness: 300 });
  const fresh = addWall(plan, 4000, 0, 4000, 5000, { type: 'partition', thickness: 115 });
  fresh.status = 'new';
  healJunctions(plan);
  touch(plan);

  plan.phase = 'built';
  touch(plan);
  assert.equal(derived(plan).rooms.length, 1, 'today it is one room');
  plan.phase = 'planned';
  touch(plan);
  assert.equal(derived(plan).rooms.length, 2, 'and two once it is built');
});

test('the phase falls back to showing everything', () => {
  const plan = renovation();
  assert.equal(phaseOf(plan), 'all');
  plan.phase = 'nonsense';
  assert.equal(phaseOf(plan), 'all');
  assert.equal(phaseWalls(plan).length, plan.walls.length);
});

test('the work is counted so it can be reported', () => {
  const plan = renovation();
  const counts = statusCounts(plan);
  assert.equal(counts.remove, 1);
  assert.equal(counts.new, 0);
  assert.equal(counts.existing + counts.remove + counts.new, plan.walls.length);
});
