// Dimension chains, worked out from the drawing rather than drawn by hand.
//
// A German plan carries a stack of them outside each elevation of the building, and
// they always say the same three things, innermost first:
//
//   1. Öffnungsmaße — every window and door on that face, and the piers between them
//   2. Rohbaumaße   — the structural bays: where the walls of that face start and stop
//   3. Außenmaß     — the whole thing, once
//
// The figures follow the same convention your architect's sheet uses: metres to two
// places with the millimetre raised as a superscript, and anything under a metre in
// centimetres — so 4185 reads 4,18⁵ and 248 reads 24⁸.

import {
  SQUARE_TO_PAGE,
  findNode,
  intoFrame,
  openingGeometry,
  outOfFrame,
  phaseWalls,
  tightestFrame,
  wallCorners,
  wallEnds,
} from './model.js';
import { openingWidth } from './openings.js';
import { pointInPolygon } from '../geom/vec.js';

const ALONG_AXIS = 0.26; // radians, about 15 degrees
const MERGE = 20; // mm; points closer than this are the same point
const FACADE_BAND = 0.2; // how far in from the outermost wall still counts as that face

export const CHAIN_KINDS = [
  { id: 'inside', label: 'Inside', hint: 'doors and openings on the walls within the building' },
  { id: 'openings', label: 'Openings', hint: 'every window and door, and the piers between them' },
  { id: 'bays', label: 'Structure', hint: 'where the walls of that face start and stop' },
  { id: 'overall', label: 'Overall', hint: 'the whole building, once' },
];

export const SIDES = [
  { id: 'north', axis: 'x', sign: -1, label: 'Top' },
  { id: 'south', axis: 'x', sign: 1, label: 'Bottom' },
  { id: 'west', axis: 'y', sign: -1, label: 'Left' },
  { id: 'east', axis: 'y', sign: 1, label: 'Right' },
];

/**
 * A dimension figure, split into the part on the line and the raised millimetre.
 *
 * Under a metre a German plan writes centimetres, so 248 mm is 24⁸ rather than 0,24⁸.
 */
export function dimText(mm) {
  const value = Math.max(0, Math.round(mm));
  if (value < 1000) {
    const cm = Math.floor(value / 10);
    const rest = value - cm * 10;
    return { main: String(cm), sup: rest ? String(rest) : '' };
  }
  const metres = Math.floor(value / 1000);
  const cm = Math.floor((value - metres * 1000) / 10);
  const rest = value - metres * 1000 - cm * 10;
  return { main: `${metres},${String(cm).padStart(2, '0')}`, sup: rest ? String(rest) : '' };
}

const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** The figure as one string, with the millimetre raised the way a plan writes it. */
export function dimLabel(mm) {
  const { main, sup } = dimText(mm);
  return main + [...sup].map((d) => SUPERSCRIPT[d] ?? d).join('');
}

function wallAngleOf(plan, wall) {
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const angle = Math.atan2(ends.b.y - ends.a.y, ends.b.x - ends.a.x);
  return { ends, angle };
}

/**
 * The frame a storey's walls are square to.
 *
 * A chain runs along one of two axes; which two is the question. Drawn on a skew — the
 * whole building turned fifteen degrees, which is what a survey of an old house looks
 * like — the drawing's own x and y describe nothing: each chain measures the *shadow*
 * of a wall on an axis it does not run along, so a 4,50 wall reads 3,59 and the two
 * side chains, being shadows of the same thing, print the same figures twice.
 *
 * Weighted by length, so a long shell decides the frame and a short skew wall inside it
 * does not. A drawing already square to the page keeps exactly the frame it had.
 */
export function planFrame(plan, walls) {
  const points = [];
  const directions = [{ x: 1, y: 0 }];
  for (const wall of walls) {
    const ends = wallEnds(plan, wall);
    if (!ends) continue;
    points.push({ x: ends.a.x, y: ends.a.y }, { x: ends.b.x, y: ends.b.y });
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    // Once per metre of wall, so the frame follows the walls there is most of.
    for (let i = 0; i < Math.max(1, Math.round(len / 1000)); i++) directions.push({ x: dx, y: dy });
  }
  return tightestFrame(directions, points) ?? SQUARE_TO_PAGE;
}

/** Whether a frame is the page's own, so nothing needs turning. */
export function isSquareToPage(frame) {
  return !frame || Math.abs(frame.angle) < 0.5;
}

/**
 * The same plan seen square to `frame`: every node turned into it.
 *
 * Turning the nodes is enough, because a wall's ends, an opening's geometry and the
 * extents are all worked out from them — so the chain builders go on thinking in x and
 * y and need not know the drawing is on a skew. `chainGeometry` turns the answer back.
 */
export function framePlan(plan, frame) {
  if (isSquareToPage(frame)) return plan;
  return {
    ...plan,
    nodes: (plan.nodes ?? []).map((node) => {
      const f = intoFrame(frame, node.x, node.y);
      return { ...node, x: f.u, y: f.v };
    }),
  };
}

/** A frame in which this wall runs exactly along u, so a chain can run along it. */
function frameAlong(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  return { ox: 0, oy: 0, ux, uy, angle: (Math.atan2(uy, ux) * 180) / Math.PI };
}

/** Whether a direction lies along one of a frame's two axes. */
function squareToFrame(frame, dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const u = (dx * frame.ux + dy * frame.uy) / len;
  const v = (-dx * frame.uy + dy * frame.ux) / len;
  return Math.abs(u) < 0.02 || Math.abs(v) < 0.02; // about a degree
}

/**
 * A chain along each wall that no elevation chain can carry.
 *
 * The elevation chains measure two directions, and a wall running in neither is only
 * ever caught by them side on: the figure they print is the wall's shadow on an axis it
 * does not run along, which is shorter than the wall and is not a length anybody builds
 * to. A quadrilateral with no two sides parallel has four such walls and no pair of
 * chains that could describe them.
 *
 * So each gets a Maßkette of its own, parallel to the wall and set off its outer face —
 * measured along the wall, between its end faces, divided at any openings in it. Which
 * side is "outer" is decided by the building's own middle, so the chain lands outside
 * the shell rather than in the room.
 */
export function rakingChains(plan, options = {}) {
  const walls = phaseWalls(plan).filter((wall) => wallEnds(plan, wall));
  if (!walls.length) return [];
  const frame = options.frame ?? planFrame(plan, walls);
  // Stacked outside the elevation chains rather than among them, so the drawing reads
  // outwards: the bays, the overall, then the raking walls.
  const gap = options.gap ?? 700;
  const first = (options.first ?? 700) + gap * (options.after ?? 0);

  let cx = 0;
  let cy = 0;
  let count = 0;
  for (const wall of walls) {
    const ends = wallEnds(plan, wall);
    for (const p of [ends.a, ends.b]) {
      cx += p.x;
      cy += p.y;
      count++;
    }
  }
  if (!count) return [];
  cx /= count;
  cy /= count;

  const chains = [];
  for (const wall of walls) {
    const ends = wallEnds(plan, wall);
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    if (Math.hypot(dx, dy) < 500) continue;
    if (squareToFrame(frame, dx, dy)) continue; // an elevation chain already has it
    const wf = frameAlong(dx, dy);
    const quad = wallCorners(plan, wall);
    if (!wf || !quad) continue;

    // The wall in its own frame: how far it runs, and where its two faces sit.
    const corners = quad.map((p) => intoFrame(wf, p.x, p.y));
    const vs = corners.map((p) => p.v);
    const middle = intoFrame(wf, cx, cy);
    const away = (vs[0] + vs[vs.length - 1]) / 2 >= middle.v ? 1 : -1;
    const face = away > 0 ? Math.max(...vs) : Math.min(...vs);
    const back = away > 0 ? Math.min(...vs) : Math.max(...vs);

    // A mitred wall has two lengths, and they are not the same length. Cut into a
    // corner the outer face runs past the inner one, so the wall a bricklayer sets out
    // and the wall a room is bounded by differ by the mitre at each end. One figure for
    // the pair is a figure that is wrong for one of them, so both are drawn: the inner
    // face against the wall, the outer face beyond it.
    const alongFace = (v) => corners.filter((p) => Math.abs(p.v - v) < 1).map((p) => p.u);
    const inner = alongFace(back);
    const outer = alongFace(face);
    const spanOf = (list) => (list.length ? Math.max(...list) - Math.min(...list) : 0);
    // Butt-jointed, or square at both ends: the two faces are the same and one figure
    // says everything two would.
    const differ = Math.abs(spanOf(outer) - spanOf(inner)) > MERGE;

    if (differ) {
      chains.push(
        chainFrom(
          {
            side: 'raking',
            kind: 'raking-inner',
            axis: 'x',
            at: face + away * first,
            // The extension lines start at the face this figure measures, which means
            // crossing the wall to reach the chain. That is what makes it legible as
            // the inner one rather than a second opinion about the outer.
            edge: back,
            frame: wf,
            walls: [wall.id],
            wallId: wall.id,
          },
          merge([
            { at: Math.min(...inner), owners: [wall.id] },
            { at: Math.max(...inner), owners: [wall.id] },
          ])
        )
      );
    }

    const marks = [
      { at: Math.min(...outer), owners: [wall.id] },
      { at: Math.max(...outer), owners: [wall.id] },
    ];
    for (const opening of plan.openings ?? []) {
      if (opening.wallId !== wall.id) continue;
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const owners = [opening.id];
      marks.push(
        { at: intoFrame(wf, geo.x1, geo.y1).u, owners },
        { at: intoFrame(wf, geo.x2, geo.y2).u, owners }
      );
    }
    chains.push(
      chainFrom(
        {
          side: 'raking',
          kind: 'raking',
          axis: 'x',
          at: face + away * (first + (differ ? gap : 0)),
          edge: face,
          frame: wf,
          walls: [wall.id],
          wallId: wall.id,
        },
        merge(marks)
      )
    );
  }
  return chains;
}

/** How far off square an angle can be and still be read as square, in degrees. */
const SQUARE = 0.5;

/**
 * The angle at every corner that is not a right angle.
 *
 * A plan does not dimension a corner it does not have to: a right angle is the
 * assumption, and writing 90° at each of them would bury the four that matter. So only
 * the others are marked — which is also the only way to tell 87° from 93° by eye, and
 * the figure a joiner needs before cutting anything into that corner.
 *
 * The angle given is the one inside the room, found by stepping along the sector's own
 * bisector and asking which room that lands in. A reflex corner — the inside of an L —
 * therefore reads 270° rather than 90°, which is what is actually built.
 *
 * @returns [{x, y, from, to, degrees, radius, walls}] `from`/`to` in radians
 */
export function cornerAngles(plan, rooms) {
  const walls = phaseWalls(plan).filter((wall) => wallEnds(plan, wall));
  if (walls.length < 2) return [];
  const nodes = new Map();
  for (const wall of walls) {
    const ends = wallEnds(plan, wall);
    for (const [id, from, to] of [
      [wall.a, ends.a, ends.b],
      [wall.b, ends.b, ends.a],
    ]) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (Math.hypot(dx, dy) < 1) continue;
      if (!nodes.has(id)) nodes.set(id, { x: from.x, y: from.y, arms: [], thickest: 0 });
      const node = nodes.get(id);
      node.arms.push({ wallId: wall.id, angle: Math.atan2(dy, dx) });
      node.thickest = Math.max(node.thickest, wall.thickness);
    }
  }

  const out = [];
  for (const node of nodes.values()) {
    if (node.arms.length < 2) continue;
    const arms = [...node.arms].sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % arms.length];
      let sweep = b.angle - a.angle;
      while (sweep <= 1e-9) sweep += Math.PI * 2;
      // Two walls carrying straight on through a node are not a corner at all.
      const degrees = (sweep * 180) / Math.PI;
      if (Math.abs(degrees - 180) < SQUARE || Math.abs(degrees - 90) < SQUARE || degrees < 1) continue;
      // Inside which room? Stepped far enough out to clear the walls' own thickness.
      const bisector = a.angle + sweep / 2;
      const reach = node.thickest * 1.5 + 200;
      const probe = { x: node.x + Math.cos(bisector) * reach, y: node.y + Math.sin(bisector) * reach };
      const inside = (rooms ?? []).some((room) => pointInPolygon(probe.x, probe.y, room.inner));
      if (!inside) continue;
      out.push({
        x: node.x,
        y: node.y,
        from: a.angle,
        to: a.angle + sweep,
        bisector,
        degrees,
        radius: node.thickest * 1.4 + 260,
        walls: [a.wallId, b.wallId],
      });
    }
  }
  return out;
}

/** An angle the way a drawing writes it: whole degrees unless it is not a whole one. */
export function angleLabel(degrees) {
  const rounded = Math.round(degrees * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
  return `${text}°`;
}

/** Whether a wall runs along the axis a chain is measured on. */
function runsAlong(angle, axis) {
  const along = axis === 'x' ? 0 : Math.PI / 2;
  let delta = Math.abs(angle - along) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta <= ALONG_AXIS;
}

/**
 * The division points of a chain, with what put each of them there.
 *
 * Two points close enough to be the same point become one, and it answers for both —
 * a partition's face and a door's reveal land together often enough that a chain
 * would otherwise carry a nought-millimetre division between them.
 */
function merge(points, toward = 0) {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const out = [];
  for (const point of sorted) {
    const last = out[out.length - 1];
    if (last && point.at - last.at <= MERGE) {
      for (const owner of point.owners) last.owners.add(owner);
      // Two points this close are the same point, and its extension line should start
      // at whichever of them is nearer the chain — a line drawn from the far one would
      // set out across the wall and past the thing it is measuring.
      const nearer = !Number.isFinite(last.edge) || point.edge * toward > last.edge * toward;
      if (Number.isFinite(point.edge) && nearer) last.edge = point.edge;
      continue;
    }
    out.push({ at: point.at, edge: point.edge, owners: new Set(point.owners) });
  }
  return out;
}

/**
 * A chain from its merged division points.
 *
 * Each segment records what it measures: `owns` is what both its ends belong to — a
 * wall's own thickness, a window's own width — and `touches` is everything either end
 * belongs to, which is what a figure is set out from. That is enough for the drawing
 * to light up the dimensions for whatever the cursor is over.
 */
function chainFrom(base, marks) {
  const divisions = marks.map((mark) => mark.at);
  return {
    ...base,
    from: divisions[0],
    to: divisions[divisions.length - 1],
    divisions,
    // Where on the building each division was taken from, across the chain. A wall
    // square to the chain has them all on one line — its face — but a raked one does
    // not, and its extension lines have to start on the wall or the figure is a number
    // with nothing under it.
    edges: marks.map((mark) => mark.edge),
    owners: marks.map((mark) => [...mark.owners]),
    segments: marks.slice(0, -1).map((mark, i) => {
      const next = marks[i + 1];
      return {
        from: mark.at,
        to: next.at,
        length: next.at - mark.at,
        owns: [...mark.owners].filter((id) => next.owners.has(id)),
        touches: [...new Set([...mark.owners, ...next.owners])],
      };
    }),
  };
}

/** The extent of the drawing, and how thick its walls are. */
function extentOf(plan, walls) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let thickest = 0;
  for (const wall of walls) {
    const ends = wallEnds(plan, wall);
    if (!ends) continue;
    const half = wall.thickness / 2;
    for (const p of [ends.a, ends.b]) {
      minX = Math.min(minX, p.x - half);
      maxX = Math.max(maxX, p.x + half);
      minY = Math.min(minY, p.y - half);
      maxY = Math.max(maxY, p.y + half);
    }
    thickest = Math.max(thickest, wall.thickness);
  }
  return { minX, maxX, minY, maxY, thickest };
}

/**
 * The chains for one drawing.
 *
 * @param plan the floor being drawn
 * @param options {kinds, gap, first} which chains, how far apart, how far out
 * @returns [{side, kind, axis, at, from, to, divisions, segments}]
 */
export function autoChains(plan, options = {}) {
  const walls = phaseWalls(plan).filter((wall) => wallEnds(plan, wall));
  if (walls.length < 2) return [];
  // Everything below thinks in x and y. On a skewed drawing it is handed a turned copy
  // of the plan and its answers are turned back by `chainGeometry`, so a chain runs
  // along the wall it measures rather than across the page.
  const frame = options.frame ?? planFrame(plan, walls);
  if (!isSquareToPage(frame)) {
    const turned = framePlan(plan, frame);
    return autoChains(turned, { ...options, frame: SQUARE_TO_PAGE }).map((chain) => ({ ...chain, frame }));
  }
  const kinds = options.kinds ?? ['openings', 'bays', 'overall'];
  const gap = options.gap ?? 700;
  const first = options.first ?? 700;
  const box = extentOf(plan, walls);
  if (!Number.isFinite(box.minX)) return [];
  const depth = { x: box.maxY - box.minY, y: box.maxX - box.minX };

  const chains = [];
  for (const side of SIDES) {
    const axis = side.axis;
    const across = axis === 'x' ? 'y' : 'x';
    const lo = axis === 'x' ? box.minY : box.minX;
    const hi = axis === 'x' ? box.maxY : box.maxX;
    const edge = side.sign < 0 ? lo : hi;
    const band = Math.max(box.thickest * 1.5, depth[axis] * FACADE_BAND);

    // The walls that make up this face: running along the chain, and out at its edge.
    const facade = [];
    for (const wall of walls) {
      const info = wallAngleOf(plan, wall);
      if (!info || !runsAlong(info.angle, axis)) continue;
      const at = (info.ends.a[across] + info.ends.b[across]) / 2;
      if (Math.abs(at - edge) > band) continue;
      facade.push({ wall, ends: info.ends });
    }
    if (!facade.length) continue;

    // The walls that cross this face — its returns and any partition meeting it.
    // Their two faces are what a chain divides at, which is why a German plan reads
    // 30 / 4,39 / 30 across a facade rather than one bare number.
    const crossing = [];
    for (const wall of walls) {
      const info = wallAngleOf(plan, wall);
      if (!info || runsAlong(info.angle, axis)) continue;
      // Where the wall actually is, taken from the shape that is actually drawn — its
      // mitred corners projected onto the face.
      //
      // It used to divide at the middle of the centreline give or take half a
      // thickness, which is the wall's own faces only when the wall is square to the
      // chain. Set at an angle its footprint along the face is wider than it is thick,
      // and the middle of its centreline is not the middle of anything.
      //
      // Only the end that meets this face, though. All four corners is the wall's
      // bounding box, and a long wall raked by a few degrees leans far enough across
      // the page for that box to be metres wide: a 365 return on a 4,36 m wall raked
      // 8° divided the chain at 90¹.
      const corners = wallCorners(plan, wall);
      if (!corners) continue;
      const beside = corners.map((p) => p[across]);
      const reaches = side.sign < 0 ? Math.min(...beside) <= edge + band : Math.max(...beside) >= edge - band;
      if (!reaches) continue;
      // The two corners nearest the chain are the wall's end cap on this face; the
      // other two are at the far end and have nothing to do with this figure.
      const meeting = [...corners]
        .sort((p, q) => (p[across] - q[across]) * side.sign)
        .slice(-2);
      for (const corner of meeting) crossing.push({ at: corner[axis], edge: corner[across], owners: [wall.id] });
    }

    // A chain runs the length of the face it measures, which on a skewed building is
    // not the length of the drawing's bounding box. Taken from the box, the corner of a
    // wall somewhere else in the plan pushed the end of the chain past the end of the
    // face and left a phantom figure of a few centimetres hanging off it.
    let head = null;
    let tail = null;
    for (const { wall } of facade) {
      for (const corner of wallCorners(plan, wall) ?? []) {
        const point = { at: corner[axis], edge: corner[across], owners: [] };
        if (!head || point.at < head.at) head = point;
        if (!tail || point.at > tail.at) tail = point;
      }
    }
    if (!head) {
      head = { at: axis === 'x' ? box.minX : box.minY, owners: [] };
      tail = { at: axis === 'x' ? box.maxX : box.maxY, owners: [] };
    }
    const faceFrom = head.at;
    const faceTo = tail.at;
    const ends = () => [
      { ...head, owners: [] },
      { ...tail, owners: [] },
    ];

    const ticksFor = (kind) => {
      // Only what is actually on this face. A crossing wall can reach past the end of
      // it on a skewed drawing, and a division outside the chain would make this chain
      // longer than the overall one beside it — two figures for one face that do not
      // agree, which is worse than either being slightly wrong.
      const points = crossing.filter((point) => point.at > faceFrom && point.at < faceTo);
      if (kind === 'openings') {
        for (const { wall } of facade) {
          for (const opening of plan.openings ?? []) {
            if (opening.wallId !== wall.id) continue;
            const geo = openingGeometry(plan, opening);
            if (!geo) continue;
            const owners = [opening.id];
            points.push(
              { at: axis === 'x' ? geo.x1 : geo.y1, edge: axis === 'x' ? geo.y1 : geo.x1, owners },
              { at: axis === 'x' ? geo.x2 : geo.y2, edge: axis === 'x' ? geo.y2 : geo.x2, owners }
            );
          }
        }
      }
      // The chain always spans the whole face, whatever is inside it.
      points.push(...ends());
      return merge(points, side.sign);
    };

    let step = 0;
    const elevation = facade.map(({ wall }) => wall.id);
    for (const kind of kinds) {
      const marks = kind === 'overall' ? merge(ends(), side.sign) : ticksFor(kind);
      if (marks.length < 2) continue;
      // A chain that says nothing the one inside it did not is not worth drawing.
      const signature = marks.map((mark) => mark.at).join('|');
      const previous = chains.filter((c) => c.side === side.id).map((c) => c.divisions.join('|'));
      if (previous.includes(signature)) continue;
      const at = edge + side.sign * (first + gap * step);
      step += 1;
      // Which walls this chain is the elevation of, so hovering one of them lights up
      // the whole stack of figures that describes that face.
      chains.push(chainFrom({ side: side.id, kind, axis, at, edge, walls: elevation }, marks));
    }
  }
  return chains;
}

/**
 * How long a wall actually is, measured between the walls it runs into.
 *
 * Walls meet at shared nodes on their centrelines, so end to end a partition between
 * two 365 mm outer walls measures the full 6,00 m. Nobody builds that. What gets built
 * is the 5,63⁵ between their faces, and that is the figure a chain along it has to
 * carry — a joiner setting out a door works from the face he can put a rule against.
 */
function clearSpan(plan, walls, wall, axis) {
  const ends = wallEnds(plan, wall);
  const inset = (nodeId) => {
    let half = 0;
    for (const other of walls) {
      if (other.id === wall.id) continue;
      if (other.a !== nodeId && other.b !== nodeId) continue;
      const info = wallAngleOf(plan, other);
      // A wall carrying on in the same line does not stop this one.
      if (!info || runsAlong(info.angle, axis)) continue;
      half = Math.max(half, other.thickness / 2);
    }
    return half;
  };
  const first = { at: ends.a[axis], node: wall.a };
  const second = { at: ends.b[axis], node: wall.b };
  const [low, high] = first.at <= second.at ? [first, second] : [second, first];
  return { from: low.at + inset(low.node), to: high.at - inset(high.node) };
}

/**
 * Chains for the openings in the walls inside the building.
 *
 * The chains outside only reach the openings on the elevations. A door in a partition
 * still has to be set out, and it is set out along its own wall — which is what a
 * joiner needs and what the elevation chains cannot say.
 *
 * The chain itself goes out on the paper with all the others, stacked past them on the
 * side it runs parallel to. A chain drawn across a room covers the room it is
 * measuring; a plan is read from the outside in. Only the witness lines come inside,
 * and they start at the wall so a figure points at the thing it measures.
 */
export function interiorChains(plan, options = {}) {
  const walls = phaseWalls(plan).filter((wall) => wallEnds(plan, wall));
  if (!walls.length) return [];
  // As with the elevation chains: measured square to the walls, turned back on the way
  // out. Both families take the frame from `allChains` so they cannot end up in
  // different ones and fail to stack.
  const frame = options.frame ?? planFrame(plan, walls);
  if (!isSquareToPage(frame)) {
    const turned = framePlan(plan, frame);
    return interiorChains(turned, { ...options, frame: SQUARE_TO_PAGE }).map((chain) => ({ ...chain, frame }));
  }
  const box = extentOf(plan, walls);
  const gap = options.gap ?? 700;
  const first = options.first ?? 700;
  const steps = { ...(options.after ?? {}) };
  const chains = [];

  for (const wall of walls) {
    const openings = (plan.openings ?? []).filter((o) => o.wallId === wall.id);
    if (!openings.length) continue;
    const info = wallAngleOf(plan, wall);
    if (!info) continue;
    const { ends } = info;
    const axis = runsAlong(info.angle, 'x') ? 'x' : runsAlong(info.angle, 'y') ? 'y' : null;
    if (!axis) continue; // a chain along a raking wall is a job for a manual dimension
    const across = axis === 'x' ? 'y' : 'x';
    const at = (ends.a[across] + ends.b[across]) / 2;
    const lo = axis === 'x' ? box.minY : box.minX;
    const hi = axis === 'x' ? box.maxY : box.maxX;
    // An outside wall already has its openings on the elevation chains.
    if (Math.min(Math.abs(at - lo), Math.abs(at - hi)) < wall.thickness * 1.5) continue;

    const span = clearSpan(plan, walls, wall, axis);
    const points = [
      { at: span.from, owners: [wall.id] },
      { at: span.to, owners: [wall.id] },
      // And the building either end of it, so the chain spans what every other chain
      // spans and its figures line up with the ones it is stacked behind.
      { at: axis === 'x' ? box.minX : box.minY, owners: [] },
      { at: axis === 'x' ? box.maxX : box.maxY, owners: [] },
    ];
    for (const opening of openings) {
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const owners = [opening.id];
      points.push(
        { at: axis === 'x' ? geo.x1 : geo.y1, owners },
        { at: axis === 'x' ? geo.x2 : geo.y2, owners }
      );
    }
    const marks = merge(points);
    if (marks.length < 3) continue;

    const near = at <= (lo + hi) / 2;
    const side = SIDES.find((s) => s.axis === axis && (near ? s.sign < 0 : s.sign > 0));
    const step = steps[side.id] ?? 0;
    steps[side.id] = step + 1;
    chains.push(
      chainFrom(
        {
          side: side.id,
          kind: 'inside',
          axis,
          at: (near ? lo : hi) + side.sign * (first + gap * step),
          edge: at + side.sign * (wall.thickness / 2),
          walls: [wall.id],
          wallId: wall.id,
        },
        marks
      )
    );
  }
  return chains;
}

/** Every chain a drawing carries: the elevations outside, and the walls within. */
export function allChains(plan, options = {}) {
  const kinds = options.kinds ?? ['openings', 'bays', 'overall', 'inside'];
  // Worked out once and shared, or the elevation chains and the interior ones could be
  // measured in two different frames and would not stack.
  const walls = phaseWalls(plan).filter((wall) => wallEnds(plan, wall));
  const frame = walls.length > 1 ? planFrame(plan, walls) : SQUARE_TO_PAGE;
  options = { ...options, frame };
  const outside = autoChains(plan, { ...options, kinds: kinds.filter((k) => k !== 'inside') });
  if (!kinds.includes('inside')) return outside;
  // The interior chains stack behind the elevation chains rather than on top of them,
  // so they have to know how many are already out there on each side.
  const after = {};
  for (const chain of outside) after[chain.side] = (after[chain.side] ?? 0) + 1;
  const deepest = Math.max(0, ...Object.values(after));
  return [
    ...outside,
    ...interiorChains(plan, { ...options, after }),
    ...rakingChains(plan, { ...options, after: deepest }),
  ];
}

/**
 * What names one chain on the drawing.
 *
 * The chains are worked out afresh from the plan every time, so they have no identity
 * of their own. Where it runs and what it is give it one, which is all a cursor needs
 * to say which figure it is over.
 */
export function chainKey(chain) {
  // The wall is part of the name for a chain that belongs to one: two raking walls can
  // sit the same distance out in their own frames and would otherwise share an id.
  return `${chain.side}:${chain.kind}:${chain.wallId ?? ''}:${Math.round(chain.at)}`;
}

/** A chain's line and ticks as plain points, for whatever is drawing it. */
export function chainGeometry(chain) {
  const frame = chain.frame;
  const place = (u, v) => (frame ? outOfFrame(frame, u, v) : { x: u, y: v });
  const at = (value) => (chain.axis === 'x' ? place(value, chain.at) : place(chain.at, value));
  const owners = chain.owners ?? chain.divisions.map(() => []);
  return {
    line: { a: at(chain.from), b: at(chain.to) },
    ticks: chain.divisions.map((value, i) => ({ ...at(value), owners: owners[i] })),
    extensions: chain.divisions.map((value, i) => {
      const from = Number.isFinite(chain.edges?.[i]) ? chain.edges[i] : chain.edge;
      return {
        a: chain.axis === 'x' ? place(value, from) : place(from, value),
        b: at(value),
        owners: owners[i],
      };
    }),
    labels: chain.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.length > 1)
      .map(({ segment, index }) => ({
        at: at((segment.from + segment.to) / 2),
        a: at(segment.from),
        b: at(segment.to),
        length: segment.length,
        room: segment.length,
        index,
        owns: segment.owns ?? [],
        touches: segment.touches ?? [],
      })),
  };
}

/**
 * What a chain has to say about one thing on the drawing.
 *
 * `owns` is a figure that measures it — the thickness of that wall, the width of that
 * window. `touches` is a figure set out from it: the pier between this window and the
 * next. A whole chain answers for the walls whose elevation it is.
 */
export function chainMentions(chain, id) {
  if (!id) return null;
  if ((chain.walls ?? []).includes(id)) return 'elevation';
  if (chain.segments.some((segment) => (segment.owns ?? []).includes(id))) return 'owns';
  if (chain.segments.some((segment) => (segment.touches ?? []).includes(id))) return 'touches';
  return null;
}
