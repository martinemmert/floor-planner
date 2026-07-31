import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WOFLV_FULL,
  addWall,
  healJunctions,
  WOFLV_HALF,
  addRoomRect,
  ceilingHeightAt,
  createPlan,
  derived,
  findNode,
  headroomLines,
  livingArea,
  roomHeadroomBands,
  roomLivingArea,
  roomMetaFor,
  totalArea,
  touch,
} from '../src/app/model.js';

/** A room with a Drempel on one or both of its long sides, like an attic. */
function attic({ depth = 4000, ceiling = 2750, front = null, back = null } = {}) {
  const plan = createPlan();
  plan.height = ceiling;
  addRoomRect(plan, 0, 0, 5000, depth, { type: 'exterior', thickness: 300 });
  touch(plan);
  const at = (id) => findNode(plan, id);
  for (const wall of plan.walls) {
    const a = at(wall.a);
    const b = at(wall.b);
    if (front && Math.abs(a.y) < 1 && Math.abs(b.y) < 1) Object.assign(wall, front);
    if (back && Math.abs(a.y - depth) < 1 && Math.abs(b.y - depth) < 1) Object.assign(wall, back);
  }
  touch(plan);
  return plan;
}

const m2 = (mm2) => Number((mm2 / 1e6).toFixed(2));

test('a room with no slope counts every square metre', () => {
  const plan = attic();
  const room = derived(plan).rooms[0];
  const bands = roomHeadroomBands(plan, room);
  assert.equal(bands.slopes.length, 0);
  assert.equal(bands.half, 0);
  assert.equal(bands.none, 0);
  assert.equal(m2(bands.full), m2(bands.total));
  assert.equal(m2(livingArea(plan)), m2(totalArea(plan)));
});

test('a knee wall without a pitch is not a slope', () => {
  // Just a low wall: nothing is said about what is above it.
  const plan = attic({ front: { height: 1250 } });
  const room = derived(plan).rooms[0];
  assert.equal(roomHeadroomBands(plan, room).slopes.length, 0);
  assert.equal(m2(livingArea(plan)), m2(totalArea(plan)));
});

test('the ceiling rises inward from the Drempel at the roof pitch', () => {
  // 1,25 m Drempel, 50°, 2,75 m ceiling — the numbers off the user's own DG.
  const plan = attic({ front: { height: 1250, pitch: 50 } });
  const room = derived(plan).rooms[0];
  const at = (y) => Math.round(ceilingHeightAt(plan, room, 2500, y));
  // The inner face is at y = 150, so that is where 1250 mm starts.
  assert.equal(at(150), 1250);
  // tan 50° ≈ 1.1918: 500 mm in gives about 596 mm of rise.
  assert.equal(at(650), 1250 + Math.round(500 * Math.tan((50 * Math.PI) / 180)));
  // And it never goes above the storey's own ceiling.
  assert.equal(at(3500), 2750);
});

test('WoFlV §4 splits the floor at two metres and at one', () => {
  const plan = attic({ front: { height: 1250, pitch: 50 } });
  const room = derived(plan).rooms[0];
  const bands = roomHeadroomBands(plan, room);
  assert.ok(bands.full > 0 && bands.half > 0);
  // A 1,25 m Drempel is already over a metre, so nothing drops out entirely.
  assert.equal(bands.none, 0);
  assert.ok(Math.abs(bands.full + bands.half + bands.none - bands.total) < 1, 'the bands account for the floor');
  // Living area is the full band plus half the middle one.
  assert.equal(m2(roomLivingArea(plan, room)), m2(bands.full + bands.half * 0.5));
  assert.ok(roomLivingArea(plan, room) < bands.total, 'and it is less than the footprint');
});

test('a low Drempel loses floor area altogether', () => {
  const plan = attic({ depth: 6000, front: { height: 500, pitch: 50 }, back: { height: 500, pitch: 30 } });
  const room = derived(plan).rooms[0];
  const bands = roomHeadroomBands(plan, room);
  assert.equal(bands.slopes.length, 2, 'a slope from each side');
  assert.ok(bands.none > 0, 'the strips under a metre count for nothing');
  assert.ok(Math.abs(bands.full + bands.half + bands.none - bands.total) < 1);
  // Under a saddle roof off a half-metre Drempel the loss is severe.
  assert.ok(roomLivingArea(plan, room) < bands.total * 0.7, `${m2(roomLivingArea(plan, room))} of ${m2(bands.total)}`);
});

test('the shallower pitch loses more of the room', () => {
  const steep = attic({ front: { height: 500, pitch: 50 } });
  const shallow = attic({ front: { height: 500, pitch: 30 } });
  const bandsOf = (plan) => roomHeadroomBands(plan, derived(plan).rooms[0]);
  assert.ok(bandsOf(shallow).full < bandsOf(steep).full, 'a shallow roof keeps less full-height floor');
  assert.ok(bandsOf(shallow).none > bandsOf(steep).none);
});

test('the one and two metre lines land where the ceiling reaches them', () => {
  const plan = attic({ front: { height: 500, pitch: 45 } });
  const room = derived(plan).rooms[0];
  // At 45° the rise equals the run, so from the inner face at y = 150:
  const two = headroomLines(plan, room, WOFLV_FULL);
  const one = headroomLines(plan, room, WOFLV_HALF);
  assert.equal(two.length, 1);
  assert.equal(one.length, 1);
  assert.equal(Math.round(two[0].y1), 150 + 1500);
  assert.equal(Math.round(one[0].y1), 150 + 500);
  // Each line runs right across the room.
  assert.ok(Math.abs(two[0].x2 - two[0].x1) > 4000);
});

test('a line the ceiling never reaches is not drawn', () => {
  // The Drempel is already over two metres, so there is no two metre line.
  const plan = attic({ front: { height: 2200, pitch: 45 } });
  const room = derived(plan).rooms[0];
  assert.equal(headroomLines(plan, room, WOFLV_FULL).length, 0);
  assert.equal(headroomLines(plan, room, WOFLV_HALF).length, 0);
  assert.equal(roomHeadroomBands(plan, room).half, 0);
});

test('the room usage still applies on top of the bands', () => {
  const plan = attic({ front: { height: 500, pitch: 45 } });
  const room = derived(plan).rooms[0];
  const bands = roomHeadroomBands(plan, room);
  const full = roomLivingArea(plan, room);
  // Make it a balcony: a quarter of what the headroom bands allow.
  const meta = roomMetaFor(plan, room);
  meta.usage = 'balcony';
  touch(plan);
  assert.equal(m2(roomLivingArea(plan, room)), m2((bands.full + bands.half * 0.5) * 0.25));
  assert.ok(roomLivingArea(plan, room) < full);
});

test('a slope only counts for the rooms it is actually over', () => {
  // Two rooms side by side; the Drempel bounds only the left one.
  const plan = createPlan();
  plan.height = 2750;
  addRoomRect(plan, 0, 0, 8000, 4000, { type: 'exterior', thickness: 300 });
  touch(plan);
  addWall(plan, 4000, 0, 4000, 4000, { type: 'partition', thickness: 115 });
  healJunctions(plan);
  touch(plan);
  // Give the left half of the front wall a Drempel with a pitch.
  const at = (id) => findNode(plan, id);
  for (const wall of plan.walls) {
    const a = at(wall.a);
    const b = at(wall.b);
    if (Math.abs(a.y) < 1 && Math.abs(b.y) < 1 && Math.max(a.x, b.x) <= 4001) {
      wall.height = 1250;
      wall.pitch = 50;
    }
  }
  touch(plan);
  const rooms = derived(plan).rooms;
  const withSlope = rooms.filter((room) => roomHeadroomBands(plan, room).slopes.length);
  assert.equal(withSlope.length, 1, 'only the room the wall bounds');
});

test('what a room is used for survives the next edit', () => {
  // The metadata is rebuilt every time the rooms are worked out again, and it used to
  // be rebuilt from a fixed list of fields. Everything not on that list was dropped —
  // so a balcony set to count half went back to counting in full the moment a wall
  // moved, and the Wohnfläche silently changed with it.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const meta = roomMetaFor(plan, derived(plan).rooms[0]);
  meta.usage = 'balcony';
  meta.areaFactor = 0.5;
  meta.floor = 'tile';
  touch(plan);

  const after = roomMetaFor(plan, derived(plan).rooms[0]);
  assert.equal(after.usage, 'balcony');
  assert.equal(after.areaFactor, 0.5);
  assert.equal(after.floor, 'tile', 'and anything else put on it');
});
