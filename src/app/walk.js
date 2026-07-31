// Standing inside the drawing and walking about in it.
//
// A plan tells you the sizes and the 3D view shows you the shape, but neither tells you
// what it is like to be in the room — whether the hall is mean, whether you can see the
// garden from the kitchen door, whether the landing is somewhere you would want to
// stand. That is what this is for, and it is the one question a drawing cannot answer.
//
// Everything here is plain geometry with no renderer in it, so it can be tested.

import { openingGeometry, phaseWalls, wallCorners, wallEnds, wallHeight } from './model.js';

/** Eye height for an adult, in millimetres. */
export const EYE = 1650;
/** How wide the walker is: enough not to clip a corner, narrow enough for a doorway. */
export const SHOULDERS = 220;
/** Metres per second at a walk, and at a hurry. */
export const PACE = 1400;
export const HURRY = 3200;

/**
 * Where you can and cannot go on this floor.
 *
 * Each wall becomes one or more solid rectangles along its length. What is left out is
 * what you can actually walk through: a doorway or a plain opening that reaches the
 * floor and is tall enough to pass under. A window is not a hole you can walk through,
 * so it stays solid — which is also what stops you strolling out of a first-floor
 * bedroom.
 *
 * @returns [{x, y, ux, uy, half, reach}] — a rectangle as its middle, its direction,
 *          half its length and half its thickness
 */
export function walkBlockers(plan) {
  const out = [];
  for (const wall of phaseWalls(plan)) {
    const ends = wallEnds(plan, wall);
    const quad = wallCorners(plan, wall);
    if (!ends || !quad) continue;
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const tall = wallHeight(plan, wall);

    // The gaps in this wall you could walk through, as spans along it.
    const gaps = [];
    if (tall > EYE) {
      for (const opening of plan.openings ?? []) {
        if (opening.wallId !== wall.id) continue;
        const sill = Math.max(0, opening.sill ?? 0);
        const head = Math.max(sill, opening.head ?? 2010);
        // Low enough to step over is not a gap; too low to duck under is not either.
        if (sill > 250 || head < EYE + 100) continue;
        const geo = openingGeometry(plan, opening);
        if (!geo) continue;
        const from = (geo.x1 - ends.a.x) * ux + (geo.y1 - ends.a.y) * uy;
        const to = (geo.x2 - ends.a.x) * ux + (geo.y2 - ends.a.y) * uy;
        gaps.push([Math.min(from, to), Math.max(from, to)]);
      }
    }
    // A knee wall you can see over is still a wall you cannot walk through.
    gaps.sort((p, q) => p[0] - q[0]);

    // What is left of the wall once the gaps are taken out of it.
    let at = 0;
    const solids = [];
    for (const [from, to] of gaps) {
      if (from > at) solids.push([at, from]);
      at = Math.max(at, to);
    }
    if (at < len) solids.push([at, len]);

    for (const [from, to] of solids) {
      if (to - from < 1) continue;
      const mid = (from + to) / 2;
      out.push({
        x: ends.a.x + ux * mid,
        y: ends.a.y + uy * mid,
        ux,
        uy,
        half: (to - from) / 2,
        reach: wall.thickness / 2,
      });
    }
  }
  return out;
}

/** How far a point is outside a blocker, along and across it. */
function against(blocker, x, y) {
  const dx = x - blocker.x;
  const dy = y - blocker.y;
  return {
    along: dx * blocker.ux + dy * blocker.uy,
    across: -dx * blocker.uy + dy * blocker.ux,
  };
}

/**
 * Where a step actually ends up.
 *
 * Walking into a wall should stop you at it and let you slide along it, not stick you
 * to it or stop you dead — sliding is what makes a corridor walkable without steering.
 * The walker is a circle, so each blocker is grown by its radius and the walker pushed
 * back out along whichever way out is shortest.
 *
 * Resolved twice, because stepping out of one wall can step you into the next, which is
 * exactly what a corner is.
 */
export function stepTo(blockers, from, to, radius = SHOULDERS) {
  // Walked in short steps rather than in one stride. Resolving only where the step
  // *ends* lets a long one pass clean through a wall without ever being inside it —
  // which a 115 partition and one dropped frame is enough to do. Each sub-step is
  // shorter than the walker is wide, so nothing can be crossed without being entered.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.6)));
  const stepX = dx / steps;
  const stepY = dy / steps;
  let at = { x: from.x, y: from.y };
  for (let i = 0; i < steps; i++) {
    // From where the walker actually is, not from where the original line says it
    // should be by now. Marching along the line regardless threw away every push-out
    // the moment the next sub-step was taken, and the walk went through the wall as if
    // nothing had happened.
    at = resolve(blockers, at, { x: at.x + stepX, y: at.y + stepY }, radius);
  }
  return at;
}

/** One short step: put the walker back outside anything it has ended up inside. */
function resolve(blockers, from, to, radius) {
  let at = { x: to.x, y: to.y };
  for (let pass = 0; pass < 2; pass++) {
    let worst = null;
    for (const blocker of blockers) {
      const { along, across } = against(blocker, at.x, at.y);
      const overAlong = Math.abs(along) - (blocker.half + radius);
      const overAcross = Math.abs(across) - (blocker.reach + radius);
      // Outside on either axis is outside the rectangle altogether.
      if (overAlong >= 0 || overAcross >= 0) continue;
      // How far in it is: the shallower of the two is the way out.
      const depth = Math.min(-overAlong, -overAcross);
      if (!worst || depth > worst.depth) worst = { blocker, along, across, overAlong, overAcross, depth };
    }
    if (!worst) break;
    const { blocker, along, across, overAlong, overAcross } = worst;
    if (-overAcross <= -overAlong) {
      const push = (blocker.reach + radius) * Math.sign(across || 1) - across;
      at = { x: at.x + -blocker.uy * push, y: at.y + blocker.ux * push };
    } else {
      const push = (blocker.half + radius) * Math.sign(along || 1) - along;
      at = { x: at.x + blocker.ux * push, y: at.y + blocker.uy * push };
    }
  }
  // Squeezed further than it was asked to move means it was pushed out of somewhere it
  // should not have got into. Stay put rather than be flung across the room.
  const asked = Math.hypot(to.x - from.x, to.y - from.y);
  const got = Math.hypot(at.x - from.x, at.y - from.y);
  return got > asked + radius * 2 ? { x: from.x, y: from.y } : at;
}

/** A sensible place to start: the middle of the biggest room, facing into it. */
export function startingPoint(plan, rooms) {
  const best = (rooms ?? []).filter((room) => room.kept !== false).sort((a, b) => b.areaMm2 - a.areaMm2)[0];
  if (best) return { x: best.centroid.x, y: best.centroid.y, yaw: Math.PI / 2 };
  const nodes = plan.nodes ?? [];
  if (!nodes.length) return { x: 0, y: 0, yaw: Math.PI / 2 };
  const x = nodes.reduce((total, node) => total + node.x, 0) / nodes.length;
  const y = nodes.reduce((total, node) => total + node.y, 0) / nodes.length;
  return { x, y, yaw: Math.PI / 2 };
}
