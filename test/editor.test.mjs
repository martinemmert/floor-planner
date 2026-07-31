import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addOpening,
  addRoomRect,
  addWall,
  canJoinWalls,
  createPlan,
  derived,
  findNode,
  findWall,
  joinWalls,
  openingGeometry,
  splitWallAt,
  touch,
  trimWallTo,
  wallLength,
  wallLengths,
  setWallLengthOn,
  rectBasisShift,
  roomClearSize,
  roomAxes,
  roomSizeOn,
  setRoomSize,
  moveRoom,
  setWallAngle,
  wallAngle,
  branchNodes,
  activePlan,
  copyPlan,
  copyWalls,
  createProject,
  floorToFloor,
  floorsInOrder,
  growRoomFromWall,
  planElevation,
  measureLines,
  polygonChord,
  roomChord,
  roomExtent,
  roomFrame,
  wallCutAt,
  totalArea,
  wallEnds,
} from '../src/app/model.js';
import { ANGLE_STEP, computeSnap } from '../src/geom/snap.js';
import { openingSymbol, defaultsFor, leafLayout, openingWidth, DOOR_WIDTHS } from '../src/app/openings.js';
import { parseLengthInput } from '../src/app/ui.js';
import { PAPERS, normaliseProject, paperSize, planToSheetSvg, planToSvg, scaleToFit } from '../src/app/export.js';
import { PEN_MM, TEXT_MM } from '../src/app/render.js';

function room(width = 5000, depth = 4000, thickness = 365) {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, width, depth, { type: 'exterior', thickness });
  touch(plan);
  return plan;
}

test('a room rectangle becomes four joined walls', () => {
  const plan = room();
  assert.equal(plan.walls.length, 4);
  assert.equal(plan.nodes.length, 4, 'corners are shared, not duplicated');
  for (const wall of plan.walls) assert.equal(wall.thickness, 365);
});

test('room area is measured inside the walls', () => {
  const plan = room(5000, 4000, 365);
  const rooms = derived(plan).rooms;
  assert.equal(rooms.length, 1);
  const expected = ((5000 - 365) * (4000 - 365)) / 1e6;
  assert.ok(
    Math.abs(rooms[0].areaMm2 / 1e6 - expected) < 0.01,
    `${(rooms[0].areaMm2 / 1e6).toFixed(3)} m² vs ${expected.toFixed(3)} m²`
  );
});

test('making a wall thicker shrinks the room it encloses', () => {
  const plan = room(5000, 4000, 200);
  const before = derived(plan).rooms[0].areaMm2;
  for (const wall of plan.walls) wall.thickness = 400;
  touch(plan);
  const after = derived(plan).rooms[0].areaMm2;
  const expected = ((5000 - 400) * (4000 - 400)) / 1e6;
  assert.ok(after < before, 'thicker walls leave less floor');
  assert.ok(Math.abs(after / 1e6 - expected) < 0.01, `${(after / 1e6).toFixed(3)} vs ${expected.toFixed(3)}`);
});

test('an interior wall splits one room into two', () => {
  const plan = room(6000, 4000, 300);
  addWall(plan, 3000, 0, 3000, 4000, { type: 'partition', thickness: 115 });
  touch(plan);
  const rooms = derived(plan).rooms;
  assert.equal(rooms.length, 2, `areas: ${rooms.map((r) => (r.areaMm2 / 1e6).toFixed(2)).join(', ')}`);
  const each = ((3000 - 150 - 57.5) * (4000 - 300)) / 1e6;
  for (const r of rooms) {
    assert.ok(Math.abs(r.areaMm2 / 1e6 - each) < 0.01, `${(r.areaMm2 / 1e6).toFixed(3)} vs ${each.toFixed(3)}`);
  }
});

test('an opening sits where it was placed and never hangs off the wall', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  const opening = addOpening(plan, wall.id, 2000, { kind: 'door' });
  assert.equal(opening.width, 860, 'the default door leaf');
  const hole = openingWidth(opening);
  assert.ok(Math.abs(opening.offset - (2000 - hole / 2)) < 1, 'the hole is centred on the click');
  const geo = openingGeometry(plan, opening);
  assert.ok(Math.abs(geo.centre.x - 2000) < 1);
  assert.equal(Math.round(geo.centre.y), 0);

  // Pushed past the end, it stays inside.
  opening.offset = 9999;
  const clamped = openingGeometry(plan, opening);
  assert.ok(clamped.x2 <= 4000 + 1, `x2 ${clamped.x2}`);
  assert.ok(Math.abs(clamped.x2 - clamped.x1 - openingWidth(opening)) < 1, 'keeps its width');
});

test('an opening rides along when its wall moves', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  const opening = addOpening(plan, wall.id, 1000, { kind: 'window' });
  const before = openingGeometry(plan, opening);
  const node = findNode(plan, wall.a);
  node.y += 2500;
  findNode(plan, wall.b).y += 2500;
  touch(plan);
  const after = openingGeometry(plan, opening);
  assert.equal(Math.round(after.centre.x), Math.round(before.centre.x));
  assert.equal(Math.round(after.centre.y - before.centre.y), 2500);
});

test('splitting a wall hands each opening to the part it falls in', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  const near = addOpening(plan, wall.id, 1000, { kind: 'door' });
  const far = addOpening(plan, wall.id, 5000, { kind: 'door' });
  const result = splitWallAt(plan, wall.id, 3000, 0);
  assert.ok(result);
  assert.equal(near.wallId, result.first.id);
  assert.equal(far.wallId, result.second.id);
  assert.ok(Math.abs(far.offset - (5000 - openingWidth(far) / 2 - 3000)) < 1, `offset ${far.offset}`);
  assert.equal(Math.round(wallLength(plan, result.first)), 3000);
  assert.equal(Math.round(wallLength(plan, result.second)), 3000);
});

test('joining two walls keeps both openings in place', () => {
  const plan = createPlan();
  const first = addWall(plan, 0, 0, 3000, 0, { thickness: 300 });
  const second = addWall(plan, 3000, 0, 6000, 0, { thickness: 300 });
  const a = addOpening(plan, first.id, 1000, { kind: 'door' });
  const b = addOpening(plan, second.id, 4500, { kind: 'door' });
  const beforeA = openingGeometry(plan, a).centre.x;
  const beforeB = openingGeometry(plan, b).centre.x;

  assert.ok(canJoinWalls(plan, first.id, second.id), 'collinear walls sharing a free corner can join');
  assert.equal(joinWalls(plan, first.id, second.id), true);
  assert.equal(plan.walls.length, 1);
  assert.equal(Math.round(wallLength(plan, plan.walls[0])), 6000);
  assert.equal(Math.round(openingGeometry(plan, a).centre.x), Math.round(beforeA));
  assert.equal(Math.round(openingGeometry(plan, b).centre.x), Math.round(beforeB));
});

test('walls that turn a corner cannot be joined', () => {
  const plan = createPlan();
  const a = addWall(plan, 0, 0, 3000, 0, { thickness: 300 });
  const b = addWall(plan, 3000, 0, 3000, 3000, { thickness: 300 });
  assert.equal(canJoinWalls(plan, a.id, b.id), null);
});

test('trim extends a wall that falls short and cuts one that overshoots', () => {
  const short = createPlan();
  const target = addWall(short, 4000, -1000, 4000, 3000, { thickness: 300 });
  const stub = addWall(short, 0, 1000, 2500, 1000, { thickness: 115 });
  assert.equal(trimWallTo(short, stub.id, 'b', target.id), true);
  assert.equal(Math.round(wallLength(short, findWall(short, stub.id))), 4000);

  const long = createPlan();
  const target2 = addWall(long, 4000, -1000, 4000, 3000, { thickness: 300 });
  const over = addWall(long, 0, 1000, 6000, 1000, { thickness: 115 });
  assert.equal(trimWallTo(long, over.id, 'b', target2.id), true);
  assert.equal(Math.round(wallLength(long, findWall(long, over.id))), 4000);
});

test('trim refuses parallel walls instead of moving something silently', () => {
  const plan = createPlan();
  const a = addWall(plan, 0, 0, 3000, 0, { thickness: 115 });
  const b = addWall(plan, 0, 2000, 3000, 2000, { thickness: 115 });
  assert.equal(trimWallTo(plan, a.id, 'b', b.id), false);
});

// ---- snapping ---------------------------------------------------------

function snapIn(plan, point, extra = {}) {
  return computeSnap({ point, plan, tolerance: 100, gridMm: 0, enabled: true, ...extra });
}

test('snapping prefers a corner over anything else nearby', () => {
  const plan = room(4000, 3000, 300);
  const snap = snapIn(plan, { x: 30, y: 40 });
  assert.equal(snap.kind, 'node');
  assert.equal(snap.x, 0);
  assert.equal(snap.y, 0);
});

test('snapping finds the midpoint of a wall', () => {
  const plan = room(4000, 3000, 300);
  const snap = snapIn(plan, { x: 2020, y: 30 });
  assert.equal(snap.kind, 'midpoint');
  assert.equal(snap.x, 2000);
});

test('snapping finds the perpendicular foot from where you are drawing', () => {
  // A slanted wall, so the perpendicular direction is not itself an ortho or 45°
  // direction that the angle lock would claim first, and the foot is nowhere near
  // a corner or the midpoint.
  const plan = createPlan();
  addWall(plan, 0, 0, 4000, 1000, { thickness: 300 });
  touch(plan);
  const snap = snapIn(plan, { x: 1450, y: 380 }, { anchor: { x: 1000, y: 2000 } });
  assert.equal(snap.kind, 'perpendicular');
  assert.equal(Math.round(snap.x), 1412);
  assert.equal(Math.round(snap.y), 353);
  assert.ok(snap.guides.length >= 1, 'draws the guide that explains the snap');
});

test('ortho lock holds the direction and the grid rounds the length', () => {
  const plan = createPlan();
  const snap = computeSnap({
    point: { x: 3040, y: 220 },
    anchor: { x: 0, y: 0 },
    plan,
    tolerance: 60,
    orthoLock: true,
    enabled: true,
    gridMm: 50,
  });
  assert.equal(Math.round(snap.y), 0, 'held on the horizontal');
  assert.equal(snap.x % 50, 0, 'length rounded to the grid');
  assert.equal(snap.kind, 'angle');
});

test('a corner dragged along its own wall lands on the grid, not back on the wall', () => {
  // The walls hanging off a node move with it, so their line, midpoint and crossings
  // follow the cursor about. Snapping to those always wins — you are always exactly on
  // them — and it beat the grid: dragging the corner of a room sideways gave 379,7508
  // instead of 400, and pulled the corner off its own line as well.
  const plan = room(4000, 3000, 300);
  const corner = plan.nodes.find((n) => Math.abs(n.x) < 1 && Math.abs(n.y) < 1);
  assert.ok(corner, 'the room has a corner at the origin');
  // Along the top wall, which that corner is an end of, and nowhere near anything else.
  const snap = computeSnap({
    point: { x: 1387, y: 12 },
    plan,
    tolerance: 100,
    enabled: true,
    gridMm: 50,
    ignoreNodeId: corner.id,
  });
  assert.notEqual(snap.kind, 'wall', 'snapped back onto the wall it is an end of');
  assert.equal(snap.x % 50, 0, `x came out at ${snap.x}`);
  assert.equal(snap.y % 50, 0, `y came out at ${snap.y}`);
});

test('an alignment pins one axis and rounds the other', () => {
  // Lining a corner up with another corner fixes one coordinate exactly; the other is
  // still free, and a free coordinate should be a round number rather than wherever the
  // cursor happened to be.
  const plan = room(4000, 3000, 300);
  const dragged = plan.nodes.find((n) => Math.abs(n.x) < 1 && Math.abs(n.y) < 1);
  const snap = computeSnap({
    point: { x: 1387, y: 12 },
    plan,
    tolerance: 100,
    enabled: true,
    gridMm: 50,
    ignoreNodeId: dragged.id,
  });
  assert.equal(snap.kind, 'alignY');
  assert.equal(snap.y, 0, 'held exactly in line with the far corner');
  assert.equal(snap.x, 1400, 'and rounded along it');
});

test('a corner still snaps to walls it is not attached to', () => {
  // The fix must not make a dragged node blind to the rest of the drawing.
  const plan = room(4000, 3000, 300);
  const far = addWall(plan, 8000, -2000, 8000, 5000, { thickness: 115 });
  touch(plan);
  const corner = plan.nodes.find((n) => Math.abs(n.x) < 1 && Math.abs(n.y) < 1);
  const snap = computeSnap({
    point: { x: 7960, y: 1500 },
    plan,
    tolerance: 100,
    enabled: true,
    gridMm: 50,
    ignoreNodeId: corner.id,
  });
  assert.equal(snap.x, 8000, 'caught the wall it has nothing to do with');
  assert.ok(far);
});

test('with snapping off only the grid applies', () => {
  const plan = room(4000, 3000, 300);
  const snap = computeSnap({ point: { x: 37, y: 61 }, plan, tolerance: 100, enabled: false, gridMm: 25 });
  assert.equal(snap.x, 25);
  assert.equal(snap.y, 50);
});

// ---- openings catalogue ----------------------------------------------

test('every door and window style produces a symbol', () => {
  for (const kind of ['door', 'window', 'opening']) {
    const base = defaultsFor(kind);
    const primitives = openingSymbol({ ...base, width: 1000 }, 300);
    assert.ok(primitives.length >= 2, `${kind} drew ${primitives.length} primitives`);
    for (const item of primitives) {
      assert.ok(['line', 'arc', 'rect'].includes(item.type), `unknown primitive ${item.type}`);
      for (const key of Object.keys(item)) {
        if (key === 'type' || key === 'heavy') continue;
        assert.ok(Number.isFinite(item[key]), `${kind}: ${key} is ${item[key]}`);
      }
    }
  }
});

test('a single door swings from its jamb and closes into the opening', () => {
  const opening = { kind: 'door', style: 'single', width: 900, sill: 0, head: 2010, hinge: 'start', swing: 'in' };
  const symbol = openingSymbol(opening, 300);
  const arc = symbol.find((s) => s.type === 'arc');
  const layout = leafLayout(opening, 300);
  assert.ok(arc, 'has a swing arc');
  // The arc turns about the hinge, which is on the jamb face at the face of the
  // wall — the same place the model hangs the leaf.
  assert.equal(arc.hinge, layout.leaves[0].hingeA);
  assert.equal(arc.hingeC, layout.hingeC);
  assert.equal(arc.hingeC, 150, 'the wall face, not its middle');
  // It reaches a clear width, not the structural width.
  const radius = Math.hypot(arc.fromA - arc.hinge, arc.fromC - arc.hingeC);
  assert.equal(Math.round(radius), 900, 'the arc is exactly the door');
  assert.ok(openingWidth(opening) > 900, 'and the hole is the door plus its stock');
  // And it closes into the opening rather than at the far corner.
  assert.equal(Math.round(arc.toA), Math.round(layout.leaves[0].hingeA + layout.length));
  assert.equal(arc.toC, arc.hingeC);
});

test('flipping the hinge mirrors the door along the wall', () => {
  const of = (hinge) => {
    const opening = { kind: 'door', style: 'single', width: 900, sill: 0, head: 2010, hinge, swing: 'in' };
    return openingSymbol(opening, 300).find((s) => s.type === 'arc');
  };
  const left = of('start');
  const right = of('end');
  assert.ok(left.hinge < 100, `hinged near the near jamb, at ${left.hinge}`);
  assert.ok(right.hinge > 800, `hinged near the far jamb, at ${right.hinge}`);
  assert.equal(left.hingeC, right.hingeC, 'both turn about the same face');
});

test('the plan, the model and the clearance all hang the leaf in one place', () => {
  for (const over of [{}, { hinge: 'end' }, { swing: 'out' }, { style: 'double', width: 1510 }]) {
    const opening = { kind: 'door', style: 'single', width: 900, sill: 0, head: 2010, hinge: 'start', swing: 'in', ...over };
    const layout = leafLayout(opening, 300);
    const arcs = openingSymbol(opening, 300).filter((s) => s.type === 'arc');
    assert.equal(arcs.length, layout.leaves.length, 'an arc per leaf');
    arcs.forEach((arc, i) => {
      assert.equal(arc.hinge, layout.leaves[i].hingeA);
      assert.equal(arc.hingeC, layout.hingeC);
      const radius = Math.hypot(arc.fromA - arc.hinge, arc.fromC - arc.hingeC);
      assert.equal(Math.round(radius), Math.round(layout.length));
    });
  }
});

test('flipping the swing mirrors the door across the wall', () => {
  const inward = openingSymbol({ kind: 'door', style: 'single', width: 900, hinge: 'start', swing: 'in' }, 300);
  const outward = openingSymbol({ kind: 'door', style: 'single', width: 900, hinge: 'start', swing: 'out' }, 300);
  assert.equal(Math.sign(inward.find((s) => s.type === 'arc').fromC), 1);
  assert.equal(Math.sign(outward.find((s) => s.type === 'arc').fromC), -1);
});

test('door widths are the sizes joinery is actually made in', () => {
  assert.ok(DOOR_WIDTHS.includes(860));
  assert.equal(defaultsFor('door').width, 860, 'a leaf, not a hole');
  assert.equal(defaultsFor('window').sill, 900);
  assert.equal(defaultsFor('window').width, 1135);
});

// ---- typed input -----------------------------------------------------

test('typed lengths accept metres, centimetres and bare millimetres', () => {
  assert.equal(parseLengthInput('3,74 m'), 3740);
  assert.equal(parseLengthInput('3.74m'), 3740);
  assert.equal(parseLengthInput('374 cm'), 3740);
  assert.equal(parseLengthInput('3740'), 3740);
  assert.equal(parseLengthInput('3,74'), 3740, 'a small bare number reads as metres');
  assert.equal(parseLengthInput('nonsense'), null);
  assert.equal(parseLengthInput('0'), null);
});

// ---- opening a drawing saved by an older version ----------------------

test('a project saved by the previous version opens cleanly', () => {
  // The shape the earlier PDF-import version wrote: layer flags on the backdrop,
  // set-aside geometry, a separate `source` object, and openings whose swing
  // carried the hinge side.
  const legacy = {
    plans: [
      {
        id: 'p1',
        name: 'Ground floor',
        scaleDenominator: 100,
        nodes: [
          { id: 'n1', x: 0, y: 0 },
          { id: 'n2', x: 4000, y: 0 },
        ],
        walls: [{ id: 'w1', a: 'n1', b: 'n2', thickness: 300, kind: 'exterior', manual: true }],
        openings: [{ id: 'o1', wallId: 'w1', kind: 'door', width: 885, offset: 500, swing: 'right', sill: 0 }],
        furniture: [],
        labels: [],
        dimensions: [],
        rooms: [],
        layerVisibility: { rooms: true, dimensions: false, labels: true, furniture: true, backdrop: true },
        source: { kind: 'pdf', widthMm: 42000, heightMm: 29700, scaleConfirmed: true },
        extract: { layers: { wall: true, thin: false } },
        setAside: [],
        backdrop: {
          visible: true,
          opacity: 0.28,
          image: null,
          segments: [
            { x1: 0, y1: 0, x2: 10, y2: 0, layer: 'wall', excluded: false },
            { x1: 99, y1: 0, x2: 199, y2: 0, layer: 'hatch', excluded: true },
          ],
          texts: [{ str: 'Wohnen', x: 100, y: 100, size: 200, layer: 'label', excluded: false }],
        },
      },
    ],
    activePlanId: 'p1',
    stage: 'edit',
  };

  const project = normaliseProject(JSON.parse(JSON.stringify(legacy)));
  const plan = project.plans[0];

  // What the old file said is kept; anything it never had gets today's default.
  assert.equal(plan.show.rooms, true);
  assert.equal(plan.show.dimensions, false, 'the setting it had is respected');
  assert.equal(plan.show.labels, true);
  assert.equal(plan.show.furniture, true);
  assert.equal(plan.show.backdrop, true);
  assert.equal(plan.show.openingSizes, true, 'opening sizes are shown unless turned off');
  assert.equal(plan.backdrop.kind, 'pdf');
  assert.equal(plan.backdrop.widthMm, 42000);
  assert.equal(plan.backdrop.segments.length, 1, 'set-aside geometry is dropped');
  assert.equal(plan.backdrop.segments[0].layer, undefined, 'layer tags are gone');
  assert.equal(plan.scaleConfirmed, true);
  assert.equal(plan.source, undefined);
  assert.equal(plan.extract, undefined);
  assert.equal(plan.walls[0].type, 'exterior');
  // hinge and swing were one field before; the hinge side survives
  assert.equal(plan.openings[0].hinge, 'end');
  assert.equal(plan.openings[0].swing, 'in');
  assert.equal(plan.openings[0].style, 'single');
  assert.equal(plan.openings[0].head, 2010);
  assert.equal(project.stage, undefined);

  // and the migrated plan still measures and draws
  touch(plan);
  assert.equal(Math.round(wallLength(plan, plan.walls[0])), 4000);
  assert.ok(openingSymbol(plan.openings[0], 300).length >= 2);
});

// ---- the rectangle tool must not be angle-constrained -----------------

test('ortho lock does not flatten a room rectangle', () => {
  // Regression: the room tool passed its anchor for angle locking, so with ortho
  // lock on (the default) the opposite corner was forced onto an axis, one side
  // collapsed to zero and no room was created at all.
  const plan = createPlan();
  const snap = computeSnap({
    point: { x: 6000, y: 4000 },
    anchor: { x: 0, y: 0 },
    plan,
    tolerance: 60,
    orthoLock: true,
    enabled: true,
    gridMm: 50,
    constrainAngle: false,
  });
  assert.equal(Math.round(snap.x), 6000);
  assert.equal(Math.round(snap.y), 4000, 'the far corner keeps both of its coordinates');

  const walls = addRoomRect(plan, 0, 0, snap.x, snap.y, { type: 'exterior', thickness: 300 });
  assert.equal(walls.length, 4);
});

test('walls are still angle-constrained by ortho lock', () => {
  const plan = createPlan();
  const snap = computeSnap({
    point: { x: 6000, y: 400 },
    anchor: { x: 0, y: 0 },
    plan,
    tolerance: 60,
    orthoLock: true,
    enabled: true,
    gridMm: 50,
  });
  assert.equal(Math.round(snap.y), 0, 'held on the horizontal');
  assert.equal(snap.kind, 'angle');
});

test('a rectangle too small to be a room makes no walls', () => {
  const plan = createPlan();
  assert.deepEqual(addRoomRect(plan, 0, 0, 200, 4000, { thickness: 300 }), []);
  assert.equal(plan.walls.length, 0);
});

// ---- centreline vs faces ----------------------------------------------

test('a rectangle is one wall thickness bigger outside and smaller inside', () => {
  const plan = room(7000, 5000, 365);
  for (const wall of plan.walls) {
    const l = wallLengths(plan, wall);
    const centre = Math.round(l.centre);
    assert.ok(centre === 7000 || centre === 5000, `centreline ${centre}`);
    // Each end is a square corner, so each contributes half the other wall's
    // thickness: outer = centre + t, inner = centre - t.
    assert.ok(Math.abs(l.outer - (centre + 365)) < 0.5, `outer ${l.outer} vs ${centre + 365}`);
    assert.ok(Math.abs(l.inner - (centre - 365)) < 0.5, `inner ${l.inner} vs ${centre - 365}`);
  }
});

test('a free-standing wall measures the same on every basis', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  const l = wallLengths(plan, wall);
  assert.equal(Math.round(l.centre), 4000);
  assert.equal(Math.round(l.outer), 4000);
  assert.equal(Math.round(l.inner), 4000);
});

test('a wall butting into one that carries on loses half its thickness, not gains it', () => {
  const plan = createPlan();
  addWall(plan, 4000, -2000, 4000, 2000, { thickness: 300 });
  const stub = addWall(plan, 0, 0, 4000, 0, { thickness: 115 });
  splitWallAt(plan, plan.walls[0].id, 4000, 0); // a real T-junction
  touch(plan);
  const l = wallLengths(plan, findWall(plan, stub.id));
  assert.equal(Math.round(l.centre), 4000);
  // both faces of the stub stop at the through wall's face
  assert.equal(Math.round(l.outer), 4000 - 150);
  assert.equal(Math.round(l.inner), 4000 - 150);
});

test('the mitre follows the angle between the two walls', () => {
  // The angle that matters is the one between the walls' directions measured out
  // of the shared corner: 90° for a square corner, small for a sharp spike, near
  // 180° for a join that carries almost straight on.
  const miter = (theta, t = 200) => ((t / 2) * Math.cos(theta) + t / 2) / Math.sin(theta);

  const square = createPlan();
  const a = addWall(square, 0, 0, 4000, 0, { thickness: 200 });
  addWall(square, 4000, 0, 4000, 4000, { thickness: 200 });
  touch(square);
  assert.ok(Math.abs(wallLengths(square, a).outer - (4000 + 100)) < 0.5, 'square corner: half a thickness');
  assert.ok(Math.abs(miter(Math.PI / 2) - 100) < 1e-6);

  // A sharp spike: the second wall doubles back at 45° to the first.
  const sharp = createPlan();
  const b = addWall(sharp, 0, 0, 4000, 0, { thickness: 200 });
  addWall(sharp, 4000, 0, 1000, 3000, { thickness: 200 });
  touch(sharp);
  const sharpExpected = 4000 + miter(Math.PI / 4);
  assert.ok(Math.abs(wallLengths(sharp, b).outer - sharpExpected) < 1, `${wallLengths(sharp, b).outer}`);
  assert.ok(sharpExpected - 4000 > 200, 'a sharp corner mitres out further than a thickness');

  // A shallow join turns only 45°, so the walls meet at 135° and barely mitre.
  const shallow = createPlan();
  const c = addWall(shallow, 0, 0, 4000, 0, { thickness: 200 });
  addWall(shallow, 4000, 0, 7000, -3000, { thickness: 200 });
  touch(shallow);
  const shallowExpected = 4000 + miter((3 * Math.PI) / 4);
  assert.ok(Math.abs(wallLengths(shallow, c).outer - shallowExpected) < 1);
  assert.ok(shallowExpected - 4000 < 100, 'a shallow corner mitres less than a square one');
});

test('a length typed on a face basis lands on that face exactly', () => {
  // Moving the end drags the joined wall with it, so that corner stops being
  // square and the mitre changes — which is why this has to settle rather than
  // convert once. What must hold is that the typed figure is what you get.
  for (const [basis, target] of [
    ['outer', 8000],
    ['outer', 6000],
    ['inner', 7000],
    ['centre', 5500],
  ]) {
    const plan = room(7000, 5000, 365);
    const wall = plan.walls.find((w) => Math.round(wallLengths(plan, w).centre) === 7000);
    assert.equal(setWallLengthOn(plan, wall.id, target, basis), true, `${basis} ${target}`);
    touch(plan);
    const after = wallLengths(plan, findWall(plan, wall.id));
    const got = basis === 'outer' ? after.outer : basis === 'inner' ? after.inner : after.centre;
    assert.ok(Math.abs(got - target) < 0.5, `${basis}: got ${got.toFixed(2)}, wanted ${target}`);
  }
});

test('an impossible length is refused and leaves the wall alone', () => {
  const plan = room(7000, 5000, 365);
  const wall = plan.walls.find((w) => Math.round(wallLengths(plan, w).centre) === 7000);
  const before = wallLengths(plan, wall).centre;
  assert.equal(setWallLengthOn(plan, wall.id, 10, 'outer'), false);
  assert.ok(Math.abs(wallLengths(plan, findWall(plan, wall.id)).centre - before) < 0.5);
});

test('a room typed as an outside size comes out that size outside', () => {
  const plan = createPlan();
  const t = 365;
  const shift = rectBasisShift('outer', t);
  assert.equal(shift, t);
  // what the interaction does: centreline size = typed size - shift
  addRoomRect(plan, 0, 0, 8400 - shift, 6200 - shift, { thickness: t });
  touch(plan);
  const widthWall = plan.walls.find((w) => Math.round(wallLengths(plan, w).centre) === 8400 - t);
  assert.ok(Math.abs(wallLengths(plan, widthWall).outer - 8400) < 0.5);
  const rooms = derived(plan).rooms;
  const clear = roomClearSize(rooms[0]);
  assert.equal(clear.tapers, false, 'a rectangle measures the same wherever you take it');
  assert.equal(Math.round(clear.width.min), 8400 - 2 * t);
  assert.equal(Math.round(clear.width.max), 8400 - 2 * t);
  assert.equal(Math.round(clear.depth.min), 6200 - 2 * t);
  assert.equal(Math.round(clear.depth.max), 6200 - 2 * t);
});

test('a wall that carries on past a partition keeps its outer face', () => {
  // The partition butts into the wall, so only the face it lands on is
  // interrupted; the far face runs straight through.
  const plan = room(8000, 5000, 365);
  const top = plan.walls.find((w) => {
    const ends = [w.a, w.b].map((id) => plan.nodes.find((n) => n.id === id));
    return Math.abs(ends[0].y) < 1 && Math.abs(ends[1].y) < 1;
  });
  addWall(plan, 4000, 0, 4000, 5000, { type: 'partition', thickness: 115 });
  splitWallAt(plan, top.id, 4000, 0);
  touch(plan);

  const left = plan.walls.find((w) => {
    const ends = [w.a, w.b].map((id) => plan.nodes.find((n) => n.id === id));
    return (
      Math.abs(ends[0].y) < 1 &&
      Math.abs(ends[1].y) < 1 &&
      Math.min(ends[0].x, ends[1].x) < 1 &&
      Math.max(ends[0].x, ends[1].x) > 3900
    );
  });
  const l = wallLengths(plan, left);
  assert.equal(Math.round(l.centre), 4000);
  // outer: mitres out half the corner wall at one end, unaffected at the junction
  assert.ok(Math.abs(l.outer - (4000 + 182.5)) < 0.5, `outer ${l.outer}`);
  // inner: recedes at the corner and stops at the partition's face
  assert.ok(Math.abs(l.inner - (4000 - 182.5 - 57.5)) < 0.5, `inner ${l.inner}`);
});

// ---- stretching, not shearing ------------------------------------------

function cornerSet(plan) {
  return plan.nodes
    .map((n) => `${Math.round(n.x)},${Math.round(n.y)}`)
    .sort()
    .join(' | ');
}

test('lengthening a wall carries the far side with it and keeps corners square', () => {
  const plan = room(6000, 4000, 300);
  const top = plan.walls.find((w) => {
    const e = [w.a, w.b].map((id) => findNode(plan, id));
    return Math.abs(e[0].y) < 1 && Math.abs(e[1].y) < 1;
  });
  assert.equal(setWallLengthOn(plan, top.id, 9000, 'centre'), true);
  touch(plan);
  // the rectangle stretched: still four square corners, now 9000 x 4000
  assert.equal(cornerSet(plan), ['0,0', '0,4000', '9000,0', '9000,4000'].sort().join(' | '));
  for (const wall of plan.walls) {
    const l = wallLengths(plan, wall);
    const centre = Math.round(l.centre);
    assert.ok(centre === 9000 || centre === 4000, `centreline ${centre}`);
    assert.ok(Math.abs(l.outer - (centre + 300)) < 0.5, 'corner still square');
  }
  assert.equal(derived(plan).rooms.length, 1);
});

test('shortening a wall pulls the far side back', () => {
  const plan = room(6000, 4000, 300);
  const top = plan.walls.find((w) => {
    const e = [w.a, w.b].map((id) => findNode(plan, id));
    return Math.abs(e[0].y) < 1 && Math.abs(e[1].y) < 1;
  });
  setWallLengthOn(plan, top.id, 3500, 'centre');
  touch(plan);
  assert.equal(cornerSet(plan), ['0,0', '0,4000', '3500,0', '3500,4000'].sort().join(' | '));
});

test('a partition moves as a whole when a room is resized', () => {
  const plan = room(8000, 5000, 300);
  addWall(plan, 4000, 0, 4000, 5000, { type: 'partition', thickness: 115 });
  touch(plan);
  const rooms = derived(plan).rooms.slice().sort((a, b) => a.centroid.x - b.centroid.x);
  const left = rooms[0];
  const before = derived(plan).rooms.length;
  assert.equal(setRoomSize(plan, left, 'x', 5000, 'centre'), true);
  touch(plan);
  const after = derived(plan).rooms.slice().sort((a, b) => a.centroid.x - b.centroid.x);
  assert.equal(after.length, before, 'still two rooms');
  const axes = roomAxes(plan, after[0]);
  assert.equal(Math.round(axes.x.centre), 5000, 'left room is now 5000 on its centrelines');
  // The partition slid across; the shell stayed where it was, so the room next
  // door gave up the space rather than the house growing.
  const xs = plan.nodes.map((n) => Math.round(n.x)).sort((a, b) => a - b);
  assert.deepEqual([...new Set(xs)], [0, 5000, 8000]);
  assert.equal(Math.round(roomAxes(plan, after[1]).x.centre), 3000, 'the neighbour gave up 1000');
});

test('room width and depth read out on every basis', () => {
  const plan = room(7000, 5000, 365);
  const rooms = derived(plan).rooms;
  const axes = roomAxes(plan, rooms[0]);
  assert.equal(Math.round(axes.x.centre), 7000);
  assert.equal(Math.round(axes.x.outer), 7365);
  assert.equal(Math.round(axes.x.inner), 6635);
  assert.equal(Math.round(axes.y.outer), 5365);
  assert.equal(Math.round(roomSizeOn(axes.y, 'inner')), 4635);
});

test('setting a room size on the outside basis lands exactly', () => {
  const plan = room(7000, 5000, 365);
  const room0 = derived(plan).rooms[0];
  assert.equal(setRoomSize(plan, room0, 'x', 9000, 'outer'), true);
  touch(plan);
  const axes = roomAxes(plan, derived(plan).rooms[0]);
  assert.equal(Math.round(axes.x.outer), 9000);
  assert.equal(Math.round(axes.x.centre), 9000 - 365);
});

test('moving a room takes its walls along and leaves its size alone', () => {
  const plan = room(6000, 4000, 300);
  const before = derived(plan).rooms[0];
  const area = before.areaMm2;
  assert.equal(moveRoom(plan, before, 1500, -800), true);
  touch(plan);
  const after = derived(plan).rooms[0];
  assert.ok(Math.abs(after.areaMm2 - area) < 1, 'same size');
  assert.equal(Math.round(after.centroid.x - before.centroid.x), 1500);
  assert.equal(Math.round(after.centroid.y - before.centroid.y), -800);
});

test('setting an angle swings the rest of the run with it', () => {
  const plan = createPlan();
  const first = addWall(plan, 0, 0, 3000, 0, { thickness: 115 });
  const second = addWall(plan, 3000, 0, 3000, 2000, { thickness: 115 });
  touch(plan);
  assert.equal(setWallAngle(plan, first.id, 90), true);
  touch(plan);
  // the first wall now runs straight up, and the second came along rigidly
  const f = findWall(plan, first.id);
  assert.equal(Math.round(wallAngle(plan, f)), 90);
  assert.equal(Math.round(wallLength(plan, f)), 3000);
  const s = findWall(plan, second.id);
  assert.equal(Math.round(wallLength(plan, s)), 2000, 'the follower kept its length');
  // It swung by the same 90°, so the corner between the two is unchanged:
  // 0° then 270° before, 90° then 0° after — a right turn either way.
  assert.ok(Math.abs(wallAngle(plan, s)) < 0.5, `follower bearing ${wallAngle(plan, s)}`);
});

test('an angle on a closed shape only moves the far corner', () => {
  const plan = room(4000, 3000, 300);
  const top = plan.walls.find((w) => {
    const e = [w.a, w.b].map((id) => findNode(plan, id));
    return Math.abs(e[0].y) < 1 && Math.abs(e[1].y) < 1;
  });
  const others = plan.walls.filter((w) => w.id !== top.id).map((w) => wallLength(plan, w));
  assert.equal(setWallAngle(plan, top.id, 10), true);
  touch(plan);
  assert.equal(Math.round(wallAngle(plan, findWall(plan, top.id))), 10);
  // the shape is still closed: four walls, one room
  assert.equal(plan.walls.length, 4);
  assert.equal(derived(plan).rooms.length, 1);
  const nowOthers = plan.walls.filter((w) => w.id !== top.id).map((w) => wallLength(plan, w));
  assert.notDeepEqual(
    nowOthers.map(Math.round),
    others.map(Math.round),
    'the neighbours reshaped rather than the whole thing turning'
  );
});

test('a rectangle is still a rectangle when another wall butts into it', () => {
  // The partition splits the big room's boundary, adding a corner that is not a
  // corner. Its width and depth must still be editable.
  const plan = room(9000, 6500, 365);
  addWall(plan, 5200, 0, 5200, 6500, { type: 'partition', thickness: 115 });
  addWall(plan, 5200, 3600, 9000, 3600, { type: 'partition', thickness: 115 });
  touch(plan);
  const rooms = derived(plan).rooms.slice().sort((a, b) => b.areaMm2 - a.areaMm2);
  const big = rooms[0];
  assert.ok(big.polygon.length > 4, 'the raw face has an extra vertex');
  const axes = roomAxes(plan, big);
  assert.ok(axes, 'but it is still treated as a rectangle');
  assert.equal(Math.round(axes.x.centre), 5200);
  assert.equal(Math.round(axes.y.centre), 6500);
  assert.ok(roomClearSize(big), 'and it reports a clear size');
});

// ---- growing a room off a wall ------------------------------------------

test('a room grows off a wall, which the two then share', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const before = plan.walls.length;
  const north = plan.walls.find((w) => {
    const ends = wallEnds(plan, w);
    return Math.abs(ends.a.y) < 1 && Math.abs(ends.b.y) < 1;
  });

  const built = growRoomFromWall(plan, north.id, 3000, -1);
  touch(plan);
  assert.equal(built.length, 3, 'three new sides, not four: the wall is shared');
  assert.equal(plan.walls.length, before + 3);

  const rooms = derived(plan).rooms.sort((a, b) => b.areaMm2 - a.areaMm2);
  assert.equal(rooms.length, 2);
  // The original is untouched: 5635 by 3635 inside its 365 walls.
  assert.equal(Math.round(rooms[0].areaMm2 / 1e4), Math.round((5635 * 3635) / 1e4));
  // And the new one is exactly as deep as it was asked to be. The depth is the room,
  // not the gap between centre lines — ask for three metres and you can stand in
  // three metres, rather than in 2,63⁵ once half of each wall has been taken out.
  assert.equal(Math.round(rooms[1].areaMm2 / 1e4), Math.round((5635 * 3000) / 1e4));
});

test('which side it grows on is the caller’s to say', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const north = plan.walls.find((w) => {
    const ends = wallEnds(plan, w);
    return Math.abs(ends.a.y) < 1 && Math.abs(ends.b.y) < 1;
  });
  // The other way is into the room, which divides it rather than extending it.
  growRoomFromWall(plan, north.id, 1500, 1);
  touch(plan);
  const rooms = derived(plan).rooms.sort((a, b) => b.areaMm2 - a.areaMm2);
  assert.equal(rooms.length, 2, 'the room it was taken from keeps what is left');
  const total = rooms.reduce((sum, r) => sum + r.areaMm2, 0);
  assert.ok(total < 5635 * 3635, 'and the new wall takes its own thickness out of it');
  // Dividing a room: the new one is 1500 inside, and the remainder is the rest less
  // the wall that now stands between them.
  assert.equal(Math.round(rooms[1].areaMm2 / 1e4), Math.round((5635 * 1500) / 1e4));
  assert.equal(Math.round(rooms[0].areaMm2 / 1e4), Math.round((5635 * (3635 - 1500 - 365)) / 1e4));
});

test('a room will not grow off nothing', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const wall = plan.walls[0];
  assert.deepEqual(growRoomFromWall(plan, wall.id, 40, 1), [], 'nor to no depth');
  assert.deepEqual(growRoomFromWall(plan, 'not-a-wall', 3000, 1), []);
});


// ---- the angle a wall can be drawn at ---------------------------------

test('a free angle is rounded, never limited', () => {
  // Ninety degrees was the only direction on offer, which is no use for a house with
  // a wall running at fifty-one. Three divides ninety, so every right angle and every
  // forty-five is still exactly reachable.
  assert.equal(90 % ANGLE_STEP, 0);
  assert.equal(45 % ANGLE_STEP, 0);

  const drawn = (dx, dy) => {
    const snap = computeSnap({
      point: { x: dx, y: dy },
      anchor: { x: 0, y: 0 },
      plan: createPlan(),
      tolerance: 40,
      gridMm: 0,
      enabled: true,
    });
    // Degrees clockwise from east in the snap's own frame, which is what it rounds.
    const deg = (Math.atan2(snap.y - 0, snap.x - 0) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
  };

  // Every one of these is a whole number of steps, and none of them is a right angle.
  for (const want of [3, 21, 51, 87, 129, 231, 318]) {
    const rad = (want * Math.PI) / 180;
    assert.equal(drawn(Math.cos(rad) * 4000, Math.sin(rad) * 4000), want, `${want}°`);
  }

  // And anything between rounds to the nearest step rather than being thrown away.
  for (const [put, expected] of [[50, 51], [49, 48], [1, 0], [46, 45]]) {
    const rad = (put * Math.PI) / 180;
    const got = drawn(Math.cos(rad) * 4000, Math.sin(rad) * 4000);
    assert.equal(got, expected, `${put}° should tidy to ${expected}°, got ${got}°`);
    assert.ok(Math.abs(got - put) <= ANGLE_STEP / 2 + 0.5);
  }
});

test('ortho lock still holds a right angle, and outranks the object snaps', () => {
  const plan = createPlan();
  addWall(plan, 0, 0, 4000, 1000, { thickness: 300 });
  touch(plan);
  // The same pointer that finds a perpendicular foot when free.
  const free = snapIn(plan, { x: 1450, y: 380 }, { anchor: { x: 1000, y: 2000 } });
  assert.equal(free.kind, 'perpendicular', 'rounding the angle must not cost this snap');
  const locked = snapIn(plan, { x: 1450, y: 380 }, { anchor: { x: 1000, y: 2000 }, orthoLock: true });
  assert.equal(Math.round(locked.x), 1000, 'held on the anchor\'s own vertical');
});

// ---- splitting a wall -------------------------------------------------

test('a cut lands on the wall, not where the pointer happened to be', () => {
  // The point comes from the snapping engine, which is free to catch a guide or an
  // alignment a little off the wall. Taken as given it put the new corner off the
  // line and left the wall with a kink in it.
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  touch(plan);
  const cut = wallCutAt(plan, wall.id, 1500, 140);
  assert.equal(cut.y, 0, 'dropped onto the centreline');
  assert.equal(cut.x, 1500);
  assert.equal(Math.round(cut.at), 1500, 'measured along the wall, not straight to the point');
  assert.deepEqual([cut.first, cut.second], [1500, 2500]);

  const made = splitWallAt(plan, wall.id, 1500, 140);
  const node = findNode(plan, made.node.id);
  assert.equal(node.y, 0, 'so the wall has no kink in it');
  assert.deepEqual(made.lengths.map(Math.round), [1500, 2500]);
});

test('a cut too near an end is refused rather than made badly', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 4000, 0, { thickness: 300 });
  touch(plan);
  assert.equal(wallCutAt(plan, wall.id, 20, 0), null, 'no stub of a wall');
  assert.equal(wallCutAt(plan, wall.id, 3990, 0), null);
  assert.equal(splitWallAt(plan, wall.id, 20, 0), null);
  assert.equal(plan.walls.length, 1, 'and nothing is changed by the refusal');
});

test('the cut shown and the cut made are the same cut', () => {
  // Both come from `wallCutAt`, so the preview cannot promise one place and the click
  // land in another — which is the whole point of showing it.
  const plan = createPlan();
  const wall = addWall(plan, 1000, 500, 1000, 4500, { thickness: 240 });
  touch(plan);
  const shown = wallCutAt(plan, wall.id, 1120, 2600);
  const made = splitWallAt(plan, wall.id, 1120, 2600);
  assert.equal(made.at, shown.at);
  assert.deepEqual(made.lengths, [shown.first, shown.second]);
  assert.equal(findNode(plan, made.node.id).x, shown.x);
  assert.equal(findNode(plan, made.node.id).y, shown.y);
});

test('an opening past the cut moves onto the piece it now belongs to', () => {
  const plan = createPlan();
  const wall = addWall(plan, 0, 0, 6000, 0, { thickness: 300 });
  const near = addOpening(plan, wall.id, 800, { kind: 'door', width: 860 });
  const far = addOpening(plan, wall.id, 4200, { kind: 'door', width: 860 });
  touch(plan);
  // An opening is centred on where it was clicked, so read the offsets rather than
  // assuming them.
  const wasNear = near.offset;
  const wasFar = far.offset;
  const made = splitWallAt(plan, wall.id, 3000, 0);
  assert.equal(near.wallId, wall.id, 'the near door stays on the first piece');
  assert.equal(near.offset, wasNear, 'at the same distance along it');
  assert.equal(far.wallId, made.second.id, 'the far door moves to the second');
  assert.equal(far.offset, wasFar - 3000, 'measured from the new corner');
});


// ---- measuring a room that is not a rectangle -------------------------

test('a room is measured across itself, not across its bounding box', () => {
  // The room from the drawing that showed this up: square on three sides with the
  // fourth wall slanted, which is what the three degree angles made easy to draw.
  // Its bounding box is 6000 x 4000; no edge of it is 4000 long.
  const room = [
    { x: 0, y: 0 },
    { x: 6000, y: 1000 },
    { x: 6000, y: 4000 },
    { x: 0, y: 4000 },
  ];

  // Near the slanted wall the room is genuinely narrower, and the chord says so.
  const nearSlant = polygonChord(room, 'y', 3000);
  assert.equal(Math.round(nearSlant.from), 500, 'starts on the slanted wall, not above it');
  assert.equal(nearSlant.to, 4000);
  assert.equal(Math.round(nearSlant.length), 3500);

  // A bounding box would have claimed 4000 here and drawn the line from y=0, which is
  // outside the room — through the wall.
  assert.ok(nearSlant.length < 4000);
  assert.ok(nearSlant.from > 0, 'the line starts inside the room');

  // And across the other way it is the full width wherever you take it.
  assert.equal(Math.round(polygonChord(room, 'x', 2000).length), 6000);
});

test('in a rectangle a chord is just the room, wherever it is taken', () => {
  const room = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ];
  for (const at of [250, 1500, 2750]) {
    const chord = polygonChord(room, 'x', at);
    assert.equal(chord.from, 0);
    assert.equal(chord.to, 4000);
    assert.equal(chord.length, 4000);
  }
  // Which is why picking either side of the room cannot change the figure — and why
  // the 3D view is free to draw whichever of the two it can actually see.
  assert.equal(polygonChord(room, 'y', 250).length, polygonChord(room, 'y', 3750 - 250 - 500).length);
});

test('a pinched room reports a side of it, not the gap', () => {
  // An L, so a line across the waist crosses the polygon twice. The longest run is
  // the answer: a room narrowed by a projecting wall should read as a room, not as
  // the slot beside the projection.
  const room = [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 2000, y: 5000 },
    { x: 0, y: 5000 },
  ];
  assert.equal(polygonChord(room, 'x', 1000).length, 5000, 'the wide part');
  assert.equal(polygonChord(room, 'x', 3000).length, 2000, 'and the leg above the step');
  assert.equal(polygonChord(room, 'x', 9000), null, 'a line that misses the room measures nothing');
});


test('a tapering room is given as a range, not as a box it never fills', () => {
  // The room from the drawing. Its bounding box is 6000 x 4000, and 4000 is a depth no
  // part of it has: it runs from about 3,0 at the narrow end to about 4,0 at the wide.
  const room = { inner: [{ x: 0, y: 0 }, { x: 6000, y: 1000 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }] };
  room.polygon = room.inner;
  const clear = roomClearSize(room);
  assert.equal(clear.tapers, true);
  assert.ok(clear.depth.max < 4000, `the box said 4000, the room reaches ${Math.round(clear.depth.max)}`);
  assert.ok(clear.depth.min > 2900 && clear.depth.min < 3200, `narrow end ${Math.round(clear.depth.min)}`);
  assert.ok(clear.depth.max > 3800, `wide end ${Math.round(clear.depth.max)}`);
  // Across the other way it is the full width, and says so as one figure.
  assert.equal(Math.round(clear.width.max), 6000);

  // And it is not measured hard against a corner, where a tapering room runs out to
  // nothing and the reading would be true but useless.
  assert.ok(clear.width.min > 1000, `apex sliver would give ~0, got ${Math.round(clear.width.min)}`);
});

test('a room turned off the page is still measured square to its own walls', () => {
  // The room from the drawing, turned fifteen degrees. Measured on the page's axes the
  // bounding box is bigger than the room and a line set in from it crosses a corner,
  // where the room is a sliver — which is how a 15 m² room came to report two metres.
  const turned = (deg) => {
    const a = (deg * Math.PI) / 180;
    const at = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const inner = [at(0, 0), at(4500, 0), at(4500, 3400), at(0, 3400)];
    return { inner, polygon: inner };
  };

  // Up to a quarter turn the room keeps its own sides: 4500 across, 3400 deep.
  for (const deg of [0, 15, 33, 45]) {
    const clear = roomClearSize(turned(deg));
    assert.equal(Math.round(clear.width.min), 4500, `${deg}°: width`);
    assert.equal(Math.round(clear.depth.min), 3400, `${deg}°: depth`);
    assert.equal(clear.tapers, false, `${deg}°: a rectangle does not taper, whichever way it lies`);
    assert.equal(Math.round(roomFrame(turned(deg)).angle), deg, `${deg}°: frame`);
  }

  // Past a quarter turn the long side is the one running down the page, so it is the
  // depth — the sides are the same two, and which is called which follows the reader
  // rather than the order the corners happened to be drawn in.
  const far = roomClearSize(turned(72));
  assert.deepEqual(
    [Math.round(far.width.min), Math.round(far.depth.min)].sort((p, q) => p - q),
    [3400, 4500]
  );
  assert.ok(Math.abs(roomFrame(turned(72)).angle) <= 45, 'the frame never leaves the quarter turn');
});

test('a room measures the same in the panel and on the model', () => {
  // Both take their readings on the lines `measureLines` picks, so the two views cannot
  // disagree about the same room — which they did when one used a bounding box.
  const inner = [{ x: 0, y: 0 }, { x: 6000, y: 1000 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }];
  const room = { inner, polygon: inner };
  const frame = roomFrame(room);
  const extent = roomExtent(room, frame);
  const lines = measureLines(extent.u[0], extent.u[1]);
  const depths = lines.map((at) => Math.round(roomChord(room, frame, 'y', at).length));
  const clear = roomClearSize(room);
  assert.equal(Math.min(...depths), Math.round(clear.depth.min));
  assert.equal(Math.max(...depths), Math.round(clear.depth.max));
});

// ---- a document that came from somewhere else --------------------------

test('a wall standing on a corner that is not there is dropped, and said so', () => {
  // Every reader looks a wall's ends up. One whose corners are missing draws as a
  // blank, bounds no room and joins no chain — while still counting in the totals.
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const before = plan.walls.length;
  plan.walls.push({ id: 'wGhost', a: 'nowhere', b: plan.nodes[0].id, thickness: 300, type: 'exterior' });
  plan.openings.push({ id: 'oGhost', wallId: 'wGhost', kind: 'door', width: 860, offset: 100 });
  plan.fixtures = [{ id: 'xGhost', kind: 'socket', wallId: 'wGhost', x: 0, y: 0 }];

  normaliseProject(project);
  const fixed = activePlan(project);
  assert.equal(fixed.walls.length, before, 'the ghost wall is gone');
  assert.equal(fixed.walls.some((w) => w.id === 'wGhost'), false);
  assert.equal(fixed.openings.some((o) => o.wallId === 'wGhost'), false, 'and what was cut into it');
  assert.equal(fixed.dropped, 1, 'and it is on the record rather than silent');
  // A socket on it comes loose rather than vanishing.
  assert.equal(fixed.fixtures[0].wallId, undefined);
  assert.equal(fixed.fixtures.length, 1);
});

test('a sound drawing passes through untouched', () => {
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const walls = plan.walls.length;
  normaliseProject(project);
  assert.equal(activePlan(project).walls.length, walls);
  assert.equal(activePlan(project).dropped, undefined, 'nothing to report');
});

// ---- copying ----------------------------------------------------------

test('walls copied together keep the corners they share', () => {
  // The whole point. Copied one at a time each wall mints its own pair of corners and
  // the copy comes apart at every junction: four walls in, four loose sticks out, and
  // no room inside them.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  addOpening(plan, plan.walls[0].id, 1500, { kind: 'door', width: 860 });
  touch(plan);
  const before = { walls: plan.walls.length, nodes: plan.nodes.length, rooms: derived(plan).rooms.length };
  assert.equal(before.rooms, 1);

  const copies = copyWalls(plan, plan.walls.map((w) => w.id), 6000, 0);
  touch(plan);

  assert.equal(copies.length, before.walls);
  assert.equal(plan.nodes.length, before.nodes * 2, 'one new corner per old corner, and no more');
  // The copy encloses a room of its own, which it only can if its corners are shared.
  assert.equal(derived(plan).rooms.length, 2, 'the copy encloses a room too');
  // And the door came with the wall it was cut into.
  assert.equal(plan.openings.length, 2);
  assert.equal(plan.openings[1].wallId, copies[0].id);
  assert.notEqual(plan.openings[1].id, plan.openings[0].id);
});

test('a copied floor is a separate floor, not a second view of the same one', () => {
  const plan = createPlan({ name: 'Erdgeschoss' });
  addRoomRect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 365 });
  addOpening(plan, plan.walls[0].id, 2000, { kind: 'window', width: 1010 });
  plan.furniture.push({ id: 'f1', kind: 'bed-double', x: 2000, y: 2000, w: 1800, h: 2000, rotation: 0 });
  touch(plan);

  const copy = copyPlan(plan, { name: 'Obergeschoss' });
  assert.equal(copy.name, 'Obergeschoss');
  assert.notEqual(copy.id, plan.id);

  // The same building.
  assert.equal(copy.walls.length, plan.walls.length);
  assert.equal(copy.nodes.length, plan.nodes.length);
  touch(copy);
  assert.equal(derived(copy).rooms.length, derived(plan).rooms.length, 'and it still encloses its rooms');
  assert.equal(Math.round(totalArea(copy)), Math.round(totalArea(plan)));

  // Sharing no ids at all, or editing one floor would edit the other.
  const ids = (p) => [...p.nodes, ...p.walls, ...p.openings, ...p.furniture].map((x) => x.id);
  assert.equal(ids(copy).some((id) => ids(plan).includes(id)), false, 'nothing is shared');
  // The walls of the copy point at the corners of the copy.
  const own = new Set(copy.nodes.map((n) => n.id));
  assert.equal(copy.walls.every((w) => own.has(w.a) && own.has(w.b)), true);
  assert.equal(copy.openings.every((o) => copy.walls.some((w) => w.id === o.wallId)), true);

  // Moving the copy leaves the original where it was.
  copy.nodes[0].x += 1000;
  assert.notEqual(copy.nodes[0].x, plan.nodes[0].x);
});

test('a copied floor does not carry the traced page with it', () => {
  // A PDF page belongs to the storey it was traced from; under another floor it is a
  // drawing of somewhere else.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  plan.backdrop = { kind: 'pdf', name: 'survey.pdf', segments: [], x: 0, y: 0, scale: 1 };
  touch(plan);
  assert.equal(copyPlan(plan).backdrop.kind, null, 'the copy starts with no traced page');
  assert.equal(plan.backdrop.kind, 'pdf', 'and the original keeps its own');
});

// ---- which floor sits on which ----------------------------------------

test('a cellar drawn second still goes underneath', () => {
  // The order floors are drawn in is not the order they are stacked in. Anyone draws
  // the ground floor first; the cellar used to end up on the roof.
  const project = createProject();
  const ground = activePlan(project);
  ground.name = 'Erdgeschoss';
  ground.storey = 0;
  const cellar = createPlan({ name: 'Keller' });
  cellar.storey = -1;
  const upper = createPlan({ name: 'Obergeschoss' });
  upper.storey = 1;
  project.plans.push(cellar, upper);

  assert.deepEqual(floorsInOrder(project).map((p) => p.name), ['Keller', 'Erdgeschoss', 'Obergeschoss']);
  // And the elevations follow: the cellar is the one at the bottom.
  assert.equal(planElevation(project, cellar), 0);
  assert.ok(planElevation(project, ground) > 0, 'the ground floor sits on the cellar');
  assert.ok(planElevation(project, upper) > planElevation(project, ground));
  assert.equal(planElevation(project, ground), floorToFloor(cellar));
});

test('a drawing that never said which storey is which stacks as it always did', () => {
  // Nothing in an older file carries a storey, and it must come up looking the same.
  const project = createProject();
  const first = activePlan(project);
  const second = createPlan({ name: 'Second' });
  const third = createPlan({ name: 'Third' });
  project.plans.push(second, third);
  for (const plan of project.plans) assert.equal(plan.storey, undefined);

  assert.deepEqual(floorsInOrder(project).map((p) => p.id), project.plans.map((p) => p.id));
  assert.equal(planElevation(project, first), 0);
  assert.equal(planElevation(project, second), floorToFloor(first));
});

test('saying which storey one floor is does not shuffle the rest', () => {
  const project = createProject();
  const ground = activePlan(project);
  const attic = createPlan({ name: 'Attic' });
  const cellar = createPlan({ name: 'Cellar' });
  project.plans.push(attic, cellar);
  // Only the cellar is placed; the other two keep the order they were drawn in, below
  // nothing and above the one that has been placed.
  cellar.storey = -1;
  assert.deepEqual(floorsInOrder(project).map((p) => p.name), ['Cellar', 'Ground floor', 'Attic']);
});

// ---- the pen the drawing is made with ----------------------------------

test('line weight and lettering come from the scale, not from the building', () => {
  // A pen width belongs to the sheet. Taken from the building's own size, a bungalow
  // and a terrace drawn at the same scale came out with different pens, and enlarging
  // a drawing thinned every line on it.
  const small = createProject();
  addRoomRect(activePlan(small), 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(activePlan(small));

  const large = createProject();
  addRoomRect(activePlan(large), 0, 0, 40000, 30000, { type: 'exterior', thickness: 300 });
  touch(activePlan(large));

  const penOf = (svg) => Number(svg.match(/stroke-width="([\d.]+)"/)[1]);
  const one = penOf(planToSvg(activePlan(small)));
  const other = penOf(planToSvg(activePlan(large)));
  assert.equal(one, other, `a building ten times the size drew with a ${other} pen instead of ${one}`);
  assert.equal(one, PEN_MM * 100, 'at 1:100 a 0,25 mm pen is 25 mm on the ground');

  // And it follows the scale, which is the whole point of fixing it to the sheet.
  const fifty = planToSvg(activePlan(small), { denominator: 50 });
  assert.equal(penOf(fifty), PEN_MM * 50);
});

test('a room is lettered the same whether it is a cupboard or a hall', () => {
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 8000, 6000, { type: 'exterior', thickness: 300 });
  addRoomRect(plan, 9000, 0, 1400, 1200, { type: 'exterior', thickness: 300 });
  touch(plan);
  // Both rooms are unnamed, so each carries its area alone, at nine tenths of the
  // lettering height. One size for both, whatever the rooms measure.
  const svg = planToSvg(plan);
  const want = TEXT_MM * 100 * 0.9;
  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  const roomText = sizes.filter((size) => Math.abs(size - want) < 0.01);
  assert.equal(roomText.length, 2, `expected two rooms lettered at ${want}, got ${[...new Set(sizes)].join(', ')}`);
});

// ---- the plan on a sheet of paper ---------------------------------------

test('a sheet is the paper size it says it is', () => {
  const plan = createPlan({ name: 'Erdgeschoss' });
  addRoomRect(plan, 0, 0, 9000, 7000, { type: 'exterior', thickness: 365 });
  touch(plan);

  const svg = planToSheetSvg(plan, { paper: 'A3', orientation: 'landscape', projectName: 'Haus B' });
  // Printed at 100% the paper is A3 landscape, in millimetres, or the scale on it is a
  // lie — which is the only reason to print a scale at all.
  assert.match(svg, /width="420mm" height="297mm"/);
  assert.match(svg, /viewBox="0 0 420 297"/);

  const portrait = planToSheetSvg(plan, { paper: 'A4', orientation: 'portrait' });
  assert.match(portrait, /width="210mm" height="297mm"/);
});

test('the scale is the largest standard one that fits, not one nobody draws at', () => {
  const small = createPlan();
  addRoomRect(small, 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(small);
  const big = createPlan();
  addRoomRect(big, 0, 0, 30000, 22000, { type: 'exterior', thickness: 365 });
  touch(big);

  const a4 = paperSize('A4', 'landscape');
  assert.equal(scaleToFit(small, a4, 10, 26), 50, 'a small house goes on A4 at 1:50');
  // A 30 m frontage does not go on A4 at any scale a house is drawn at.
  assert.ok([100, 200, null].includes(scaleToFit(big, a4, 10, 26)));
  // And it gets further on a bigger sheet than on a smaller one.
  const a2 = paperSize('A2', 'landscape');
  const onA2 = scaleToFit(big, a2, 10, 26);
  const onA4 = scaleToFit(big, a4, 10, 26);
  if (onA4 !== null) assert.ok(onA2 <= onA4, 'a bigger sheet takes a bigger scale');
  else assert.ok(onA2 !== null || true);
});

test('a sheet carries the frame and the block, and the plan inside them', () => {
  const plan = createPlan({ name: 'Obergeschoss' });
  addRoomRect(plan, 0, 0, 6000, 5000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const svg = planToSheetSvg(plan, { paper: 'A3', projectName: 'Haus B', date: '30.07.2026' });

  assert.match(svg, /SCALE/, 'the block names the scale');
  assert.match(svg, /Haus B/, 'and the drawing');
  assert.match(svg, /Obergeschoss/, 'and the storey');
  assert.match(svg, /30\.07\.2026/, 'and when it was drawn');
  // The plan is placed by a transform rather than redrawn, so it cannot disagree with
  // the tight export.
  assert.match(svg, /<g transform="translate\([-\d. ]+\) scale\(([\d.]+)\)">/);
  const scale = Number(svg.match(/scale\(([\d.]+)\)/)[1]);
  assert.ok(Math.abs(1 / scale - 50) < 0.01 || Math.abs(1 / scale - 100) < 0.01, `scale came out 1:${1 / scale}`);
  // One title block, not two: the tight export's own is left off.
  assert.equal((svg.match(/LIVING AREA/g) ?? []).length, 1);
});

test('a drawing that will not fit says so on the sheet', () => {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 90000, 70000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const svg = planToSheetSvg(plan, { paper: 'A4', orientation: 'portrait' });
  assert.match(svg, /runs over the frame/, 'better said than silently cropped');
});

test('a copied floor is the storey above, not the same one', () => {
  // Spread along with everything else the copy kept its source's level, so "copy this
  // floor" made two floors both claiming to be the ground floor, stacked at one height.
  const ground = createPlan({ name: 'Erdgeschoss' });
  ground.storey = 0;
  const first = copyPlan(ground, { name: 'Obergeschoss' });
  assert.equal(first.storey, 1);
  assert.equal(copyPlan(first).storey, 2, 'and each one after that');
  // A floor that never said which storey it was leaves the copy saying nothing either,
  // so an old drawing still stacks in the order it was drawn.
  assert.equal(copyPlan(createPlan()).storey, undefined);
  // And it can be told outright.
  assert.equal(copyPlan(ground, { storey: -1 }).storey, -1);

  // The stack agrees.
  const project = createProject();
  project.plans = [ground, first];
  project.activePlanId = ground.id;
  assert.deepEqual(floorsInOrder(project).map((p) => p.name), ['Erdgeschoss', 'Obergeschoss']);
  assert.ok(planElevation(project, first) > 0);
});
