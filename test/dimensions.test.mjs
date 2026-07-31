import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAIN_KINDS,
  allChains,
  angleLabel,
  cornerAngles,
  autoChains,
  chainGeometry,
  chainMentions,
  dimLabel,
  dimText,
  interiorChains,
} from '../src/app/dimensions.js';
import {
  addOpening,
  addRoomRect,
  addWall,
  createPlan,
  derived,
  findNode,
  healJunctions,
  touch,
  wallCorners,
  wallEnds,
  wallLengths,
} from '../src/app/model.js';
import { openingWidth } from '../src/app/openings.js';

function house({ width = 9000, depth = 6000, thickness = 300 } = {}) {
  const plan = createPlan();
  addRoomRect(plan, 0, 0, width, depth, { type: 'exterior', thickness });
  touch(plan);
  const on = (test) => plan.walls.find((w) => test(findNode(plan, w.a), findNode(plan, w.b)));
  return { plan, top: on((a, b) => Math.abs(a.y) < 1 && Math.abs(b.y) < 1) };
}

const northOf = (plan) => autoChains(plan).filter((c) => c.side === 'north');
/** The chain nearest the building — the detailed one, whatever it ended up called. */
const innermost = (plan) =>
  northOf(plan).sort((a, b) => Math.abs(a.at - a.edge) - Math.abs(b.at - b.edge))[0];
const readsAs = (chain) => chain.segments.map((s) => dimLabel(s.length));

// ---- the figures --------------------------------------------------------

test('a figure is written the way a German plan writes it', () => {
  // Metres to two places, with the millimetre raised.
  assert.deepEqual(dimText(4185), { main: '4,18', sup: '5' });
  assert.equal(dimLabel(4185), '4,18⁵');
  assert.equal(dimLabel(11740), '11,74');
  assert.equal(dimLabel(1750), '1,75');
  // Under a metre it is centimetres, not 0,24.
  assert.deepEqual(dimText(248), { main: '24', sup: '8' });
  assert.equal(dimLabel(248), '24⁸');
  assert.equal(dimLabel(300), '30');
  assert.equal(dimLabel(905), '90⁵');
  // A round metre carries no superscript at all.
  assert.equal(dimLabel(5000), '5,00');
  assert.equal(dimLabel(0), '0');
});

// ---- the chains ---------------------------------------------------------

test('a bare box gets one chain per side, and they agree with each other', () => {
  const { plan } = house();
  const chains = autoChains(plan);
  const sides = new Set(chains.map((c) => c.side));
  assert.equal(sides.size, 4, 'all four elevations');
  for (const chain of chains) {
    const total = chain.segments.reduce((sum, s) => sum + s.length, 0);
    assert.equal(Math.round(total), Math.round(chain.to - chain.from), `${chain.side}/${chain.kind} adds up`);
  }
});

test('the overall chain is the outside of the building, wall faces and all', () => {
  const { plan } = house({ width: 9000, depth: 6000, thickness: 300 });
  const overall = northOf(plan).find((c) => c.kind === 'overall');
  assert.ok(overall);
  assert.equal(overall.segments.length, 1);
  // 9000 between the centre lines, plus half a wall at each end.
  assert.equal(Math.round(overall.segments[0].length), 9300);
  assert.equal(readsAs(overall)[0], '9,30');
});

test('the structural chain divides at the faces of the walls that cross it', () => {
  const { plan } = house({ thickness: 300 });
  // The two returns, then the clear span between them: 30 / 8,70 / 30.
  assert.deepEqual(readsAs(innermost(plan)), ['30', '8,70', '30']);
});

test('a partition meeting the facade shows up as its own bay', () => {
  const { plan } = house({ thickness: 300 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const chain = innermost(plan);
  assert.equal(chain.segments.length, 5, '30 / bay / 17,5 / bay / 30');
  assert.deepEqual(readsAs(chain), ['30', '3,76³', '17⁵', '4,76³', '30']);
});

test('the openings chain adds every window and the piers between them', () => {
  const { plan, top } = house({ thickness: 300 });
  addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  addOpening(plan, top.id, 6000, { kind: 'window', width: 1010 });
  touch(plan);
  const openings = northOf(plan).find((c) => c.kind === 'openings');
  const bays = northOf(plan).find((c) => c.kind === 'bays');
  assert.ok(bays, 'with openings present the structural chain is worth drawing on its own');
  assert.ok(openings.segments.length > bays.segments.length, 'it says more than the structural one');
  // Both window holes appear as segments of their own.
  const lengths = openings.segments.map((s) => Math.round(s.length));
  assert.ok(lengths.includes(1385 + 120), `1505 among ${lengths.join(', ')}`);
  assert.ok(lengths.includes(1010 + 120), `1130 among ${lengths.join(', ')}`);
});

test('a chain that repeats the one inside it is not drawn twice', () => {
  // With no openings the structural chain says exactly what the openings one does,
  // so only one of them is drawn — a plan does not stack identical chains.
  const { plan } = house();
  const north = northOf(plan);
  const signatures = north.map((c) => c.divisions.join('|'));
  assert.equal(new Set(signatures).size, signatures.length, 'no two chains are the same');
  assert.equal(north.length, 2, 'the detail chain and the overall');
});

test('the chains stand off the building, each further than the last', () => {
  const { plan, top } = house({ thickness: 300 });
  addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  touch(plan);
  const north = northOf(plan).sort((a, b) => b.at - a.at);
  for (let i = 1; i < north.length; i++) {
    assert.ok(north[i].at < north[i - 1].at, 'each one is further out');
  }
  assert.ok(north[0].at < -150, 'and all of them are clear of the wall');
});

test('a drawing with nothing in it has nothing to dimension', () => {
  assert.deepEqual(autoChains(createPlan()), []);
  const one = createPlan();
  addWall(one, 0, 0, 4000, 0, { thickness: 300 });
  touch(one);
  assert.deepEqual(autoChains(one), [], 'one wall is not a building');
});

test('only the chains asked for are made', () => {
  const { plan } = house();
  const only = autoChains(plan, { kinds: ['overall'] });
  assert.ok(only.length > 0);
  assert.ok(only.every((c) => c.kind === 'overall'));
  assert.equal(CHAIN_KINDS.length, 4, 'three outside and one within');
});

// ---- what gets drawn ----------------------------------------------------

test('a chain hands over a line, its ticks and a figure per bay', () => {
  const { plan } = house({ thickness: 300 });
  const chain = innermost(plan);
  const geo = chainGeometry(chain);
  assert.equal(geo.ticks.length, chain.divisions.length);
  assert.equal(geo.labels.length, chain.segments.length);
  assert.equal(geo.extensions.length, chain.divisions.length);
  // The line runs along the chain's own axis, out at its standoff.
  assert.equal(geo.line.a.y, chain.at);
  assert.equal(geo.line.b.y, chain.at);
  assert.ok(geo.line.b.x > geo.line.a.x);
  // Every witness line runs from the point it measures out to the chain — the face of
  // the building for the ends of it, the far side of a return where that is what the
  // figure is set out from.
  for (const ext of geo.extensions) {
    assert.equal(ext.b.y, chain.at, 'and reaches the chain');
    assert.ok(
      Math.abs(ext.a.y - chain.edge) <= 300,
      `starts ${Math.round(ext.a.y - chain.edge)} from the face, which is more than a wall`
    );
  }
});

// ---- the walls within ---------------------------------------------------

test('a door in a partition is dimensioned along its own wall', () => {
  const { plan } = house({ width: 9000, depth: 6000, thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const partition = plan.walls.find((w) => w.thickness === 175);
  addOpening(plan, partition.id, 4200, { kind: 'door', width: 860 });
  touch(plan);

  const inside = interiorChains(plan);
  assert.equal(inside.length, 1, 'one chain, along the wall the door is in');
  const chain = inside[0];
  assert.equal(chain.kind, 'inside');
  assert.equal(chain.axis, 'y', 'it runs the way the wall runs');
  // The door reads as its hole, 860 plus its stock.
  const door = chain.segments.find((s) => Math.round(s.length) === 920);
  assert.ok(door, 'the door has a figure of its own');
  assert.equal(dimLabel(door.length), '92');
  // And it spans the building, like every other chain, so the figures line up.
  assert.equal(Math.round(chain.to - chain.from), 6365);
});

test('a partition is measured between the walls it meets, not their centres', () => {
  // Walls share nodes on their centrelines, so end to end this partition is 6,00 m.
  // Nobody builds that: 5,63⁵ between the faces of the outer walls is what gets
  // built, and setting a door out from the centre of a 365 wall is 182 mm wrong.
  const { plan } = house({ width: 9000, depth: 6000, thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const partition = plan.walls.find((w) => w.thickness === 175);
  addOpening(plan, partition.id, 3000, { kind: 'door', width: 860 });
  touch(plan);

  const chain = interiorChains(plan)[0];
  const own = chain.segments.filter((s) => s.owns.includes(partition.id));
  assert.equal(own.length, 0, 'the wall does not measure itself along its own length');
  // The chain reads: outer wall, to the door, the door, to the far wall, outer wall.
  assert.deepEqual(readsAs(chain), ['36⁵', '2,35⁸', '92', '2,35⁸', '36⁵']);
  // The two setting-out figures are equal, which they only are off the faces —
  // measured from the nodes they would come out 182 mm apart.
  const [, before, , afterDoor] = chain.segments;
  assert.ok(Math.abs(before.length - afterDoor.length) < 2, 'the door is central in the clear span');
  // And the clear span itself is the wall between the faces.
  assert.equal(Math.round(before.length + 920 + afterDoor.length), 5635);
});

test('an outside wall is left to the elevation chains', () => {
  const { plan, top } = house({ thickness: 365 });
  addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  touch(plan);
  assert.deepEqual(interiorChains(plan), [], 'its openings are already on the north chain');
});

test('a partition with nothing in it gets no chain', () => {
  const { plan } = house();
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  assert.deepEqual(interiorChains(plan), [], 'there is nothing to set out');
});

test('the interior chain goes out on the paper, never across a room', () => {
  const { plan } = house({ width: 9000, depth: 6000, thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const partition = plan.walls.find((w) => w.thickness === 175);
  addOpening(plan, partition.id, 3000, { kind: 'door', width: 860 });
  touch(plan);

  const chain = interiorChains(plan)[0];
  assert.ok(chain.at < -182.5, 'clear of the building altogether');
  assert.equal(chain.side, 'west', 'on the side it runs parallel to');
  // Only the witness lines come inside, and they start at the wall so the figure
  // points at what it measures.
  assert.equal(Math.abs(chain.edge - 4000), 175 / 2);
});

test('the interior chains stack behind the elevation chains, not over them', () => {
  const { plan } = house({ width: 9000, depth: 6000, thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const partition = plan.walls.find((w) => w.thickness === 175);
  addOpening(plan, partition.id, 3000, { kind: 'door', width: 860 });
  touch(plan);

  const chains = allChains(plan);
  const west = chains.filter((c) => c.side === 'west');
  assert.ok(west.length > 1, 'there is a stack to get behind');
  const inside = west.find((c) => c.kind === 'inside');
  const others = west.filter((c) => c.kind !== 'inside');
  assert.ok(
    others.every((c) => inside.at < c.at),
    'the interior chain is the outermost of them'
  );
  // No two chains on that side sit on the same line.
  const places = west.map((c) => Math.round(c.at));
  assert.equal(new Set(places).size, places.length);
});

test('everything together is the elevations plus the walls within', () => {
  const { plan, top } = house({ thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  const partition = plan.walls.find((w) => w.thickness === 175);
  addOpening(plan, partition.id, 3000, { kind: 'door', width: 860 });
  touch(plan);

  const all = allChains(plan);
  assert.ok(all.some((c) => c.kind === 'inside'), 'the partition is in there');
  assert.ok(all.some((c) => c.side === 'north'), 'and so is the elevation');
  // Asking for fewer gets fewer.
  const outsideOnly = allChains(plan, { kinds: ['overall'] });
  assert.ok(outsideOnly.every((c) => c.kind === 'overall'));
});

// ---- what a chain is about ---------------------------------------------

test('a figure knows what it measures and what it is set out from', () => {
  const { plan, top } = house({ thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const window = addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  touch(plan);

  const chain = northOf(plan).find((c) => c.kind === 'openings');
  const own = chain.segments.find((s) => s.owns.includes(window.id));
  assert.ok(own, 'the window has a figure of its own');
  assert.equal(Math.round(own.length), openingWidth(window), 'and it is the hole');

  // The piers either side are set out from it without being it.
  const piers = chain.segments.filter((s) => s.touches.includes(window.id) && !s.owns.includes(window.id));
  assert.equal(piers.length, 2, 'a pier each side');

  // The partition crossing the facade owns the figure between its own two faces.
  const partition = plan.walls.find((w) => w.thickness === 175);
  const thickness = chain.segments.find((s) => s.owns.includes(partition.id));
  assert.ok(thickness, 'the crossing wall has a figure of its own');
  assert.equal(Math.round(thickness.length), 175, 'and it is its thickness');
});

test('hovering something finds the chains that mention it', () => {
  const { plan, top } = house({ thickness: 365 });
  addWall(plan, 4000, 0, 4000, 6000, { type: 'bearing', thickness: 175 });
  healJunctions(plan);
  touch(plan);
  const window = addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  const partition = plan.walls.find((w) => w.thickness === 175);
  const door = addOpening(plan, partition.id, 3000, { kind: 'door', width: 860 });
  touch(plan);
  const chains = allChains(plan);

  // The window is measured on the elevation it is in, and nowhere else.
  const forWindow = chains.filter((c) => chainMentions(c, window.id) === 'owns');
  assert.equal(forWindow.length, 1);
  assert.equal(forWindow[0].side, 'north');

  // The door is in a partition, so it is measured on the chain along that wall.
  const forDoor = chains.filter((c) => chainMentions(c, door.id) === 'owns');
  assert.equal(forDoor.length, 1);
  assert.equal(forDoor[0].kind, 'inside');

  // A wall of the facade answers for the whole stack of chains on that side.
  const elevation = chains.filter((c) => chainMentions(c, top.id) === 'elevation');
  assert.ok(elevation.length >= 2, 'every chain on that face');
  assert.ok(elevation.every((c) => c.side === 'north'));

  // And nothing at all is mentioned when nothing is hovered.
  assert.ok(chains.every((c) => chainMentions(c, null) === null));
});

test('two divisions in the same place answer for both of the things there', () => {
  // A door hard against a partition puts its reveal and the wall's face together.
  // Merged into one division, that point has to still belong to both, or hovering
  // one of them loses its witness line.
  const { plan, top } = house({ thickness: 365 });
  const window = addOpening(plan, top.id, 2000, { kind: 'window', width: 1385 });
  touch(plan);
  const chain = northOf(plan).find((c) => c.kind === 'openings');
  const geo = chainGeometry(chain);
  assert.equal(geo.ticks.length, chain.divisions.length);
  const owned = geo.ticks.filter((t) => t.owners.includes(window.id));
  assert.equal(owned.length, 2, 'a witness line at each reveal');
  assert.equal(geo.extensions.filter((e) => e.owners.includes(window.id)).length, 2);
});

// ---- a drawing on a skew ----------------------------------------------

test('chains follow the walls, not the page, when the building is turned', () => {
  // The case from the drawing: a whole room turned fifteen degrees. Measured on the
  // page's own axes, each chain carries the shadow of a wall on an axis it does not run
  // along — a 4,50 wall reading 3,59 — and the two side chains, being shadows of the
  // same thing, print the same figures twice.
  const turn = (deg) => {
    const a = (deg * Math.PI) / 180;
    const plan = createPlan();
    const at = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
    const corners = [at(0, 0), at(4500, 0), at(4500, 3400), at(0, 3400)];
    for (let i = 0; i < 4; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % 4];
      addWall(plan, p.x, p.y, q.x, q.y, { type: 'exterior', thickness: 365 });
    }
    touch(plan);
    return plan;
  };

  // One overall chain per side, so the two spans each appear twice.
  const overall = (plan) => [
    ...new Set(
      allChains(plan, {})
        .filter((c) => c.kind === 'overall')
        .map((c) => Math.round(Math.abs(c.to - c.from)))
    ),
  ].sort((p, q) => p - q);

  const square = overall(turn(0));
  const skewed = overall(turn(15));
  assert.deepEqual(skewed, square, `turned it reads ${skewed}, square it reads ${square}`);
  // And the figures are the building, outside faces included: 4500 and 3400 centre to
  // centre plus a wall thickness each way.
  assert.deepEqual(square, [3400 + 365, 4500 + 365]);
});

test('a chain is drawn where it is measured, however the drawing is turned', () => {
  const a = (33 * Math.PI) / 180;
  const plan = createPlan();
  const at = (x, y) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const corners = [at(0, 0), at(5000, 0), at(5000, 3000), at(0, 3000)];
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    addWall(plan, p.x, p.y, q.x, q.y, { type: 'exterior', thickness: 300 });
  }
  touch(plan);

  for (const chain of allChains(plan, {})) {
    const geo = chainGeometry(chain);
    // The drawn line is as long as the chain says it is — which it would not be if the
    // ends were read as x and y on a drawing that is not square to them.
    const drawn = Math.hypot(geo.line.b.x - geo.line.a.x, geo.line.b.y - geo.line.a.y);
    assert.ok(
      Math.abs(drawn - Math.abs(chain.to - chain.from)) < 1,
      `${chain.side}/${chain.kind}: drawn ${Math.round(drawn)} for a span of ${Math.round(Math.abs(chain.to - chain.from))}`
    );
    // And it runs parallel to the walls, 33° off the page, not along the page.
    const angle = (Math.atan2(geo.line.b.y - geo.line.a.y, geo.line.b.x - geo.line.a.x) * 180) / Math.PI;
    const off = Math.abs(((angle % 90) + 90) % 90 - 33);
    assert.ok(off < 1 || Math.abs(off - 90) < 1, `${chain.side}: runs at ${angle.toFixed(1)}°`);
  }
});

test('a wall that runs in neither chain direction is dimensioned along itself', () => {
  // A quadrilateral with two sides parallel and two not — the shape a survey of an old
  // house comes out as. The pair of elevation chains can carry the two parallel walls
  // and the overall extent; there is no third direction for the other two, and side on
  // they read as their own shadow. Each gets a Maßkette of its own instead.
  const plan = createPlan();
  const corners = [
    { x: 1650, y: 600 },
    { x: 5948, y: -552 },
    { x: 6780, y: 3361 },
    { x: 2144, y: 4603 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    addWall(plan, a.x, a.y, b.x, b.y, { type: 'exterior', thickness: 365 });
  }
  touch(plan);

  const raking = allChains(plan, {}).filter((c) => c.kind === 'raking');
  assert.equal(raking.length, 2, 'the two walls no elevation chain can describe');

  // Each carries its own wall's length along the wall, not its shadow on an axis.
  for (const chain of raking) {
    const wall = plan.walls.find((w) => w.id === chain.wallId);
    assert.ok(wall, 'a raking chain names the wall it measures');
    const outer = wallLengths(plan, wall).outer;
    assert.ok(
      Math.abs(Math.abs(chain.to - chain.from) - outer) < 2,
      `${chain.wallId}: chain says ${Math.round(Math.abs(chain.to - chain.from))}, the wall is ${Math.round(outer)}`
    );
    // Drawn along the wall, and outside it.
    const geo = chainGeometry(chain);
    const drawn = Math.hypot(geo.line.b.x - geo.line.a.x, geo.line.b.y - geo.line.a.y);
    assert.ok(Math.abs(drawn - outer) < 2, 'and drawn as long as it says');
    const ends = wallEnds(plan, wall);
    const along = Math.atan2(ends.b.y - ends.a.y, ends.b.x - ends.a.x);
    const line = Math.atan2(geo.line.b.y - geo.line.a.y, geo.line.b.x - geo.line.a.x);
    const off = Math.abs(((along - line) * 180) / Math.PI) % 180;
    assert.ok(off < 1 || Math.abs(off - 180) < 1, `runs parallel to its wall, off by ${off.toFixed(1)}°`);
  }

  // A building square to the page gets none of these: its elevation chains already
  // carry every wall, and a second set saying the same thing would be clutter.
  const square = createPlan();
  addRoomRect(square, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  touch(square);
  assert.equal(allChains(square, {}).filter((c) => c.kind === 'raking').length, 0);
});

test('a raking wall is dimensioned on both faces, because they are not the same length', () => {
  // Mitred into a corner the outer face runs past the inner one. The wall a bricklayer
  // sets out and the wall a room is bounded by then differ by the mitre at each end, and
  // one figure for the pair is a figure that is wrong for one of them.
  const plan = createPlan();
  const corners = [
    { x: 1650, y: 600 },
    { x: 5948, y: -552 },
    { x: 6780, y: 3361 },
    { x: 2144, y: 4603 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    addWall(plan, a.x, a.y, b.x, b.y, { type: 'exterior', thickness: 365 });
  }
  touch(plan);

  const chains = allChains(plan, {}).filter((c) => c.kind === 'raking' || c.kind === 'raking-inner');
  const raked = [...new Set(chains.map((c) => c.wallId))];
  assert.equal(raked.length, 2, 'two walls no elevation chain can describe');

  for (const wallId of raked) {
    const wall = plan.walls.find((w) => w.id === wallId);
    const lengths = wallLengths(plan, wall);
    assert.ok(lengths.outer - lengths.inner > 100, 'the mitres really do make the faces differ');
    const mine = chains.filter((c) => c.wallId === wallId);
    assert.equal(mine.length, 2, `${wallId} has an inner and an outer figure`);
    const figure = (kind) => Math.abs(mine.find((c) => c.kind === kind).to - mine.find((c) => c.kind === kind).from);
    assert.ok(Math.abs(figure('raking') - lengths.outer) < 2, `outer says ${Math.round(figure('raking'))}`);
    assert.ok(Math.abs(figure('raking-inner') - lengths.inner) < 2, `inner says ${Math.round(figure('raking-inner'))}`);

    // Each figure is set out from the face it measures: its extension lines start on
    // the wall's own corners, so the inner one is legible as the inner one rather than
    // as a second opinion about the outer.
    const quad = wallCorners(plan, wall);
    for (const chain of mine) {
      for (const ext of chainGeometry(chain).extensions) {
        const nearest = Math.min(...quad.map((p) => Math.hypot(p.x - ext.a.x, p.y - ext.a.y)));
        assert.ok(nearest < 1, `${chain.kind} extension starts ${Math.round(nearest)} mm off any corner`);
      }
    }
    // The inner figure sits against the wall and the outer beyond it, so the drawing
    // reads outwards and the two never land on the same line.
    const out = (kind) => Math.abs(mine.find((c) => c.kind === kind).at);
    assert.ok(out('raking-inner') < out('raking'), 'the inner figure is the one nearer the wall');
  }
});

test('a wall whose faces are the same length is dimensioned once', () => {
  // Butt-jointed there are no mitres, so a second chain would repeat the first.
  const plan = createPlan();
  plan.joinStyle = 'butt';
  const corners = [
    { x: 1650, y: 600 },
    { x: 5948, y: -552 },
    { x: 6780, y: 3361 },
    { x: 2144, y: 4603 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    addWall(plan, a.x, a.y, b.x, b.y, { type: 'exterior', thickness: 365 });
  }
  touch(plan);
  const chains = allChains(plan, {}).filter((c) => String(c.kind).startsWith('raking'));
  assert.equal(chains.length, 2, `one figure per raked wall: ${chains.map((c) => c.kind).join(', ')}`);
  assert.ok(chains.every((c) => c.kind === 'raking'));
});

// ---- angles at the corners --------------------------------------------

test('a right angle is not written down; anything else is', () => {
  // A plan assumes square. Writing 90° at every corner would bury the ones that matter,
  // and there is nothing else on the drawing that tells 87° from 93°.
  const square = createPlan();
  addRoomRect(square, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  touch(square);
  assert.equal(cornerAngles(square, derived(square).rooms).length, 0);

  // The room from the drawing: four corners, none of them square.
  const plan = createPlan();
  const corners = [
    { x: 1650, y: 600 },
    { x: 5948, y: -552 },
    { x: 6780, y: 3361 },
    { x: 2144, y: 4603 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    addWall(plan, a.x, a.y, b.x, b.y, { type: 'exterior', thickness: 365 });
  }
  touch(plan);
  const marks = cornerAngles(plan, derived(plan).rooms);
  assert.equal(marks.length, 4);
  const sum = marks.reduce((total, mark) => total + mark.degrees, 0);
  assert.ok(Math.abs(sum - 360) < 0.5, `a quadrilateral's angles must come to 360, got ${sum.toFixed(1)}`);
  assert.deepEqual(marks.map((m) => Math.round(m.degrees)).sort((p, q) => p - q), [82, 87, 93, 98]);

  // Each is marked at its own corner, and the arc spans the angle it prints.
  for (const mark of marks) {
    assert.ok(
      corners.some((c) => Math.hypot(c.x - mark.x, c.y - mark.y) < 2),
      'a mark sits on the corner it measures'
    );
    const span = ((mark.to - mark.from) * 180) / Math.PI;
    assert.ok(Math.abs(span - mark.degrees) < 0.01, 'and the arc is the angle');
  }
});

test('the angle given is the one inside the room, so a reflex corner reads reflex', () => {
  // An L. Every corner is square except the one that turns back on itself, and what
  // gets built there is 270° — the figure a joiner needs, not its 90° complement.
  const plan = createPlan();
  const ring = [
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 3000 },
    { x: 3000, y: 3000 },
    { x: 3000, y: 6000 },
    { x: 0, y: 6000 },
  ];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    addWall(plan, a.x, a.y, b.x, b.y, { type: 'exterior', thickness: 300 });
  }
  touch(plan);
  const marks = cornerAngles(plan, derived(plan).rooms);
  assert.equal(marks.length, 1, 'only the corner that is not square');
  assert.equal(Math.round(marks[0].degrees), 270);
  assert.equal(marks[0].x, 3000);
  assert.equal(marks[0].y, 3000);
});

test('a wall carrying straight on through a junction is not a corner', () => {
  // A partition landing in the middle of a wall makes a T: two right angles, which are
  // assumed, and a straight line, which is not an angle at all.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 6000, 4000, { type: 'exterior', thickness: 300 });
  addWall(plan, 3000, 0, 3000, 4000, { type: 'partition', thickness: 115 });
  touch(plan);
  healJunctions(plan);
  touch(plan);
  assert.equal(cornerAngles(plan, derived(plan).rooms).length, 0);
});

test('an angle is written the way a drawing writes it', () => {
  assert.equal(angleLabel(93), '93°');
  assert.equal(angleLabel(270), '270°');
  assert.equal(angleLabel(92.5), '92,5°');
  assert.equal(angleLabel(92.04), '92°', 'not to a precision the drawing does not have');
});

/** A four-sided building, given its corners, walled all the way round. */
function ringPlan(ring, thickness = 365) {
  const plan = createPlan();
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    addWall(plan, ax, ay, bx, by, { type: 'exterior', thickness });
  }
  touch(plan);
  healJunctions(plan);
  touch(plan);
  return plan;
}

test('a chain divides where a wall meets the face, not across its whole bounding box', () => {
  // A wall raked by a few degrees leans a long way across the page over four metres, so
  // its bounding box is nothing like its footprint on the face. Dividing by that box a
  // 365 return read 90¹ on the chain, and the bay beside it was short by the difference.
  const plan = ringPlan([
    [0, 0],
    [5000, -600],
    [5600, 4000],
    [600, 4600],
  ]);

  // How far the two returns lean: each box is two and a half times the wall's thickness.
  for (const wall of plan.walls) {
    const ends = wallEnds(plan, wall);
    if (Math.abs(ends.a.x - ends.b.x) > Math.abs(ends.a.y - ends.b.y)) continue;
    const xs = wallCorners(plan, wall).map((p) => p.x);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 900, 'the returns really do lean');
  }

  const north = allChains(plan, {}).find((c) => c.side === 'north' && c.kind === 'openings');
  const lengths = north.segments.map((s) => Math.round(s.length));
  // A return, the bay, the other return — and no fourth figure hanging off the end,
  // which is what taking the ends of the chain from the bounding box produced.
  assert.equal(lengths.length, 3, `expected three figures, got ${lengths.join(', ')}`);
  assert.ok(
    [lengths[0], lengths[2]].every((length) => Math.abs(length - 365) < 40),
    `the returns read ${lengths[0]} and ${lengths[2]}, not about 365`
  );
  assert.ok(lengths[1] > 4500, `the bay reads ${lengths[1]}`);
});

test('a corner reads the mitre, not the bare thickness, when the walls meet at 45°', () => {
  // The face starts where the outer faces cross and the room starts where the inner ones
  // do, and at 45° those are 151 apart, not 365. Reading the thickness there — which is
  // what dividing at the centreline ± half did — puts every figure beside it out.
  const plan = ringPlan([
    [0, 0],
    [6000, 0],
    [6000, 4000],
    [2000, 4000],
    [0, 2000],
  ]);
  const raked = plan.walls.find((w) => {
    const { a, b } = wallEnds(plan, w);
    return Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1;
  });
  assert.ok(raked, 'the drawing has a raked wall');

  const south = allChains(plan, {}).find((c) => c.side === 'south' && c.kind === 'openings');
  const lengths = south.segments.map((s) => Math.round(s.length));
  // The raked corner at one end, the square corner at the other.
  assert.ok(lengths.includes(151), `the 45° corner reads its mitre: ${lengths.join(', ')}`);
  assert.equal(lengths.filter((length) => length === 365).length, 1, 'only the square corner reads 365');
  // The chain still adds up to the face it measures, give or take the rounding of each
  // figure to the millimetre.
  const sum = south.segments.reduce((total, s) => total + s.length, 0);
  assert.ok(Math.abs(sum - Math.abs(south.to - south.from)) < 0.5);
});

test('a building square to the page divides exactly as it did', () => {
  // The change is for raked walls; nothing about a square one may move.
  const plan = createPlan();
  addRoomRect(plan, 0, 0, 8000, 6000, { type: 'exterior', thickness: 300 });
  addWall(plan, 4000, 150, 4000, 5850, { type: 'partition', thickness: 115 });
  touch(plan);
  healJunctions(plan);
  touch(plan);
  const north = allChains(plan, {}).find((c) => c.side === 'north' && c.kind === 'openings');
  const lengths = north.segments.map((s) => Math.round(s.length));
  // 150 of wall, the bays either side of a 115 partition, 150 of wall.
  assert.ok(lengths.includes(115), `the partition reads its own thickness: ${lengths.join(', ')}`);
  assert.deepEqual(lengths, [300, 3793, 115, 3793, 300], 'the same five figures as before');
  const sum = north.segments.reduce((total, s) => total + s.length, 0);
  assert.ok(Math.abs(sum - Math.abs(north.to - north.from)) < 0.5);
});
