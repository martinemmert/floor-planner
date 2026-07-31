// Turns a project into triangles for the 3D view.
//
// Walls are extruded from the floor to their own height, so a knee wall stands as
// low as it is drawn. Openings are cut by splitting each wall along its length
// rather than by subtracting solids: between openings the wall is full height, and
// at an opening only the pieces below the sill and above the head are built.

import {
  derived,
  floorToFloor,
  openingGeometry,
  planElevation,
  isKneeWall,
  wallCorners,
  wallRoofProfile,
  wallEnds,
  wallHeight,
  fixturePlacement,
  roomFloorPieces,
  roomFrame,
  roomMetaFor,
  roomSlopes,
  inPhase,
  phaseWalls,
} from './model.js';
import { stairParts, stairToWorld, stairWorldTreads } from './stairs.js';
import { furnitureById } from './furniture.js';
import { isRadiator, radiatorSpec } from './fixtures.js';
import { furnitureFootprint } from './clearance.js';
import { clipPolygonHalfPlane } from '../geom/vec.js';
import { openingParts, partToWorld } from './opening3d.js';
import { openingWidth } from './openings.js';
import { MATERIAL, floorSurface, wallSurface } from './materials.js';
import { finishOf, furnitureParts } from './furniture3d.js';

export const MESH_COLORS = {
  light: {
    dark: false,
    wall: [0.87, 0.88, 0.89],
    wallTop: [0.72, 0.75, 0.78],
    floor: [0.93, 0.94, 0.95],
    stair: [0.8, 0.82, 0.85],
    column: [0.45, 0.5, 0.55],
    knee: [0.78, 0.8, 0.83],
    ground: [0.9, 0.91, 0.92],
    furniture: [0.79, 0.8, 0.78],
    radiator: [0.93, 0.93, 0.94],
    furnitureTop: [0.86, 0.87, 0.85],
    rail: [0.55, 0.58, 0.6],
    slope: [0.82, 0.83, 0.85],
    frame: [0.97, 0.97, 0.97],
    leaf: [0.83, 0.74, 0.63],
    sill: [0.89, 0.89, 0.87],
    bar: [0.95, 0.95, 0.95],
    glass: [0.62, 0.78, 0.88, 0.3],
  },
  dark: {
    dark: true,
    wall: [0.42, 0.46, 0.5],
    wallTop: [0.3, 0.34, 0.38],
    floor: [0.26, 0.3, 0.34],
    stair: [0.5, 0.54, 0.58],
    column: [0.2, 0.24, 0.28],
    knee: [0.34, 0.38, 0.42],
    ground: [0.12, 0.15, 0.18],
    furniture: [0.36, 0.39, 0.41],
    radiator: [0.58, 0.6, 0.62],
    furnitureTop: [0.44, 0.47, 0.49],
    rail: [0.6, 0.63, 0.66],
    slope: [0.38, 0.42, 0.46],
    frame: [0.68, 0.71, 0.74],
    leaf: [0.5, 0.43, 0.35],
    sill: [0.56, 0.57, 0.56],
    bar: [0.64, 0.67, 0.7],
    glass: [0.4, 0.58, 0.7, 0.34],
  },
};

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    // What each triangle is made of, how big the pattern on it repeats, and which way
    // the pattern runs. Three floats per vertex, set before the geometry is added
    // rather than passed through every call — a whole floor or a whole kitchen is one
    // material, and threading it through prism, quad and polygon would touch every one
    // of them.
    this.surfaces = [];
    this.surface_ = [MATERIAL.flat, 1, 0];
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
    // Glass has to be drawn after everything behind it, so see-through triangles
    // are collected separately and appended at the end.
    this.clear = { positions: [], normals: [], colors: [], surfaces: [] };
    this.into = null;
    // The outlines, for the drawn look. Every edge is collected with the way each
    // face that uses it is turned, because which of them get drawn is decided at the
    // end and depends on that.
    this.edges = new Map();
  }

  /**
   * A face's boundary, recorded against the plane it lies in.
   *
   * A wall is a prism, a corner is two prisms mitred together, and a wall with a door
   * in it is three prisms. Drawn as they are built, every one of those joints puts a
   * line across a surface that is in fact flat and continuous — the diagonal over a
   * corner, the seam up a wall beside a door. `build` throws those away.
   */
  outline(ring) {
    // Newell's normal: right for any planar ring, not just a triangle.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    const normal = [nx / len, ny / len, nz / len];

    const at = (p) => `${Math.round(p[0] * 4)},${Math.round(p[1] * 4)},${Math.round(p[2] * 4)}`;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ka = at(a);
      const kb = at(b);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = this.edges.get(key);
      if (edge) edge.faces.push(normal);
      else this.edges.set(key, { a, b, faces: [normal] });
    }
  }

  /** The edges worth drawing: the boundaries and the creases, and nothing else. */
  outlines() {
    const out = [];
    for (const edge of this.edges.values()) {
      // An edge with two faces turned the same way is a seam inside a flat surface —
      // the mitre across a corner, the joint between two lengths of the same wall.
      // Nothing is folded there, so there is nothing to draw.
      let seam = false;
      for (let i = 0; i < edge.faces.length && !seam; i++) {
        for (let j = i + 1; j < edge.faces.length && !seam; j++) {
          const p = edge.faces[i];
          const q = edge.faces[j];
          if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] > 0.985) seam = true;
        }
      }
      if (seam) continue;
      out.push(edge.a[0], edge.a[1], edge.a[2], edge.b[0], edge.b[1], edge.b[2]);
    }
    return out;
  }

  /**
   * What everything built after this is made of, and which way its grain runs.
   *
   * `turn` is in radians, anticlockwise: the direction the finish is set out along. A
   * floor takes it from the room it is in and a wall from its own direction, so boards
   * run with the room and tiles run with the wall — rather than all of them running
   * along the page, which is what they did on any drawing not square to it.
   */
  madeOf(material, repeat = 1, turn = 0) {
    this.surface_ = [material, Math.max(1, repeat), turn];
  }

  /** Everything built inside the callback goes into the see-through pass. */
  seeThrough(build) {
    this.into = this.clear;
    try {
      build();
    } finally {
      this.into = null;
    }
  }

  triangle(p0, p1, p2, colour) {
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0];
    const vy = p2[1] - p0[1];
    const vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const target = this.into ?? this;
    const alpha = colour.length > 3 ? colour[3] : 1;
    const [material, repeat, turn] = this.surface_;
    for (const p of [p0, p1, p2]) {
      target.positions.push(p[0], p[1], p[2]);
      target.normals.push(nx, ny, nz);
      target.surfaces.push(material, repeat, turn);
      target.colors.push(colour[0], colour[1], colour[2], alpha);
      for (let i = 0; i < 3; i++) {
        if (p[i] < this.min[i]) this.min[i] = p[i];
        if (p[i] > this.max[i]) this.max[i] = p[i];
      }
    }
  }

  quad(p0, p1, p2, p3, colour) {
    this.triangle(p0, p1, p2, colour);
    this.triangle(p0, p2, p3, colour);
    if (!this.into) this.outline([p0, p1, p2, p3]);
  }

  /** A prism: four plan corners, a flat bottom, and a top that may slope. */
  prism(corners, zBottom, zTops, colour, topColour) {
    const bottom = corners.map((p) => [p.x, p.y, zBottom]);
    const top = corners.map((p, i) => [p.x, p.y, zTops[i]]);
    this.quad(top[0], top[1], top[2], top[3], topColour ?? colour);
    this.quad(bottom[3], bottom[2], bottom[1], bottom[0], colour);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(bottom[i], bottom[j], top[j], top[i], colour);
    }
  }

  polygon(points, z, colour, flip = false) {
    const tris = triangulate(points);
    for (const [a, b, c] of tris) {
      const p = [
        [points[a].x, points[a].y, z],
        [points[b].x, points[b].y, z],
        [points[c].x, points[c].y, z],
      ];
      if (flip) this.triangle(p[0], p[2], p[1], colour);
      else this.triangle(p[0], p[1], p[2], colour);
    }
    if (!this.into) this.outline(points.map((p) => [p.x, p.y, z]));
  }

  /** A polygon lifted to a height that varies per point, drawn from both sides. */
  surface(points3, colour) {
    const flat = points3.map((p) => ({ x: p.x, y: p.y }));
    const tris = triangulate(flat);
    for (const [a, b, c] of tris) {
      const p0 = [points3[a].x, points3[a].y, points3[a].z];
      const p1 = [points3[b].x, points3[b].y, points3[b].z];
      const p2 = [points3[c].x, points3[c].y, points3[c].z];
      this.triangle(p0, p1, p2, colour);
      this.triangle(p0, p2, p1, colour);
    }
    if (!this.into) this.outline(points3.map((p) => [p.x, p.y, p.z]));
  }

  build() {
    // Solid first, see-through after, in one buffer with the boundary recorded so
    // the renderer can turn depth writing off for the tail.
    const opaque = this.positions.length / 3;
    const lines = this.outlines();
    return {
      positions: new Float32Array([...this.positions, ...this.clear.positions]),
      normals: new Float32Array([...this.normals, ...this.clear.normals]),
      colors: new Float32Array([...this.colors, ...this.clear.colors]),
      surfaces: new Float32Array([...this.surfaces, ...this.clear.surfaces]),
      count: opaque + this.clear.positions.length / 3,
      opaqueCount: opaque,
      lines: new Float32Array(lines),
      lineCount: lines.length / 3,
      min: this.min,
      max: this.max,
    };
  }
}

/**
 * Whether a wall stands between these two points.
 *
 * The measurements over the 3D view are drawn on a canvas of their own, above the
 * model, and a canvas knows nothing about what is in front of what. Without this a
 * figure inside a room is read straight through the wall you are looking at, and the
 * bare line running out to it looks for all the world like an edge of the wall drawn
 * across its own face.
 *
 * The wall is a convex quad in plan, pulled up between two heights, so the segment is
 * clipped against its six planes. What survives is what passes through the wall.
 */
export function segmentBlocked(quad, z0, z1, a, b) {
  const hit = segmentThrough(quad, z0, z1, a, b);
  return hit !== null && hit.exit - hit.enter > 1e-4;
}

/**
 * Where a segment goes into a wall-shaped solid and where it comes out.
 *
 * The solid is a convex quad in plan pulled between two heights, so the segment is
 * clipped against its six planes and what survives is the part inside. Used both to
 * ask whether something is hidden and to ask what the cursor is pointing at.
 *
 * @returns {enter, exit} as fractions along the segment, or null if it misses
 */
export function segmentThrough(quad, z0, z1, a, b) {
  let twice = 0;
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % quad.length];
    twice += p.x * q.y - q.x * p.y;
  }
  const wind = twice >= 0 ? 1 : -1;
  const planes = [];
  for (let i = 0; i < quad.length; i++) {
    const p = quad[i];
    const q = quad[(i + 1) % quad.length];
    const nx = (q.y - p.y) * wind;
    const ny = -(q.x - p.x) * wind;
    if (Math.hypot(nx, ny) < 1e-6) continue;
    planes.push([nx, ny, 0, nx * p.x + ny * p.y]);
  }
  planes.push([0, 0, 1, z1], [0, 0, -1, -z0]);

  let t0 = 0;
  let t1 = 1;
  for (const [nx, ny, nz, d] of planes) {
    const da = nx * a[0] + ny * a[1] + nz * a[2] - d;
    const db = nx * b[0] + ny * b[1] + nz * b[2] - d;
    if (da > 0 && db > 0) return null; // both outside this face: it misses the solid
    if (da > 0) t0 = Math.max(t0, da / (da - db));
    else if (db > 0) t1 = Math.min(t1, da / (da - db));
    if (t0 >= t1) return null;
  }
  return { enter: t0, exit: t1 };
}

/** Ear clipping, enough for the simple polygons a room boundary produces. */
export function triangulate(points) {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const area = signedArea(points);
  const index = [...points.keys()];
  if (area < 0) index.reverse(); // work anticlockwise
  const tris = [];
  let guard = 0;
  while (index.length > 3 && guard++ < n * n + 32) {
    let clipped = false;
    for (let i = 0; i < index.length; i++) {
      const i0 = index[(i - 1 + index.length) % index.length];
      const i1 = index[i];
      const i2 = index[(i + 1) % index.length];
      const a = points[i0];
      const b = points[i1];
      const c = points[i2];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross <= 0) continue; // reflex on an anticlockwise ring
      let contains = false;
      for (const j of index) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTriangle(points[j], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      index.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate; take what we have
  }
  if (index.length === 3) tris.push([index[0], index[1], index[2]]);
  return tris;
}

function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function inTriangle(p, a, b, c) {
  const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
  const d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/** Top of the storey, for anything that reaches the ceiling. */
function topAt(plan, baseZ) {
  return baseZ + (plan.height ?? 2500);
}

function addWallMesh(mesh, plan, baseZ, wall, colours, rooms) {
  const ends = wallEnds(plan, wall);
  const corners = wallCorners(plan, wall);
  if (!ends || !corners) return;
  const len = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
  if (len < 1) return;
  const ux = (ends.b.x - ends.a.x) / len;
  const uy = (ends.b.y - ends.a.y) / len;
  const standing = wallHeight(plan, wall);
  const top = baseZ + standing;
  // A roof coming down over this wall cuts its top to the ceiling under it, so a gable
  // runs from full height down to the eaves instead of standing square and leaving the
  // slope floating inside the room.
  const roof = wallRoofProfile(plan, wall, rooms);
  const topAt = (p) => (roof ? baseZ + roof.at(p.x, p.y) : top);
  // A painted wall keeps its colour; an unpainted one takes the drawing's own grey,
  // so a plan nobody has decorated still reads as a plan rather than a white box.
  const painted = wall.paint ? wallSurface(wall.paint).colour : null;
  const colour = painted
    ? colours.dark
      ? painted.map((c) => c * 0.5 + 0.06)
      : painted
    : isKneeWall(plan, wall)
      ? colours.knee
      : colours.wall;

  // The drawn shape already carries the mitres, so the solid is built between its two
  // faces. Where it gets cut for an opening, though, the cut has to be square through
  // the wall: the plane at that distance along the run, met with each face.
  //
  // Taking the same fraction of each face's own length instead is what leaves a
  // reveal on the skew. The mitres make the two faces different lengths — a 300 wall
  // between two corners has an inside 600 mm shorter than its outside — so the same
  // fraction of each is not the same distance along, and the further the mitres
  // differ, the more the jamb leans. It showed up as a door hole 966 mm wide outside
  // and 874 inside where both should have been 920.
  const [leftA, leftB, rightB, rightA] = corners;
  const along = (p) => (p.x - ends.a.x) * ux + (p.y - ends.a.y) * uy;
  const leftBase = along(leftA);
  const rightBase = along(rightA);
  const square = (d) => ({
    left: { x: leftA.x + ux * (d - leftBase), y: leftA.y + uy * (d - leftBase) },
    right: { x: rightA.x + ux * (d - rightBase), y: rightA.y + uy * (d - rightBase) },
  });
  // The wall's own two ends keep their mitres — that is the whole point of them.
  const head = { left: leftA, right: rightA };
  const tail = { left: leftB, right: rightB };

  // Split the run at the openings, measured along the centreline.
  const cuts = [];
  for (const opening of plan.openings) {
    if (opening.wallId !== wall.id || !inPhase(plan, opening.wallId)) continue;
    const start = Math.max(0, opening.offset);
    const end = Math.min(len, opening.offset + openingWidth(opening));
    if (end <= start) continue;
    cuts.push({
      d0: start,
      d1: end,
      sill: baseZ + Math.max(0, opening.sill ?? 0),
      headZ: Math.min(top, baseZ + Math.max(0, opening.head ?? 2010)),
    });
  }
  cuts.sort((p, q) => p.d0 - q.d0);

  const band = (from, to, zLow, zHigh) => {
    if (zHigh <= zLow + 1) return;
    const quad = [from.left, to.left, to.right, from.right];
    mesh.prism(quad, zLow, [zHigh, zHigh, zHigh, zHigh], colour, colours.wallTop);
  };

  // The piece that carries the sloping top: square underneath, cut to the roof above.
  const capped = (from, to, zLow) => {
    const quad = [from.left, to.left, to.right, from.right];
    const tops = quad.map(topAt);
    if (Math.max(...tops) <= zLow + 1) return;
    mesh.prism(quad, zLow, tops.map((z) => Math.max(z, zLow)), colour, colours.wallTop);
  };

  // How low the roof gets anywhere over one stretch of wall — everything below that is
  // ordinary banded wall, and only the piece above it has to follow the slope.
  const lowestOver = (from, to) => Math.min(...[from.left, to.left, to.right, from.right].map(topAt));

  // Every piece of the wall is broken at the same heights: the floor, the ceiling, and
  // the sill and head of each opening in it. The pieces are all one flat wall, so none
  // of those joints should show — but a joint only disappears if the two pieces meet
  // edge to edge. A full-height piece beside a door does not share an edge with the
  // lintel over it, and the mismatch draws a line from the head of the door to the
  // ceiling. Cut to the same heights, they match, and the joint goes.
  const levels = new Set([baseZ, top]);
  for (const cut of cuts) {
    if (cut.sill > baseZ + 1 && cut.sill < top) levels.add(cut.sill);
    if (cut.headZ > baseZ && cut.headZ < top) levels.add(cut.headZ);
  }
  const zs = [...levels].sort((p, q) => p - q);
  const stack = (from, to, zLow, zHigh) => {
    for (let i = 0; i < zs.length - 1; i++) {
      band(from, to, Math.max(zLow, zs[i]), Math.min(zHigh, zs[i + 1]));
    }
  };

  // Everything up to where the roof first bites is banded at the shared heights, so the
  // joints beside a door still line up; the piece above it is the one that slopes.
  const upTo = (from, to, zLow) => {
    const roofLow = lowestOver(from, to);
    stack(from, to, zLow, Math.max(zLow, roofLow));
    capped(from, to, Math.max(zLow, roofLow));
  };

  // The stretches to build: the run broken at every opening, and again wherever the
  // roof over the wall changes pitch. Without those breaks a stretch spanning the
  // springing line would be one flat-topped slab from eaves height to ridge height,
  // which is a chamfer rather than a roof.
  const pieces = [];
  let cursor = 0;
  let from = head;
  for (const cut of cuts) {
    // An opening hard against the end of a wall takes the mitre with it, so the wall
    // is not left with a sliver of itself between the two.
    const a = cut.d0 <= 0.5 ? head : square(cut.d0);
    const b = cut.d1 >= len - 0.5 ? tail : square(cut.d1);
    if (cut.d0 > cursor + 0.5) pieces.push({ d0: cursor, d1: cut.d0, from, to: a, whole: true });
    pieces.push({ d0: cut.d0, d1: cut.d1, from: a, to: b, cut });
    cursor = Math.max(cursor, cut.d1);
    from = b;
  }
  if (cursor < len - 0.5) pieces.push({ d0: cursor, d1: len, from, to: tail, whole: true });

  const breaks = roof?.breaks ?? [];
  for (const piece of pieces) {
    // A solid stretch is split again at the roof's own cuts; a stretch that is an
    // opening is left whole, because a window is not cut in half by the ceiling above.
    const inside = piece.whole ? breaks.filter((d) => d > piece.d0 + 1 && d < piece.d1 - 1) : [];
    const stops = [piece.d0, ...inside, piece.d1];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = i === 0 ? piece.from : square(stops[i]);
      const b = i === stops.length - 2 ? piece.to : square(stops[i + 1]);
      if (piece.cut) {
        if (piece.cut.sill > baseZ + 1) stack(a, b, baseZ, piece.cut.sill);
        upTo(a, b, piece.cut.headZ);
      } else {
        upTo(a, b, baseZ);
      }
    }
  }
}


/**
 * What is actually in an opening: the frame, the glass, the leaves.
 *
 * The leaf stands at the same angle the plan swings its arc through, so walking
 * round the model shows you the door catching the furniture before you find out on
 * site.
 */
function addOpeningMesh(mesh, plan, baseZ, opening, colours) {
  const geo = openingGeometry(plan, opening);
  if (!geo) return;
  const ceiling = wallHeight(plan, geo.wall);
  for (const part of openingParts(opening, geo.thickness, ceiling)) {
    const corners = part.pts.map((q) => partToWorld(geo, q.a, q.c));
    const z0 = baseZ + part.z0;
    const z1 = baseZ + part.z1;
    const colour = colours[part.kind] ?? colours.frame;
    const build = () => mesh.prism(corners, z0, [z1, z1, z1, z1], colour);
    if (part.kind === 'glass') mesh.seeThrough(build);
    else build();
  }
}


/**
 * A radiator on the wall, as long, as tall and as deep as its type makes it.
 *
 * It hangs at the height the fixture is set to, so a panel under a window reads
 * against the sill rather than floating.
 */
function addRadiatorMesh(mesh, plan, baseZ, fixture, colours) {
  const rad = radiatorSpec(fixture);
  const placement = fixturePlacement(plan, fixture);
  const rot = (placement.angle * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const at = (a, c) => ({ x: placement.x + a * cos - c * sin, y: placement.y + a * sin + c * cos });
  const half = rad.length / 2;
  const bottom = baseZ + Math.max(0, (fixture.height ?? 600) - rad.height / 2);
  mesh.prism(
    [at(-half, 0), at(half, 0), at(half, rad.depth), at(-half, rad.depth)],
    bottom,
    Array(4).fill(bottom + rad.height),
    colours.radiator
  );
}

/** Furniture as the box it is: a wardrobe reads differently from a nightstand. */
function addFurnitureMesh(mesh, plan, baseZ, item, colours) {
  const spec = furnitureById(item.kind ?? item.id);
  const height = Math.max(60, item.z ?? spec?.z ?? 700);
  const width = Math.max(60, item.w ?? spec?.w ?? 600);
  const depth = Math.max(60, item.h ?? spec?.h ?? 600);
  const rad = ((item.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The parts come out in the piece's own frame; this is the only place that knows
  // where the piece has been put and which way it has been turned.
  const at = (x, y) => ({ x: item.x + x * cos - y * sin, y: item.y + x * sin + y * cos });

  const parts = furnitureParts(item.kind ?? item.id, width, depth, height);
  for (const piece of parts) {
    const finish = finishOf(piece.finish);
    const tone = colours.dark ? finish.colour.map((c) => c * 0.55 + 0.05) : finish.colour;
    const colour = finish.alpha < 1 ? [...tone, finish.alpha] : tone;
    const corners = [at(piece.x0, piece.y0), at(piece.x1, piece.y0), at(piece.x1, piece.y1), at(piece.x0, piece.y1)];
    const z0 = baseZ + piece.z0;
    const z1 = baseZ + piece.z1;
    if (z1 - z0 < 1) continue;
    mesh.madeOf(finish.material, finish.repeat);
    const build = () => mesh.prism(corners, z0, [z1, z1, z1, z1], colour);
    if (finish.alpha < 1) mesh.seeThrough(build);
    else build();
  }
  mesh.madeOf(MATERIAL.flat, 1);
}

/**
 * The sloping ceiling over a room, where a knee wall carries a roof pitch.
 *
 * Only the sloping part is built. The flat middle is left open so the model can
 * still be looked into from above — the point is to see how far in the roof comes
 * down, not to put a lid on the house.
 */
function addSlopeMesh(mesh, plan, baseZ, room, colours) {
  const slopes = roomSlopes(plan, room);
  if (!slopes.length) return;
  const ceiling = plan.height ?? 2500;
  for (const plane of slopes) {
    // Where this plane governs: nearer to it than to any other, and not yet up at
    // the storey ceiling.
    let poly = room.inner;
    const reach = (ceiling - plane.height) / plane.rise;
    poly = clipPolygonHalfPlane(poly, -plane.nx, -plane.ny, -(plane.base + reach));
    for (const other of slopes) {
      if (other === plane) continue;
      // Halfway between the two springing lines, when they face each other.
      const facing = plane.nx * other.nx + plane.ny * other.ny < -0.9;
      if (!facing) continue;
      const middle = (plane.base - other.base) / 2;
      poly = clipPolygonHalfPlane(poly, -plane.nx, -plane.ny, -(plane.base - middle));
    }
    if (poly.length < 3) continue;
    const lifted = poly.map((p) => ({
      x: p.x,
      y: p.y,
      z: baseZ + Math.min(ceiling, plane.height + Math.max(0, p.x * plane.nx + p.y * plane.ny - plane.base) * plane.rise),
    }));
    mesh.surface(lifted, colours.slope);
  }
}

/** A handrail up the walking line, so a flight reads as something you can use. */
function addRailMesh(mesh, plan, baseZ, stair, colours) {
  if (stair.railing === false) return;
  const parts = stairParts(stair);
  const line = parts.walkLine;
  if (line.length < 2) return;
  const riser = stair.rise / Math.max(1, Math.round(stair.steps));
  const half = Math.max(300, stair.width) / 2;
  const HEIGHT = 900; // mm above the going, where a hand falls
  const THICK = 45;
  // Out at the edge of the flight rather than up the middle of it.
  const at = (p, index) => {
    const next = line[Math.min(line.length - 1, index + 1)];
    const prev = line[Math.max(0, index - 1)];
    const dx = next.a - prev.a;
    const dy = next.c - prev.c;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const offset = half - 60;
    return { a: p.a + nx * offset, c: p.c + ny * offset };
  };
  const climbed = (index) => (index / Math.max(1, line.length - 1)) * stair.rise;
  for (let i = 0; i < line.length - 1; i++) {
    const p0 = at(line[i], i);
    const p1 = at(line[i + 1], i + 1);
    const w0 = stairToWorld(stair, p0.a, p0.c);
    const w1 = stairToWorld(stair, p1.a, p1.c);
    const dx = w1.x - w0.x;
    const dy = w1.y - w0.y;
    const len = Math.hypot(dx, dy);
    if (len < 20) continue;
    const nx = (-dy / len) * (THICK / 2);
    const ny = (dx / len) * (THICK / 2);
    const z0 = baseZ + climbed(i) + HEIGHT;
    const z1 = baseZ + climbed(i + 1) + HEIGHT;
    mesh.prism(
      [
        { x: w0.x + nx, y: w0.y + ny },
        { x: w1.x + nx, y: w1.y + ny },
        { x: w1.x - nx, y: w1.y - ny },
        { x: w0.x - nx, y: w0.y - ny },
      ],
      Math.min(z0, z1) - THICK,
      [z0, z1, z1, z0],
      colours.rail
    );
  }
}

/**
 * @param project the whole project, so floors stack at their real levels
 * @param options {theme, onlyPlanId}
 */
export function buildMesh(project, options = {}) {
  const colours = MESH_COLORS[options.theme === 'dark' ? 'dark' : 'light'];
  const mesh = new MeshBuilder();
  const plans = options.onlyPlanId
    ? project.plans.filter((p) => p.id === options.onlyPlanId)
    : project.plans;

  for (const plan of plans) {
    const baseZ = planElevation(project, plan);

    for (const room of derived(plan).rooms) {
      if (room.kept === false) continue;
      // Each room is laid with whatever it is laid with. The pattern is worked out
      // from where the floor is in the building, so boards carry on through a doorway
      // into the next room laid the same way instead of restarting at its threshold.
      const meta = roomMetaFor(plan, room);
      const finish = floorSurface(meta?.floor);
      // Laid along the room's own walls. Set out on the page instead, a board in a room
      // turned fifteen degrees runs across it and every joint meets a wall at an angle
      // — which is not how anybody lays a floor.
      const grain = roomFrame(room);
      mesh.madeOf(finish.material, finish.scale, grain ? (grain.angle * Math.PI) / 180 : 0);
      const tone = options.theme === 'dark' ? finish.colour.map((c) => c * 0.42 + 0.05) : finish.colour;
      // The slab is cut away at a stair well, so the floor is built round the hole.
      for (const piece of roomFloorPieces(plan, room)) mesh.polygon(piece, baseZ + 2, tone);
      mesh.madeOf(MATERIAL.flat, 1);
    }
    const rooms = derived(plan).rooms;
    for (const wall of phaseWalls(plan)) addWallMesh(mesh, plan, baseZ, wall, colours, rooms);

    for (const opening of plan.openings) {
      if (!inPhase(plan, opening.wallId)) continue;
      addOpeningMesh(mesh, plan, baseZ, opening, colours);
    }

    if (options.furniture !== false) {
      for (const item of plan.furniture ?? []) addFurnitureMesh(mesh, plan, baseZ, item, colours);
    }
    for (const fixture of plan.fixtures ?? []) {
      if (isRadiator(fixture.kind) && inPhase(plan, fixture.wallId)) {
        addRadiatorMesh(mesh, plan, baseZ, fixture, colours);
      }
    }
    for (const room of derived(plan).rooms) {
      if (room.kept === false) continue;
      addSlopeMesh(mesh, plan, baseZ, room, colours);
    }

    for (const column of plan.columns ?? []) {
      const w = column.w / 2;
      const h = column.h / 2;
      const rad = ((column.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const corner = (dx, dy) => ({
        x: column.x + dx * cos - dy * sin,
        y: column.y + dx * sin + dy * cos,
      });
      const pts =
        column.shape === 'round'
          ? Array.from({ length: 16 }, (_, i) => {
              const ang = (i / 16) * Math.PI * 2;
              return corner(Math.cos(ang) * w, Math.sin(ang) * h);
            })
          : [corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h)];
      const top = topAt(plan, baseZ);
      if (pts.length === 4) {
        mesh.prism(pts, baseZ, [top, top, top, top], colours.column);
      } else {
        // a round column: side faces plus a cap
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          mesh.quad(
            [pts[i].x, pts[i].y, baseZ],
            [pts[j].x, pts[j].y, baseZ],
            [pts[j].x, pts[j].y, top],
            [pts[i].x, pts[i].y, top],
            colours.column
          );
        }
        mesh.polygon(pts, top, colours.column);
      }
    }

    for (const stair of plan.stairs ?? []) {
      addRailMesh(mesh, plan, baseZ, stair, colours);
      for (const tread of stairWorldTreads(stair)) {
        const z = baseZ + tread.z;
        const pts = tread.pts;
        if (pts.length < 3) continue;
        // A solid step up to the tread's own height reads correctly in massing.
        mesh.polygon(pts, z, colours.stair);
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          mesh.quad(
            [pts[i].x, pts[i].y, baseZ],
            [pts[j].x, pts[j].y, baseZ],
            [pts[j].x, pts[j].y, z],
            [pts[i].x, pts[i].y, z],
            colours.stair
          );
        }
      }
    }

  }

  return mesh.build();
}

/** Bounds of everything, so the camera can frame it. */
export function meshBounds(mesh) {
  if (!Number.isFinite(mesh.min[0])) {
    return { centre: [0, 0, 0], size: 10000 };
  }
  const centre = [0, 1, 2].map((i) => (mesh.min[i] + mesh.max[i]) / 2);
  const size = Math.max(
    mesh.max[0] - mesh.min[0],
    mesh.max[1] - mesh.min[1],
    mesh.max[2] - mesh.min[2],
    1000
  );
  return { centre, size, min: mesh.min, max: mesh.max };
}

export { floorToFloor };
