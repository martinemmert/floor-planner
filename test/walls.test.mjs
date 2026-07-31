import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addFixture,
  addRoomRect,
  addWall,
  createPlan,
  derived,
  findWall,
  fixturePlacement,
  fixtureToWorld,
  isKneeWall,
  kneeWalls,
  touch,
  wallCorners,
  wallHeight,
  wallLength,
  wallLengths,
} from '../src/app/model.js';
import { defaultFixture, fixtureSymbol, isWallMounted } from '../src/app/fixtures.js';

function room(width = 6000, depth = 4000, thickness = 300, style = 'mitre') {
  const plan = createPlan({ joinStyle: style });
  addRoomRect(plan, 0, 0, width, depth, { type: 'exterior', thickness });
  touch(plan);
  return plan;
}

// ---- joints -------------------------------------------------------------

test('a mitred square corner puts the faces exactly on the corner', () => {
  const plan = room(6000, 4000, 300, 'mitre');
  const at = (id) => plan.nodes.find((n) => n.id === id);
  const top = plan.walls.find((w) => Math.abs(at(w.a).y) < 1 && Math.abs(at(w.b).y) < 1);
  const corners = wallCorners(plan, top);
  const xs = corners.map((p) => Math.round(p.x));
  const ys = corners.map((p) => Math.round(p.y));
  // outer face runs the full outside of the building, inner face is inset both ends
  assert.deepEqual([...new Set(ys)].sort((a, b) => a - b), [-150, 150]);
  assert.equal(Math.min(...xs), -150, 'outer face reaches the outside corner');
  assert.equal(Math.max(...xs), 6150);
  const inner = corners.filter((p) => Math.round(p.y) === 150).map((p) => Math.round(p.x));
  assert.deepEqual(inner.sort((a, b) => a - b), [150, 5850], 'inner face stops at the return walls');
});

test('a mitre on a sharp corner meets in a point, not a notch', () => {
  // Two walls meeting at 60 degrees: the outer faces must intersect exactly.
  const plan = createPlan({ joinStyle: 'mitre' });
  const a = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  const b = addWall(plan, 4000, 0, 6000, -3464, { thickness: 300 }); // 60° turn
  touch(plan);
  const ca = wallCorners(plan, a);
  const cb = wallCorners(plan, b);
  // The two walls share a corner point on each face: every corner of a must have a
  // partner in b within a millimetre.
  const shared = ca.filter((p) => cb.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1));
  assert.equal(shared.length, 2, `faces meet at ${shared.length} points, want 2`);
});

test('a butt joint stops both walls dead at the corner', () => {
  const plan = room(6000, 4000, 300, 'butt');
  for (const wall of plan.walls) {
    const corners = wallCorners(plan, wall);
    // no corner runs past the node it belongs to
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    assert.ok(Math.min(...xs) >= -150.5 && Math.max(...xs) <= 6150.5);
    assert.ok(Math.min(...ys) >= -150.5 && Math.max(...ys) <= 4150.5);
  }
  // and a butt corner leaves the outside faces short of each other
  const top = plan.walls[0];
  const c = wallCorners(plan, top);
  assert.ok(c.every((p) => Math.abs(p.x) > 1 || Math.abs(p.y) > 1));
});

test('the join style does not change the room area', () => {
  const areas = ['mitre', 'square', 'butt'].map((style) => {
    const plan = room(6000, 4000, 300, style);
    return Math.round(derived(plan).rooms[0].areaMm2);
  });
  assert.equal(new Set(areas).size, 1, `areas differ by style: ${areas.join(', ')}`);
});

test('a sharp spike is cut back rather than shooting off the drawing', () => {
  // 8 degrees between the walls would mitre out to about 7 times the thickness.
  const plan = createPlan({ joinStyle: 'mitre' });
  const a = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  addWall(plan, 4000, 0, 200, 560, { thickness: 300 });
  touch(plan);
  const corners = wallCorners(plan, a);
  for (const p of corners) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    // nothing further than the mitre limit beyond the wall's own end
    assert.ok(p.x < 4000 + 3.5 * 300 + 1, `corner ran to ${p.x}`);
  }
});

// ---- wall height and knee walls -----------------------------------------

test('a wall takes the storey height until it is given its own', () => {
  const plan = room(6000, 4000, 300);
  plan.height = 2600;
  const wall = plan.walls[0];
  assert.equal(wallHeight(plan, wall), 2600);
  assert.equal(isKneeWall(plan, wall), false);
  wall.height = 1100;
  assert.equal(wallHeight(plan, wall), 1100);
  assert.equal(isKneeWall(plan, wall), true);
  assert.equal(kneeWalls(plan).length, 1);
  wall.height = null;
  assert.equal(isKneeWall(plan, wall), false);
});

test('a wall as tall as the storey is not a knee wall', () => {
  const plan = room(6000, 4000, 300);
  plan.height = 2500;
  plan.walls[0].height = 2500;
  assert.equal(isKneeWall(plan, plan.walls[0]), false);
});

// ---- fixtures -----------------------------------------------------------

test('a wall-mounted fixture sits on the wall face and rides along with it', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  touch(plan);
  const fixture = addFixture(plan, { ...defaultFixture('socket'), wallId: wall.id, offset: 1000, side: 1 });
  const before = fixturePlacement(plan, fixture);
  // on the face, not the centreline
  assert.equal(Math.round(before.x), 1000);
  assert.equal(Math.round(Math.abs(before.y)), 150);

  // move the wall; the socket comes with it
  for (const node of plan.nodes) node.y += 2000;
  touch(plan);
  const after = fixturePlacement(plan, fixture);
  assert.equal(Math.round(after.x), 1000);
  assert.equal(Math.round(after.y - before.y), 2000);
});

test('flipping the side puts it on the other face', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  touch(plan);
  const one = fixturePlacement(plan, addFixture(plan, { ...defaultFixture('socket'), wallId: wall.id, offset: 1000, side: 1 }));
  const other = fixturePlacement(plan, addFixture(plan, { ...defaultFixture('socket'), wallId: wall.id, offset: 1000, side: -1 }));
  assert.equal(Math.round(one.y + other.y), 0, 'mirrored about the centreline');
  assert.equal(Math.round(Math.abs(one.y - other.y)), 300, 'one wall thickness apart');
});

test('the symbol points into the room, whichever face it is on', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  touch(plan);
  for (const side of [1, -1]) {
    const fixture = addFixture(plan, { ...defaultFixture('socket'), wallId: wall.id, offset: 2000, side });
    const placement = fixturePlacement(plan, fixture);
    const out = fixtureToWorld(placement, 0, 500); // 500 into the room
    const away = Math.abs(out.y) > Math.abs(placement.y);
    assert.ok(away, `side ${side}: symbol grows back into the wall`);
  }
});

test('every fixture draws something, with finite numbers', () => {
  for (const spec of [...new Set(['socket', 'socket2', 'switch', 'dimmer', 'light-ceiling', 'radiator', 'smoke', 'data', 'drain', 'board'])]) {
    const primitives = fixtureSymbol(defaultFixture(spec));
    assert.ok(primitives.length >= 1, `${spec} drew nothing`);
    for (const item of primitives) {
      const values =
        item.type === 'polygon'
          ? item.pts.flatMap((p) => [p.a, p.c])
          : item.type === 'circle' || item.type === 'text'
            ? [item.a, item.c, item.r ?? item.size]
            : item.type === 'arc'
              ? [item.a, item.c, item.r, item.from, item.to]
              : [item.a1, item.c1, item.a2, item.c2];
      for (const v of values) assert.ok(Number.isFinite(v), `${spec} ${item.type}: ${v}`);
    }
  }
});

test('what goes on a wall and what does not is stated per fixture', () => {
  assert.equal(isWallMounted('socket'), true);
  assert.equal(isWallMounted('switch'), true);
  assert.equal(isWallMounted('light-ceiling'), false);
  assert.equal(isWallMounted('smoke'), false);
  // sockets sit low, switches at handle height, ceiling lights at the ceiling
  assert.ok(defaultFixture('socket').height < defaultFixture('switch').height);
  assert.ok(defaultFixture('light-ceiling').height > 2000);
});

// ---- the mitre limit ----------------------------------------------------

/** Signed area: negative or tiny means the wall has been drawn inside out. */
function polyArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum / 2);
}

test('a wall at a sharp corner is not drawn inside out', () => {
  // Six degrees between two 365 walls: the true mitre runs out over a metre and a
  // half, which used to fold the polygon over and put a spike on the drawing.
  const plan = createPlan({ joinStyle: 'mitre' });
  addWall(plan, 0, 0, 6000, 0, { thickness: 365 });
  addWall(plan, 6000, 0, 0, 630, { thickness: 365 });
  touch(plan);
  for (const wall of plan.walls) {
    const corners = wallCorners(plan, wall);
    assert.ok(corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    const area = polyArea(corners);
    const least = wallLength(plan, wall) * wall.thickness * 0.2;
    assert.ok(area > least, `area ${Math.round(area)} mm² is too small for the wall`);
  }
});

test('a joint never eats more than two fifths of its wall', () => {
  // A short partition wedged between two thick walls at shallow angles: the case
  // that read "clear inside 259 mm" on a 1,36 m wall.
  const plan = createPlan({ joinStyle: 'mitre' });
  const pts = [
    [2000, 0],
    [8000, 0],
    [8000, 4000],
    [3000, 6000],
    [0, 3000],
    [600, 1200],
  ];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    addWall(plan, a[0], a[1], b[0], b[1], { type: 'exterior', thickness: 365 });
  }
  touch(plan);
  // Thin the shortest wall, the way changing exterior to partition does.
  const shortest = plan.walls.reduce((best, w) => (wallLength(plan, w) < wallLength(plan, best) ? w : best));
  shortest.thickness = 115;
  touch(plan);

  for (const wall of plan.walls) {
    const lengths = wallLengths(plan, wall);
    assert.ok(lengths.inner >= lengths.centre * 0.2 - 1, `inner ${lengths.inner} of ${lengths.centre}`);
    assert.ok(lengths.outer <= lengths.centre * 1.8 + 1, `outer ${lengths.outer} of ${lengths.centre}`);
    assert.ok(polyArea(wallCorners(plan, wall)) > 0);
  }
});

test('an ordinary square corner is untouched by the limit', () => {
  // Half the other wall's thickness, exactly as the geometry says.
  const plan = createPlan({ joinStyle: 'mitre' });
  addRoomRect(plan, 0, 0, 8000, 5000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const wall = plan.walls[0];
  const lengths = wallLengths(plan, wall);
  assert.equal(Math.round(lengths.outer - lengths.centre), 300);
  assert.equal(Math.round(lengths.centre - lengths.inner), 300);
});

test('thinning a wall cannot break the walls beside it', () => {
  const plan = createPlan({ joinStyle: 'mitre' });
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 365 });
  addWall(plan, 6000, 0, 7200, 2600, { type: 'exterior', thickness: 365 });
  addWall(plan, 7200, 2600, 6000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const before = derived(plan).rooms.length;
  for (const wall of plan.walls) {
    wall.thickness = 115;
    wall.type = 'partition';
    touch(plan);
    for (const other of plan.walls) {
      const corners = wallCorners(plan, other);
      assert.ok(corners.every((p) => Number.isFinite(p.x)), `${other.id} went non-finite`);
      assert.ok(polyArea(corners) > 0, `${other.id} folded over`);
    }
  }
  assert.equal(derived(plan).rooms.length, before, 'the rooms survived');
});
