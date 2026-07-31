// Room detection. Wall centrelines form a planar graph; splitting every edge at
// its intersections and walking the faces yields one closed region per room.
// Angles are computed in a y-up frame so interior faces come out positive and
// the outer face is the only negative one.

import { polygonArea, polygonCentroid, lineIntersection, pointInPolygon } from './vec.js';

const NODE_TOLERANCE = 60; // mm

function nodeKeyFor(x, y, tolerance) {
  return `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
}

class NodeSet {
  constructor(tolerance) {
    this.tolerance = tolerance;
    this.nodes = [];
    this.index = new Map();
  }
  add(x, y) {
    const t = this.tolerance;
    const gx = Math.round(x / t);
    const gy = Math.round(y / t);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const found = this.index.get(`${gx + dx},${gy + dy}`);
        if (found !== undefined) {
          const node = this.nodes[found];
          if (Math.hypot(node.x - x, node.y - y) <= t) return found;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ id, x, y });
    this.index.set(`${gx},${gy}`, id);
    return id;
  }
}

/**
 * Splits walls at their mutual intersections and welds coincident endpoints.
 * @param walls [{x1,y1,x2,y2,thickness,id?}] in millimetres
 */
export function buildGraph(walls, tolerance = NODE_TOLERANCE) {
  const cuts = walls.map(() => []);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const hit = lineIntersection(walls[i], walls[j]);
      if (!hit) continue;
      const lenI = Math.hypot(walls[i].x2 - walls[i].x1, walls[i].y2 - walls[i].y1);
      const lenJ = Math.hypot(walls[j].x2 - walls[j].x1, walls[j].y2 - walls[j].y1);
      const slackI = tolerance / Math.max(lenI, 1e-6);
      const slackJ = tolerance / Math.max(lenJ, 1e-6);
      if (hit.t < -slackI || hit.t > 1 + slackI) continue;
      if (hit.u < -slackJ || hit.u > 1 + slackJ) continue;
      cuts[i].push(Math.min(1, Math.max(0, hit.t)));
      cuts[j].push(Math.min(1, Math.max(0, hit.u)));
    }
  }

  const nodes = new NodeSet(tolerance);
  const edges = [];
  walls.forEach((wall, index) => {
    const ts = [0, 1, ...cuts[index]].sort((a, b) => a - b);
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const len = Math.hypot(dx, dy);
    let prev = null;
    for (const t of ts) {
      const x = wall.x1 + dx * t;
      const y = wall.y1 + dy * t;
      const id = nodes.add(x, y);
      if (prev !== null && prev !== id) {
        const a = nodes.nodes[prev];
        const b = nodes.nodes[id];
        if (Math.hypot(b.x - a.x, b.y - a.y) > tolerance) {
          edges.push({
            id: edges.length,
            a: prev,
            b: id,
            wallIndex: index,
            thickness: wall.thickness ?? 115,
          });
        }
      }
      if (prev === null || prev !== id) prev = id;
    }
    if (len === 0) return;
  });

  // Drop duplicate edges between the same node pair.
  const seen = new Map();
  const unique = [];
  for (const edge of edges) {
    const key = edge.a < edge.b ? `${edge.a}-${edge.b}` : `${edge.b}-${edge.a}`;
    if (seen.has(key)) {
      const kept = unique[seen.get(key)];
      kept.thickness = Math.max(kept.thickness, edge.thickness);
      continue;
    }
    seen.set(key, unique.length);
    unique.push({ ...edge, id: unique.length });
  }
  return { nodes: nodes.nodes, edges: unique };
}

function angleAt(nodes, from, to) {
  const a = nodes[from];
  const b = nodes[to];
  return Math.atan2(-(b.y - a.y), b.x - a.x); // y-up frame
}

/**
 * Walks the planar faces of the graph.
 * @returns [{nodeIds, polygon, signedArea, edgeIds}] with the outer face removed
 */
export function findFaces(graph) {
  const { nodes, edges } = graph;
  const outgoing = new Map();
  for (const edge of edges) {
    for (const [from, to] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ]) {
      const list = outgoing.get(from) ?? [];
      list.push({ to, edge, angle: angleAt(nodes, from, to) });
      outgoing.set(from, list);
    }
  }
  for (const list of outgoing.values()) list.sort((p, q) => p.angle - q.angle);

  const visited = new Set();
  const faces = [];
  const halfKey = (from, to) => `${from}>${to}`;

  for (const edge of edges) {
    for (const [startFrom, startTo] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ]) {
      if (visited.has(halfKey(startFrom, startTo))) continue;
      const nodeIds = [];
      const edgeIds = [];
      let from = startFrom;
      let to = startTo;
      // The edge currently being walked, so edgeIds[i] is always the edge from
      // nodeIds[i] to nodeIds[i + 1]. Recording the *next* edge instead would
      // shift the array by one and inset every room edge by its neighbour's
      // wall thickness.
      let currentEdge = edge;
      let guard = 0;
      let closed = false;
      while (guard++ < edges.length * 2 + 8) {
        visited.add(halfKey(from, to));
        nodeIds.push(from);
        edgeIds.push(currentEdge.id);
        const list = outgoing.get(to) ?? [];
        const back = angleAt(nodes, to, from);
        // clockwise-next after the incoming direction
        let pick = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].angle < back - 1e-9) {
            pick = list[i];
            break;
          }
        }
        if (!pick) pick = list[list.length - 1];
        if (!pick) break;
        const nextFrom = to;
        const nextTo = pick.to;
        if (nextFrom === startFrom && nextTo === startTo) {
          closed = true;
          break;
        }
        from = nextFrom;
        to = nextTo;
        currentEdge = pick.edge;
      }
      if (!closed || nodeIds.length < 3) continue;
      const polygon = nodeIds.map((id) => ({ x: nodes[id].x, y: nodes[id].y }));
      // positive area in the y-up frame means an interior face
      const areaYUp = -polygonArea(polygon);
      faces.push({ nodeIds, edgeIds, polygon, signedArea: areaYUp });
    }
  }
  return faces.filter((f) => f.signedArea > 0);
}

// Moves every edge of the polygon inward by half of its wall thickness so the
// reported area is the usable floor area rather than the centreline area.
export function insetPolygon(points, offsets) {
  const n = points.length;
  if (n < 3) return points;
  const area = polygonArea(points);
  const sign = area > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      lines.push(null);
      continue;
    }
    const nx = (sign * -dy) / len;
    const ny = (sign * dx) / len;
    const d = offsets[i] ?? 0;
    lines.push({
      x1: p.x + nx * d,
      y1: p.y + ny * d,
      x2: q.x + nx * d,
      y2: q.y + ny * d,
    });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prevIndex = (i - 1 + n) % n;
    const prev = lines[prevIndex];
    const cur = lines[i];
    if (!prev || !cur) {
      out.push(points[i]);
      continue;
    }
    // Consecutive edges that continue straight on (a T-junction splits an edge
    // in two) have parallel offset lines. Their intersection is meaningless and
    // numerically explosive, so the offset start point is used directly.
    const prevAngle = Math.atan2(prev.y2 - prev.y1, prev.x2 - prev.x1);
    const curAngle = Math.atan2(cur.y2 - cur.y1, cur.x2 - cur.x1);
    let turn = Math.abs(((curAngle - prevAngle + Math.PI) % (2 * Math.PI)) - Math.PI);
    const hit = turn < 0.02 ? null : lineIntersection(prev, cur);
    if (!hit) {
      out.push({ x: cur.x1, y: cur.y1 });
      continue;
    }
    const reach = Math.max(20, 12 * Math.max(Math.abs(offsets[prevIndex] ?? 0), Math.abs(offsets[i] ?? 0)));
    if (Math.hypot(hit.x - points[i].x, hit.y - points[i].y) > reach) {
      out.push({ x: cur.x1, y: cur.y1 });
      continue;
    }
    out.push({ x: hit.x, y: hit.y });
  }
  return out;
}

function perimeterOf(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * @param walls millimetre wall centrelines
 * @param options {minAreaMm2, minWidthMm, tolerance}
 * @returns {{graph, rooms}}
 */
export function detectRooms(walls, options = {}) {
  const tolerance = options.tolerance ?? NODE_TOLERANCE;
  const minArea = options.minAreaMm2 ?? 700000; // 0.7 m²
  const minWidth = options.minWidthMm ?? 400;
  const graph = buildGraph(walls, tolerance);
  const faces = findFaces(graph);
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));

  const rooms = [];
  for (const face of faces) {
    const offsets = face.edgeIds.map((id) => (edgeById.get(id)?.thickness ?? 115) / 2);
    const inner = insetPolygon(face.polygon, offsets);
    const areaMm2 = Math.abs(polygonArea(inner));
    const perimeter = perimeterOf(inner);
    // A wall cavity is long and thin; a room is not.
    const widthProxy = perimeter > 0 ? (4 * areaMm2) / perimeter : 0;
    if (areaMm2 < minArea || widthProxy < minWidth) continue;
    const key = [...face.nodeIds].sort((a, b) => a - b).join('.');
    rooms.push({
      key,
      nodeIds: face.nodeIds,
      edgeIds: face.edgeIds,
      polygon: face.polygon,
      inner,
      areaMm2,
      centroid: polygonCentroid(inner),
    });
  }
  rooms.sort((a, b) => b.areaMm2 - a.areaMm2);
  return { graph, rooms };
}

// Attaches extracted text to the room that contains it.
export function nameRooms(rooms, texts) {
  const used = new Set();
  for (const room of rooms) {
    const inside = [];
    for (let i = 0; i < texts.length; i++) {
      if (used.has(i)) continue;
      const text = texts[i];
      if (pointInPolygon(text.x, text.y, room.inner)) inside.push({ index: i, text });
    }
    const words = inside.filter(({ text }) => !text.numeric && /[A-Za-zÄÖÜäöüß]{3}/.test(text.str));
    words.sort((a, b) => b.text.size - a.text.size || b.text.str.length - a.text.str.length);
    if (words.length) {
      room.name = words[0].text.str.trim();
      used.add(words[0].index);
    }
    const areas = inside.filter(({ text }) => /m²|m2/i.test(text.str));
    if (areas.length) room.statedArea = areas[0].text.str.trim();
  }
  return rooms;
}
