// What has to be left clear, and what is in the way.
//
// A door needs its swing, a WC needs room to stand in front of it, and two things
// cannot occupy the same square metre. None of that is visible on a drawing until
// something checks it, which is how a wardrobe ends up behind a door that no longer
// opens.

import { furnitureById } from './furniture.js';
import { MAX_SWING, swingAngle } from './opening3d.js';
import { openingGeometry } from './model.js';
import { leafLayout, openingWidth, swingsOpen } from './openings.js';
import { stairWorldFootprint } from './stairs.js';

const SWING_STEPS = 8;

/** The rectangle a piece of furniture covers, in drawing coordinates. */
export function furnitureFootprint(item) {
  const rad = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = (item.w ?? 600) / 2;
  const hh = (item.h ?? 600) / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: item.x + x * cos - y * sin, y: item.y + x * sin + y * cos }));
}

/**
 * A line a piece can be brought up against.
 *
 * `nx, ny` is the direction across it and `at` is how far along that direction it
 * sits, so a guide is a line without needing to be a segment. `from`–`to` is the
 * stretch of it that counts, measured along the line, because a wall's plane runs on
 * for ever and a wardrobe at the far end of the house should not line up with it.
 * `edges` says whether the piece meets it with an edge or with its middle.
 *
 * `along` is the direction the guide runs, in degrees, for a guide worth lining a
 * piece up with as well as bringing it against. A wall has one; a piece's own edge is
 * left without, because furniture is put against a wall, not squared to the sideboard.
 *
 * `pull` overrides how close counts as close enough. Bringing a piece up against a face
 * is a small movement and wants a small reach, or everything sticks to everything; but
 * centring one on a line is aiming rather than touching, and a hand aiming at the middle
 * of a window is a good deal further out than sixteen centimetres.
 */
const guide = (nx, ny, at, from, to, what, edges = 'edge', along = null, pull = null) => ({
  nx,
  ny,
  at,
  from,
  to,
  what,
  edges,
  along,
  pull,
});

/** The faces of the walls: what furniture is actually put against. */
export function wallGuides(walls) {
  const out = [];
  for (const wall of walls) {
    const { a, b } = wall.ends;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    const centre = a.x * nx + a.y * ny;
    const start = a.x * ux + a.y * uy;
    const along = (Math.atan2(uy, ux) * 180) / Math.PI;
    for (const side of [-1, 1]) {
      out.push(guide(nx, ny, centre + (side * wall.thickness) / 2, start, start + len, 'a wall', 'edge', along));
    }
  }
  return out;
}

/**
 * The openings: the middle of each, to centre something under it.
 *
 * A sofa goes under the window, a bed between two of them, a table in front of the
 * French doors. That is a thing everybody does and there was nothing to catch it — the
 * walls and the other furniture were the only guides, so centring a sofa on a window
 * meant reading two figures off the chain and doing the arithmetic.
 *
 * A centre line only. The reveals are already covered by the wall's own faces, and a
 * piece brought flush with the edge of a window is not a thing anybody wants.
 */
export function openingGuides(plan) {
  const out = [];
  for (const opening of plan.openings ?? []) {
    const geo = openingGeometry(plan, opening);
    if (!geo) continue;
    const nx = geo.dx;
    const ny = geo.dy;
    // Across the opening's own width: the line through its middle, running into the room
    // at right angles to the wall.
    const middle = geo.centre.x * nx + geo.centre.y * ny;
    // The same way round `offerOf` measures it — along (ny, −nx). Written the other way
    // the stretch of wall this guide covers was mirrored about the origin, so the piece
    // was never judged to be beside it and the guide never offered anything.
    const across = geo.centre.x * ny - geo.centre.y * nx;
    const reach = Math.max(1200, openingWidth(opening));
    // Aimed at rather than touched, so it reaches further than a wall face does.
    out.push(guide(nx, ny, middle, across - reach, across + reach, 'a window', 'centre', null, 400));
  }
  return out;
}

/**
 * The other furniture: its edges, to stand something flush beside it, and its middle,
 * to line two things up on their centres.
 */
export function pieceGuides(pieces) {
  const out = [];
  for (const piece of pieces) {
    const poly = furnitureFootprint(piece);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      const nx = -uy;
      const ny = ux;
      const start = a.x * ux + a.y * uy;
      out.push(guide(nx, ny, a.x * nx + a.y * ny, start, start + len, 'a piece'));
      // And a line through its middle, for lining centres up.
      const mid = piece.x * nx + piece.y * ny;
      out.push(guide(nx, ny, mid, start - len, start + len * 2, 'a centre', 'centre'));
    }
  }
  return out;
}

/** How far a guide would have to move the piece, or null if it is not close enough. */
function offerOf(guide, poly, centre, reach) {
  // Only a guide the piece is actually beside.
  const ux = guide.ny;
  const uy = -guide.nx;
  const runs = poly.map((p) => p.x * ux + p.y * uy);
  if (Math.max(...runs) < guide.from - reach || Math.min(...runs) > guide.to + reach) return null;

  const across = poly.map((p) => p.x * guide.nx + p.y * guide.ny);
  const meets =
    guide.edges === 'centre'
      ? [centre.x * guide.nx + centre.y * guide.ny]
      : [Math.min(...across), Math.max(...across)];
  const close = guide.pull ?? reach;
  let best = null;
  for (const edge of meets) {
    const gap = guide.at - edge;
    if (Math.abs(gap) <= close && (!best || Math.abs(gap) < Math.abs(best))) best = gap;
  }
  return best === null ? null : { gap: best, guide };
}

/**
 * Where a piece wants to sit, given where you have dropped it.
 *
 * Furniture goes against things. On a 50 mm grid that is a matter of nudging until it
 * looks right, and it never quite is — there is always a millimetre of daylight
 * behind the wardrobe. Each guide is offered to whichever edge of the piece is nearly
 * touching it, and the nearest offer wins.
 *
 * Then it is done again across the first: a piece goes into a corner, not against one
 * wall of it, and a bedside table wants to be both against the wall and level with the
 * bed. Only a guide square to the one already taken is considered on the second pass,
 * or the two fight over the same direction and the piece slides along the wall.
 *
 * Any angle, either way round: the piece is measured along each guide's own normal, so
 * a bed turned thirty degrees still finds the wall it is nearly against, and a wall
 * running diagonally is no different from one running square.
 *
 * @param reach how close counts as nearly touching, in millimetres
 * @returns {x, y, on} — `on` names what claimed it, for telling the user
 */
export function snapPlacement(item, x, y, guides, reach = 160) {
  // Turned before it is moved. Furniture against a wall lies along the wall — nobody
  // stands a wardrobe at eleven degrees to the one behind it — and on a wall that is
  // not square to the page, coming up against it without turning leaves a wedge of
  // daylight that no amount of nudging closes. The position is then worked out from
  // the turned footprint, or it would settle the piece and then swing it off the wall.
  const rotation = alignedTo(item, x, y, guides, reach);
  const turned = { ...item, rotation };

  let at = { x, y };
  const on = [];
  let taken = null;
  for (let pass = 0; pass < 2; pass++) {
    const poly = furnitureFootprint({ ...turned, ...at });
    let best = null;
    for (const g of guides) {
      // The second pass only looks across the first, never along it.
      if (taken && Math.abs(g.nx * taken.nx + g.ny * taken.ny) > 0.3) continue;
      const offer = offerOf(g, poly, at, reach);
      if (offer && (!best || Math.abs(offer.gap) < Math.abs(best.gap))) best = offer;
    }
    if (!best) break;
    at = { x: at.x + best.guide.nx * best.gap, y: at.y + best.guide.ny * best.gap };
    if (!on.includes(best.guide.what)) on.push(best.guide.what);
    taken = best.guide;
  }
  const turnedBy = Math.abs(wrap180(rotation - (item.rotation ?? 0))) > 0.01;
  if (turnedBy && !on.includes('a wall')) on.push('a wall');
  return { x: at.x, y: at.y, rotation, on, snapped: on.length > 0 || turnedBy };
}

/** An angle brought into −180…180, which is where "how far apart" is measurable. */
function wrap180(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * Which way a piece should lie, given the wall it is being brought against.
 *
 * Square to the wall, on the quarter turn nearest the way it is already lying. Turning
 * it to face the wall outright would spin a piece the moment it came near one and undo
 * whichever way round you had put it; this only ever makes it parallel, and which of
 * its four sides is against the wall stays yours to choose.
 */
function alignedTo(item, x, y, guides, reach) {
  const rotation = item.rotation ?? 0;
  let best = null;
  for (const g of guides) {
    if (g.along === null || g.along === undefined) continue;
    const candidate = quarterNearest(g.along, rotation);
    // Asked of the turned piece, not the one lying askew. A wardrobe at thirty degrees
    // to a wall reaches almost a metre and a half across it, so its near corner is
    // already through the wall and nothing is ever within reach — which ruled out the
    // alignment in exactly the case that needed it. Turned, it is its own depth deep,
    // and the question becomes the one worth asking: brought square to this wall, would
    // it be against it?
    const poly = furnitureFootprint({ ...item, x, y, rotation: candidate });
    const offer = offerOf(g, poly, { x, y }, reach);
    if (offer && (!best || Math.abs(offer.gap) < Math.abs(best.gap))) best = { gap: offer.gap, rotation: candidate };
  }
  return best ? best.rotation : rotation;
}

/** The quarter turn of `along` that lies nearest `rotation`. */
function quarterNearest(along, rotation) {
  let closest = rotation;
  let apart = Infinity;
  for (let q = 0; q < 4; q++) {
    const candidate = along + q * 90;
    const off = Math.abs(wrap180(candidate - rotation));
    if (off < apart) {
      apart = off;
      closest = candidate;
    }
  }
  return (((Math.round(closest * 10) / 10) % 360) + 360) % 360;
}

/**
 * The room a fitting has to have in front of it, if a standard says so.
 *
 * A piece faces its local +y — the side away from the wall its back is against —
 * so the space it needs is the rectangle just beyond that face.
 */
export function frontClearance(item) {
  const spec = furnitureById(item.kind ?? item.id);
  const clear = item.clear ?? spec?.clear;
  if (!clear) return null;
  const rad = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = Math.max((item.w ?? 600) / 2, clear.width / 2);
  const near = (item.h ?? 600) / 2;
  const far = near + clear.depth;
  const zone = [
    [-hw, near],
    [hw, near],
    [hw, far],
    [-hw, far],
  ].map(([x, y]) => ({ x: item.x + x * cos - y * sin, y: item.y + x * sin + y * cos }));
  return { zone, width: clear.width, depth: clear.depth, label: spec?.label ?? 'Fitting' };
}

/**
 * The floor a door leaf sweeps: a sector from the hinge, out to the clear width.
 *
 * Measured over the whole swing the door is capable of, not the angle it happens to
 * be drawn at — the point of a clear zone is that the door can be opened.
 */
export function doorSwingZone(plan, opening) {
  // A window counts too. A Drehflügel swings into the room exactly as a door does,
  // and a wardrobe pushed up beside it is the classic way to find out afterwards
  // that it cannot be opened. What does not count: a fixed light, a Kippflügel —
  // which needs no floor, only the height above the sill — and a sliding leaf.
  if (opening.kind === 'opening') return null;
  if (!swingsOpen(opening)) return null;
  const geo = openingGeometry(plan, opening);
  if (!geo) return null;
  const layout = leafLayout(opening, geo.thickness);
  const reach = layout.length;
  const sweep = Math.min(MAX_SWING, 90); // the zone a door has to have to open properly
  const at = (a, c) => ({ x: geo.x1 + geo.dx * a + geo.nx * c, y: geo.y1 + geo.dy * a + geo.ny * c });

  const arc = ({ hingeA, dirAlong }) => {
    const pts = [at(hingeA, layout.hingeC)];
    for (let i = 0; i <= SWING_STEPS; i++) {
      const theta = ((sweep * i) / SWING_STEPS) * (Math.PI / 180);
      pts.push(
        at(hingeA + Math.cos(theta) * dirAlong * reach, layout.hingeC + Math.sin(theta) * layout.side * reach)
      );
    }
    return pts;
  };
  return {
    zones: layout.leaves.map(arc),
    reach,
    side: layout.side,
    angle: swingAngle(opening),
    // How high off the floor the leaf starts. A door sweeps from the floor up, so
    // everything is in its way; a window sweeps from the sill up, so a sideboard
    // under it is not — only what stands taller than the sill.
    sill: Math.max(0, opening.sill ?? 0),
  };
}

// ---- overlap -------------------------------------------------------------

function axes(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) out.push({ x: -dy / len, y: dx / len });
  }
  return out;
}

function span(poly, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Whether two convex shapes share any floor, and by how much at the tightest.
 *
 * Separating axes: if a line can be drawn with one shape wholly each side of it,
 * they are apart. Everything checked here is convex — a rectangle, a stair's
 * footprint, a door's sector — so this is exact.
 */
export function overlapDepth(a, b, tolerance = 20) {
  if (a.length < 3 || b.length < 3) return 0;
  let least = Infinity;
  for (const axis of [...axes(a), ...axes(b)]) {
    const sa = span(a, axis);
    const sb = span(b, axis);
    const gap = Math.min(sa.max - sb.min, sb.max - sa.min);
    if (gap <= tolerance) return 0;
    if (gap < least) least = gap;
  }
  return Number.isFinite(least) ? least : 0;
}

// ---- the checks ----------------------------------------------------------

const mm = (value) => `${Math.round(value)} mm`;

function centreOf(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x / poly.length;
    y += p.y / poly.length;
  }
  return { x, y };
}

/**
 * Everything in the way, worst first.
 *
 * @returns [{level, text, at:{x,y}, kind}]
 */
export function clearanceIssues(plan) {
  const issues = [];
  const furniture = (plan.furniture ?? []).map((item) => ({
    item,
    poly: furnitureFootprint(item),
    spec: furnitureById(item.kind ?? item.id),
  }));
  const stairs = (plan.stairs ?? []).map((stair) => ({ poly: stairWorldFootprint(stair) }));
  const doors = [];
  for (const opening of plan.openings ?? []) {
    const swing = doorSwingZone(plan, opening);
    if (swing) doors.push({ opening, swing });
  }

  // A door against what is standing in its way.
  for (const { opening, swing } of doors) {
    for (const zone of swing.zones) {
      for (const other of furniture) {
        // Under the sill it is not in the way. A window over a worktop opens fine.
        if ((other.spec?.z ?? 0) <= swing.sill + 20) continue;
        const depth = overlapDepth(zone, other.poly);
        if (!depth) continue;
        issues.push({
          level: depth > 200 ? 'bad' : 'warn',
          kind: 'swing',
          text: `The ${opening.kind === 'window' ? 'window' : 'door'} catches the ${(
            other.spec?.label ?? 'furniture'
          ).toLowerCase()} — ${mm(depth)} into its swing.`,
          at: centreOf(other.poly),
          shape: other.poly,
          openingId: opening.id,
        });
      }
      for (const { poly } of stairs) {
        const depth = overlapDepth(zone, poly);
        if (depth > 100) {
          issues.push({
            level: 'bad',
            kind: 'swing',
            text: `The door opens over the stair — ${mm(depth)} into its swing.`,
            at: centreOf(poly),
            shape: poly,
            openingId: opening.id,
          });
        }
      }
    }
  }

  // Two doors swinging into each other.
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      let worst = 0;
      let where = null;
      for (const one of doors[i].swing.zones) {
        for (const two of doors[j].swing.zones) {
          const depth = overlapDepth(one, two, 40);
          if (depth > worst) {
            worst = depth;
            where = centreOf(one);
          }
        }
      }
      if (worst > 100) {
        issues.push({
          level: worst > 300 ? 'bad' : 'warn',
          kind: 'swing',
          text: `Two swings run into each other — ${mm(worst)} of overlap. Hang one on the other side.`,
          at: where,
          openingId: doors[i].opening.id,
          alsoOpeningId: doors[j].opening.id,
        });
      }
    }
  }

  // The room a fitting needs in front of it.
  for (const { item, spec } of furniture) {
    const clear = frontClearance({ ...item, kind: item.kind ?? item.id });
    if (!clear) continue;
    for (const other of furniture) {
      if (other.item === item) continue;
      const depth = overlapDepth(clear.zone, other.poly, 30);
      if (!depth) continue;
      issues.push({
        level: depth > 150 ? 'bad' : 'warn',
        kind: 'clear',
        text:
          `The ${(spec?.label ?? 'fitting').toLowerCase()} needs ${clear.width} × ${clear.depth} mm in front of it; ` +
          `the ${(other.spec?.label ?? 'furniture').toLowerCase()} takes ${mm(depth)} of it.`,
        at: centreOf(clear.zone),
        shape: other.poly,
      });
    }
  }

  // Two things in the same place.
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      const depth = overlapDepth(furniture[i].poly, furniture[j].poly, 30);
      if (depth < 60) continue;
      issues.push({
        level: 'warn',
        kind: 'overlap',
        text: `The ${(furniture[i].spec?.label ?? 'furniture').toLowerCase()} and the ${(
          furniture[j].spec?.label ?? 'furniture'
        ).toLowerCase()} overlap by ${mm(depth)}.`,
        at: centreOf(furniture[i].poly),
      });
    }
  }

  const rank = { bad: 0, warn: 1, ok: 2 };
  return issues.sort((a, b) => rank[a.level] - rank[b.level]);
}
