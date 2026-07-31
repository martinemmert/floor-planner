import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_SWING, openingParts, partToWorld, swingAngle } from '../src/app/opening3d.js';
import { defaultsFor, openingSymbol, openingWidth } from '../src/app/openings.js';
import {
  activePlan,
  addOpening,
  addRoomRect,
  addWall,
  createPlan,
  createProject,
  derived,
  roomMetaFor,
  touch,
} from '../src/app/model.js';
import { buildMesh, segmentBlocked } from '../src/app/mesh.js';
import { normaliseProject } from '../src/app/export.js';

const door = (over = {}) => ({ ...defaultsFor('door'), width: 885, ...over });
const window_ = (style, over = {}) => ({ ...defaultsFor('window', style), ...over });

const kinds = (parts) => {
  const out = {};
  for (const part of parts) out[part.kind] = (out[part.kind] ?? 0) + 1;
  return out;
};

test('every style builds parts that are actually solid', () => {
  const cases = [
    door(),
    door({ style: 'double', width: 1510 }),
    door({ style: 'sliding', width: 1010 }),
    door({ style: 'folding', width: 1010 }),
    window_('turn-tilt'),
    window_('turn-tilt', { width: 1760 }),
    window_('fixed'),
    window_('floor'),
    window_('french'),
  ];
  for (const opening of cases) {
    const parts = openingParts(opening, 365, 2500);
    assert.ok(parts.length >= 3, `${opening.kind}/${opening.style}: only ${parts.length} parts`);
    for (const part of parts) {
      assert.equal(part.pts.length, 4);
      for (const p of part.pts) {
        assert.ok(Number.isFinite(p.a) && Number.isFinite(p.c), `${part.kind}: ${p.a},${p.c}`);
      }
      assert.ok(part.z1 > part.z0, `${part.kind}: no height`);
      assert.ok(Number.isFinite(part.z0) && Number.isFinite(part.z1));
    }
  }
});

test('a plain opening is just a hole', () => {
  assert.deepEqual(openingParts({ ...defaultsFor('opening'), width: 1010 }, 300, 2500), []);
});

test('a door gets leaves, a window gets glass', () => {
  assert.equal(kinds(openingParts(door(), 300, 2500)).glass, undefined);
  assert.equal(kinds(openingParts(door(), 300, 2500)).leaf, 1);
  assert.equal(kinds(openingParts(door({ style: 'double', width: 1510 }), 300, 2500)).leaf, 2);
  assert.equal(kinds(openingParts(window_('turn-tilt'), 300, 2500)).leaf, undefined);
  assert.ok(kinds(openingParts(window_('turn-tilt'), 300, 2500)).glass >= 1);
  // A french door is both.
  const french = kinds(openingParts(window_('french'), 300, 2500));
  assert.equal(french.leaf, 2);
  assert.ok(french.glass >= 1);
});

test('a wide sash pair gets a bar down the middle, a narrow one does not', () => {
  assert.equal(kinds(openingParts(window_('turn-tilt', { width: 885 }), 300, 2500)).bar, undefined);
  const wide = kinds(openingParts(window_('turn-tilt', { width: 1760 }), 300, 2500));
  assert.equal(wide.bar, 1);
  assert.equal(wide.glass, 2, 'a pane each side of the bar');
});

test('a leaf lies in the frame when shut and stands square when open', () => {
  const leafAt = (angle) => {
    const parts = openingParts(door({ width: 900, swingAngle: angle }), 300, 2500);
    const leaf = parts.find((p) => p.kind === 'leaf');
    const as = leaf.pts.map((p) => p.a);
    const cs = leaf.pts.map((p) => p.c);
    return { a0: Math.min(...as), a1: Math.max(...as), c0: Math.min(...cs), c1: Math.max(...cs) };
  };
  // Shut, it fills the clear opening between the jambs and lies across the wall.
  const shut = leafAt(0);
  assert.ok(shut.a1 - shut.a0 > 700, `shut leaf is only ${Math.round(shut.a1 - shut.a0)} wide`);
  assert.ok(shut.c1 - shut.c0 < 60, 'and it is a thin panel across the wall');
  // Open, it stands out into the room instead.
  const open = leafAt(90);
  assert.ok(open.c1 - open.c0 > 700, `open leaf reaches only ${Math.round(open.c1 - open.c0)} into the room`);
  assert.ok(open.a1 - open.a0 < 60);
  // And right round, it is back along the wall.
  const flat = leafAt(180);
  assert.ok(flat.a0 < 0 && flat.c1 - flat.c0 < 60, `flat at a ${Math.round(flat.a0)}, c ${Math.round(flat.c1 - flat.c0)}`);
  // Halfway is halfway round, not halfway across.
  const half = leafAt(45);
  assert.ok(half.a1 - half.a0 > 400 && half.c1 - half.c0 > 400, 'at 45° it is across the corner');
});

test('a door swings past square without going through the wall', () => {
  // Hung on the frame's centre line, a leaf opened past 90° drove itself into the
  // masonry beside the opening. Hung on the face of the frame — where the hinges
  // actually are — it swings right round and comes to rest against the wall.
  for (const thickness of [115, 300, 365]) {
    const face = thickness / 2;
    for (const angle of [0, 45, 90, 135, 180]) {
      const opening = door({ width: 900, swingAngle: angle });
      const hole = openingWidth(opening);
      const parts = openingParts(opening, thickness, 2500);
      const leaf = parts.find((p) => p.kind === 'leaf');
      const beyond = leaf.pts.filter((p) => p.a < -1 || p.a > hole + 1);
      for (const p of beyond) {
        // Anything past the jamb has to be clear of the wall, not inside it.
        assert.ok(
          p.c >= face - 0.5,
          `${thickness} wall at ${angle}°: the leaf is at c=${Math.round(p.c)}, inside the face at ${face}`
        );
      }
    }
  }
});

test('a leaf comes to rest flat against the wall', () => {
  const thickness = 300;
  const parts = openingParts(door({ width: 900, swingAngle: MAX_SWING }), thickness, 2500);
  const leaf = parts.find((p) => p.kind === 'leaf');
  const cs = leaf.pts.map((p) => p.c);
  const as = leaf.pts.map((p) => p.a);
  assert.ok(Math.min(...cs) >= thickness / 2 - 0.5, 'it is in front of the wall');
  assert.ok(Math.max(...cs) - Math.min(...cs) < 60, 'lying flat, not standing out');
  assert.ok(Math.min(...as) < 0, 'and it reaches back past the jamb, along the wall');
});

test('a shut leaf fills the reveal flush with the wall', () => {
  const thickness = 365;
  const parts = openingParts(door({ width: 900, swingAngle: 0 }), thickness, 2500);
  const leaf = parts.find((p) => p.kind === 'leaf');
  const face = Math.max(...leaf.pts.map((p) => p.c));
  assert.ok(Math.abs(face - thickness / 2) < 0.5, `shut leaf face at ${face}, wall face at ${thickness / 2}`);
  const as = leaf.pts.map((p) => p.a);
  assert.ok(Math.max(...as) - Math.min(...as) > 700, 'and it fills the clear width');
});

test('the swing and the hinge decide which way the leaf goes', () => {
  const tip = (over) => {
    const parts = openingParts(door({ width: 900, ...over }), 300, 2500);
    return parts.find((p) => p.kind === 'leaf').pts[1];
  };
  assert.ok(tip({ swing: 'in' }).c > 0, 'in swings to the positive side');
  assert.ok(tip({ swing: 'out' }).c < 0, 'out swings the other way');
  // Hinged at the far jamb, the leaf sweeps back towards the near one.
  assert.ok(tip({ hinge: 'start' }).a < 100);
  assert.ok(tip({ hinge: 'end' }).a > 800);
});

test('the plan and the model agree on which side a door opens', () => {
  for (const swing of ['in', 'out']) {
    for (const hinge of ['start', 'end']) {
      const opening = door({ width: 900, swing, hinge });
      // The plan draws the leaf as a line from the hinge across the room.
      const leafLine = openingSymbol(opening, 300).find(
        (item) => item.type === 'line' && Math.abs(item.c2) > 400
      );
      const part = openingParts(opening, 300, 2500).find((p) => p.kind === 'leaf');
      assert.ok(leafLine, 'the plan draws a leaf');
      assert.equal(
        Math.sign(leafLine.c2),
        Math.sign(part.pts[1].c),
        `${swing}/${hinge}: the plan and the model disagree`
      );
    }
  }
});

test('the angle a leaf stands at is kept sane', () => {
  assert.equal(swingAngle({}), 90, 'ninety unless told otherwise');
  assert.equal(swingAngle({ swingAngle: 45 }), 45);
  assert.equal(swingAngle({ swingAngle: -20 }), 0);
  assert.equal(swingAngle({ swingAngle: 400 }), MAX_SWING, 'no further than flat against the wall');
  assert.equal(swingAngle({ swingAngle: 135 }), 135, 'past square is perfectly normal');
  assert.equal(swingAngle({ swingAngle: 'wide open' }), 90);
});

test('the frame stays inside the wall it sits in', () => {
  for (const thickness of [115, 175, 365]) {
    const parts = openingParts(window_('turn-tilt'), thickness, 2500);
    for (const part of parts.filter((p) => p.kind === 'frame' || p.kind === 'glass' || p.kind === 'bar')) {
      for (const p of part.pts) {
        assert.ok(
          Math.abs(p.c) <= thickness / 2 + 0.5,
          `${part.kind} pokes ${Math.round(Math.abs(p.c) - thickness / 2)} mm out of a ${thickness} wall`
        );
      }
    }
  }
});

test('a window board stands out into the room, and only on a window that has one', () => {
  const board = openingParts(window_('turn-tilt'), 365, 2500).filter((p) => p.kind === 'sill');
  assert.equal(board.length, 2, 'one inside, one out');
  const inner = board.find((p) => Math.max(...p.pts.map((q) => q.c)) > 182);
  assert.ok(inner, 'the inner board projects past the wall face');
  // Floor-to-ceiling and french have no board to sit on.
  assert.equal(openingParts(window_('floor'), 365, 2500).filter((p) => p.kind === 'sill').length, 0);
  assert.equal(openingParts(window_('french'), 365, 2500).filter((p) => p.kind === 'sill').length, 0);
  assert.equal(openingParts(door(), 365, 2500).filter((p) => p.kind === 'sill').length, 0);
});

test('nothing pokes through the ceiling', () => {
  // A head asked for above the storey height is brought back down to it.
  const parts = openingParts(window_('floor', { head: 4000 }), 300, 2400);
  for (const part of parts) assert.ok(part.z1 <= 2400.5, `${part.kind} reaches ${part.z1}`);
});

test('a door in a thin wall still builds', () => {
  const parts = openingParts(door({ width: 635 }), 60, 2500);
  assert.ok(parts.length >= 3);
  for (const part of parts) assert.ok(part.z1 > part.z0);
});

test('a part maps into the drawing along the wall it is in', () => {
  // A wall running east: `a` goes with x, `c` across to y.
  const geo = { x1: 1000, y1: 500, dx: 1, dy: 0, nx: 0, ny: 1 };
  assert.deepEqual(partToWorld(geo, 0, 0), { x: 1000, y: 500 });
  assert.deepEqual(partToWorld(geo, 900, 0), { x: 1900, y: 500 });
  assert.deepEqual(partToWorld(geo, 0, 150), { x: 1000, y: 650 });
});

// ---- what reaches the 3D view -------------------------------------------

function room(openings = []) {
  const project = createProject();
  const plan = project.plans[0];
  plan.height = 2500;
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  for (const over of openings) {
    const opening = addOpening(plan, plan.walls[0].id, over.offset ?? 1500, { type: over.kind ?? 'door' });
    Object.assign(opening, over);
  }
  touch(plan);
  return { project, plan };
}

test('an opening puts something in the hole', () => {
  const bare = buildMesh(room().project, {});
  const withDoor = buildMesh(room([{ kind: 'door', style: 'single', width: 885 }]).project, {});
  assert.ok(withDoor.count > bare.count, 'a door adds triangles');
});

test('glass is drawn in its own pass, at less than full opacity', () => {
  const mesh = buildMesh(
    room([{ kind: 'window', style: 'turn-tilt', width: 1385, sill: 900, head: 2100, offset: 2000 }]).project,
    {}
  );
  assert.ok(mesh.count > mesh.opaqueCount, 'there are see-through triangles');
  assert.equal(mesh.colors.length, mesh.count * 4, 'colours carry an alpha');
  const solid = [...mesh.colors.slice(0, mesh.opaqueCount * 4)].filter((_, i) => i % 4 === 3);
  const clear = [...mesh.colors.slice(mesh.opaqueCount * 4)].filter((_, i) => i % 4 === 3);
  assert.deepEqual([...new Set(solid)], [1], 'everything solid is opaque');
  assert.ok(clear.length > 0 && clear.every((a) => a > 0 && a < 1), 'and the glass is not');
});

test('a plain opening has nothing in it but the reveal', () => {
  const plain = buildMesh(room([{ kind: 'opening', style: 'plain', width: 1010 }]).project, {});
  const doorway = buildMesh(room([{ kind: 'door', style: 'single', width: 1010 }]).project, {});
  // Both cut the wall the same way, so the difference is the door itself.
  assert.ok(doorway.count > plain.count, 'a door is more than a hole');
  assert.equal(plain.count, plain.opaqueCount, 'and there is no glass in a plain opening');
});

test('the model has no NaN in it', () => {
  const mesh = buildMesh(
    room([
      { kind: 'door', style: 'double', width: 1510, offset: 700 },
      { kind: 'window', style: 'turn-tilt', width: 1385, sill: 900, head: 2100, offset: 3000 },
    ]).project,
    {}
  );
  assert.ok(![...mesh.positions].some(Number.isNaN));
  assert.ok(![...mesh.normals].some(Number.isNaN));
  assert.ok(![...mesh.colors].some(Number.isNaN));
});

test('a setting turned on comes back on after a save and load', () => {
  // Rebuilding `show` from a fixed list of keys threw away every toggle added
  // later, so this holds the door open for the next one.
  const plan = createPlan();
  plan.show.stairNumbers = true;
  plan.show.headroom = false;
  plan.show.somethingNew = true;
  const back = normaliseProject({ plans: [plan], activePlanId: plan.id }).plans[0];
  assert.equal(back.show.stairNumbers, true);
  assert.equal(back.show.headroom, false);
  assert.equal(back.show.somethingNew, true);
  assert.equal(back.show.rooms, true, 'and the ones that must have an answer still do');
});

// ---- what you can set --------------------------------------------------

test('the window board is as deep and as thick as it is told to be', async () => {
  const { boardOf } = await import('../src/app/opening3d.js');
  const base = window_('turn-tilt');
  assert.deepEqual(boardOf(base), { inner: 40, outer: 20, thickness: 30 }, 'the sizes one normally comes in');

  const boards = (over) => openingParts({ ...base, ...over }, 365, 2500).filter((p) => p.kind === 'sill');
  assert.equal(boards({}).length, 2, 'one inside, one out');
  assert.equal(boards({ boardInner: 0 }).length, 1, 'zero leaves that side off');
  assert.equal(boards({ boardInner: 0, boardOuter: 0 }).length, 0, 'and zero both leaves none');

  // A deeper board reaches further into the room.
  const deep = boards({ boardInner: 250 })[0];
  assert.equal(Math.round(Math.max(...deep.pts.map((p) => p.c))), Math.round(365 / 2 + 250));
  // A thicker one is deeper down from the sill.
  const thick = boards({ boardThickness: 80 })[0];
  assert.equal(Math.round(thick.z1 - thick.z0), 80);
});

test('nonsense in the board sizes falls back to the usual', async () => {
  const { boardOf } = await import('../src/app/opening3d.js');
  assert.deepEqual(boardOf({ boardInner: 'wide', boardOuter: null, boardThickness: undefined }), {
    inner: 40,
    outer: 20,
    thickness: 30,
  });
  assert.equal(boardOf({ boardInner: -50 }).inner, 0, 'and a negative board is no board');
});

test('an opening has a height, and setting it moves the head', async () => {
  const { openingHeight } = await import('../src/app/openings.js');
  assert.equal(openingHeight({ sill: 0, head: 2010 }), 2010, 'a door is as tall as its head');
  assert.equal(openingHeight({ sill: 900, head: 2100 }), 1200, 'a window is head less sill');
  // What the panel does when you type a height.
  const opening = { sill: 900, head: 2100 };
  const next = { ...opening, head: opening.sill + 1400 };
  assert.equal(openingHeight(next), 1400);
  assert.equal(next.sill, 900, 'and the sill stays put');
});

test('a taller window is taller in 3D', () => {
  const short = openingParts(window_('turn-tilt', { sill: 900, head: 2100 }), 365, 2600);
  const tall = openingParts(window_('turn-tilt', { sill: 900, head: 2500 }), 365, 2600);
  const top = (parts) => Math.max(...parts.map((p) => p.z1));
  assert.equal(top(tall) - top(short), 400);
  const glass = (parts) => parts.find((p) => p.kind === 'glass');
  assert.ok(glass(tall).z1 - glass(tall).z0 > glass(short).z1 - glass(short).z0, 'and so is its glass');
});

test('a wider door is wider in 3D', () => {
  const narrow = openingParts(door({ width: 760 }), 300, 2500);
  const wide = openingParts(door({ width: 1135 }), 300, 2500);
  const leafOf = (parts) => {
    const leaf = parts.find((p) => p.kind === 'leaf');
    const cs = leaf.pts.map((p) => p.c);
    return Math.max(...cs) - Math.min(...cs);
  };
  assert.equal(Math.round(leafOf(wide) - leafOf(narrow)), 1135 - 760, 'the leaf grows with the opening');
});

// ---- the stock, and what width means ------------------------------------

test('the width is the door and the hole is the door plus its stock', async () => {
  const { openingWidth, stockOf } = await import('../src/app/openings.js');
  const leaf = door({ width: 860 });
  assert.equal(stockOf(leaf), 30, 'a door lining, per side');
  assert.equal(openingWidth(leaf), 920);
  // Widen the stock and the hole grows; the door does not.
  const wide = door({ width: 860, stock: 60 });
  assert.equal(openingWidth(wide), 980);
  assert.equal(wide.width, 860);
  // A plain hole has no lining at all.
  assert.equal(stockOf({ kind: 'opening', width: 1000 }), 0);
  assert.equal(openingWidth({ kind: 'opening', width: 1000 }), 1000);
});

test('the leaf drawn is exactly the width asked for', async () => {
  const { leafLayout } = await import('../src/app/openings.js');
  for (const width of [610, 860, 1110]) {
    const layout = leafLayout(door({ width }), 300);
    assert.equal(Math.round(layout.length), width, `a ${width} door`);
  }
  // A pair splits the leaf between them.
  const double = leafLayout(door({ style: 'double', width: 1485 }), 300);
  assert.equal(double.leaves.length, 2);
  assert.equal(Math.round(double.length * 2), 1485);
});

test('a lining is drawn in the plan, in both reveals', async () => {
  const { openingSymbol } = await import('../src/app/openings.js');
  const rects = openingSymbol(door({ width: 860 }), 300).filter((i) => i.type === 'rect');
  assert.equal(rects.length, 2, 'one each side');
  for (const rect of rects) {
    assert.equal(Math.round(rect.a1 - rect.a0), 30, 'as wide as the stock');
    assert.ok(Math.abs(rect.c0) <= 150 && Math.abs(rect.c1) <= 150, 'inside the wall');
  }
  // No stock, no lining.
  assert.equal(openingSymbol({ ...door({ width: 860 }), stock: 0 }, 300).filter((i) => i.type === 'rect').length, 0);
});

// ---- windows open too ---------------------------------------------------

test('a casement has a sash, a fixed light does not', async () => {
  const { leafLayout } = await import('../src/app/openings.js');
  assert.equal(leafLayout(window_('turn-tilt', { width: 885 }), 300).leaves.length, 1);
  // Over a metre of glass it comes as a pair with a bar between them.
  assert.equal(leafLayout(window_('turn-tilt', { width: 1760 }), 300).leaves.length, 2);
  assert.equal(leafLayout(window_('fixed'), 300).leaves.length, 0);
  assert.equal(leafLayout({ kind: 'opening', style: 'plain', width: 1000 }, 300).leaves.length, 0);
});

test('a window is drawn shut and a door open, unless told otherwise', async () => {
  const { swingAngle } = await import('../src/app/openings.js');
  assert.equal(swingAngle({ kind: 'door' }), 90);
  assert.equal(swingAngle({ kind: 'window' }), 0, 'a facade of open casements reads as a mistake');
  assert.equal(swingAngle({ kind: 'window', swingAngle: 75 }), 75);
});

test('the glass swings with the sash', () => {
  // One sash, so the pane is the whole opening rather than half of it.
  const single = (angle) => window_('turn-tilt', { width: 885, swingAngle: angle });
  const shut = openingParts(single(0), 365, 2600).find((p) => p.kind === 'glass');
  const open = openingParts(single(80), 365, 2600).find((p) => p.kind === 'glass');
  const across = (part) => {
    const cs = part.pts.map((p) => p.c);
    return Math.max(...cs) - Math.min(...cs);
  };
  assert.ok(across(shut) < 20, 'shut, the pane lies in the opening');
  assert.ok(across(open) > 500, 'open, it stands out into the room with the sash');
});

test('a shut leaf never stands proud of the wall, whichever way it is hung', () => {
  for (const thickness of [115, 300]) {
    for (const over of [{}, { hinge: 'end' }, { swing: 'out' }, { style: 'double', width: 1485 }]) {
      const opening = door({ width: 860, swingAngle: 0, ...over });
      const parts = openingParts(opening, thickness, 2500).filter((p) => p.kind === 'leaf');
      for (const part of parts) {
        for (const p of part.pts) {
          assert.ok(
            Math.abs(p.c) <= thickness / 2 + 0.5,
            `${thickness} wall ${JSON.stringify(over)}: leaf at c=${Math.round(p.c)}`
          );
        }
      }
    }
  }
});

test('the plan arc sweeps as far as the leaf actually opens', async () => {
  const { openingSymbol } = await import('../src/app/openings.js');
  for (const angle of [30, 90, 135]) {
    const arc = openingSymbol(door({ width: 860, swingAngle: angle }), 300).find((i) => i.type === 'arc');
    assert.equal(Math.round((-arc.sweep * 180) / Math.PI), angle, `at ${angle}°`);
    // The open end of the arc is where the leaf's free edge is.
    const radius = Math.hypot(arc.fromA - arc.hinge, arc.fromC - arc.hingeC);
    assert.equal(Math.round(radius), 860);
  }
});

test('the symbol is laid out along the hole, whatever the stock', async () => {
  const { openingSymbol, openingWidth } = await import('../src/app/openings.js');
  for (const stock of [0, 30, 60, 115]) {
    const opening = door({ width: 860, stock });
    const hole = openingWidth(opening);
    const symbol = openingSymbol(opening, 300);

    // The two reveals are the two ends of the hole.
    const reveals = symbol
      .filter((i) => i.type === 'line' && Math.abs(i.a1 - i.a2) < 1 && Math.abs(i.c1 + i.c2) < 1)
      .map((i) => Math.round(i.a1))
      .sort((a, b) => a - b);
    assert.deepEqual(reveals, [0, Math.round(hole)], `stock ${stock}: reveals`);

    // The linings sit inside them, one stock wide each.
    const rects = symbol.filter((i) => i.type === 'rect').sort((a, b) => a.a0 - b.a0);
    if (stock === 0) {
      assert.equal(rects.length, 0, 'no stock, no lining');
    } else {
      assert.equal(rects.length, 2);
      assert.equal(Math.round(rects[0].a0), 0);
      assert.equal(Math.round(rects[0].a1), stock);
      assert.equal(Math.round(rects[1].a0), Math.round(hole - stock));
      assert.equal(Math.round(rects[1].a1), Math.round(hole));
    }

    // And the arc is the door, not the hole, however wide the lining is.
    const arc = symbol.find((i) => i.type === 'arc');
    const radius = Math.hypot(arc.fromA - arc.hinge, arc.fromC - arc.hingeC);
    assert.equal(Math.round(radius), 860, `stock ${stock}: the arc must stay the door`);
    assert.equal(Math.round(arc.hinge), stock, 'hinged on the inside of the lining');
  }
});

test('a window symbol spans its hole too', async () => {
  const { openingSymbol, openingWidth } = await import('../src/app/openings.js');
  const opening = window_('turn-tilt', { width: 885, stock: 60 });
  const hole = openingWidth(opening);
  const across = openingSymbol(opening, 300)
    .filter((i) => i.type === 'line')
    .flatMap((i) => [i.a1, i.a2]);
  assert.equal(Math.round(Math.max(...across)), Math.round(hole));
  assert.equal(Math.round(Math.min(...across)), 0);
});

test('the 3D parts fill the hole and stay inside it', () => {
  // The frame is built on the hole, the leaves are laid out on the hole, and the two
  // have to agree — build the frame on the leaf width instead and the jambs stand
  // short of the reveal while the leaves hang out past them into the masonry.
  const cases = [
    door({ stock: 30 }),
    door({ stock: 90 }),
    door({ style: 'double', width: 1610, stock: 40 }),
    window_('turn-tilt', { width: 1385, stock: 60 }),
    window_('turn-tilt', { width: 885, stock: 100 }),
    window_('fixed', { width: 1010, stock: 60 }),
  ];
  for (const opening of cases) {
    const hole = openingWidth(opening);
    const parts = openingParts(opening, 365, 2750);
    const jambs = parts.filter((p) => p.kind === 'frame' || p.kind === 'glass' || p.kind === 'bar');
    const along = jambs.flatMap((p) => p.pts.map((q) => q.a));
    assert.ok(
      Math.min(...along) >= -1,
      `${opening.kind} ${opening.style}: something starts before the near jamb`
    );
    assert.ok(
      Math.max(...along) <= hole + 1,
      `${opening.kind} ${opening.style}: something runs ${Math.round(
        Math.max(...along) - hole
      )} mm past the far jamb of a ${hole} mm hole`
    );
    // And the frame reaches both jambs, rather than leaving a gap at the reveal.
    const frame = parts.filter((p) => p.kind === 'frame').flatMap((p) => p.pts.map((q) => q.a));
    assert.equal(Math.round(Math.min(...frame)), 0, 'the frame starts at the near jamb');
    assert.equal(Math.round(Math.max(...frame)), Math.round(hole), 'and finishes at the far one');
  }
});

test('a shut leaf is the door, and the lining makes up the rest', () => {
  // What the user gets told the door is has to be what swings: 860 stays 860 whatever
  // the lining round it is set to.
  for (const stock of [20, 30, 60, 115]) {
    const opening = door({ width: 860, stock });
    const parts = openingParts(opening, 115, 2750);
    const leaf = parts.find((p) => p.kind === 'leaf');
    const span = Math.hypot(leaf.pts[1].a - leaf.pts[0].a, leaf.pts[1].c - leaf.pts[0].c);
    assert.equal(Math.round(span), 860, `stock ${stock}: the leaf must stay the door`);
  }
});

test('glazing sits within its sash, not on the face of it', () => {
  const parts = openingParts(window_('turn-tilt', { width: 1385, stock: 60 }), 365, 2750);
  const glass = parts.filter((p) => p.kind === 'glass');
  assert.ok(glass.length, 'a casement is glazed');
  const sashAcross = parts
    .filter((p) => p.kind === 'frame')
    .flatMap((p) => p.pts.map((q) => q.c));
  for (const pane of glass) {
    const across = pane.pts.map((q) => q.c);
    // Strictly inside: a pane flush with the stiles shares a plane with them, and two
    // surfaces in one plane fight over which is in front.
    assert.ok(Math.min(...across) > Math.min(...sashAcross), 'the pane is bedded in');
    assert.ok(Math.max(...across) < Math.max(...sashAcross), 'on both faces');
  }
});

test('a window frame is a frame, not the whole wall', () => {
  // Filling the wall's thickness made a 365 wall read as a deep white tunnel with a
  // mullion to match. A window frame is a slab of its own set into the reveal; the
  // masonry either side of it is what the board inside covers.
  for (const t of [240, 300, 365, 490]) {
    const parts = openingParts(window_('turn-tilt', { width: 1385, stock: 60, sill: 900 }), t, 2750);
    const frame = parts.filter((p) => p.kind === 'frame' || p.kind === 'bar');
    const across = frame.flatMap((p) => p.pts.map((q) => q.c));
    const depth = Math.max(...across) - Math.min(...across);
    assert.ok(depth < 120, `wall ${t}: a ${Math.round(depth)} mm deep frame is a tunnel`);
    assert.ok(depth > 40, `wall ${t}: and ${Math.round(depth)} mm is not a frame either`);
    assert.ok(Math.min(...across) >= -t / 2 - 1, 'it stays inside the wall');
    assert.ok(Math.max(...across) <= t / 2 + 1, 'at both faces');
  }
});

test('a door lining wraps the whole reveal', () => {
  // The opposite case: an Umfassungszarge does run the full thickness, and a lining
  // that stopped short would leave a strip of bare wall down each side of the door.
  const t = 115;
  const parts = openingParts(door({ width: 860, stock: 30 }), t, 2750);
  const across = parts.filter((p) => p.kind === 'frame').flatMap((p) => p.pts.map((q) => q.c));
  assert.ok(Math.max(...across) > t / 2 - 5, 'the lining reaches the room face');
  assert.ok(Math.min(...across) < -t / 2 + 5, 'and the other one');
  // But not dead flush, or it shares a plane with the wall and they fight over it.
  assert.ok(Math.max(...across) < t / 2, 'without sharing the wall face');
});

test('a fixed light is glazed into its frame, not the middle of the wall', () => {
  const parts = openingParts(window_('fixed', { width: 1010, stock: 60, sill: 900 }), 365, 2750);
  const frame = parts.filter((p) => p.kind === 'frame').flatMap((p) => p.pts.map((q) => q.c));
  const glass = parts.filter((p) => p.kind === 'glass').flatMap((p) => p.pts.map((q) => q.c));
  assert.ok(glass.length, 'a fixed light still has glass in it');
  assert.ok(Math.min(...glass) > Math.min(...frame), 'the pane sits within the frame');
  assert.ok(Math.max(...glass) < Math.max(...frame), 'on both faces');
});

test('the outlines are the boundaries of the building, not a wireframe of it', () => {
  // A wall is a prism, a corner is two prisms mitred together, and a wall with a door
  // in it is three. Outlining each one as it is built draws the joints: a diagonal
  // across every corner where the two mitred tops meet, a seam up the wall beside
  // every door. None of those is a fold in the surface, so none should be drawn.
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 365 });
  touch(plan);
  const mesh = buildMesh(project, {});

  let vertical = 0;
  let level = 0;
  let diagonal = 0;
  for (let i = 0; i < mesh.lineCount; i += 2) {
    const dx = mesh.lines[(i + 1) * 3] - mesh.lines[i * 3];
    const dy = mesh.lines[(i + 1) * 3 + 1] - mesh.lines[i * 3 + 1];
    const dz = mesh.lines[(i + 1) * 3 + 2] - mesh.lines[i * 3 + 2];
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) vertical += 1;
    else if (Math.abs(dz) < 1) level += 1;
    else diagonal += 1;
  }
  assert.equal(diagonal, 0, 'a rectangular room has nothing running on the skew');
  assert.equal(vertical, 8, 'four corners outside and four in, and no mitre lines');
});

test('a door does not draw a seam up the wall it is in', () => {
  // The wall is built as the piece each side of the door and the lintel over it. They
  // are the same wall and the same flat face, so the joins between them are not edges.
  const project = createProject();
  const plan = activePlan(project);
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 300 });
  touch(plan);
  const bare = buildMesh(project, {}).lineCount;

  const wall = plan.walls[0];
  addOpening(plan, wall.id, 2000, { kind: 'door', width: 860 });
  touch(plan);
  const withDoor = buildMesh(project, {});

  // The door adds its own reveal, lining and leaf. What it must not add is a pair of
  // full-height lines where the wall was cut, nor a line along the top of the lintel.
  const jamb = [];
  for (let i = 0; i < withDoor.lineCount; i += 2) {
    const a = [0, 1, 2].map((k) => withDoor.lines[i * 3 + k]);
    const b = [0, 1, 2].map((k) => withDoor.lines[(i + 1) * 3 + k]);
    const full = Math.min(a[2], b[2]) < 1 && Math.max(a[2], b[2]) > 2400;
    if (full && Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1) jamb.push(a);
  }
  // The only full-height verticals left are the building's own eight corners.
  assert.equal(jamb.length, 8, `a full-height line at each corner and nowhere else`);
  assert.ok(withDoor.lineCount > bare, 'the door itself is still outlined');
});

test('a wall between you and a figure hides it', () => {
  // The measurements over the 3D view are painted on a canvas above the model, which
  // knows nothing about what is in front of what. Left alone, a figure inside a room
  // reads straight through the wall you are looking at.
  const quad = [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 300 },
    { x: 0, y: 300 },
  ];
  const eye = [2000, -5000, 1600];
  // Straight through the middle of it.
  assert.equal(segmentBlocked(quad, 0, 2500, eye, [2000, 3000, 1600]), true);
  // Over the top of it, and round the end of it.
  assert.equal(segmentBlocked(quad, 0, 2500, eye, [2000, 3000, 9000]), false);
  assert.equal(segmentBlocked(quad, 0, 2500, eye, [9000, 3000, 1600]), false);
  // A knee wall only reaches so far up, and you see over it.
  assert.equal(segmentBlocked(quad, 0, 900, eye, [2000, 3000, 1600]), false);
  // And something on the near face of it is not hidden by it.
  assert.equal(segmentBlocked(quad, 0, 2500, eye, [2000, -60, 1600]), false);
});

test('the plan and the chain say the same thing about one window', () => {
  // A window has two widths: the leaf you order and the hole the bricklayer leaves.
  // Both are worth knowing, but the figure written at the opening has to be the one
  // the dimension chain beside it measures, or the same window carries two different
  // numbers on the same sheet and a joiner cannot tell which is which.
  const opening = { ...defaultsFor('window', 'turn-tilt'), width: 1385, stock: 60, sill: 900, head: 2100 };
  const hole = openingWidth(opening);
  assert.equal(hole, 1505, 'the leaf plus its lining each side');
  assert.notEqual(hole, opening.width, 'and it is not the leaf');

  // Whatever the annotation is built from, it must start from the same number the
  // chain does. The chain measures between the reveals, which is `openingWidth`.
  const across = openingSymbol(opening, 365)
    .filter((i) => i.type === 'line')
    .flatMap((i) => [i.a1, i.a2]);
  assert.equal(Math.round(Math.max(...across)), hole, 'the symbol spans the hole');

  // And the leaf is still recoverable, because it is what gets ordered.
  assert.equal(opening.width, 1385);
});


test('the plan draws the glass, not how the window opens', () => {
  // The DIN opening mark belongs in the elevation, where the hinge axis it points at
  // is visible. Laid over a plan it is a full-width bowtie across the glazing lines,
  // and the window turns to noise — so a shut window is the same drawing whichever
  // way it opens, which is what a real Grundriss does.
  const shut = (style) => JSON.stringify(openingSymbol(window_(style, { width: 885 }), 365));
  assert.equal(shut('turn'), shut('tilt'), 'a Dreh and a Kipp are the same drawing when shut');
  assert.equal(shut('turn'), shut('turn-tilt'));
  assert.notEqual(shut('turn'), shut('fixed'), 'but a fixed light has no sash to draw');
  assert.equal(
    shut('turn'),
    JSON.stringify(openingSymbol(window_('turn', { width: 885, hinge: 'end' }), 365)),
    'and which end it is hung on does not show until it is open'
  );

  // Nothing a window draws leaves the wall it sits in.
  const across = openingSymbol(window_('turn-tilt', { width: 885 }), 365)
    .flatMap((i) => [i.c1, i.c2, i.c0])
    .filter(Number.isFinite);
  assert.ok(Math.max(...across.map(Math.abs)) <= 365 / 2 + 0.5);
});

test('only a sash on side hinges swings, and only when it is open', () => {
  const swung = (style, angle) =>
    openingSymbol(window_(style, { width: 885, swingAngle: angle }), 365).filter((i) => i.type === 'arc');
  assert.equal(swung('turn', 0).length, 0, 'shut, there is nothing to sweep');
  assert.equal(swung('turn', 90).length, 1, 'open, the sash sweeps like a leaf');
  assert.equal(swung('tilt', 90).length, 0, 'a Kippflügel does not turn, whatever it is set to');
  assert.equal(swung('fixed', 90).length, 0);
});

test('a tilt sash is built shut in 3D, because it cannot lean', () => {
  // Everything in the model is a prism standing square, so a sash leaning in at the
  // head has nothing to be built from. It is drawn shut, and the panel says so.
  const parts = (style) => openingParts(window_(style, { width: 885, swingAngle: 90 }), 365, 2500);
  // The sash only — a window board stands out into the room by design.
  const reach = (style) =>
    Math.max(...parts(style).filter((p) => p.kind !== 'sill').flatMap((p) => p.pts.map((q) => q.c)));
  assert.ok(reach('turn') > 365 / 2, 'a Dreh sash stands out into the room');
  assert.ok(reach('tilt') <= 365 / 2 + 1, 'a Kipp sash stays in the wall');
});

test('an arc ends where the leaf shuts, whichever jamb it is hung on', () => {
  // The arc is drawn from the open leaf by turning through `sweep`, so `sweep` has to
  // land on the shut leaf. Fixed at minus the angle it only did for a leaf hung on the
  // near jamb opening inward: the second leaf of a pair swept the opposite way and
  // finished out past its own hinge, on the wrong side of the window.
  const swept = (arc) => {
    const da = arc.fromA - arc.hinge;
    const dc = arc.fromC - (arc.hingeC ?? 0);
    const cos = Math.cos(arc.sweep);
    const sin = Math.sin(arc.sweep);
    return { a: arc.hinge + da * cos - dc * sin, c: (arc.hingeC ?? 0) + da * sin + dc * cos };
  };

  const cases = [];
  for (const base of [door({ width: 885 }), door({ style: 'double', width: 1510 }), window_('turn-tilt', { width: 1385 }), window_('french', { width: 1610 })]) {
    for (const hinge of ['start', 'end']) {
      for (const swing of ['in', 'out']) {
        cases.push({ ...base, hinge, swing, swingAngle: 70 });
      }
    }
  }

  for (const opening of cases) {
    const arcs = openingSymbol(opening, 300).filter((i) => i.type === 'arc');
    assert.ok(arcs.length, `${opening.style}/${opening.hinge}/${opening.swing}: no arc`);
    for (const arc of arcs) {
      const end = swept(arc);
      const off = Math.hypot(end.a - arc.toA, end.c - arc.toC);
      assert.ok(off < 1, `${opening.style}/${opening.hinge}/${opening.swing}: arc ends ${off.toFixed(0)} mm from the shut leaf`);
    }
  }
});

// ---- which way a finish runs -------------------------------------------

test('a floor is laid along its room, not along the page', () => {
  // Boards set out on the page run across a room that is turned, and every joint meets
  // a wall at an angle. Nobody lays a floor that way.
  const roomAt = (deg) => {
    const a = (deg * Math.PI) / 180;
    const at = (x, y) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    const corners = [at(0, 0), at(5000, 0), at(5000, 4000), at(0, 4000)];
    const project = createProject();
    const plan = activePlan(project);
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % 4];
      addWall(plan, p[0], p[1], q[0], q[1], { type: 'exterior', thickness: 300 });
    }
    touch(plan);
    // Boards, so the floor carries a pattern that has a direction at all.
    for (const room of derived(plan).rooms) {
      plan.roomMeta = plan.roomMeta ?? [];
      const meta = roomMetaFor(plan, room);
      if (meta) meta.floor = 'oak';
    }
    touch(plan);
    return project;
  };

  // The third float of each vertex's surface is the direction its finish runs in.
  const turns = (project) => {
    const mesh = buildMesh(project);
    const seen = new Set();
    for (let i = 0; i < mesh.surfaces.length; i += 3) {
      // Only the floor carries a pattern; everything else is flat and has no direction.
      if (mesh.surfaces[i] === 0) continue;
      seen.add(Math.round(((mesh.surfaces[i + 2] * 180) / Math.PI) * 10) / 10);
    }
    return [...seen];
  };

  assert.deepEqual(turns(roomAt(0)), [0], 'square to the page, the boards run along it');
  assert.deepEqual(turns(roomAt(15)), [15], 'turned fifteen degrees, so do the boards');
  assert.deepEqual(turns(roomAt(33)), [33]);
});
