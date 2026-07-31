import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EYE, SHOULDERS, startingPoint, stepTo, walkBlockers } from '../src/app/walk.js';
import { addOpening, addRoomRect, createPlan, derived, findNode, touch } from '../src/app/model.js';

/** A room, and the wall on the side you ask for. */
function room({ width = 5000, depth = 4000, thickness = 300 } = {}) {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, width, depth, { type: 'exterior', thickness });
  touch(plan);
  const on = (test) =>
    plan.walls.find((w) => {
      const a = findNode(plan, w.a);
      const b = findNode(plan, w.b);
      return test(a, b);
    });
  return { plan, top: on((a, b) => Math.abs(a.y) < 1 && Math.abs(b.y) < 1) };
}

test('a wall stops you', () => {
  const { plan } = room();
  const blockers = walkBlockers(plan);
  // Straight at the top wall from the middle of the room.
  const at = stepTo(blockers, { x: 2500, y: 2000 }, { x: 2500, y: -500 });
  assert.ok(at.y > 0, `walked through the wall to y=${Math.round(at.y)}`);
  // Stopped at the face of it, not somewhere out in the middle of the room.
  assert.ok(at.y < 400, `stopped ${Math.round(at.y)} short of a wall whose face is at 150`);
});

test('a doorway does not', () => {
  const { plan, top } = room();
  addOpening(plan, top.id, 2500, { kind: 'door', width: 985 });
  touch(plan);
  const blockers = walkBlockers(plan);
  // Through the middle of the doorway, which is where the door was put.
  const at = stepTo(blockers, { x: 2500, y: 2000 }, { x: 2500, y: -600 });
  assert.ok(at.y < -400, `the doorway stopped me at y=${Math.round(at.y)}`);
});

test('a window is not a doorway', () => {
  // It is a hole in the wall you can see through, not one you can walk through — and
  // on an upper floor it is the thing between you and the garden.
  const { plan, top } = room();
  addOpening(plan, top.id, 2500, { kind: 'window', width: 1010, sill: 900 });
  touch(plan);
  const at = stepTo(walkBlockers(plan), { x: 2500, y: 2000 }, { x: 2500, y: -600 });
  assert.ok(at.y > 0, `walked out of the window to y=${Math.round(at.y)}`);
});

test('a wall you can see over is still a wall you cannot walk through', () => {
  // A knee wall is waist high. You can look across it in the model; you cannot step
  // through it.
  const { plan, top } = room();
  top.height = 1000;
  touch(plan);
  const at = stepTo(walkBlockers(plan), { x: 2500, y: 2000 }, { x: 2500, y: -600 });
  assert.ok(at.y > 0, 'a Drempel is not a doorway');
});

test('walking into a wall slides along it rather than sticking', () => {
  // Without this a corridor needs steering: brush a wall and you stop dead.
  const { plan } = room();
  const blockers = walkBlockers(plan);
  const from = { x: 2500, y: 400 };
  // Mostly along the wall, a little into it.
  const at = stepTo(blockers, from, { x: 3400, y: -200 });
  assert.ok(at.x > from.x + 500, `slid only to x=${Math.round(at.x)} from ${from.x}`);
  assert.ok(at.y > 0, 'and still did not go through it');
});

test('a doorway is wide enough to get through without steering', () => {
  // The walker has shoulders. An 860 door with a lining is about 800 clear, and the
  // walker is 440 across — it has to fit with room to spare or every doorway is a
  // wrestling match.
  const { plan, top } = room();
  addOpening(plan, top.id, 2500, { kind: 'door', width: 860 });
  touch(plan);
  const blockers = walkBlockers(plan);
  assert.ok(SHOULDERS * 2 < 800, 'the walker fits through a standard door');
  // Aimed a little off centre, as anyone would.
  for (const aim of [2400, 2500, 2620]) {
    const at = stepTo(blockers, { x: aim, y: 1200 }, { x: aim, y: -600 });
    assert.ok(at.y < -300, `aiming at x=${aim} left me at y=${Math.round(at.y)}`);
  }
});

test('the walls of one wall do not trap you in the corner', () => {
  const { plan } = room();
  const blockers = walkBlockers(plan);
  // Hard into the corner, then back out of it.
  const cornered = stepTo(blockers, { x: 600, y: 600 }, { x: -900, y: -900 });
  assert.ok(cornered.x > 0 && cornered.y > 0, 'stayed inside the room');
  const out = stepTo(blockers, cornered, { x: cornered.x + 900, y: cornered.y + 900 });
  assert.ok(out.x > cornered.x + 500, 'and can walk back out of it');
});

test('you start in the biggest room, not in a wall', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 3000, 2500, { type: 'exterior', thickness: 300 });
  addRoomRect(plan, 3000, 0, 7000, 6000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const rooms = derived(plan).rooms;
  const start = startingPoint(plan, rooms);
  const biggest = [...rooms].sort((a, b) => b.areaMm2 - a.areaMm2)[0];
  assert.equal(Math.round(start.x), Math.round(biggest.centroid.x));
  assert.equal(Math.round(start.y), Math.round(biggest.centroid.y));
  // And standing there is not standing in a wall.
  const at = stepTo(walkBlockers(plan), start, start);
  assert.equal(Math.round(at.x), Math.round(start.x));
  assert.equal(Math.round(at.y), Math.round(start.y));
});

test('an empty drawing still gives somewhere to stand', () => {
  const plan = createPlan();
  const start = startingPoint(plan, []);
  assert.ok(Number.isFinite(start.x) && Number.isFinite(start.y) && Number.isFinite(start.yaw));
  assert.deepEqual(walkBlockers(plan), []);
});

test('the eye is at a person’s height, not the camera’s', () => {
  assert.ok(EYE > 1400 && EYE < 1800, `${EYE} mm is not eye height`);
});
