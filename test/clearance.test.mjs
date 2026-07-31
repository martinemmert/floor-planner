import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearanceIssues,
  doorSwingZone,
  openingGuides,
  frontClearance,
  furnitureFootprint,
  overlapDepth,
  pieceGuides,
  snapPlacement,
  wallGuides,
} from '../src/app/clearance.js';
import { FURNITURE, furnitureById } from '../src/app/furniture.js';
import { addOpening, addRoomRect, addWall, createPlan, findNode, openingGeometry, touch } from '../src/app/model.js';
import { buildMesh } from '../src/app/mesh.js';
import { createProject } from '../src/app/model.js';

/** A 4 × 3 m room, and the wall you asked for. */
function room() {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const on = (test) =>
    plan.walls.find((w) => {
      const a = findNode(plan, w.a);
      const b = findNode(plan, w.b);
      return test(a, b);
    });
  return {
    plan,
    bottom: on((a, b) => Math.abs(a.y - 3000) < 1 && Math.abs(b.y - 3000) < 1),
    left: on((a, b) => Math.abs(a.x) < 1 && Math.abs(b.x) < 1),
  };
}

function put(plan, kind, x, y, rotation = 0) {
  const spec = furnitureById(kind);
  const item = { id: `f${plan.furniture.length}`, kind, x, y, w: spec.w, h: spec.h, z: spec.z, rotation };
  plan.furniture.push(item);
  touch(plan);
  return item;
}

// ---- the shapes ---------------------------------------------------------

test('a footprint turns with the piece', () => {
  const flat = furnitureFootprint({ x: 0, y: 0, w: 1800, h: 600, rotation: 0 });
  const xs = flat.map((p) => p.x);
  const ys = flat.map((p) => p.y);
  assert.equal(Math.max(...xs) - Math.min(...xs), 1800);
  assert.equal(Math.max(...ys) - Math.min(...ys), 600);
  const turned = furnitureFootprint({ x: 0, y: 0, w: 1800, h: 600, rotation: 90 });
  assert.equal(Math.round(Math.max(...turned.map((p) => p.x)) - Math.min(...turned.map((p) => p.x))), 600);
});

test('separating axes finds an overlap and its depth', () => {
  const a = furnitureFootprint({ x: 0, y: 0, w: 1000, h: 1000 });
  const apart = furnitureFootprint({ x: 2000, y: 0, w: 1000, h: 1000 });
  const touching = furnitureFootprint({ x: 1000, y: 0, w: 1000, h: 1000 });
  const over = furnitureFootprint({ x: 700, y: 0, w: 1000, h: 1000 });
  assert.equal(overlapDepth(a, apart), 0, 'well clear');
  assert.equal(overlapDepth(a, touching), 0, 'edge to edge is not a clash');
  assert.equal(Math.round(overlapDepth(a, over)), 300);
});

test('a door sweeps a quarter circle out of its hinge', () => {
  const { plan, bottom } = room();
  const door = addOpening(plan, bottom.id, 1000, { kind: 'door', width: 900 });
  touch(plan);
  const swing = doorSwingZone(plan, door);
  assert.equal(swing.zones.length, 1);
  // `width` is the door itself, so the sweep is exactly the leaf.
  assert.equal(Math.round(swing.reach), 900, `reach ${swing.reach}`);
  // The far edge of the sweep is a whole clear width from the hinge.
  const hinge = swing.zones[0][0];
  const furthest = Math.max(...swing.zones[0].map((p) => Math.hypot(p.x - hinge.x, p.y - hinge.y)));
  assert.ok(Math.abs(furthest - swing.reach) < 1);
});

test('a double door sweeps twice, each leaf half as far', () => {
  const { plan, bottom } = room();
  const door = addOpening(plan, bottom.id, 900, { kind: 'door', width: 1510 });
  door.style = 'double';
  touch(plan);
  const swing = doorSwingZone(plan, door);
  assert.equal(swing.zones.length, 2);
  assert.ok(swing.reach < 1510 / 2 + 10, `each leaf reaches ${swing.reach}`);
});

test('what does not swing has no zone', () => {
  const { plan, bottom } = room();
  const fixed = addOpening(plan, bottom.id, 500, { kind: 'window', width: 1010 });
  fixed.style = 'fixed';
  const tilt = addOpening(plan, bottom.id, 1600, { kind: 'window', width: 1010 });
  tilt.style = 'tilt';
  const plain = addOpening(plan, bottom.id, 2800, { kind: 'opening', width: 1010 });
  const sliding = addOpening(plan, bottom.id, 4000, { kind: 'door', width: 900 });
  sliding.style = 'sliding';
  touch(plan);
  assert.equal(doorSwingZone(plan, fixed), null, 'a fixed light does not open');
  assert.equal(doorSwingZone(plan, tilt), null, 'a Kippflügel needs no floor, only height');
  assert.equal(doorSwingZone(plan, plain), null);
  assert.equal(doorSwingZone(plan, sliding), null, 'a sliding door needs no floor');
});

test('a turn window sweeps the room the way a door does', () => {
  const { plan, bottom } = room();
  const turn = addOpening(plan, bottom.id, 900, { kind: 'window', width: 1010 });
  turn.style = 'turn-tilt';
  touch(plan);
  const swing = doorSwingZone(plan, turn);
  assert.ok(swing, 'a Dreh-Kipp sash turns into the room');
  assert.equal(swing.sill, 900, 'and it starts at the sill, not the floor');
  assert.ok(swing.zones.length >= 1);
});

test('a window is only caught by what stands taller than its sill', () => {
  const { plan, bottom } = room();
  const window_ = addOpening(plan, bottom.id, 900, { kind: 'window', width: 1010 });
  window_.style = 'turn';
  window_.sill = 900;
  touch(plan);
  const geo = openingGeometry(plan, window_);
  const at = { x: geo.x1 + geo.dx * 500 + geo.nx * 400, y: geo.y1 + geo.dy * 500 + geo.ny * 400 };
  plan.furniture = [{ id: 'f1', kind: 'counter', x: at.x, y: at.y, w: 2400, h: 600, rotation: 0 }];
  const under = clearanceIssues(plan).filter((i) => i.kind === 'swing');
  assert.equal(under.length, 0, 'a 900 worktop is level with the sill, not in the way');

  plan.furniture[0].kind = 'wardrobe';
  const over = clearanceIssues(plan).filter((i) => i.kind === 'swing');
  assert.ok(over.length > 0, 'a 2 m wardrobe beside it is');
});

test('a fitting that a standard covers gets a zone in front of it', () => {
  const wc = frontClearance({ kind: 'toilet', x: 1000, y: 1000, w: 400, h: 680, rotation: 0 });
  assert.ok(wc, 'a WC has a clearance');
  assert.equal(wc.depth, 550);
  // It sits in front — the +y side, away from the wall its cistern is against.
  assert.ok(Math.min(...wc.zone.map((p) => p.y)) >= 1000 + 680 / 2 - 1);
  assert.equal(frontClearance({ kind: 'sofa', x: 0, y: 0, w: 2100, h: 900 }), null, 'a sofa has none');
});

// ---- the checks --------------------------------------------------------

test('a door that catches the furniture says so', () => {
  const { plan, bottom } = room();
  const door = addOpening(plan, bottom.id, 1000, { kind: 'door', width: 900 });
  touch(plan);
  const swing = doorSwingZone(plan, door);
  const centre = swing.zones[0][4]; // out in the middle of the sweep
  put(plan, 'wardrobe', centre.x, centre.y);
  const issues = clearanceIssues(plan);
  assert.ok(issues.length >= 1);
  assert.ok(
    issues.some((i) => /catches the wardrobe/.test(i.text)),
    issues.map((i) => i.text).join(' | ')
  );
  assert.equal(issues[0].level, 'bad');
  assert.ok(issues[0].at, 'and it says where');
});

test('the same wardrobe out of the way says nothing', () => {
  const { plan, bottom } = room();
  addOpening(plan, bottom.id, 1000, { kind: 'door', width: 900 });
  touch(plan);
  put(plan, 'wardrobe', 1200, 500);
  assert.deepEqual(clearanceIssues(plan), []);
});

test('a basin standing in front of the WC is called out, with the numbers', () => {
  const { plan } = room();
  put(plan, 'toilet', 600, 500);
  put(plan, 'basin', 600, 1100);
  const issues = clearanceIssues(plan);
  const clash = issues.find((i) => i.kind === 'clear');
  assert.ok(clash, issues.map((i) => i.text).join(' | '));
  assert.match(clash.text, /600 × 550 mm/, 'the standard is quoted');
  assert.match(clash.text, /washbasin/);
});

test('two doors swinging into each other are caught', () => {
  // A hallway a metre wide with a door facing a door: two 885 leaves each sweeping
  // 765 mm cannot both open. Note the two walls run in opposite directions, so the
  // offsets that put the doors opposite each other are not the same number.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 4000, 1100, { type: 'exterior', thickness: 300 });
  touch(plan);
  const wallOn = (test) =>
    plan.walls.find((w) => test(findNode(plan, w.a), findNode(plan, w.b)));
  const top = wallOn((a, b) => Math.abs(a.y) < 1 && Math.abs(b.y) < 1);
  const bottom = wallOn((a, b) => Math.abs(a.y - 1100) < 1 && Math.abs(b.y - 1100) < 1);
  const a = addOpening(plan, top.id, 1500, { kind: 'door', width: 885 });
  const b = addOpening(plan, bottom.id, 2500, { kind: 'door', width: 885 });
  touch(plan);

  // Prove they really are opposite each other before trusting the message.
  const za = doorSwingZone(plan, a).zones[0];
  const zb = doorSwingZone(plan, b).zones[0];
  const deep = overlapDepth(za, zb, 40);
  assert.ok(deep > 100, `the two sweeps only overlap by ${Math.round(deep)} mm`);

  const issues = clearanceIssues(plan);
  assert.ok(
    issues.some((i) => /run into each other/.test(i.text)),
    issues.map((i) => i.text).join(' | ')
  );
});

test('the same two doors along the hallway are fine', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 6000, 1100, { type: 'exterior', thickness: 300 });
  touch(plan);
  const wallOn = (test) => plan.walls.find((w) => test(findNode(plan, w.a), findNode(plan, w.b)));
  const top = wallOn((a, b) => Math.abs(a.y) < 1 && Math.abs(b.y) < 1);
  const bottom = wallOn((a, b) => Math.abs(a.y - 1100) < 1 && Math.abs(b.y - 1100) < 1);
  addOpening(plan, top.id, 1200, { kind: 'door', width: 885 });
  addOpening(plan, bottom.id, 1200, { kind: 'door', width: 885 }); // the far end of the hall
  touch(plan);
  assert.deepEqual(clearanceIssues(plan), [], 'doors well apart do not clash');
});

test('furniture on top of other furniture is caught', () => {
  const { plan } = room();
  put(plan, 'dining-table', 2000, 1500);
  put(plan, 'sofa', 2200, 1500);
  const issues = clearanceIssues(plan);
  assert.ok(
    issues.some((i) => i.kind === 'overlap'),
    issues.map((i) => i.text).join(' | ')
  );
});

test('the worst is listed first', () => {
  const { plan, bottom } = room();
  const door = addOpening(plan, bottom.id, 1000, { kind: 'door', width: 900 });
  touch(plan);
  const swing = doorSwingZone(plan, door);
  put(plan, 'wardrobe', swing.zones[0][4].x, swing.zones[0][4].y);
  put(plan, 'chair', 1000, 700);
  put(plan, 'coffee-table', 1100, 700);
  const issues = clearanceIssues(plan);
  assert.ok(issues.length >= 2);
  const levels = issues.map((i) => i.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => (a === 'bad' ? -1 : b === 'bad' ? 1 : 0)));
});

test('an empty drawing has nothing to report', () => {
  assert.deepEqual(clearanceIssues(createPlan()), []);
});

// ---- what the catalogue has to carry -----------------------------------

test('every piece of furniture has a height it could stand at', () => {
  for (const item of FURNITURE) {
    assert.ok(item.z > 0 && item.z < 2600, `${item.id} stands ${item.z} mm tall`);
    assert.ok(item.w > 0 && item.h > 0);
  }
  // The ones a standard covers carry their clearance with them.
  for (const id of ['toilet', 'basin', 'shower', 'bath']) {
    const spec = furnitureById(id);
    assert.ok(spec.clear?.depth > 0, `${id} has no clearance`);
  }
});

test('furniture stands up in the 3D model at its own height', () => {
  const project = createProject();
  const plan = project.plans[0];
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const bare = buildMesh(project, {}).count;
  put(plan, 'wardrobe', 1500, 800);
  const withIt = buildMesh(project, {});
  assert.ok(withIt.count > bare, 'it is in the model');
  // Its top is at the height the catalogue gives it.
  const wardrobe = furnitureById('wardrobe');
  const top = Math.max(...[...withIt.positions].filter((_, i) => i % 3 === 2));
  assert.ok(top >= wardrobe.z - 1, `the tallest thing is ${Math.round(top)}, the wardrobe is ${wardrobe.z}`);
  // And it can be turned off.
  assert.equal(buildMesh(project, { furniture: false }).count, bare);
});

// ---- radiators ----------------------------------------------------------

test('a radiator is described the way one is sold', async () => {
  const { RADIATOR_TYPES, isRadiator, radiatorSpec } = await import('../src/app/fixtures.js');
  assert.equal(isRadiator('radiator'), true);
  assert.equal(isRadiator('socket'), false);

  // A metre of type 22 at 600 high is about 1,3 kW, which is what a merchant quotes.
  const t22 = radiatorSpec({ kind: 'radiator', radType: '22', size: 1000, panelHeight: 600 });
  assert.equal(t22.watts, 1300);
  assert.equal(t22.depth, 100);

  // More panels, more heat and more depth, in that order.
  const byOutput = RADIATOR_TYPES.filter((t) => t.id !== 'tube').map(
    (t) => radiatorSpec({ kind: 'radiator', radType: t.id, size: 1000, panelHeight: 600 }).watts
  );
  assert.deepEqual(byOutput, [...byOutput].sort((a, b) => a - b), 'a fatter type puts out more');
});

test('a longer or taller radiator puts out more', async () => {
  const { radiatorSpec } = await import('../src/app/fixtures.js');
  const base = { kind: 'radiator', radType: '22', size: 1000, panelHeight: 600 };
  assert.equal(radiatorSpec({ ...base, size: 2000 }).watts, radiatorSpec(base).watts * 2);
  assert.equal(radiatorSpec({ ...base, panelHeight: 300 }).watts, radiatorSpec(base).watts / 2);
  // An unset type falls back to the common one rather than to nothing.
  assert.equal(radiatorSpec({ kind: 'radiator', size: 1000, panelHeight: 600 }).watts, 1300);
});

test('a radiator stands on the wall in 3D at its own size', async () => {
  const { addFixture, addRoomRect: rect, createPlan: plan_, createProject: proj, touch: t } = await import(
    '../src/app/model.js'
  );
  const project = proj();
  const plan = project.plans[0];
  rect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  t(plan);
  const bare = buildMesh(project, {}).count;
  addFixture(plan, {
    kind: 'radiator',
    wallId: plan.walls[0].id,
    offset: 1500,
    side: 1,
    height: 600,
    size: 1400,
    radType: '33',
    panelHeight: 600,
  });
  t(plan);
  const withIt = buildMesh(project, {});
  assert.ok(withIt.count > bare, 'it is in the model');
  // A box is six faces, twelve triangles, thirty-six vertices — and `count` counts
  // vertices, which is what the draw call takes.
  assert.equal(withIt.count - bare, 36, 'one box and no more');
});

// ---- putting furniture where it goes ------------------------------------

/** A wall running east–west, 300 thick, centred on y = 0: faces at ±150. */
const eastWest = (from = 0, to = 6000) => ({ ends: { a: { x: from, y: 0 }, b: { x: to, y: 0 } }, thickness: 300 });

test('a piece dropped near a wall goes against it', () => {
  const guides = wallGuides([eastWest()]);
  const wardrobe = { w: 1800, h: 600, rotation: 0 };

  // Dropped with 80 mm of daylight behind it, it closes up: the back edge lands on
  // the face at 150, so the centre sits at 150 + 300 = 450.
  const near = snapPlacement(wardrobe, 2000, 530, guides);
  assert.equal(near.snapped, true);
  assert.equal(Math.round(near.y), 450);
  assert.equal(Math.round(near.x), 2000, 'and it does not slide along the wall');

  // Dropped overlapping the wall, it is pushed back out to the same place.
  assert.equal(Math.round(snapPlacement(wardrobe, 2000, 380, guides).y), 450);

  // Dropped in the middle of the room it is left alone.
  const free = snapPlacement(wardrobe, 2000, 3000, guides);
  assert.equal(free.snapped, false);
  assert.equal(free.y, 3000);
});

test('a piece past the end of a wall is not pulled sideways onto it', () => {
  // Without this a wardrobe at the far end of the house lines itself up with a wall
  // it is nowhere near, because the wall's plane runs on for ever.
  const guides = wallGuides([eastWest(0, 2000)]);
  const piece = { w: 600, h: 600, rotation: 0 };
  assert.equal(snapPlacement(piece, 9000, 460, guides).snapped, false);
  assert.equal(snapPlacement(piece, 1000, 460, guides).snapped, true);
});

test('a wall on the skew claims a piece turned to match it', () => {
  // The piece is measured along the wall's own normal, so neither has to be square
  // to the drawing for the two to meet.
  const guides = wallGuides([{ ends: { a: { x: 0, y: 0 }, b: { x: 4000, y: 4000 } }, thickness: 200 }]);
  const piece = { w: 1000, h: 500, rotation: 45 };
  const placed = snapPlacement(piece, 1200, 1000, guides);
  assert.equal(placed.snapped, true);
  // One of its edges ends up on a face of the wall, 100 off the centre line.
  const poly = furnitureFootprint({ ...piece, x: placed.x, y: placed.y });
  const across = poly.map((p) => (-p.x + p.y) / Math.SQRT2);
  const onAFace = Math.abs(Math.max(...across) - 100) < 2 || Math.abs(Math.min(...across) + 100) < 2;
  assert.ok(onAFace, `edges at ${Math.min(...across).toFixed(1)}..${Math.max(...across).toFixed(1)}`);
});

test('a piece goes into a corner, not just against one wall of it', () => {
  // One snap only ever gets a piece flat against something. A corner needs the second
  // pass, and the second pass has to look across the first or the piece just slides
  // along the wall it already found.
  const guides = wallGuides([
    eastWest(),
    { ends: { a: { x: 0, y: 0 }, b: { x: 0, y: 5000 } }, thickness: 300 }, // north–south
  ]);
  const wardrobe = { w: 1000, h: 600, rotation: 0 };
  const placed = snapPlacement(wardrobe, 720, 530, guides);
  assert.equal(Math.round(placed.y), 450, 'back against the east–west wall');
  assert.equal(Math.round(placed.x), 650, 'and side against the north–south one');
  assert.equal(placed.on.length, 1, 'both were walls, so it says so once');
});

test('a piece stands flush beside another, and lines up on its centre', () => {
  const bed = { id: 'bed', x: 2000, y: 2000, w: 1600, h: 2000, rotation: 0 };
  const guides = pieceGuides([bed]);
  const table = { id: 't', w: 450, h: 400, rotation: 0 };

  // Dropped just off the side of the bed, it comes up against it: the bed's right
  // edge is at 2800, so a 450-wide table beside it centres on 3025.
  const beside = snapPlacement(table, 3060, 1200, guides);
  assert.equal(Math.round(beside.x), 3025, `came to ${Math.round(beside.x)}`);

  // And dropped near the bed's centre line it takes it, which is how two things get
  // lined up rather than merely put near each other.
  const lined = snapPlacement(table, 4000, 2040, guides);
  assert.equal(Math.round(lined.y), 2000);
});


// ---- lying along the wall ----------------------------------------------

/** The walls of a room, in the shape `wallGuides` wants them. */
function guidesFor(plan) {
  return wallGuides(
    plan.walls.map((w) => ({ ends: { a: findNode(plan, w.a), b: findNode(plan, w.b) }, thickness: w.thickness }))
  );
}

test('a piece brought against a wall lies along it, however the wall runs', () => {
  // Square to the page and on the diagonal: the same gesture, the same result.
  for (const turn of [0, 15, 33, 45, 90]) {
    const rad = (turn * Math.PI) / 180;
    const at = (x, y) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];
    const plan = createPlan();
    const ring = [at(0, 0), at(5000, 0), at(5000, 4000), at(0, 4000)];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % 4];
      addWall(plan, ax, ay, bx, by, { type: 'exterior', thickness: 300 });
    }
    touch(plan);

    // A square piece, so the drop is the same distance from the wall whichever of its
    // sides ends up facing it — the test is about the angle, not about the reach.
    const item = { id: 'f1', kind: 'nightstand', w: 600, h: 600, rotation: 0 };
    const [dx, dy] = at(2500, 400);
    const placed = snapPlacement(item, dx, dy, guidesFor(plan));

    // Parallel to that wall — a quarter turn of its direction, not some angle between.
    const off = Math.abs((((placed.rotation - turn) % 90) + 90) % 90);
    assert.ok(
      off < 0.05 || Math.abs(off - 90) < 0.05,
      `wall at ${turn}°: the piece came to rest at ${placed.rotation}°, which is not square to it`
    );
    assert.ok(placed.snapped, `wall at ${turn}°: nothing claimed it`);
    assert.ok(placed.on.includes('a wall'));
  }
});

test('lining up never spins a piece further than a quarter turn', () => {
  // It squares the piece to the wall; it does not decide which way round you wanted it.
  // Turning it to face the wall outright would undo that choice every time it came near.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const guides = guidesFor(plan);
  for (const start of [0, 80, 100, 170, 265, 350]) {
    const placed = snapPlacement({ id: 'f1', kind: 'wardrobe', w: 1800, h: 600, rotation: start }, 2500, 400, guides);
    const moved = Math.abs((((placed.rotation - start + 180) % 360) + 360) % 360 - 180);
    assert.ok(moved <= 45.01, `from ${start}° it swung ${moved.toFixed(1)}°`);
  }
});

test('a piece nowhere near a wall is left lying as it was', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 8000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const placed = snapPlacement({ id: 'f1', kind: 'chair', w: 450, h: 480, rotation: 37 }, 4000, 4000, guidesFor(plan));
  assert.equal(placed.rotation, 37);
  assert.equal(placed.snapped, false);
});

test('a diagonal wall closes the wedge, not just the gap', () => {
  // The point of turning: brought up square to the page against a wall that is not, a
  // piece touches at one corner and stands off it everywhere else.
  const plan = createPlan();
  const rad = (20 * Math.PI) / 180;
  const at = (x, y) => [x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)];
  const ring = [at(0, 0), at(6000, 0), at(6000, 4000), at(0, 4000)];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % 4];
    addWall(plan, ax, ay, bx, by, { type: 'exterior', thickness: 300 });
  }
  touch(plan);
  const guides = guidesFor(plan);
  const item = { id: 'f1', kind: 'wardrobe', w: 1800, h: 600, rotation: 0 };
  const [dx, dy] = at(3000, 400);
  const placed = snapPlacement(item, dx, dy, guides);

  // Every corner of the piece is now the same distance from the wall's face, give or
  // take a millimetre — which is what "flat against it" means.
  const face = guides.find((g) => Math.abs(((g.along % 90) + 90) % 90 - 20) < 0.01);
  assert.ok(face, 'found the wall it was put against');
  const poly = furnitureFootprint({ ...item, ...placed });
  const across = poly.map((p) => Math.abs(p.x * face.nx + p.y * face.ny - face.at));
  const spread = Math.max(...across) - Math.min(...across);
  assert.ok(spread < 601, `the piece sits askew: its corners are ${Math.round(spread)} mm apart across the wall`);
});

test('a piece can be centred under a window without doing the arithmetic', () => {
  // Everybody puts the sofa under the window. There was nothing to catch it: the walls
  // and the other furniture were the only guides, so it meant reading two figures off
  // the chain and working it out.
  // A room with somewhere to stand back in: a 2,1 m sofa in a 4 m room is never more
  // than a hand's width from a side wall, and then the side wall fairly wins.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 9000, 5000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const bottom = plan.walls.find(
    (w) => Math.abs(findNode(plan, w.a).y - 5000) < 1 && Math.abs(findNode(plan, w.b).y - 5000) < 1
  );
  const window_ = addOpening(plan, bottom.id, 4000, { kind: 'window', width: 1385, sill: 900 });
  touch(plan);
  const geo = openingGeometry(plan, window_);

  const guides = [...guidesFor(plan), ...openingGuides(plan)];
  const sofa = { id: 'f1', kind: 'sofa', w: 2100, h: 900, rotation: 0 };
  // Dropped near the window but off to one side of it.
  const off = 260;
  const placed = snapPlacement(sofa, geo.centre.x + off, geo.centre.y - 700, guides);

  // It comes to rest on the window's own centre line, measured along the wall.
  const along = (p) => (p.x - geo.x1) * geo.dx + (p.y - geo.y1) * geo.dy;
  const middle = along(geo.centre);
  assert.ok(
    Math.abs(along(placed) - middle) < 2,
    `${Math.round(Math.abs(along(placed) - middle))} mm off the middle of the window`
  );
  assert.ok(placed.on.includes('a window'), `claimed by ${placed.on.join(', ') || 'nothing'}`);
});

test('a window claims the middle, never an edge', () => {
  // Flush with the edge of a window is not a thing anybody wants, and the reveals are
  // already covered by the wall's own faces.
  const { plan, bottom } = room();
  addOpening(plan, bottom.id, 1600, { kind: 'window', width: 1385, sill: 900 });
  touch(plan);
  const guides = openingGuides(plan);
  assert.equal(guides.length, 1, 'one guide per opening');
  assert.equal(guides[0].edges, 'centre');
});

test('a piece nowhere near a window is not dragged to one', () => {
  const { plan, bottom } = room();
  const win = addOpening(plan, bottom.id, 500, { kind: 'window', width: 1010, sill: 900 });
  touch(plan);
  const guides = openingGuides(plan);
  const geo = openingGeometry(plan, win);

  // Well along the wall from it — beside the window, but plainly not aimed at it.
  const far = snapPlacement({ id: 'f1', kind: 'chair', w: 450, h: 480, rotation: 0 }, geo.centre.x - 2200, 1500, guides);
  assert.equal(far.snapped, false, `claimed by ${far.on.join(', ')}`);
  assert.equal(Math.round(far.x), Math.round(geo.centre.x - 2200));

  // Deep into the room is not aimed at it either: the guide reaches about a metre out,
  // which is as far as a piece could sensibly be said to sit under a window.
  const deep = snapPlacement({ id: 'f1', kind: 'chair', w: 450, h: 480, rotation: 0 }, geo.centre.x + 120, 300, guides);
  assert.equal(deep.snapped, false, `a chair across the room was claimed by ${deep.on.join(', ')}`);
});
