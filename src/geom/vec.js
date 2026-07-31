// Small geometry helpers shared by extraction, wall inference and the editor.
// Everything works on plain {x, y} objects and [x1, y1, x2, y2] segments.

export const EPS = 1e-9;

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function segLength(s) {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

// Direction normalised into [0, PI) so opposite directions compare equal.
export function segAngle(s) {
  let a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  if (a < 0) a += Math.PI;
  if (a >= Math.PI - EPS) a = 0;
  return a;
}

export function angleDelta(a, b) {
  let d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

export function pointSegDistance(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS) return dist(px, py, s.x1, s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, s.x1 + t * dx, s.y1 + t * dy);
}

export function lineIntersection(a, b) {
  const x1 = a.x1;
  const y1 = a.y1;
  const x2 = a.x2;
  const y2 = a.y2;
  const x3 = b.x1;
  const y3 = b.y1;
  const x4 = b.x2;
  const y4 = b.y2;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / den;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t, u };
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonCentroid(points) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < EPS) {
    const n = points.length || 1;
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

export function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Uniform grid for near-neighbour queries over segments or points.
export class Grid {
  constructor(cellSize) {
    this.cell = cellSize > 0 ? cellSize : 1;
    this.map = new Map();
  }
  key(ix, iy) {
    return `${ix},${iy}`;
  }
  insert(x, y, item) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let list = this.map.get(k);
    if (!list) {
      list = [];
      this.map.set(k, list);
    }
    list.push(item);
  }
  insertSegment(s, item) {
    const steps = Math.max(1, Math.ceil(segLength(s) / this.cell));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.insert(s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t, item);
    }
  }
  near(x, y, radius = 0) {
    const r = Math.max(1, Math.ceil(radius / this.cell));
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out = new Set();
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iy = cy - r; iy <= cy + r; iy++) {
        const list = this.map.get(this.key(ix, iy));
        if (list) for (const item of list) out.add(item);
      }
    }
    return out;
  }
}

/**
 * The part of a polygon on one side of a line: keeps everything where
 * `nx·x + ny·y >= at`, cutting new vertices where the boundary crosses.
 *
 * Sutherland–Hodgman. The clip is a half plane, so intersecting several of them in
 * turn gives any convex region — which is what a headroom band under a sloping
 * ceiling is, and what the area outside a rectangular floor opening reduces to.
 * A concave subject can come out with a zero-width seam along the cut, which costs
 * nothing in area.
 */
export function clipPolygonHalfPlane(points, nx, ny, at) {
  if (points.length < 3) return [];
  const inside = (p) => nx * p.x + ny * p.y >= at - 1e-9;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) out.push(a);
    if (aIn === bIn) continue;
    const da = nx * a.x + ny * a.y - at;
    const db = nx * b.x + ny * b.y - at;
    const t = da / (da - db);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out.length >= 3 ? out : [];
}

/** The polygon with everything inside an axis-aligned box taken out of it. */
export function clipPolygonOutsideBox(points, box) {
  const pieces = [];
  const push = (poly) => {
    if (poly.length >= 3 && Math.abs(polygonArea(poly)) > 1) pieces.push(poly);
  };
  // Left of the box, right of it, then the band between taken above and below.
  push(clipPolygonHalfPlane(points, -1, 0, -box.x0));
  push(clipPolygonHalfPlane(points, 1, 0, box.x1));
  let band = clipPolygonHalfPlane(points, 1, 0, box.x0);
  band = band.length ? clipPolygonHalfPlane(band, -1, 0, -box.x1) : [];
  if (band.length) {
    push(clipPolygonHalfPlane(band, 0, -1, -box.y0));
    push(clipPolygonHalfPlane(band, 0, 1, box.y1));
  }
  return pieces;
}
