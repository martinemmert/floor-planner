// Snapping engine. Candidates are ranked the way a CAD program ranks them:
// exact points beat lines, lines beat the grid, and an angle lock constrains
// everything to a ray from the anchor. Every snap reports what it snapped to so
// the canvas can draw the guide that explains it.

import { lineIntersection, pointSegDistance } from './vec.js';

/**
 * How coarsely a free angle is rounded, in degrees.
 *
 * Three, because a house is not all right angles and being held to ninety is no help
 * when a wall runs at fifty-one. Three divides ninety, so every cardinal and every
 * forty-five is still on the list and a square building is as easy to draw as before;
 * everything between is reachable to a third of a degree of where you put it. It
 * rounds rather than refuses: the angle is never limited, only tidied, and an exact
 * one — 51, 47, whatever the survey says — can still be typed into the field while
 * drawing. Ortho lock is the separate, deliberate choice to be held to ninety.
 */
export const ANGLE_STEP = 3;

export const SNAP_LABELS = {
  node: 'corner',
  intersection: 'intersection',
  midpoint: 'midpoint',
  perpendicular: 'perpendicular',
  wall: 'on wall',
  extension: 'extension',
  alignX: 'aligned',
  alignY: 'aligned',
  angle: 'angle',
  guide: 'guide',
  grid: 'grid',
};

function wallSegments(plan, ignoreWallId, ignoreNodeId) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const out = [];
  for (const wall of plan.walls) {
    if (wall.id === ignoreWallId) continue;
    // A wall hanging off the node being dragged moves with it, so its line, midpoint
    // and crossings follow the cursor about. Snapping to those is snapping to yourself:
    // it always wins, because you are always exactly on it, and it beats the grid — so
    // a corner dragged along its own wall lands on 379,7508 instead of 400, and slides
    // sideways as well when the wall it is stuck to swings round.
    if (ignoreNodeId && (wall.a === ignoreNodeId || wall.b === ignoreNodeId)) continue;
    const a = byId.get(wall.a);
    const b = byId.get(wall.b);
    if (!a || !b) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    out.push({ id: wall.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, a, b });
  }
  return out;
}

function projectOnSegment(px, py, seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { x: seg.x1, y: seg.y1, t: 0 };
  const t = ((px - seg.x1) * dx + (py - seg.y1) * dy) / lenSq;
  return { x: seg.x1 + dx * t, y: seg.y1 + dy * t, t };
}

/**
 * @param options.point   cursor position in millimetres
 * @param options.anchor  the point being drawn from, or null
 * @param options.plan    the plan being edited
 * @param options.tolerance snap radius in millimetres (a pixel radius converted)
 * @param options.orthoLock force 90 degree increments from the anchor
 * @param options.enabled  master switch; the grid still applies when off
 * @param options.gridMm   grid step, 0 for none
 * @param options.ignoreNodeId a node being dragged, which must not snap to itself —
 *        nor to the walls hanging off it, which move with it
 * @param options.ignoreWallId a wall being modified
 * @returns {{x, y, kind, label, guides}}
 */
export function computeSnap(options) {
  const {
    point,
    anchor = null,
    plan,
    tolerance,
    orthoLock = false,
    enabled = true,
    gridMm = 0,
    ignoreNodeId = null,
    ignoreWallId = null,
    backdrop = null,
    // A rectangle's opposite corner must stay free: constraining it to a ray from
    // the anchor would force one of its two sides to zero.
    constrainAngle = true,
  } = options;

  const guides = [];
  const result = (x, y, kind, extraGuides = []) => ({
    x,
    y,
    kind,
    label: kind ? SNAP_LABELS[kind] ?? kind : null,
    guides: [...guides, ...extraGuides],
  });

  if (!enabled) {
    return result(snapToGrid(point.x, gridMm), snapToGrid(point.y, gridMm), gridMm ? 'grid' : null);
  }

  const segments = wallSegments(plan, ignoreWallId, ignoreNodeId);

  // --- exact points ---------------------------------------------------
  let best = null;
  const consider = (x, y, kind, priority) => {
    const d = Math.hypot(x - point.x, y - point.y);
    if (d > tolerance) return;
    if (!best || priority < best.priority || (priority === best.priority && d < best.d)) {
      best = { x, y, kind, d, priority };
    }
  };

  for (const node of plan.nodes) {
    if (node.id === ignoreNodeId) continue;
    consider(node.x, node.y, 'node', 0);
  }
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = lineIntersection(segments[i], segments[j]);
      if (!hit) continue;
      if (hit.t < -0.05 || hit.t > 1.05 || hit.u < -0.05 || hit.u > 1.05) continue;
      consider(hit.x, hit.y, 'intersection', 1);
    }
  }
  for (const seg of segments) {
    consider((seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2, 'midpoint', 2);
  }
  // Guides are there to be snapped to, so where two of them cross, or one crosses
  // a wall, is an exact point worth catching before any midpoint.
  const guideLines = plan.guides ?? [];
  const xs = guideLines.filter((g) => g.axis === 'x');
  const ys = guideLines.filter((g) => g.axis === 'y');
  for (const gx of xs) {
    for (const gy of ys) consider(gx.at, gy.at, 'guide', 0);
    for (const seg of segments) {
      const hit = lineIntersection({ x1: gx.at, y1: -1e7, x2: gx.at, y2: 1e7 }, seg);
      if (hit && hit.u >= -0.02 && hit.u <= 1.02) consider(hit.x, hit.y, 'guide', 1);
    }
  }
  for (const gy of ys) {
    for (const seg of segments) {
      const hit = lineIntersection({ x1: -1e7, y1: gy.at, x2: 1e7, y2: gy.at }, seg);
      if (hit && hit.u >= -0.02 && hit.u <= 1.02) consider(hit.x, hit.y, 'guide', 1);
    }
  }
  for (const node of plan.nodes) {
    if (node.id === ignoreNodeId) continue;
    for (const gx of xs) consider(gx.at, node.y, 'guide', 1);
    for (const gy of ys) consider(node.x, gy.at, 'guide', 1);
  }
  if (backdrop) {
    for (const seg of backdrop) {
      consider(seg.x1, seg.y1, 'node', 3);
      consider(seg.x2, seg.y2, 'node', 3);
    }
  }
  if (best) return result(best.x, best.y, best.kind);

  // A single guide, taken as a line: the cursor drops onto it perpendicular.
  let onGuide = null;
  for (const guide of plan.guides ?? []) {
    const d = guide.axis === 'x' ? Math.abs(point.x - guide.at) : Math.abs(point.y - guide.at);
    if (d > tolerance || (onGuide && d >= onGuide.d)) continue;
    onGuide = {
      d,
      x: guide.axis === 'x' ? guide.at : point.x,
      y: guide.axis === 'y' ? guide.at : point.y,
    };
  }

  // --- angle lock from the anchor -------------------------------------
  if (onGuide && !anchor) return result(snapToGrid(onGuide.x, 0) || onGuide.x, onGuide.y, 'guide');
  const angleRay = anchor && constrainAngle ? rayForAngle(point, anchor, orthoLock) : null;
  const onAngleRay = () => {
    const ray = {
      x1: anchor.x,
      y1: anchor.y,
      x2: anchor.x + Math.cos(angleRay.angle) * 1e6,
      y2: anchor.y + Math.sin(angleRay.angle) * 1e6,
    };
    guides.push({ x1: anchor.x, y1: anchor.y, x2: angleRay.x, y2: angleRay.y, kind: 'angle' });
    // Prefer a real intersection along the constrained direction.
    let along = null;
    for (const seg of segments) {
      const hit = lineIntersection(ray, seg);
      if (!hit) continue;
      if (hit.u < -0.02 || hit.u > 1.02) continue;
      const d = Math.hypot(hit.x - point.x, hit.y - point.y);
      if (d <= tolerance && (!along || d < along.d)) along = { x: hit.x, y: hit.y, d, kind: 'wall' };
    }
    if (along) return result(along.x, along.y, along.kind);
    // Otherwise round the distance along the ray onto the grid.
    if (gridMm > 0) {
      const dist = Math.hypot(angleRay.x - anchor.x, angleRay.y - anchor.y);
      const snapped = Math.round(dist / gridMm) * gridMm;
      return result(
        anchor.x + Math.cos(angleRay.angle) * snapped,
        anchor.y + Math.sin(angleRay.angle) * snapped,
        'angle'
      );
    }
    return result(angleRay.x, angleRay.y, 'angle');
  };

  // Ortho lock is a constraint the drawer asked for, so it outranks the object snaps
  // below and the direction is held whatever the cursor passes near. The three degree
  // rounding is a courtesy rather than a constraint, so it waits its turn: rounding
  // the angle must not cost the perpendicular foot, the wall face or the alignment
  // with an existing corner, which are the snaps that put a wall exactly where it
  // belongs. Those are tested first, and the rounding catches everything else.
  if (angleRay && orthoLock) return onAngleRay();

  // --- lines ----------------------------------------------------------
  let line = null;
  const considerLine = (x, y, kind, priority, guide) => {
    const d = Math.hypot(x - point.x, y - point.y);
    if (d > tolerance) return;
    if (!line || priority < line.priority || (priority === line.priority && d < line.d)) {
      line = { x, y, kind, d, priority, guide };
    }
  };

  if (anchor) {
    for (const seg of segments) {
      const foot = projectOnSegment(anchor.x, anchor.y, seg);
      considerLine(foot.x, foot.y, 'perpendicular', 0, {
        x1: anchor.x,
        y1: anchor.y,
        x2: foot.x,
        y2: foot.y,
        kind: 'perpendicular',
      });
    }
  }
  for (const seg of segments) {
    if (pointSegDistance(point.x, point.y, seg) <= tolerance) {
      const proj = projectOnSegment(point.x, point.y, seg);
      if (proj.t >= 0 && proj.t <= 1) considerLine(proj.x, proj.y, 'wall', 1, null);
    }
  }
  // Extensions: the infinite line of a wall, past its ends.
  for (const seg of segments) {
    const proj = projectOnSegment(point.x, point.y, seg);
    if (proj.t > -2 && proj.t < 3 && (proj.t < 0 || proj.t > 1)) {
      const d = Math.hypot(proj.x - point.x, proj.y - point.y);
      if (d <= tolerance) {
        const from = proj.t < 0 ? seg.a : seg.b;
        considerLine(proj.x, proj.y, 'extension', 2, {
          x1: from.x,
          y1: from.y,
          x2: proj.x,
          y2: proj.y,
          kind: 'extension',
        });
      }
    }
  }
  // Alignment with an existing corner, horizontally or vertically.
  for (const node of plan.nodes) {
    if (node.id === ignoreNodeId) continue;
    if (Math.abs(node.x - point.x) <= tolerance) {
      considerLine(node.x, point.y, 'alignX', 3, {
        x1: node.x,
        y1: node.y,
        x2: node.x,
        y2: point.y,
        kind: 'align',
      });
    }
    if (Math.abs(node.y - point.y) <= tolerance) {
      considerLine(point.x, node.y, 'alignY', 3, {
        x1: node.x,
        y1: node.y,
        x2: point.x,
        y2: node.y,
        kind: 'align',
      });
    }
  }
  if (line) {
    // An alignment pins one axis and leaves the other free, so the free one may as well
    // be a round number: rounding it keeps the alignment exact and costs nothing. Left
    // raw, dragging a corner into line with another corner gave 1387 along an otherwise
    // exact alignment. A wall, an extension or a perpendicular foot is a point on a
    // line, and rounding either axis would take it off that line, so those stay put.
    let { x, y } = line;
    let guide = line.guide;
    if (gridMm > 0 && (line.kind === 'alignX' || line.kind === 'alignY')) {
      if (line.kind === 'alignX') y = snapToGrid(y, gridMm);
      else x = snapToGrid(x, gridMm);
      if (guide) guide = { ...guide, x2: line.kind === 'alignX' ? guide.x2 : x, y2: line.kind === 'alignX' ? y : guide.y2 };
    }
    return result(x, y, line.kind, guide ? [guide] : []);
  }
  if (angleRay) return onAngleRay();

  // --- grid -----------------------------------------------------------
  if (gridMm > 0) {
    return result(snapToGrid(point.x, gridMm), snapToGrid(point.y, gridMm), 'grid');
  }
  return result(point.x, point.y, null);
}

function snapToGrid(value, gridMm) {
  return gridMm > 0 ? Math.round(value / gridMm) * gridMm : value;
}

// Constrains the cursor to a ray from the anchor: to a right angle under ortho lock,
// otherwise to the nearest whole `ANGLE_STEP` degrees.
function rayForAngle(point, anchor, orthoLock) {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const angle = Math.atan2(dy, dx);
  // Rounded, never refused. It used to snap to forty-fives and give up outside a six
  // degree window, which meant a wall at fifty-one was drawn by hand to the pixel.
  const step = orthoLock ? Math.PI / 2 : (ANGLE_STEP * Math.PI) / 180;
  const snapped = Math.round(angle / step) * step;
  return {
    angle: snapped,
    x: anchor.x + Math.cos(snapped) * len,
    y: anchor.y + Math.sin(snapped) * len,
  };
}

// Angle measured the way a drawing reads it: degrees counter-clockwise from east,
// with the y axis pointing down on screen.
export function angleBetween(from, to) {
  const deg = (Math.atan2(-(to.y - from.y), to.x - from.x) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

export function pointAtAngle(from, lengthMm, degrees) {
  const rad = (degrees * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * lengthMm, y: from.y - Math.sin(rad) * lengthMm };
}
