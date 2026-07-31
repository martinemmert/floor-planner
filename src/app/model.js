// The document model. Millimetres, y downward.
//
// Walls join through shared nodes, so dragging a corner moves every wall that
// meets there. Openings store an offset along their wall, so a door rides along
// when its wall moves. Rooms are derived from the wall graph on every change;
// only their names and keep state are stored.

import { detectRooms, nameRooms } from '../geom/faces.js';
import {
  clipPolygonHalfPlane,
  clipPolygonOutsideBox,
  dist,
  lineIntersection,
  pointInPolygon,
  pointSegDistance,
  polygonArea,
  polygonCentroid,
} from '../geom/vec.js';
import { defaultsFor, openingWidth, stockOf } from './openings.js';
import { emptyBackdrop, rescaleBackdrop } from './backdrop.js';
import { stairWorldFootprint, stairWorldTreads } from './stairs.js';

export const WALL_TYPES = [
  { id: 'exterior', label: 'Exterior', thickness: 365 },
  { id: 'bearing', label: 'Load-bearing', thickness: 175 },
  { id: 'partition', label: 'Partition', thickness: 115 },
];

export function wallTypeFor(id) {
  return WALL_TYPES.find((t) => t.id === id) ?? WALL_TYPES[2];
}

let counter = 0;
export function nextId(prefix) {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/**
 * A floor as a copy of another: the same building, ready to be knocked about.
 *
 * A house is mostly the same shell storey after storey, so this is how a second floor
 * actually gets drawn. Everything gets a new id — a copy that shared ids with its
 * source would have the two floors editing each other — and the backdrop is left
 * behind, because a traced PDF page belongs to the storey it was traced from.
 */
export function copyPlan(plan, options = {}) {
  const fresh = new Map();
  const id = (old, prefix) => {
    if (!fresh.has(old)) fresh.set(old, nextId(prefix));
    return fresh.get(old);
  };
  const list = (items, prefix, extra = () => ({})) =>
    (items ?? []).map((item) => ({ ...item, id: id(item.id, prefix), ...extra(item) }));

  return {
    ...plan,
    id: nextId('p'),
    name: options.name ?? `${plan.name} copy`,
    // One storey up, not the same one. Spread along with everything else it kept its
    // source's level, so "copy this floor" made two floors claiming to be the ground
    // floor — and the stack put one of them on top of the other at the same height.
    storey: options.storey ?? (Number.isFinite(plan.storey) ? plan.storey + 1 : undefined),
    nodes: list(plan.nodes, 'n'),
    walls: list(plan.walls, 'w', (wall) => ({ a: id(wall.a, 'n'), b: id(wall.b, 'n') })),
    openings: list(plan.openings, 'o', (opening) => ({ wallId: id(opening.wallId, 'w') })),
    furniture: list(plan.furniture, 'f'),
    labels: list(plan.labels, 'l'),
    dimensions: list(plan.dimensions, 'd', (dim) => ({
      ...(dim.fromNode ? { fromNode: id(dim.fromNode, 'n') } : {}),
      ...(dim.toNode ? { toNode: id(dim.toNode, 'n') } : {}),
    })),
    fixtures: list(plan.fixtures, 'x', (fixture) => (fixture.wallId ? { wallId: id(fixture.wallId, 'w') } : {})),
    stairs: list(plan.stairs, 's'),
    columns: list(plan.columns, 'c'),
    voids: list(plan.voids, 'v'),
    guides: list(plan.guides, 'g'),
    rooms: (plan.rooms ?? []).map((room) => ({ ...room })),
    // Not the traced page: it belongs to the storey it was traced from, and a copy of
    // it under a different floor is a drawing of somewhere else.
    backdrop: emptyBackdrop(),
    version: 0,
  };
}

export function createPlan(options = {}) {
  return {
    id: nextId('p'),
    name: options.name ?? 'Ground floor',
    scaleDenominator: options.scaleDenominator ?? 100,
    scaleConfirmed: false,
    // Which faces sizes are quoted against. Outside is what a building is
    // normally described by, so it is the default.
    dimBasis: options.dimBasis ?? 'outer',
    // Vertical: clear height under the ceiling, and the slab above it.
    height: options.height ?? 2500,
    floorThickness: options.floorThickness ?? 250,
    stairs: [],
    columns: [],
    fixtures: [],
    guides: [],
    voids: [],
    joinStyle: options.joinStyle ?? 'mitre',
    nodes: [],
    walls: [],
    openings: [],
    furniture: [],
    labels: [],
    dimensions: [],
    rooms: [],
    backdrop: emptyBackdrop(),
    show: {
      rooms: true,
      dimensions: true,
      labels: true,
      furniture: true,
      backdrop: true,
      openingSizes: true,
      guides: true,
      headroom: true,
      voids: true,
      clearances: false,
      autoDims: true,
      stairCut: true,
      stairNumbers: false,
    },
    cutHeight: 1000,
    version: 0,
  };
}

export function createProject(options = {}) {
  const plan = createPlan({ name: options.planName ?? 'Ground floor' });
  return {
    id: nextId('prj'),
    name: options.name ?? 'My floor plan',
    createdAt: options.now ?? 0,
    updatedAt: options.now ?? 0,
    plans: [plan],
    activePlanId: plan.id,
    // Where the building is and which way it faces. `bearing` is the compass bearing
    // of the direction the plan calls up, so 0 is a plan drawn north up.
    site: { latitude: 50.09, longitude: 8.45, label: 'Hofheim am Taunus', bearing: 0 },
  };
}

export function activePlan(project) {
  return project.plans.find((p) => p.id === project.activePlanId) ?? project.plans[0];
}

export function touch(plan) {
  plan.version = (plan.version ?? 0) + 1;
}

// ---- nodes and walls ---------------------------------------------------

export function findNode(plan, id) {
  return plan.nodes.find((n) => n.id === id);
}

export function findWall(plan, id) {
  return plan.walls.find((w) => w.id === id);
}

export function addNode(plan, x, y, tolerance = 1) {
  for (const node of plan.nodes) {
    if (dist(node.x, node.y, x, y) <= tolerance) return node;
  }
  const node = { id: nextId('n'), x, y };
  plan.nodes.push(node);
  return node;
}

export function addWall(plan, ax, ay, bx, by, options = {}) {
  const type = options.type ?? 'partition';
  const thickness = options.thickness ?? wallTypeFor(type).thickness;
  const tolerance = options.weld ?? 25;
  const a = addNode(plan, ax, ay, tolerance);
  const b = addNode(plan, bx, by, tolerance);
  if (a.id === b.id) return null;
  const existing = plan.walls.find(
    (w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id)
  );
  if (existing) return existing;
  const wall = { id: nextId('w'), a: a.id, b: b.id, thickness, type };
  plan.walls.push(wall);
  return wall;
}

/**
 * Copy a set of walls, offset, keeping the corners they share.
 *
 * The whole set at once, because walls are not separate things: a corner belongs to
 * both walls that meet at it. Copied one at a time each would mint its own pair of
 * corners and the copy would come apart at every junction — four walls in, four
 * disconnected sticks out, and no room inside them.
 *
 * Whatever is cut into a copied wall comes with it, since a door in a wall you are
 * copying is part of what you meant to copy.
 *
 * @returns the new walls
 */
export function copyWalls(plan, wallIds, dx, dy) {
  const wanted = new Set(wallIds);
  const walls = plan.walls.filter((wall) => wanted.has(wall.id));
  if (!walls.length) return [];

  // One new corner per old corner, made once and shared by every wall that used it.
  const corners = new Map();
  const cornerFor = (id) => {
    if (corners.has(id)) return corners.get(id);
    const node = findNode(plan, id);
    if (!node) return null;
    // No welding: a copy landing back on the original's corners would be swallowed by
    // them and the two would become one wall.
    const made = { id: nextId('n'), x: node.x + dx, y: node.y + dy };
    plan.nodes.push(made);
    corners.set(id, made);
    return made;
  };

  const made = [];
  for (const wall of walls) {
    const a = cornerFor(wall.a);
    const b = cornerFor(wall.b);
    if (!a || !b) continue;
    const copy = { ...wall, id: nextId('w'), a: a.id, b: b.id };
    plan.walls.push(copy);
    made.push(copy);
    for (const opening of plan.openings ?? []) {
      if (opening.wallId !== wall.id) continue;
      plan.openings.push({ ...opening, id: nextId('o'), wallId: copy.id });
    }
  }
  return made;
}

export function wallEnds(plan, wall) {
  const a = findNode(plan, wall.a);
  const b = findNode(plan, wall.b);
  return a && b ? { a, b } : null;
}

export function wallSegment(plan, wall) {
  const ends = wallEnds(plan, wall);
  return ends ? { x1: ends.a.x, y1: ends.a.y, x2: ends.b.x, y2: ends.b.y } : null;
}

export function wallLength(plan, wall) {
  const ends = wallEnds(plan, wall);
  return ends ? dist(ends.a.x, ends.a.y, ends.b.x, ends.b.y) : 0;
}

export function wallAngle(plan, wall) {
  const ends = wallEnds(plan, wall);
  if (!ends) return 0;
  const deg = (Math.atan2(-(ends.b.y - ends.a.y), ends.b.x - ends.a.x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

// ---- reference line vs faces -------------------------------------------
//
// Walls are stored on their centreline, the way every CAD tool stores them: the
// join at a corner stays symmetric and changing a thickness does not shift the
// wall. What a drawing is dimensioned to, though, is faces — outer faces for the
// overall size, inner faces for a room's clear width. These functions convert.
//
// At a mitred corner the outer face runs past the shared node and the inner face
// stops short of it, both by the same amount:
//
//     delta = (t_this/2 · cos θ + t_other/2) / sin θ
//
// where θ is the angle between the two walls. For a square corner that reduces to
// half the other wall's thickness. Where a wall butts into one that carries on
// past (a T-junction), both of its faces stop at that wall's face instead.

const COLLINEAR = 0.09; // radians, about 5 degrees

function directionAt(plan, wall, nodeId) {
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const from = ends.a.id === nodeId ? ends.a : ends.b;
  const to = ends.a.id === nodeId ? ends.b : ends.a;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len < 1e-6) return null;
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
}

function angleBetweenDirs(a, b) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  return Math.acos(dot);
}

/**
 * The most a joint may take off, or add to, one end of a wall.
 *
 * At a sharp corner the true mitre runs out to a spike — two faces meeting at six
 * degrees really do cross a metre and a half away — and where a thin partition
 * butts into a thick wall at a shallow angle the same thing happens inward. Left
 * alone, a shift longer than half the wall turns the wall inside out: the drawing
 * shows a wedge with a point on it and the clear length reads as nonsense. So the
 * mitre is limited, the way every drawing program limits one, and never allowed to
 * eat more than two fifths of the wall from either end.
 */
function mitreCap(plan, wall) {
  return Math.min(MITRE_LIMIT * Math.max(wall.thickness, 1), wallLength(plan, wall) * 0.4);
}

function jointOffset(plan, wall, nodeId) {
  const u = directionAt(plan, wall, nodeId);
  if (!u) return { extend: 0, recede: 0 };
  const others = plan.walls.filter((w) => w.id !== wall.id && (w.a === nodeId || w.b === nodeId));
  const turns = [];
  let carriesOn = false;
  for (const other of others) {
    const v = directionAt(plan, other, nodeId);
    if (!v) continue;
    const theta = angleBetweenDirs(u, v);
    if (theta < COLLINEAR || theta > Math.PI - COLLINEAR) {
      carriesOn = true; // this wall runs straight through the node
      continue;
    }
    turns.push({ other, theta });
  }
  if (turns.length === 0) return { extend: 0, recede: 0 };

  // The deepest that something butting in cuts into this wall.
  let deepest = 0;
  for (const turn of turns) {
    const off = turn.other.thickness / 2 / Math.sin(turn.theta);
    if (off > deepest) deepest = off;
  }

  const cap = mitreCap(plan, wall);
  const limit = (value) => Math.max(-cap, Math.min(cap, value));

  if (carriesOn) {
    // This wall passes through, so its far face is untouched; only the face the
    // other wall butts into is interrupted.
    return { extend: 0, recede: limit(-deepest) };
  }
  if (turns.length === 1) {
    const { other, theta } = turns[0];
    const delta = ((wall.thickness / 2) * Math.cos(theta) + other.thickness / 2) / Math.sin(theta);
    return { extend: limit(delta), recede: limit(-delta) };
  }
  // This wall ends here against others: both of its faces stop at their face.
  return { extend: limit(-deepest), recede: limit(-deepest) };
}

export const JOIN_STYLES = [
  { id: 'mitre', label: 'Mitre', hint: 'faces meet in a clean point, correct at any angle' },
  { id: 'square', label: 'Square', hint: 'each wall runs square into the corner and overlaps' },
  { id: 'butt', label: 'Butt', hint: 'each wall stops dead at the corner' },
];

// A very sharp corner mitres out to a spike; past this multiple of the wall
// thickness it is cut back, as any drawing program does.
const MITRE_LIMIT = 3.5;

/**
 * The four corners of a wall as it is drawn, in order: the two on its left face
 * then the two on its right. Shared by the plan, the SVG export and the 3D model,
 * so a join can never look different in one of them.
 *
 * At a mitred corner one face runs past the shared node and the other stops short
 * of it, by the amount `jointOffset` works out. Which face does which depends on
 * the way the corner turns.
 */
export function wallCorners(plan, wall) {
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const { a, b } = ends;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return null;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const t = wall.thickness / 2;
  const style = plan.joinStyle ?? 'mitre';

  // shift along the wall's own direction, per end and per face
  const shiftFor = (nodeId) => {
    if (style === 'butt') return { left: 0, right: 0 };
    const joint = jointOffset(plan, wall, nodeId);
    if (style === 'square') {
      // The old behaviour: grow square into any shared corner.
      const grow = nodeDegree(plan, nodeId) > 1 ? t : 0;
      return { left: -grow, right: -grow };
    }
    const delta = joint.extend;
    if (joint.extend <= 0) {
      // Butting into something, or running straight on: both faces stop together.
      return { left: -joint.extend, right: -joint.extend };
    }
    // Which side is the outside of the turn?
    const turn = turnSideAt(plan, wall, nodeId, { x: nx, y: ny });
    if (turn === 0) return { left: 0, right: 0 };
    return turn > 0 ? { left: delta, right: -delta } : { left: -delta, right: delta };
  };

  const atA = shiftFor(wall.a);
  const atB = shiftFor(wall.b);
  // A shift measured "away from the node" points along +u at A and along -u at B.
  const leftA = { x: a.x + nx * t + ux * atA.left, y: a.y + ny * t + uy * atA.left };
  const rightA = { x: a.x - nx * t + ux * atA.right, y: a.y - ny * t + uy * atA.right };
  const leftB = { x: b.x + nx * t - ux * atB.left, y: b.y + ny * t - uy * atB.left };
  const rightB = { x: b.x - nx * t - ux * atB.right, y: b.y - ny * t - uy * atB.right };
  return [leftA, leftB, rightB, rightA];
}

/** +1 when the neighbour turns toward this wall's left, -1 toward its right. */
function turnSideAt(plan, wall, nodeId, normal) {
  const others = plan.walls.filter((w) => w.id !== wall.id && (w.a === nodeId || w.b === nodeId));
  const u = directionAt(plan, wall, nodeId);
  if (!u) return 0;
  let best = 0;
  let bestTheta = 0;
  for (const other of others) {
    const v = directionAt(plan, other, nodeId);
    if (!v) continue;
    const theta = angleBetweenDirs(u, v);
    if (theta < COLLINEAR || theta > Math.PI - COLLINEAR) continue;
    if (theta > bestTheta) {
      bestTheta = theta;
      // The normal is the wall's left; `u` points away from the node, so a
      // neighbour on the +normal side means the corner turns left.
      best = v.x * normal.x + v.y * normal.y > 0 ? 1 : -1;
    }
  }
  return best;
}

// ---- wall height and knee walls ---------------------------------------

/** A wall's own height, falling back to the storey's ceiling height. */
export function wallHeight(plan, wall) {
  const own = wall.height;
  return Number.isFinite(own) && own > 0 ? own : plan.height ?? 2500;
}

/** A wall shorter than the storey is a knee wall — a Drempel under a slope. */
export function isKneeWall(plan, wall) {
  return wallHeight(plan, wall) < (plan.height ?? 2500) - 1;
}

export function kneeWalls(plan) {
  return plan.walls.filter((w) => isKneeWall(plan, w));
}

// ---- fixtures ----------------------------------------------------------

export function addFixture(plan, spec) {
  const fixture = { id: nextId('x'), rotation: 0, ...spec };
  plan.fixtures.push(fixture);
  return fixture;
}

export function findFixture(plan, id) {
  return plan.fixtures.find((f) => f.id === id);
}

/**
 * Where a fixture sits and which way it faces. One mounted on a wall stores the
 * wall, how far along it, and which side — so it rides along when the wall moves,
 * exactly as a door does.
 */
export function fixturePlacement(plan, fixture) {
  if (!fixture.wallId) {
    return { x: fixture.x, y: fixture.y, angle: fixture.rotation ?? 0, wall: null };
  }
  const wall = findWall(plan, fixture.wallId);
  const ends = wall ? wallEnds(plan, wall) : null;
  if (!ends) return { x: fixture.x ?? 0, y: fixture.y ?? 0, angle: fixture.rotation ?? 0, wall: null };
  const len = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y) || 1;
  const ux = (ends.b.x - ends.a.x) / len;
  const uy = (ends.b.y - ends.a.y) / len;
  const side = fixture.side ?? 1;
  const nx = -uy * side;
  const ny = ux * side;
  const along = Math.max(0, Math.min(len, fixture.offset ?? len / 2));
  const face = wall.thickness / 2;
  return {
    x: ends.a.x + ux * along + nx * face,
    y: ends.a.y + uy * along + ny * face,
    // The symbol's +a runs along the wall and +c into the room.
    angle: (Math.atan2(uy * side, ux * side) * 180) / Math.PI,
    wall,
    side,
    along,
    length: len,
  };
}

/**
 * Maps a point in a fixture's own frame to the drawing: `a` runs along the wall,
 * `c` away from it into the room.
 */
export function fixtureToWorld(placement, a, c) {
  const rad = (placement.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: placement.x + a * cos - c * sin, y: placement.y + a * sin + c * cos };
}

export const DIM_BASES = [
  { id: 'outer', label: 'Outside', hint: 'across the outer faces' },
  { id: 'centre', label: 'Centreline', hint: 'the line the wall is stored on' },
  { id: 'inner', label: 'Inside', hint: 'clear, between the inner faces' },
];

/** Centreline, outer-face and inner-face lengths of one wall. */
export function wallLengths(plan, wall) {
  const centre = wallLength(plan, wall);
  const a = jointOffset(plan, wall, wall.a);
  const b = jointOffset(plan, wall, wall.b);
  return {
    centre,
    outer: centre + a.extend + b.extend,
    inner: Math.max(0, centre + a.recede + b.recede),
    offsets: { a, b },
  };
}

export function wallLengthOn(plan, wall, basis) {
  const lengths = wallLengths(plan, wall);
  if (basis === 'outer') return lengths.outer;
  if (basis === 'inner') return lengths.inner;
  return lengths.centre;
}

/**
 * Sets a wall's length given on any basis, by moving its second end.
 *
 * Moving that end drags whatever is joined to it, which can change the angle of
 * the corner and so the mitre — meaning a single conversion from face length to
 * centreline length overshoots. A few passes settle it, which is what makes the
 * typed figure land exactly.
 */
export function setWallLengthOn(plan, wallId, value, basis) {
  const wall = findWall(plan, wallId);
  if (!wall || !Number.isFinite(value) || value <= 0) return false;
  const ends = wallEnds(plan, wall);
  if (!ends) return false;
  const dx = ends.b.x - ends.a.x;
  const dy = ends.b.y - ends.a.y;
  const current = Math.hypot(dx, dy);
  if (current < 1e-6) return false;
  const ux = dx / current;
  const uy = dy / current;
  // Everything hanging off the moving end travels with it, so corners stay square
  // and the rest of the plan stretches rather than shears.
  const branch = branchNodes(plan, wall.b, { x: ux, y: uy }, wall.a);
  let at = current;
  const setCentre = (length) => {
    const step = length - at;
    if (branch) translateNodes(plan, branch, ux * step, uy * step);
    else {
      ends.b.x = ends.a.x + ux * length;
      ends.b.y = ends.a.y + uy * length;
    }
    at = length;
  };

  if (basis === 'centre') {
    if (value < 20) return false;
    setCentre(value);
    return true;
  }

  let centre = value;
  for (let pass = 0; pass < 8; pass++) {
    if (centre < 20) {
      setCentre(current); // put it back; the request cannot be met
      return false;
    }
    setCentre(centre);
    const error = value - wallLengthOn(plan, wall, basis);
    if (Math.abs(error) < 0.05) return true;
    centre += error;
  }
  return true;
}

/**
 * Turns a wall to an absolute bearing, pivoting on its first end. Anything
 * hanging off the far end swings with it as one rigid piece; if the shape closes
 * back on itself only the far end moves, which reshapes the corner.
 */
export function setWallAngle(plan, wallId, degrees) {
  const wall = findWall(plan, wallId);
  if (!wall || !Number.isFinite(degrees)) return false;
  const ends = wallEnds(plan, wall);
  if (!ends) return false;
  const current = wallAngle(plan, wall);
  let delta = ((degrees - current) % 360 + 360) % 360;
  if (delta > 180) delta -= 360;
  if (Math.abs(delta) < 1e-6) return false;
  // screen y grows downward, so a rising bearing turns the other way
  const rad = (-delta * Math.PI) / 180;
  const pivot = { x: ends.a.x, y: ends.a.y };

  let moving = connectedNodes(plan, wall.b, wall.a);
  for (const other of plan.walls) {
    if (other.id === wall.id) continue;
    const touchesPivot = other.a === wall.a || other.b === wall.a;
    const far = other.a === wall.a ? other.b : other.a;
    if (touchesPivot && moving.has(far)) {
      moving = new Set([wall.b]); // closed loop: only the far end can move
      break;
    }
  }

  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const node of plan.nodes) {
    if (!moving.has(node.id)) continue;
    const rx = node.x - pivot.x;
    const ry = node.y - pivot.y;
    node.x = pivot.x + rx * cos - ry * sin;
    node.y = pivot.y + rx * sin + ry * cos;
  }
  return true;
}

// ---- rooms as editable objects -----------------------------------------

const ROOM_TOLERANCE = 1.5; // mm

/**
 * Drops corners that are not really corners. A room's boundary picks up a vertex
 * wherever another wall butts into it, so a plain rectangle can arrive with five
 * or six points that still describe four sides.
 */
export function simplifyPolygon(points) {
  if (points.length < 4) return points;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const here = points[i];
    const next = points[(i + 1) % points.length];
    const ax = here.x - prev.x;
    const ay = here.y - prev.y;
    const bx = next.x - here.x;
    const by = next.y - here.y;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const turn = Math.abs((ax * by - ay * bx) / (la * lb)); // |sin| of the turn
    if (turn > 0.01) out.push(here);
  }
  return out.length >= 3 ? out : points;
}

/**
 * The plan's own nodes that sit on a room's boundary. A room's face comes from
 * the wall graph, whose node numbering is its own, so the way back to the plan is
 * geometric: any node lying on the boundary outline belongs to it — including the
 * junction where a partition butts into one of its walls.
 */
export function roomBoundaryNodeIds(plan, room) {
  const ids = new Set();
  if (!room) return ids;
  const poly = room.polygon;
  for (const node of plan.nodes) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const d = pointSegDistance(node.x, node.y, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      if (d <= ROOM_TOLERANCE) {
        ids.add(node.id);
        break;
      }
    }
  }
  return ids;
}

/**
 * The two axes of an axis-aligned rectangular room: its size on each basis, the
 * nodes on each side, and the thickness of the walls closing that axis. Null for
 * rooms that are not rectangles square to the drawing.
 */
/**
 * How far a room reaches along a straight line drawn across it.
 *
 * The measurement that replaces a bounding box. A bounding box describes a rectangle
 * and nothing else: give a room one slanted wall and `max - min` is a number no edge
 * of that room has, and a line drawn between those extremes leaves the room entirely
 * and crosses the wall. A chord is true wherever it is taken, and the line drawn for
 * it runs inside the room, which is what makes it readable — you can see where the
 * number was measured.
 *
 * The longest run is the answer, so a room pinched in the middle by a projecting wall
 * reports a side of it rather than the gap.
 *
 * @param points the room's boundary, in order
 * @param axis 'x' to measure across the room at a given y, 'y' for the other way
 * @param at where to take the measurement, on the other axis
 * @returns {{from, to, length}} along `axis`, or null if the line misses the room
 */
export function polygonChord(points, axis, at) {
  const other = axis === 'x' ? 'y' : 'x';
  const crossings = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const av = a[other];
    const bv = b[other];
    // Half open, so a vertex exactly on the line is counted once rather than twice
    // and the runs stay paired.
    if ((av <= at && bv > at) || (bv <= at && av > at)) {
      crossings.push(a[axis] + ((b[axis] - a[axis]) * (at - av)) / (bv - av));
    }
  }
  crossings.sort((p, q) => p - q);
  let best = null;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const length = crossings[i + 1] - crossings[i];
    if (!best || length > best.length) best = { from: crossings[i], to: crossings[i + 1], length };
  }
  return best;
}

export function roomAxes(plan, room) {
  if (!room) return null;
  const poly = simplifyPolygon(room.polygon);
  if (poly.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > 1 && Math.abs(a.y - b.y) > 1) return null; // not square to the drawing
  }
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const bounds = {
    x: [Math.min(...xs), Math.max(...xs)],
    y: [Math.min(...ys), Math.max(...ys)],
  };
  if (bounds.x[1] - bounds.x[0] < 1 || bounds.y[1] - bounds.y[0] < 1) return null;
  const boundary = roomBoundaryNodeIds(plan, room);

  // The wall closing an axis runs across it, sits at that coordinate, and spans
  // part of the room's other dimension.
  const closingThickness = (axis, at) => {
    const other = axis === 'x' ? 'y' : 'x';
    let thickest = 0;
    for (const wall of plan.walls) {
      const ends = wallEnds(plan, wall);
      if (!ends) continue;
      const a = ends.a;
      const b = ends.b;
      if (Math.abs(a[axis] - at) > ROOM_TOLERANCE || Math.abs(b[axis] - at) > ROOM_TOLERANCE) continue;
      const lo = Math.min(a[other], b[other]);
      const hi = Math.max(a[other], b[other]);
      const overlap = Math.min(hi, bounds[other][1]) - Math.max(lo, bounds[other][0]);
      if (overlap > 1 && wall.thickness > thickest) thickest = wall.thickness;
    }
    return thickest;
  };

  const build = (axis) => {
    const [min, max] = bounds[axis];
    const centre = max - min;
    const tMin = closingThickness(axis, min);
    const tMax = closingThickness(axis, max);
    const half = tMin / 2 + tMax / 2;
    const sideNodes = (at) => {
      const ids = new Set();
      for (const node of plan.nodes) {
        if (!boundary.has(node.id)) continue;
        if (Math.abs(node[axis] - at) <= ROOM_TOLERANCE) ids.add(node.id);
      }
      return ids;
    };
    return {
      axis,
      centre,
      inner: Math.max(0, centre - half),
      outer: centre + half,
      minNodes: sideNodes(min),
      maxNodes: sideNodes(max),
      tMin,
      tMax,
    };
  };
  return { x: build('x'), y: build('y') };
}

export function roomSizeOn(axisInfo, basis) {
  if (!axisInfo) return 0;
  if (basis === 'outer') return axisInfo.outer;
  if (basis === 'inner') return axisInfo.inner;
  return axisInfo.centre;
}

/** Resizes a rectangular room along one axis, keeping its opposite side put. */
export function setRoomSize(plan, room, axis, value, basis) {
  const axes = roomAxes(plan, room);
  const info = axes?.[axis];
  if (!info || !Number.isFinite(value) || value <= 0) return false;
  const targetCentre =
    basis === 'outer'
      ? value - (info.tMin / 2 + info.tMax / 2)
      : basis === 'inner'
        ? value + (info.tMin / 2 + info.tMax / 2)
        : value;
  if (targetCentre < 200) return false;
  const delta = targetCentre - info.centre;
  if (Math.abs(delta) < 1e-6) return true;
  const along = axis === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const start = [...info.maxNodes][0];
  const guard = [...info.minNodes][0];
  if (start === undefined) return false;
  const branch = branchNodes(plan, start, along, guard) ?? info.maxNodes;
  translateNodes(plan, branch, along.x * delta, along.y * delta);
  return true;
}

/** Moves a whole room, carrying the walls that bound it. */
export function moveRoom(plan, room, dx, dy) {
  if (!room || (dx === 0 && dy === 0)) return false;
  const ids = roomBoundaryNodeIds(plan, room);
  if (ids.size === 0) return false;
  translateNodes(plan, ids, dx, dy);
  return true;
}

/**
 * For a fresh rectangle every corner is square and every wall the same
 * thickness, so the outer size is the centreline size plus one thickness and the
 * clear size is one thickness less.
 */
export function rectBasisShift(basis, thickness) {
  if (basis === 'outer') return thickness;
  if (basis === 'inner') return -thickness;
  return 0;
}

/** Clear width and depth of a rectangular room, from its inner polygon. */
/**
 * The frame a room is square to, which is not always the frame the drawing is square to.
 *
 * Turn a room fifteen degrees and every measurement taken along x and y stops
 * describing it: the width becomes the width of a box drawn round it, and a line set in
 * from that box's edge crosses the room at a corner, where it is a sliver. That is what
 * made a 15 m² room read as two metres across.
 *
 * So the room is measured square to its own walls. The frame is chosen the way a
 * minimum-area bounding rectangle is: every edge direction is tried and the one wrapping
 * the room most tightly wins, which for anything rectangular is the walls themselves.
 * It is then turned to lie within 45° of the drawing, so "width" still means roughly
 * across the page and the two readings do not swap names as a room is rotated.
 *
 * @returns {{ox, oy, ux, uy, angle}} `angle` in degrees, how far off the drawing it is
 */
export const SQUARE_TO_PAGE = { ox: 0, oy: 0, ux: 1, uy: 0, angle: 0 };

/**
 * The frame that wraps a set of points most tightly, chosen from a set of directions.
 *
 * A minimum-area bounding rectangle, restricted to directions the drawing actually
 * contains — the edges of a room, or the walls of a storey. Every candidate is first
 * turned into the quarter turn nearest the page, so the four sides of a rectangle all
 * propose one frame rather than two at right angles, and so "width" keeps meaning
 * roughly across the page however the thing is rotated.
 *
 * @param directions [{x, y}] candidate directions, not necessarily unit
 * @param points the points to wrap
 */
export function tightestFrame(directions, points) {
  if (points.length < 3) return null;
  let best = null;
  for (const d of directions) {
    const len = Math.hypot(d.x, d.y);
    if (len < 1e-6) continue;
    let angle = Math.atan2(d.y / len, d.x / len);
    while (angle <= -Math.PI / 4) angle += Math.PI / 2;
    while (angle > Math.PI / 4) angle -= Math.PI / 2;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of points) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    // A hair of slack, so a frame already square to the page is not displaced by a
    // rounding difference in a drawing that is square to it.
    if (!best || area < best.area - 1) best = { area, ux, uy, angle };
  }
  if (!best) return null;
  return { ox: 0, oy: 0, ux: best.ux, uy: best.uy, angle: (best.angle * 180) / Math.PI };
}

export function roomFrame(room) {
  const points = simplifyPolygon(room?.inner ?? []);
  if (points.length < 3) return null;
  const directions = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return { x: q.x - p.x, y: q.y - p.y };
  });
  // The page itself is always a candidate, so a room that is square to the drawing
  // stays square to it rather than being tilted by a chamfer across one corner.
  directions.push({ x: 1, y: 0 });
  return tightestFrame(directions, points);
}

/** A point taken into a room's own frame: `u` along its walls, `v` across them. */
export function intoFrame(frame, x, y) {
  return { u: x * frame.ux + y * frame.uy, v: -x * frame.uy + y * frame.ux };
}

/** And back out of it, into the drawing. */
export function outOfFrame(frame, u, v) {
  return { x: u * frame.ux - v * frame.uy, y: u * frame.uy + v * frame.ux };
}

/**
 * How far a room reaches along a line drawn across it, square to the room's own walls.
 *
 * The same chord as `polygonChord`, taken in the room's frame and given back in the
 * drawing's, so the line can be drawn where it was measured.
 */
export function roomChord(room, frame, axis, at) {
  const points = (room.inner ?? []).map((p) => {
    const f = intoFrame(frame, p.x, p.y);
    return { x: f.u, y: f.v };
  });
  const chord = polygonChord(points, axis, at);
  if (!chord) return null;
  const ends =
    axis === 'x'
      ? [outOfFrame(frame, chord.from, at), outOfFrame(frame, chord.to, at)]
      : [outOfFrame(frame, at, chord.from), outOfFrame(frame, at, chord.to)];
  return { from: ends[0], to: ends[1], length: chord.length };
}

/** A room's extent in its own frame, as `{u:[lo,hi], v:[lo,hi]}`. */
export function roomExtent(room, frame) {
  const us = [];
  const vs = [];
  for (const p of room.inner ?? []) {
    const f = intoFrame(frame, p.x, p.y);
    us.push(f.u);
    vs.push(f.v);
  }
  if (!us.length) return null;
  return { u: [Math.min(...us), Math.max(...us)], v: [Math.min(...vs), Math.max(...vs)] };
}

/**
 * Where a room is measured, on one axis: near each wall and across the middle.
 *
 * The same three lines the 3D view draws its dimensions on, so the two cannot report
 * different rooms. Set in off the wall, because a chord taken hard against a corner of
 * a tapering room runs out to nothing — a true reading, and a useless one.
 */
export function measureLines(lo, hi) {
  // Half a metre where the room allows it. Closer than that the line runs along the
  // foot of the wall, which is the first strip of floor a wall hides as the model is
  // turned down towards level — so the figure was there and then not there.
  const inset = Math.min(500, (hi - lo) / 6);
  return [lo + inset, (lo + hi) / 2, hi - inset];
}

/**
 * How wide and how deep a room is, inside its walls.
 *
 * A range rather than a pair, because outside a rectangle there is no pair. It used to
 * answer with the bounding box, which for a room with one slanted wall is a figure no
 * part of that room measures: a 6 × 4 box over a room whose depth runs from 3,02 to
 * 3,98. Now every reading is a chord the room actually has, and where they differ the
 * panel says so instead of picking one.
 *
 * @returns {{width: {min, max}, depth: {min, max}, tapers}} or null
 */
export function roomClearSize(room) {
  if (!room) return null;
  const frame = roomFrame(room);
  const extent = frame ? roomExtent(room, frame) : null;
  if (!extent) return null;
  const span = (axis, [lo, hi]) => {
    const lengths = measureLines(lo, hi)
      .map((at) => roomChord(room, frame, axis, at))
      .filter(Boolean)
      .map((chord) => chord.length);
    if (!lengths.length) return null;
    return { min: Math.min(...lengths), max: Math.max(...lengths) };
  };
  const width = span('x', extent.v);
  const depth = span('y', extent.u);
  if (!width || !depth) return null;
  const tapers = width.max - width.min > 5 || depth.max - depth.min > 5;
  return { width, depth, tapers, frame, turned: Math.abs(frame.angle) > 0.5 };
}

// ---- moving parts of the plan rigidly ----------------------------------
//
// Editing one wall's length should stretch the plan, not shear it. Starting at
// the end that moves and refusing to cross any wall running along the direction
// of travel collects exactly the part that should come along: for a rectangle,
// lengthening the top wall carries the whole right-hand side with it and leaves
// the left where it is.

const PARALLEL = 0.1; // |sin| between directions, about 6 degrees

function wallDirection(plan, wall) {
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const len = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
  if (len < 1e-6) return null;
  return { x: (ends.b.x - ends.a.x) / len, y: (ends.b.y - ends.a.y) / len };
}

/**
 * Nodes reachable from `startNodeId` without crossing a wall that runs along
 * `along`. Returns null if the walk reaches `guardNodeId`, which means the shape
 * closes back on itself and cannot move rigidly.
 */
export function branchNodes(plan, startNodeId, along, guardNodeId = null) {
  const len = Math.hypot(along.x, along.y) || 1;
  const ax = along.x / len;
  const ay = along.y / len;
  const seen = new Set([startNodeId]);
  const queue = [startNodeId];
  while (queue.length) {
    const nodeId = queue.pop();
    for (const wall of plan.walls) {
      if (wall.a !== nodeId && wall.b !== nodeId) continue;
      const dir = wallDirection(plan, wall);
      if (!dir) continue;
      if (Math.abs(dir.x * ay - dir.y * ax) < PARALLEL) continue; // runs along travel
      const other = wall.a === nodeId ? wall.b : wall.a;
      if (other === guardNodeId) return null;
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen;
}

export function translateNodes(plan, nodeIds, dx, dy) {
  for (const node of plan.nodes) {
    if (nodeIds.has(node.id)) {
      node.x += dx;
      node.y += dy;
    }
  }
}

/** Every node reachable from a node, never passing through `stopNodeId`. */
export function connectedNodes(plan, startNodeId, stopNodeId) {
  const seen = new Set([startNodeId]);
  const queue = [startNodeId];
  while (queue.length) {
    const nodeId = queue.pop();
    for (const wall of plan.walls) {
      if (wall.a !== nodeId && wall.b !== nodeId) continue;
      const other = wall.a === nodeId ? wall.b : wall.a;
      if (other === stopNodeId || seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  return seen;
}

export function removeWall(plan, wallId) {
  plan.walls = plan.walls.filter((w) => w.id !== wallId);
  plan.openings = plan.openings.filter((o) => o.wallId !== wallId);
  pruneNodes(plan);
}

export function pruneNodes(plan) {
  const used = new Set();
  for (const wall of plan.walls) {
    used.add(wall.a);
    used.add(wall.b);
  }
  for (const dim of plan.dimensions) {
    if (dim.fromNode) used.add(dim.fromNode);
    if (dim.toNode) used.add(dim.toNode);
  }
  plan.nodes = plan.nodes.filter((n) => used.has(n.id));
}

export function nodeDegree(plan, nodeId) {
  let count = 0;
  for (const wall of plan.walls) {
    if (wall.a === nodeId || wall.b === nodeId) count++;
  }
  return count;
}

/**
 * Where a wall would be cut, given a point roughly on it.
 *
 * Answered on its own so the drawing can show the cut before it is made, and so the
 * cut and its preview cannot disagree about where it lands.
 *
 * The point is dropped onto the wall's centreline rather than taken as given: it comes
 * from the pointer by way of the snapping engine, which is free to catch a guide, a
 * corner or an alignment a little off the wall. Used raw it put the new node off the
 * line and left the wall with a kink in it.
 *
 * @returns {{x, y, at, total, first, second}} `at` is the distance along from end A,
 *          `first` and `second` the two pieces it would leave. Null if either piece
 *          would be too short to be a wall.
 */
export function wallCutAt(plan, wallId, x, y) {
  const wall = findWall(plan, wallId);
  if (!wall) return null;
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const dx = ends.b.x - ends.a.x;
  const dy = ends.b.y - ends.a.y;
  const total = Math.hypot(dx, dy);
  if (total < MIN_PIECE * 2) return null;
  const along = ((x - ends.a.x) * dx + (y - ends.a.y) * dy) / total;
  const at = Math.max(0, Math.min(total, along));
  if (at < MIN_PIECE || total - at < MIN_PIECE) return null;
  return {
    x: ends.a.x + (dx / total) * at,
    y: ends.a.y + (dy / total) * at,
    at,
    total,
    first: at,
    second: total - at,
  };
}

export function splitWallAt(plan, wallId, x, y) {
  const cut = wallCutAt(plan, wallId, x, y);
  if (!cut) return null;
  const wall = findWall(plan, wallId);
  const node = addNode(plan, cut.x, cut.y, 1);
  const second = { ...wall, id: nextId('w'), a: node.id, b: wall.b };
  wall.b = node.id;
  plan.walls.push(second);
  for (const opening of plan.openings) {
    if (opening.wallId !== wallId) continue;
    if (opening.offset > cut.at) {
      opening.wallId = second.id;
      opening.offset -= cut.at;
    }
  }
  return { first: wall, second, node, at: cut.at, lengths: [cut.first, cut.second] };
}

// Two walls can be joined when they share a corner, run in the same direction,
// and nothing else is attached to that corner.
export function canJoinWalls(plan, idA, idB) {
  const a = findWall(plan, idA);
  const b = findWall(plan, idB);
  if (!a || !b || a === b) return null;
  const shared = [a.a, a.b].find((id) => id === b.a || id === b.b);
  if (!shared) return null;
  if (nodeDegree(plan, shared) !== 2) return null;
  const segA = wallSegment(plan, a);
  const segB = wallSegment(plan, b);
  if (!segA || !segB) return null;
  const dirA = Math.atan2(segA.y2 - segA.y1, segA.x2 - segA.x1);
  const dirB = Math.atan2(segB.y2 - segB.y1, segB.x2 - segB.x1);
  let delta = Math.abs(dirA - dirB) % Math.PI;
  delta = Math.min(delta, Math.PI - delta);
  if (delta > 0.035) return null;
  const farA = a.a === shared ? a.b : a.a;
  const farB = b.a === shared ? b.b : b.a;
  return { a, b, shared, farA, farB };
}

export function joinWalls(plan, idA, idB) {
  const info = canJoinWalls(plan, idA, idB);
  if (!info) return false;
  const { a, b, shared, farA, farB } = info;
  const lengthA = wallLength(plan, a);
  const lengthB = wallLength(plan, b);

  // Measure every opening from farA, which becomes the start of the merged wall,
  // before any of the walls change shape.
  const moved = [];
  for (const opening of plan.openings) {
    if (opening.wallId === a.id) {
      const fromFarA = a.a === farA ? opening.offset : lengthA - opening.offset - openingWidth(opening);
      moved.push({ opening, offset: fromFarA });
    } else if (opening.wallId === b.id) {
      const fromShared = b.a === shared ? opening.offset : lengthB - opening.offset - openingWidth(opening);
      moved.push({ opening, offset: lengthA + fromShared });
    }
  }

  a.a = farA;
  a.b = farB;
  a.thickness = Math.max(a.thickness, b.thickness);
  plan.walls = plan.walls.filter((w) => w.id !== b.id);

  const merged = lengthA + lengthB;
  for (const { opening, offset } of moved) {
    opening.wallId = a.id;
    opening.offset = clamp(offset, 0, Math.max(0, merged - openingWidth(opening)));
  }
  pruneNodes(plan);
  return true;
}

/**
 * Moves one end of a wall onto the line of another wall — extending it if it
 * falls short, trimming it if it overshoots. This is the trim/extend gesture.
 */
export function trimWallTo(plan, wallId, end, targetWallId) {
  const wall = findWall(plan, wallId);
  const target = findWall(plan, targetWallId);
  if (!wall || !target || wall === target) return false;
  const wallSeg = wallSegment(plan, wall);
  const targetSeg = wallSegment(plan, target);
  if (!wallSeg || !targetSeg) return false;
  const hit = lineIntersection(wallSeg, targetSeg);
  if (!hit) return false;
  const movingId = end === 'a' ? wall.a : wall.b;
  const fixedId = end === 'a' ? wall.b : wall.a;
  const fixed = findNode(plan, fixedId);
  if (!fixed) return false;
  if (dist(fixed.x, fixed.y, hit.x, hit.y) < 50) return false;
  const moving = findNode(plan, movingId);
  if (!moving) return false;
  if (nodeDegree(plan, movingId) > 1) {
    // Other walls share this corner; give this wall its own corner instead.
    const fresh = addNode(plan, hit.x, hit.y, 1);
    if (end === 'a') wall.a = fresh.id;
    else wall.b = fresh.id;
  } else {
    moving.x = hit.x;
    moving.y = hit.y;
  }
  // Keep openings inside the wall.
  const newLength = wallLength(plan, wall);
  for (const opening of plan.openings) {
    if (opening.wallId !== wall.id) continue;
    opening.offset = Math.max(0, Math.min(newLength - openingWidth(opening), opening.offset));
  }
  pruneNodes(plan);
  return true;
}

// ---- junctions ---------------------------------------------------------
//
// Walls only know about each other through shared nodes: that is what makes a
// corner mitre, what makes dragging one corner move every wall that meets there,
// and what lets a room be traced round a loop of walls. So a wall that merely
// crosses or touches another — a partition drawn onto the middle of an outside
// wall, two walls that cross, a wall drawn over the top of another — has to be
// turned into real nodes before any of that works.
//
// Room detection has always split walls at their intersections internally, so a
// room would appear; but the walls themselves stayed unaware of each other, and
// the drawing showed it: the partition ran on into the poché instead of stopping
// at the face, and moving the outside wall left the partition behind. This does
// the split for real, once, after every edit.

const HEAL_TOLERANCE = 25; // mm, the same distance the drawing tools weld at
const MIN_PIECE = 60; // mm, never leave a stub shorter than this

/** Distance from a to b along the wall, and the point at that distance. */
function alongWall(a, b, x, y) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const t = ((x - a.x) * dx + (y - a.y) * dy) / (len * len);
  return {
    len,
    at: t * len,
    t,
    x: a.x + dx * t,
    y: a.y + dy * t,
    off: Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)),
  };
}

/** Merges nodes that sit on top of each other, keeping the first of each group. */
function weldNodes(plan, tolerance, report) {
  const buckets = new Map();
  const remap = new Map();
  for (const node of plan.nodes) {
    const key = `${Math.round(node.x / tolerance)},${Math.round(node.y / tolerance)}`;
    // Check the nine cells around it, so a pair either side of a cell edge still meets.
    let keeper = null;
    for (let dx = -1; dx <= 1 && !keeper; dx++) {
      for (let dy = -1; dy <= 1 && !keeper; dy++) {
        const near = buckets.get(`${Math.round(node.x / tolerance) + dx},${Math.round(node.y / tolerance) + dy}`);
        if (!near) continue;
        for (const candidate of near) {
          if (Math.hypot(candidate.x - node.x, candidate.y - node.y) <= tolerance) {
            keeper = candidate;
            break;
          }
        }
      }
    }
    if (keeper) {
      remap.set(node.id, keeper.id);
      report.welded += 1;
      continue;
    }
    const list = buckets.get(key) ?? [];
    list.push(node);
    buckets.set(key, list);
  }
  if (remap.size === 0) return;
  const to = (id) => remap.get(id) ?? id;
  for (const wall of plan.walls) {
    wall.a = to(wall.a);
    wall.b = to(wall.b);
  }
  for (const dim of plan.dimensions ?? []) {
    if (dim.fromNode) dim.fromNode = to(dim.fromNode);
    if (dim.toNode) dim.toNode = to(dim.toNode);
  }
  plan.nodes = plan.nodes.filter((n) => !remap.has(n.id));
}

/** Splits one wall at a set of nodes already sitting along it. */
function splitWallAtNodes(plan, wall, cuts) {
  const ends = wallEnds(plan, wall);
  if (!ends) return 0;
  const total = dist(ends.a.x, ends.a.y, ends.b.x, ends.b.y);
  const sorted = cuts
    .filter((c) => c.at > MIN_PIECE && c.at < total - MIN_PIECE)
    .sort((p, q) => p.at - q.at)
    .filter((c, i, list) => i === 0 || c.at - list[i - 1].at > MIN_PIECE);
  if (sorted.length === 0) return 0;

  // The original wall keeps its id and becomes the first piece, so a selection,
  // an opening or a socket that pointed at it still points at something.
  const originalB = wall.b;
  const pieces = [{ wall, from: 0, to: sorted[0].at }];
  wall.b = sorted[0].nodeId;
  for (let i = 0; i < sorted.length; i++) {
    // Copy the whole wall and give the piece its own ends: anything the wall
    // carries — its height, its roof pitch, which side of the work it is on — has
    // to survive being split, and enumerating those fields means forgetting the
    // next one that gets added.
    const next = {
      ...wall,
      id: nextId('w'),
      a: sorted[i].nodeId,
      b: i + 1 < sorted.length ? sorted[i + 1].nodeId : originalB,
    };
    plan.walls.push(next);
    pieces.push({ wall: next, from: sorted[i].at, to: i + 1 < sorted.length ? sorted[i + 1].at : total });
  }

  // Anything measured along the wall moves to the piece it now falls on. An
  // opening that straddled the new junction is pulled back inside its piece;
  // one that cannot fit there at all has nowhere to be and goes.
  const doomed = new Set();
  const reseat = (item, width = 0) => {
    const offset = item.offset ?? 0;
    const piece = pieces.find((p) => offset >= p.from && offset <= p.to) ?? pieces[pieces.length - 1];
    const length = piece.to - piece.from;
    if (width > length) {
      doomed.add(item.id);
      return;
    }
    item.wallId = piece.wall.id;
    item.offset = Math.max(0, Math.min(length - width, offset - piece.from));
  };
  // Take a copy of each list first: every item still names the original wall.
  const openings = (plan.openings ?? []).filter((o) => o.wallId === wall.id);
  const fixtures = (plan.fixtures ?? []).filter((f) => f.wallId === wall.id);
  for (const opening of openings) reseat(opening, openingWidth(opening));
  for (const fixture of fixtures) reseat(fixture);
  if (doomed.size) plan.openings = plan.openings.filter((o) => !doomed.has(o.id));
  return sorted.length;
}

/**
 * Makes every place walls meet into a real node: T-junctions where one wall ends
 * on another, crossings where two walls pass through each other, and overlaps
 * where one wall was drawn along another.
 *
 * @returns {{welded, tees, crossings, merged}} what it had to fix
 */
export function healJunctions(plan, options = {}) {
  const tolerance = options.tolerance ?? HEAL_TOLERANCE;
  const report = { welded: 0, tees: 0, crossings: 0, merged: 0 };
  if (!plan.walls?.length) return report;

  weldNodes(plan, tolerance, report);
  // A wall whose ends welded together is no longer a wall.
  const straight = plan.walls.length;
  plan.walls = plan.walls.filter((w) => w.a !== w.b);
  report.merged += straight - plan.walls.length;

  // Crossings first: each one adds a node, which the T-junction pass below then
  // splits both walls at. Two passes are enough, because inserting a node never
  // creates a new crossing.
  for (let i = 0; i < plan.walls.length; i++) {
    for (let j = i + 1; j < plan.walls.length; j++) {
      const a = plan.walls[i];
      const b = plan.walls[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      const segA = wallSegment(plan, a);
      const segB = wallSegment(plan, b);
      if (!segA || !segB) continue;
      const hit = lineIntersection(segA, segB);
      if (!hit) continue;
      const lenA = Math.hypot(segA.x2 - segA.x1, segA.y2 - segA.y1);
      const lenB = Math.hypot(segB.x2 - segB.x1, segB.y2 - segB.y1);
      // Strictly inside both, or it is a T and the node pass will catch it.
      if (hit.t * lenA < MIN_PIECE || (1 - hit.t) * lenA < MIN_PIECE) continue;
      if (hit.u * lenB < MIN_PIECE || (1 - hit.u) * lenB < MIN_PIECE) continue;
      addNode(plan, hit.x, hit.y, tolerance);
      report.crossings += 1;
    }
  }

  // Now split every wall at the nodes lying along it. Snap each node exactly onto
  // the wall as we go, so the join is watertight rather than nearly.
  for (const wall of [...plan.walls]) {
    const ends = wallEnds(plan, wall);
    if (!ends) continue;
    const cuts = [];
    for (const node of plan.nodes) {
      if (node.id === wall.a || node.id === wall.b) continue;
      const on = alongWall(ends.a, ends.b, node.x, node.y);
      if (!on || on.off > tolerance) continue;
      if (on.at <= MIN_PIECE || on.at >= on.len - MIN_PIECE) continue;
      node.x = on.x;
      node.y = on.y;
      cuts.push({ nodeId: node.id, at: on.at });
    }
    const made = splitWallAtNodes(plan, wall, cuts);
    report.tees += made;
  }

  // A wall drawn over the top of another leaves two walls between the same pair
  // of nodes. Keep the thicker one — the outside wall, not the partition.
  const byPair = new Map();
  const dropped = new Set();
  for (const wall of plan.walls) {
    const key = wall.a < wall.b ? `${wall.a}|${wall.b}` : `${wall.b}|${wall.a}`;
    const kept = byPair.get(key);
    if (!kept) {
      byPair.set(key, wall);
      continue;
    }
    const loser = wall.thickness > kept.thickness ? kept : wall;
    const winner = loser === kept ? wall : kept;
    byPair.set(key, winner);
    dropped.add(loser.id);
    // Whatever sat in the wall that goes has to sit in the one that stays.
    for (const item of [...(plan.openings ?? []), ...(plan.fixtures ?? [])]) {
      if (item.wallId === loser.id) item.wallId = winner.id;
    }
    report.merged += 1;
  }
  if (dropped.size) plan.walls = plan.walls.filter((w) => !dropped.has(w.id));

  // An opening or a socket can be left pointing at a wall that no longer exists.
  const live = new Set(plan.walls.map((w) => w.id));
  if (plan.openings) plan.openings = plan.openings.filter((o) => live.has(o.wallId));
  if (plan.fixtures) {
    for (const fixture of plan.fixtures) {
      if (fixture.wallId && !live.has(fixture.wallId)) fixture.wallId = null;
    }
  }
  pruneNodes(plan);
  if (report.welded || report.tees || report.crossings || report.merged) touch(plan);
  return report;
}

/** Heals every floor of a project, and reports the total. */
export function healProject(project) {
  const total = { welded: 0, tees: 0, crossings: 0, merged: 0 };
  for (const plan of project.plans ?? []) {
    const report = healJunctions(plan);
    for (const key of Object.keys(total)) total[key] += report[key];
  }
  return total;
}

/**
 * Places where walls meet without a node: what healing would have to fix. Used to
 * report on a drawing rather than to change it.
 */
export function looseJunctions(plan, tolerance = HEAL_TOLERANCE) {
  let tees = 0;
  let crossings = 0;
  for (const wall of plan.walls) {
    const ends = wallEnds(plan, wall);
    if (!ends) continue;
    for (const node of plan.nodes) {
      if (node.id === wall.a || node.id === wall.b) continue;
      const on = alongWall(ends.a, ends.b, node.x, node.y);
      if (!on || on.off > tolerance) continue;
      if (on.at <= MIN_PIECE || on.at >= on.len - MIN_PIECE) continue;
      tees += 1;
    }
  }
  for (let i = 0; i < plan.walls.length; i++) {
    for (let j = i + 1; j < plan.walls.length; j++) {
      const a = plan.walls[i];
      const b = plan.walls[j];
      if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
      const segA = wallSegment(plan, a);
      const segB = wallSegment(plan, b);
      if (!segA || !segB) continue;
      const hit = lineIntersection(segA, segB);
      if (!hit) continue;
      const lenA = Math.hypot(segA.x2 - segA.x1, segA.y2 - segA.y1);
      const lenB = Math.hypot(segB.x2 - segB.x1, segB.y2 - segB.y1);
      if (hit.t * lenA < MIN_PIECE || (1 - hit.t) * lenA < MIN_PIECE) continue;
      if (hit.u * lenB < MIN_PIECE || (1 - hit.u) * lenB < MIN_PIECE) continue;
      crossings += 1;
    }
  }
  return { tees, crossings };
}


// ---- guides ------------------------------------------------------------
//
// A guide is an endless straight line you pull off a ruler and line things up
// against. It is not part of the building, so it is not drawn on an export and it
// has no thickness — but it snaps, which is the whole point of it.

export function addGuide(plan, axis, at) {
  if (axis !== 'x' && axis !== 'y') return null;
  if (!Number.isFinite(at)) return null;
  // One guide per position is enough; a second on the same line only confuses.
  const already = (plan.guides ?? []).find((g) => g.axis === axis && Math.abs(g.at - at) < 1);
  if (already) return already;
  const guide = { id: nextId('g'), axis, at: Math.round(at) };
  plan.guides ??= [];
  plan.guides.push(guide);
  return guide;
}

export function findGuide(plan, id) {
  return (plan.guides ?? []).find((g) => g.id === id) ?? null;
}

export function removeGuide(plan, id) {
  const before = (plan.guides ?? []).length;
  plan.guides = (plan.guides ?? []).filter((g) => g.id !== id);
  return plan.guides.length !== before;
}

export function clearGuides(plan) {
  const had = (plan.guides ?? []).length;
  plan.guides = [];
  return had > 0;
}

/** The guide under a point, within a pixel tolerance given in millimetres. */
export function guideAt(plan, point, tolerance) {
  let best = null;
  for (const guide of plan.guides ?? []) {
    const d = guide.axis === 'x' ? Math.abs(point.x - guide.at) : Math.abs(point.y - guide.at);
    if (d <= tolerance && (!best || d < best.d)) best = { guide, d };
  }
  return best?.guide ?? null;
}

export function nearestWallEnd(plan, wall, point) {
  const ends = wallEnds(plan, wall);
  if (!ends) return 'b';
  const da = dist(ends.a.x, ends.a.y, point.x, point.y);
  const db = dist(ends.b.x, ends.b.y, point.x, point.y);
  return da <= db ? 'a' : 'b';
}

/** Four joined walls from two opposite corners. */
/**
 * Grow a room off an existing wall.
 *
 * The wall becomes one side of the new room and three more are built off its ends,
 * square to it. Which is how rooms actually get added to a drawing: you have a wall,
 * and the room goes on one side of it. Outside the building that is an extension;
 * inside a large space it divides it, and the room you took it from keeps whatever is
 * left. Either way the wall itself is untouched — it is shared, not copied.
 *
 * @param sign which side to build on: +1 along the wall's normal, -1 against it
 * @param depth how deep the room is to be, inside its walls, in millimetres
 * @returns the walls it built, or [] if it could not
 */
export function growRoomFromWall(plan, wallId, depth, sign = 1, options = {}) {
  const wall = findWall(plan, wallId);
  if (!wall) return [];
  const ends = wallEnds(plan, wall);
  if (!ends) return [];
  const run = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
  if (run < 300 || !(depth >= 300)) return [];

  // The new sides match the wall they come off unless told otherwise, so an extension
  // off an outside wall is built in the same stuff as the rest of the outside.
  const spec = { type: options.type ?? wall.type, thickness: options.thickness ?? wall.thickness };

  // `depth` is the room, not the distance between centre lines. Walls meet at their
  // centres, so a wall put 3,00 m out from another leaves 2,63⁵ of floor between two
  // 365 walls — which is not what anybody means by a three metre room. Half of each
  // wall is added back on so the figure asked for is the figure you can stand in.
  const between = depth + wall.thickness / 2 + spec.thickness / 2;
  const nx = (-(ends.b.y - ends.a.y) / run) * Math.sign(sign || 1);
  const ny = ((ends.b.x - ends.a.x) / run) * Math.sign(sign || 1);
  const out = (p) => [p.x + nx * between, p.y + ny * between];
  const [px, py] = out(ends.a);
  const [qx, qy] = out(ends.b);
  const built = [
    addWall(plan, ends.a.x, ends.a.y, px, py, spec),
    addWall(plan, px, py, qx, qy, spec),
    addWall(plan, qx, qy, ends.b.x, ends.b.y, spec),
  ].filter(Boolean);
  healJunctions(plan);
  return built;
}

export function addRoomRect(plan, x1, y1, x2, y2, options = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX - minX < 300 || maxY - minY < 300) return [];
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const created = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const wall = addWall(plan, ax, ay, bx, by, options);
    if (wall) created.push(wall);
  }
  return created;
}

// ---- openings ---------------------------------------------------------

export function addOpening(plan, wallId, distanceAlong, options = {}) {
  const wall = findWall(plan, wallId);
  if (!wall) return null;
  const total = wallLength(plan, wall);
  const base = defaultsFor(options.kind ?? 'door', options.style);
  // Clamp so the hole fits the wall, not just the leaf.
  const stock = stockOf({ ...base, ...options });
  const width = Math.min(options.width ?? base.width, Math.max(200, total - 100 - stock * 2));
  const opening = {
    id: nextId('o'),
    wallId,
    ...base,
    width,
    // Centred on where you clicked: the hole, not the leaf.
    offset: clamp(distanceAlong - (width + stock * 2) / 2, 0, Math.max(0, total - (width + stock * 2))),
  };
  plan.openings.push(opening);
  return opening;
}

export function openingGeometry(plan, opening) {
  const wall = findWall(plan, opening.wallId);
  if (!wall) return null;
  const ends = wallEnds(plan, wall);
  if (!ends) return null;
  const total = dist(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
  const dx = (ends.b.x - ends.a.x) / total;
  const dy = (ends.b.y - ends.a.y) / total;
  const hole = openingWidth(opening);
  const start = clamp(opening.offset, 0, Math.max(0, total - hole));
  const end = start + hole;
  return {
    wall,
    total,
    dx,
    dy,
    nx: -dy,
    ny: dx,
    thickness: wall.thickness,
    x1: ends.a.x + dx * start,
    y1: ends.a.y + dy * start,
    x2: ends.a.x + dx * end,
    y2: ends.a.y + dy * end,
    centre: { x: ends.a.x + dx * (start + hole / 2), y: ends.a.y + dy * (start + hole / 2) },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---- derived geometry -------------------------------------------------


// ---- what is there and what is planned ----------------------------------
//
// A renovation is a comparison, so a wall can say which side of the work it is on:
// there already, going, or going in. The phase then decides which walls the drawing
// is made of — and because rooms are worked out from the walls, knocking one through
// shows up as the two rooms becoming one.

export const WALL_STATUS = [
  { id: 'existing', label: 'There already', de: 'Bestand', hint: 'part of the house as it stands' },
  { id: 'remove', label: 'To come out', de: 'Abbruch', hint: 'to be knocked out; drawn dashed' },
  { id: 'new', label: 'Going in', de: 'Neubau', hint: 'to be built; drawn solid' },
];

export const PHASES = [
  { id: 'all', label: 'Both', hint: 'everything, whatever side of the work it is on' },
  { id: 'built', label: 'As it is', hint: 'the house as it stands: what is there, including what is coming out' },
  { id: 'planned', label: 'As planned', hint: 'the house when the work is done: what stays, plus what goes in' },
];

export function wallStatus(wall) {
  const id = wall.status;
  return id === 'remove' || id === 'new' ? id : 'existing';
}

/** Whether a wall counts in the phase being shown. */
export function wallInPhase(wall, phase = 'all') {
  const status = wallStatus(wall);
  if (phase === 'built') return status !== 'new';
  if (phase === 'planned') return status !== 'remove';
  return true;
}

export function phaseOf(plan) {
  const id = plan.phase;
  return PHASES.some((p) => p.id === id) ? id : 'all';
}

/** The walls the drawing is made of right now. */
export function phaseWalls(plan) {
  const phase = phaseOf(plan);
  return phase === 'all' ? plan.walls : plan.walls.filter((wall) => wallInPhase(wall, phase));
}

/** Whether an opening or a socket is on a wall the phase is showing. */
export function inPhase(plan, wallId) {
  if (!wallId) return true;
  const wall = findWall(plan, wallId);
  return wall ? wallInPhase(wall, phaseOf(plan)) : false;
}

export function statusCounts(plan) {
  const counts = { existing: 0, remove: 0, new: 0 };
  for (const wall of plan.walls) counts[wallStatus(wall)] += 1;
  return counts;
}

export function wallsForGeometry(plan) {
  const out = [];
  for (const wall of phaseWalls(plan)) {
    const seg = wallSegment(plan, wall);
    if (!seg) continue;
    out.push({ id: wall.id, ...seg, thickness: wall.thickness });
  }
  return out;
}

const derivedCache = new WeakMap();

export function derived(plan) {
  const cached = derivedCache.get(plan);
  if (cached && cached.version === plan.version) return cached.value;
  const { graph, rooms } = detectRooms(wallsForGeometry(plan));
  // Text on a traced plan seeds room names; a name the user typed always wins.
  const texts = plan.backdrop?.texts ?? [];
  if (texts.length) nameRooms(rooms, texts);
  matchRoomMetadata(plan, rooms);
  const value = { graph, rooms };
  derivedCache.set(plan, { version: plan.version, value });
  return value;
}

function matchRoomMetadata(plan, rooms) {
  const meta = plan.rooms ?? [];
  const pairs = [];
  rooms.forEach((room, ri) => {
    meta.forEach((entry, mi) => {
      const d = dist(room.centroid.x, room.centroid.y, entry.anchor.x, entry.anchor.y);
      const areaRatio = entry.areaMm2 ? Math.abs(Math.log(room.areaMm2 / entry.areaMm2)) : 1;
      if (d < 3000 || areaRatio < 0.15) pairs.push({ ri, mi, score: d + areaRatio * 2000 });
    });
  });
  pairs.sort((a, b) => a.score - b.score);
  const usedRoom = new Set();
  const usedMeta = new Set();
  const nextMeta = [];
  for (const pair of pairs) {
    if (usedRoom.has(pair.ri) || usedMeta.has(pair.mi)) continue;
    usedRoom.add(pair.ri);
    usedMeta.add(pair.mi);
    const room = rooms[pair.ri];
    const entry = meta[pair.mi];
    room.name = entry.name || room.name || '';
    room.kept = entry.kept !== false;
    room.metaId = entry.id;
    // Everything the entry already carried, and then what this pass knows. Listing
    // the fields instead dropped the rest of them: a room's usage and its Wohnfläche
    // factor were reset to nothing on the next edit, so a balcony counted at half
    // quietly went back to counting in full the moment a wall moved.
    nextMeta.push({
      ...entry,
      id: entry.id,
      name: room.name,
      kept: room.kept,
      anchor: { x: room.centroid.x, y: room.centroid.y },
      areaMm2: room.areaMm2,
    });
  }
  rooms.forEach((room, ri) => {
    if (usedRoom.has(ri)) return;
    const entry = {
      id: nextId('r'),
      name: room.name ?? '',
      kept: true,
      anchor: { x: room.centroid.x, y: room.centroid.y },
      areaMm2: room.areaMm2,
    };
    room.kept = true;
    room.metaId = entry.id;
    nextMeta.push(entry);
  });
  plan.rooms = nextMeta;
}

export function keptRooms(plan) {
  return derived(plan).rooms.filter((r) => r.kept !== false);
}

export function totalArea(plan) {
  return keptRooms(plan).reduce((sum, room) => sum + roomFloorArea(plan, room), 0);
}

// ---- vertical -----------------------------------------------------------

/**
 * What each kind of room counts as. The factors follow the German convention for
 * living area: rooms count in full, open-air space at a quarter, a garage not at
 * all.
 */
export const ROOM_USAGES = [
  { id: 'living', label: 'Living', factor: 1 },
  { id: 'sleeping', label: 'Bedroom', factor: 1 },
  { id: 'kitchen', label: 'Kitchen', factor: 1 },
  { id: 'bath', label: 'Bathroom', factor: 1 },
  { id: 'circulation', label: 'Hall or stair', factor: 1 },
  { id: 'storage', label: 'Store', factor: 1 },
  { id: 'balcony', label: 'Balcony', factor: 0.25 },
  { id: 'terrace', label: 'Terrace', factor: 0.25 },
  { id: 'garage', label: 'Garage', factor: 0 },
];

export function usageSpec(id) {
  return ROOM_USAGES.find((u) => u.id === id) ?? ROOM_USAGES[0];
}

/** Floor to floor: the clear height plus the slab above it. */
export function floorToFloor(plan) {
  return (plan.height ?? 2500) + (plan.floorThickness ?? 250);
}

/** Height of a floor's finished level above the lowest floor in the project. */
/**
 * The floors from the bottom up.
 *
 * The order they were drawn in is not the order they are stacked in — draw the ground
 * floor first and the cellar second, which is what anyone would do, and the cellar used
 * to end up on the roof. `storey` is the answer where it has been given: 0 for the
 * ground floor, −1 for the cellar, and so on. Where it has not, the drawing order is
 * still the best guess, so an old drawing stacks exactly as it did.
 */
export function floorsInOrder(project) {
  return project.plans
    .map((plan, drawn) => ({ plan, drawn, storey: Number.isFinite(plan.storey) ? plan.storey : null }))
    .sort((a, b) => {
      if (a.storey !== null && b.storey !== null && a.storey !== b.storey) return a.storey - b.storey;
      if (a.storey !== null && b.storey === null) return -1;
      if (a.storey === null && b.storey !== null) return 1;
      return a.drawn - b.drawn;
    })
    .map((entry) => entry.plan);
}

export function planElevation(project, plan) {
  let elevation = 0;
  for (const other of floorsInOrder(project)) {
    if (other.id === plan.id) break;
    elevation += floorToFloor(other);
  }
  return elevation;
}

export function roomMetaFor(plan, room) {
  return plan.rooms.find((r) => r.id === room.metaId) ?? null;
}

export function roomHeight(plan, room) {
  const meta = roomMetaFor(plan, room);
  const own = meta?.height;
  return Number.isFinite(own) && own > 0 ? own : plan.height ?? 2500;
}

export function roomVolume(plan, room) {
  return (room.areaMm2 / 1e6) * (roomHeight(plan, room) / 1000); // m³
}

/**
 * Wall surface enclosing a room, less its openings — the figure you want when
 * pricing paint or plaster. Openings on walls that bound the room are deducted in
 * full, which is close enough to be useful and is labelled as an estimate.
 */
export function roomWallArea(plan, room) {
  const height = roomHeight(plan, room) / 1000;
  let perimeter = 0;
  const inner = room.inner;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  let gross = (perimeter / 1000) * height;
  const boundary = roomBoundaryNodeIds(plan, room);
  for (const opening of plan.openings) {
    const wall = findWall(plan, opening.wallId);
    if (!wall) continue;
    if (!boundary.has(wall.a) || !boundary.has(wall.b)) continue;
    const clear = Math.max(0, (opening.head ?? 2010) - (opening.sill ?? 0));
    gross -= (openingWidth(opening) / 1000) * (clear / 1000);
  }
  return Math.max(0, gross);
}

/** Area that counts as living space: each room's area times the factor for its use. */

// ---- sloping ceilings and living area ----------------------------------
//
// Under a roof, floor area is not all worth the same. WoFlV §4 counts what has two
// metres of headroom in full, what has between one and two metres by half, and what
// has less than a metre not at all — which is why an attic's Wohnfläche is always
// well under its footprint.
//
// The slope is described by the wall it springs from: a knee wall — a Drempel — with
// a roof pitch above it. The ceiling then rises inward from that wall's inner face
// at that pitch until it reaches the storey's own ceiling. A room under a saddle
// roof has one of these on each side, and at any point the lower of the two governs.

export const WOFLV_FULL = 2000; // mm of headroom counted in full
export const WOFLV_HALF = 1000; // and down to here, counted by half

/** The sloping planes over a room: one per knee wall on its boundary with a pitch. */
export function roomSlopes(plan, room) {
  const ceiling = plan.height ?? 2500;
  const out = [];
  const centroid = polygonCentroid(room.inner);
  for (const wall of plan.walls) {
    const pitch = Number(wall.pitch);
    if (!Number.isFinite(pitch) || pitch <= 0 || pitch >= 89) continue;
    const height = wallHeight(plan, wall);
    if (height >= ceiling - 1) continue; // springs at the ceiling: no slope to speak of
    const ends = wallEnds(plan, wall);
    if (!ends) continue;
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    // The inward normal: the side the room is on.
    let nx = -dy / len;
    let ny = dx / len;
    const along = (centroid.x - ends.a.x) * nx + (centroid.y - ends.a.y) * ny;
    if (along < 0) {
      nx = -nx;
      ny = -ny;
    }
    // Does this wall actually bound the room? Its centre has to lie on the boundary.
    const mid = { x: (ends.a.x + ends.b.x) / 2, y: (ends.a.y + ends.b.y) / 2 };
    const reach = wall.thickness / 2 + 60;
    let touches = false;
    for (let i = 0; i < room.inner.length && !touches; i++) {
      const p = room.inner[i];
      const q = room.inner[(i + 1) % room.inner.length];
      if (pointSegDistance(mid.x, mid.y, { x1: p.x, y1: p.y, x2: q.x, y2: q.y }) <= reach) touches = true;
    }
    if (!touches) continue;
    // Measured from the inner face, so the plane starts where the room does.
    const base = ends.a.x * nx + ends.a.y * ny + wall.thickness / 2;
    out.push({ wallId: wall.id, height, pitch, nx, ny, base, rise: Math.tan((pitch * Math.PI) / 180) });
  }
  return out;
}

/** How much headroom a room has at one point, in millimetres. */
export function ceilingHeightAt(plan, room, x, y, slopes = null) {
  const ceiling = plan.height ?? 2500;
  const planes = slopes ?? roomSlopes(plan, room);
  if (!planes.length) return ceiling;
  let lowest = ceiling;
  for (const plane of planes) {
    const d = Math.max(0, x * plane.nx + y * plane.ny - plane.base);
    const h = Math.min(ceiling, plane.height + d * plane.rise);
    if (h < lowest) lowest = h;
  }
  return lowest;
}

/** How far in from a sloping wall the ceiling reaches a given height. */
function reachFor(plane, height, ceiling) {
  if (height <= plane.height) return 0;
  if (height > ceiling) return Infinity;
  return (height - plane.height) / plane.rise;
}

/**
 * The room's floor split the way WoFlV splits it, in square millimetres.
 * @returns {{full, half, none, total, slopes}}
 */
export function roomHeadroomBands(plan, room) {
  // A hole in the floor is not floor, so it belongs to no band at all.
  const pieces = roomFloorPieces(plan, room);
  const total = pieces.reduce((sum, piece) => sum + Math.abs(polygonArea(piece)), 0);
  const slopes = roomSlopes(plan, room);
  if (!slopes.length) return { full: total, half: 0, none: 0, total, slopes };
  const ceiling = plan.height ?? 2500;
  // The region with at least `height` of headroom is where every sloping plane has
  // risen far enough: an intersection of half planes, so clipping in turn is exact.
  const areaAtLeast = (height) => {
    let sum = 0;
    for (const piece of pieces) {
      let poly = piece;
      let clipped = true;
      for (const plane of slopes) {
        const reach = reachFor(plane, height, ceiling);
        if (!Number.isFinite(reach)) {
          clipped = false;
          break;
        }
        poly = clipPolygonHalfPlane(poly, plane.nx, plane.ny, plane.base + reach);
        if (poly.length < 3) {
          clipped = false;
          break;
        }
      }
      if (clipped) sum += Math.abs(polygonArea(poly));
    }
    return sum;
  };
  const full = areaAtLeast(WOFLV_FULL);
  const overHalf = areaAtLeast(WOFLV_HALF);
  return {
    full,
    half: Math.max(0, overHalf - full),
    none: Math.max(0, total - overHalf),
    total,
    slopes,
  };
}

/** Where a headroom line runs across a room, for drawing it on the plan. */
export function headroomLines(plan, room, height) {
  const ceiling = plan.height ?? 2500;
  const slopes = roomSlopes(plan, room);
  const lines = [];
  for (const plane of slopes) {
    const reach = reachFor(plane, height, ceiling);
    if (!Number.isFinite(reach) || reach <= 0) continue;
    // The line lies where this plane reaches the height, clipped to the room.
    const at = plane.base + reach;
    const inside = clipPolygonHalfPlane(room.inner, plane.nx, plane.ny, at);
    if (inside.length < 3) continue;
    // The cut edge is the one running along the plane's own line.
    for (let i = 0; i < inside.length; i++) {
      const a = inside[i];
      const b = inside[(i + 1) % inside.length];
      const da = Math.abs(a.x * plane.nx + a.y * plane.ny - at);
      const db = Math.abs(b.x * plane.nx + b.y * plane.ny - at);
      if (da < 1 && db < 1 && Math.hypot(b.x - a.x, b.y - a.y) > 50) {
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, height });
      }
    }
  }
  return lines;
}

/** The room's living area: WoFlV bands first, then what the room is used for. */
export function roomLivingArea(plan, room) {
  const bands = roomHeadroomBands(plan, room);
  const meta = roomMetaFor(plan, room);
  const factor = Number.isFinite(meta?.areaFactor) ? meta.areaFactor : usageSpec(meta?.usage).factor;
  return (bands.full + bands.half * 0.5) * factor;
}

export function livingArea(plan) {
  let total = 0;
  for (const room of keptRooms(plan)) total += roomLivingArea(plan, room);
  return total;
}

// ---- stairs and columns -------------------------------------------------


// ---- openings in the floor ---------------------------------------------
//
// A stair needs a hole in the floor to come up through — a Deckenaussparung. It
// belongs to the storey whose floor it opens, because that is the storey that loses
// the area and where you would fall through. The flight below then has somewhere to
// go, which is what makes the headroom check mean anything.

export function addVoid(plan, x, y, spec = {}) {
  const item = {
    id: nextId('v'),
    x,
    y,
    w: Math.max(200, Math.round(spec.w ?? 1010)),
    h: Math.max(200, Math.round(spec.h ?? 2900)),
    rotation: spec.rotation ?? 0,
    label: spec.label ?? '',
  };
  plan.voids ??= [];
  plan.voids.push(item);
  return item;
}

export function findVoid(plan, id) {
  return (plan.voids ?? []).find((v) => v.id === id) ?? null;
}

/** The four corners of a floor opening, in drawing coordinates. */
export function voidCorners(item) {
  const rad = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = item.w / 2;
  const hh = item.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([a, b]) => ({ x: item.x + a * cos - b * sin, y: item.y + a * sin + b * cos }));
}

export function pointInVoid(item, x, y) {
  return pointInPolygon(x, y, voidCorners(item));
}

/** A room's floor with its openings taken out, as one or more pieces. */
export function roomFloorPieces(plan, room) {
  let pieces = [room.inner];
  for (const item of plan.voids ?? []) {
    const rad = ((item.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Clip in the opening's own frame, where the hole is axis aligned.
    const toLocal = (p) => ({
      x: (p.x - item.x) * cos + (p.y - item.y) * sin,
      y: -(p.x - item.x) * sin + (p.y - item.y) * cos,
    });
    const toWorld = (p) => ({
      x: item.x + p.x * cos - p.y * sin,
      y: item.y + p.x * sin + p.y * cos,
    });
    const box = { x0: -item.w / 2, x1: item.w / 2, y0: -item.h / 2, y1: item.h / 2 };
    const next = [];
    for (const piece of pieces) {
      const cut = clipPolygonOutsideBox(piece.map(toLocal), box);
      for (const part of cut) next.push(part.map(toWorld));
    }
    pieces = next;
    if (!pieces.length) break;
  }
  return pieces;
}

/** The floor area a room actually has, once its openings are taken out. */
export function roomFloorArea(plan, room) {
  if (!(plan.voids ?? []).length) return Math.abs(polygonArea(room.inner));
  return roomFloorPieces(plan, room).reduce((total, piece) => total + Math.abs(polygonArea(piece)), 0);
}

/**
 * Headroom over every tread of a flight, and where it runs out.
 *
 * The ceiling is the underside of the slab above, except where the flight passes
 * under an opening in it — there it carries on into the storey above. Two metres is
 * what DIN 18065 asks for, and running out of it is the stair mistake that is
 * expensive to find late.
 */
export function stairHeadroom(project, plan, stair) {
  const above = storeyAbove(project, plan);
  const ceiling = plan.height ?? 2500;
  const openings = above?.voids ?? [];
  const riser = stair.rise / Math.max(1, Math.round(stair.steps));
  const treads = stairWorldTreads(stair);
  let worst = null;
  const short = [];
  for (const tread of treads) {
    const centre = tread.pts.reduce(
      (acc, p) => ({ x: acc.x + p.x / tread.pts.length, y: acc.y + p.y / tread.pts.length }),
      { x: 0, y: 0 }
    );
    const throughFloor = openings.some((item) => pointInVoid(item, centre.x, centre.y));
    // Above the opening the next storey's ceiling is what you would hit.
    const head = throughFloor
      ? ceiling + (plan.floorThickness ?? 250) + ((above?.height ?? ceiling) - tread.z)
      : ceiling - tread.z;
    if (!worst || head < worst.headroom) {
      worst = { step: tread.step, headroom: head, throughFloor, x: centre.x, y: centre.y };
    }
    if (head < 2000) short.push(tread);
  }
  return {
    worst,
    riser,
    needed: 2000,
    ok: !worst || worst.headroom >= 2000,
    hasOpening: openings.length > 0,
    above,
    // The opening this flight would need: the treads that are short of headroom,
    // squared up to the way the flight runs, with a little room round the edges.
    needsOpening: short.length ? openingForTreads(stair, short) : null,
    shortFrom: short.length ? short[0].step : null,
    shortTo: short.length ? short[short.length - 1].step : null,
  };
}

/** The smallest opening, square to the flight, that clears a set of treads. */
function openingForTreads(stair, treads, margin = 50) {
  const rot = ((stair.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  let a0 = Infinity;
  let a1 = -Infinity;
  let c0 = Infinity;
  let c1 = -Infinity;
  for (const tread of treads) {
    for (const p of tread.pts) {
      // Back into the stair's own frame, where the flight runs along `a`.
      const a = (p.x - stair.x) * cos + (p.y - stair.y) * sin;
      const c = -(p.x - stair.x) * sin + (p.y - stair.y) * cos;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
    }
  }
  a0 -= margin;
  a1 += margin;
  c0 -= margin;
  c1 += margin;
  const ca = (a0 + a1) / 2;
  const cc = (c0 + c1) / 2;
  return {
    x: Math.round(stair.x + ca * cos - cc * sin),
    y: Math.round(stair.y + ca * sin + cc * cos),
    w: Math.round(a1 - a0),
    h: Math.round(c1 - c0),
    rotation: stair.rotation ?? 0,
  };
}

/** The plan directly above this one, or null at the top. */
export function storeyAbove(project, plan) {
  const index = project.plans.findIndex((p) => p.id === plan.id);
  return index >= 0 && index + 1 < project.plans.length ? project.plans[index + 1] : null;
}

/** The plan directly below this one, or null at the bottom. */
export function storeyBelow(project, plan) {
  const index = project.plans.findIndex((p) => p.id === plan.id);
  return index > 0 ? project.plans[index - 1] : null;
}

export function addStair(plan, x, y, spec) {
  const stair = {
    id: nextId('s'),
    x: Math.round(x),
    y: Math.round(y),
    rotation: 0,
    ...spec,
  };
  plan.stairs.push(stair);
  return stair;
}

export function findStair(plan, id) {
  return plan.stairs.find((s) => s.id === id);
}

export const COLUMN_SHAPES = [
  { id: 'rect', label: 'Square' },
  { id: 'round', label: 'Round' },
];

export function addColumn(plan, x, y, spec = {}) {
  const column = {
    id: nextId('c'),
    x: Math.round(x),
    y: Math.round(y),
    shape: spec.shape ?? 'rect',
    w: spec.w ?? 240,
    h: spec.h ?? 240,
    rotation: 0,
  };
  plan.columns.push(column);
  return column;
}

export function findColumn(plan, id) {
  return plan.columns.find((c) => c.id === id);
}

// ---- scale ------------------------------------------------------------

export function rescalePlan(plan, factor) {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return;
  for (const node of plan.nodes) {
    node.x *= factor;
    node.y *= factor;
  }
  for (const wall of plan.walls) wall.thickness *= factor;
  for (const opening of plan.openings) {
    opening.width *= factor;
    if (Number.isFinite(opening.stock)) opening.stock *= factor;
    opening.offset *= factor;
    opening.sill *= factor;
    opening.head *= factor;
  }
  for (const item of plan.furniture) {
    item.x *= factor;
    item.y *= factor;
    item.w *= factor;
    item.h *= factor;
  }
  // Plan dimensions scale; heights and rises were typed, not traced, so they stay.
  for (const stair of plan.stairs ?? []) {
    stair.x *= factor;
    stair.y *= factor;
    stair.width *= factor;
    stair.treadDepth *= factor;
  }
  for (const column of plan.columns ?? []) {
    column.x *= factor;
    column.y *= factor;
    column.w *= factor;
    column.h *= factor;
  }
  for (const label of plan.labels) {
    label.x *= factor;
    label.y *= factor;
    label.size *= factor;
  }
  for (const dim of plan.dimensions) {
    if (dim.from) {
      dim.from.x *= factor;
      dim.from.y *= factor;
    }
    if (dim.to) {
      dim.to.x *= factor;
      dim.to.y *= factor;
    }
    dim.offset *= factor;
  }
  for (const room of plan.rooms) {
    room.anchor.x *= factor;
    room.anchor.y *= factor;
    room.areaMm2 *= factor * factor;
  }
  rescaleBackdrop(plan.backdrop, factor);
  plan.scaleDenominator = Math.round(plan.scaleDenominator * factor);
  touch(plan);
}

/**
 * How far the building itself reaches, ignoring everything standing in it.
 *
 * `planBounds` takes in the furniture too, which is right for framing the whole
 * drawing and wrong for anything that has to hold still while furniture is moved
 * about. The walls are what a room is; a chair pushed out of the door is not.
 */
export function buildingBounds(plan) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wall of phaseWalls(plan)) {
    const corners = wallCorners(plan, wall);
    if (!corners) continue;
    for (const p of corners) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return planBounds(plan);
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function planBounds(plan) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const node of plan.nodes) add(node.x, node.y);
  for (const item of plan.furniture) {
    const r = Math.max(item.w, item.h) / 2;
    add(item.x - r, item.y - r);
    add(item.x + r, item.y + r);
  }
  for (const label of plan.labels) add(label.x, label.y);
  for (const stair of plan.stairs ?? []) {
    for (const p of stairWorldFootprint(stair)) add(p.x, p.y);
  }
  for (const column of plan.columns ?? []) {
    const r = Math.max(column.w, column.h) / 2;
    add(column.x - r, column.y - r);
    add(column.x + r, column.y + r);
  }
  // Dimension lines stand off the walls, so they belong in the extent too —
  // otherwise fitting the view cuts them off.
  for (const dim of plan.dimensions) {
    const a = dim.fromNode ? findNode(plan, dim.fromNode) : dim.from;
    const b = dim.toNode ? findNode(plan, dim.toNode) : dim.to;
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const off = (dim.offset ?? 500) + 250;
    add(a.x + nx * off, a.y + ny * off);
    add(b.x + nx * off, b.y + ny * off);
  }
  if (!Number.isFinite(minX) && plan.backdrop?.kind) {
    add(0, 0);
    add(plan.backdrop.widthMm, plan.backdrop.heightMm);
  }
  if (!Number.isFinite(minX)) {
    add(0, 0);
    add(8000, 6000);
  }
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}
