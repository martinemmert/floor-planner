// Export: SVG built from the model using the same opening symbols the canvas
// draws, PNG rendered through the canvas renderer, and the project as JSON.

import {
  derived,
  fixturePlacement,
  fixtureToWorld,
  healProject,
  inPhase,
  isKneeWall,
  phaseWalls,
  roomFloorArea,
  wallStatus,
  livingArea,
  openingGeometry,
  planBounds,
  totalArea,
  wallCorners,
} from './model.js';
import { fixtureSymbol } from './fixtures.js';
import { DEFAULT_CUT_HEIGHT, stairGeometry, stairToWorld } from './stairs.js';
import { openingSymbol } from './openings.js';
import { dimensionLine } from './interact.js';
import { PEN_MM, Renderer, TEXT_MM, formatArea, formatLength, readTheme } from './render.js';

export function exportBounds(plan) {
  const base = planBounds(plan);
  let { minX, minY, maxX, maxY } = base;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  // Dimension lines sit outside the walls by their offset, so they usually set
  // the outer extent of the drawing.
  for (const dim of plan.dimensions) {
    const line = dimensionLine(plan, dim);
    if (!line) continue;
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
    const nx = -(line.y2 - line.y1) / len;
    const ny = (line.x2 - line.x1) / len;
    add(line.x1 + nx * 300, line.y1 + ny * 300);
    add(line.x2 + nx * 300, line.y2 + ny * 300);
  }
  // Half a wall thickness beyond the outermost centreline.
  let thickest = 0;
  for (const wall of plan.walls) thickest = Math.max(thickest, wall.thickness);
  add(minX - thickest / 2, minY - thickest / 2);
  add(maxX + thickest / 2, maxY + thickest / 2);
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function wallOutline(plan, wall) {
  const corners = wallCorners(plan, wall);
  return corners ? corners.map((p) => [p.x, p.y]) : null;
}

const n = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function planToSvg(plan, options = {}) {
  const padding = options.padding ?? 400;
  const bounds = exportBounds(plan);
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const geometry = derived(plan);
  const show = plan.show ?? {};
  const ink = options.ink ?? '#16212b';
  const muted = options.muted ?? '#677885';
  const roomFill = options.roomFill ?? 'rgba(29,111,168,0.07)';
  const sans = options.sans ?? "'Helvetica Neue', Arial, sans-serif";
  const mono = options.mono ?? "'SFMono-Regular', Menlo, monospace";
  // Physical size = real size / drawing scale, so a print at 100% is correct.
  const denominator = options.denominator ?? plan.scaleDenominator ?? 100;
  // Line weight is a property of the sheet, not of the building. Taken from the
  // building's width, a bungalow and a terrace drawn at the same scale came out with
  // different pens — and enlarging the drawing thinned every line on it. A plan is
  // drawn with a 0,25 mm pen on the paper, so at 1:100 that is 25 mm on the ground.
  const stroke = PEN_MM * denominator;
  const out = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(width)} ${n(height)}" ` +
      `width="${n(width / denominator)}mm" height="${n(height / denominator)}mm">`
  );
  out.push(`<title>${esc(plan.name)} — 1:${Math.round(denominator)}</title>`);
  out.push(`<rect x="${n(minX)}" y="${n(minY)}" width="${n(width)}" height="${n(height)}" fill="#ffffff"/>`);

  // Openings become holes in the wall fill via a mask.
  out.push(
    '<defs><mask id="openings" maskUnits="userSpaceOnUse" ' +
      `x="${n(minX)}" y="${n(minY)}" width="${n(width)}" height="${n(height)}">`
  );
  out.push(`<rect x="${n(minX)}" y="${n(minY)}" width="${n(width)}" height="${n(height)}" fill="#fff"/>`);
  for (const opening of plan.openings) {
    if (!inPhase(plan, opening.wallId)) continue;
    const geo = openingGeometry(plan, opening);
    if (!geo) continue;
    const half = geo.thickness * 0.52;
    const pts = [
      [geo.x1 + geo.nx * half, geo.y1 + geo.ny * half],
      [geo.x2 + geo.nx * half, geo.y2 + geo.ny * half],
      [geo.x2 - geo.nx * half, geo.y2 - geo.ny * half],
      [geo.x1 - geo.nx * half, geo.y1 - geo.ny * half],
    ];
    out.push(`<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="#000"/>`);
  }
  out.push('</mask></defs>');

  if (show.rooms !== false) {
    for (const room of geometry.rooms) {
      if (room.kept === false) continue;
      out.push(
        `<polygon points="${room.inner.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="${roomFill}"/>`
      );
    }
  }

  // Walls are drawn by which side of the work they are on: what is there and what
  // goes in as solid poché, what comes out dashed and empty. New work carries a
  // hatch as well, so the two are still apart on a black and white print.
  const wallPaths = [];
  const newPaths = [];
  const goingPaths = [];
  for (const wall of phaseWalls(plan)) {
    const poly = wallOutline(plan, wall);
    if (!poly) continue;
    const d = `M ${poly.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')} Z`;
    const status = wallStatus(wall);
    if (status === 'remove') goingPaths.push(d);
    else {
      wallPaths.push(d);
      if (status === 'new') newPaths.push(d);
    }
  }
  if (newPaths.length) {
    const gap = Math.max(60, Math.min(...plan.walls.map((w) => w.thickness)) / 3);
    out.push(
      `<defs><pattern id="newwork" width="${n(gap)}" height="${n(gap)}" patternUnits="userSpaceOnUse" ` +
        `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${n(gap)}" ` +
        `stroke="#ffffff" stroke-width="${n(gap / 3)}"/></pattern></defs>`
    );
  }
  if (wallPaths.length) {
    out.push(`<path d="${wallPaths.join(' ')}" fill="${ink}" mask="url(#openings)"/>`);
  }
  if (newPaths.length) {
    out.push(`<path d="${newPaths.join(' ')}" fill="url(#newwork)" mask="url(#openings)"/>`);
  }
  if (goingPaths.length) {
    out.push(
      `<path d="${goingPaths.join(' ')}" fill="#ffffff" stroke="${muted}" ` +
        `stroke-width="${n(stroke)}" stroke-dasharray="${n(stroke * 5)} ${n(stroke * 3)}"/>`
    );
  }

  // Opening symbols, from the same primitives the canvas uses.
  out.push(`<g fill="none" stroke="${ink}" stroke-width="${n(stroke)}" stroke-linecap="round">`);
  for (const opening of plan.openings) {
    if (!inPhase(plan, opening.wallId)) continue;
    const geo = openingGeometry(plan, opening);
    if (!geo) continue;
    const map = (a, c) => [geo.x1 + geo.dx * a + geo.nx * c, geo.y1 + geo.dy * a + geo.ny * c];
    for (const item of openingSymbol(opening, geo.thickness)) {
      if (item.type === 'line') {
        const [x1, y1] = map(item.a1, item.c1);
        const [x2, y2] = map(item.a2, item.c2);
        const w = item.heavy ? stroke * 1.8 : stroke;
        out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${n(w)}"/>`);
        continue;
      }
      if (item.type === 'rect') {
        const pts = [
          map(item.a0, item.c0),
          map(item.a1, item.c0),
          map(item.a1, item.c1),
          map(item.a0, item.c1),
        ];
        out.push(
          `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="#ffffff" ` +
            `stroke="${ink}" stroke-width="${n(stroke)}"/>`
        );
        continue;
      }
      const [hx, hy] = map(item.hinge, item.hingeC ?? 0);
      const [ax, ay] = map(item.fromA, item.fromC);
      const [bx, by] = map(item.toA, item.toC);
      const radius = Math.hypot(ax - hx, ay - hy);
      if (radius < 1) continue;
      // The symbol says how far the leaf swings; past a right angle the arc is the
      // long way round, which SVG needs telling with its large-arc flag.
      const turn = Number.isFinite(item.sweep) ? item.sweep : null;
      const cross = (ax - hx) * (by - hy) - (ay - hy) * (bx - hx);
      const sweep = turn === null ? (cross > 0 ? 1 : 0) : turn < 0 ? 1 : 0;
      const large = turn !== null && Math.abs(turn) > Math.PI ? 1 : 0;
      out.push(
        `<path d="M ${n(ax)} ${n(ay)} A ${n(radius)} ${n(radius)} 0 ${large} ${sweep} ${n(bx)} ${n(by)}" opacity="0.55"/>`
      );
    }
  }
  out.push('</g>');

  // Columns are structure, so they read solid like the walls.
  if (plan.columns?.length) {
    out.push(`<g fill="${ink}">`);
    for (const column of plan.columns) {
      const transform = `translate(${n(column.x)} ${n(column.y)}) rotate(${n(column.rotation ?? 0)})`;
      if (column.shape === 'round') {
        out.push(`<ellipse transform="${transform}" cx="0" cy="0" rx="${n(column.w / 2)}" ry="${n(column.h / 2)}"/>`);
      } else {
        out.push(
          `<rect transform="${transform}" x="${n(-column.w / 2)}" y="${n(-column.h / 2)}" ` +
            `width="${n(column.w)}" height="${n(column.h)}"/>`
        );
      }
    }
    out.push('</g>');
  }

  // Stairs, from the same primitives the canvas draws.
  if (plan.stairs?.length) {
    out.push(`<g fill="none" stroke="${ink}" stroke-width="${n(stroke)}" stroke-linejoin="round">`);
    for (const stair of plan.stairs) {
      const geo = stairGeometry(stair, {
        cutAt: plan.cutHeight ?? DEFAULT_CUT_HEIGHT,
        cut: (show.stairCut ?? true) !== false,
        numbers: show.stairNumbers === true,
      });
      const pt = (a, c) => {
        const w = stairToWorld(stair, a, c);
        return [w.x, w.y];
      };
      for (const item of geo.primitives) {
        // Beyond the cut plane the flight is drawn thin; the break line is heavy.
        const weight = item.style === 'above' ? stroke * 0.5 : item.style === 'cut' ? stroke * 1.8 : stroke;
        if (item.type === 'polygon' || item.type === 'polyline' || item.type === 'arrow') {
          const pts = item.pts.map((p) => pt(p.a, p.c));
          const d = `M ${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L ')}${item.type === 'polygon' ? ' Z' : ''}`;
          out.push(
            `<path d="${d}" fill="${item.type === 'polygon' ? '#ffffff' : 'none'}" stroke-width="${n(weight)}"/>`
          );
          if (item.type === 'arrow') {
            const [hx, hy] = pts[pts.length - 1];
            const [px, py] = pts[pts.length - 2] ?? pts[0];
            const angle = Math.atan2(hy - py, hx - px);
            const size = stroke * 12;
            const head = [
              [hx, hy],
              [hx - size * Math.cos(angle - 0.4), hy - size * Math.sin(angle - 0.4)],
              [hx - size * Math.cos(angle + 0.4), hy - size * Math.sin(angle + 0.4)],
            ];
            out.push(`<polygon points="${head.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${ink}" stroke="none"/>`);
          }
        } else if (item.type === 'line') {
          const [x1, y1] = pt(item.a1, item.c1);
          const [x2, y2] = pt(item.a2, item.c2);
          out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${n(weight)}"/>`);
        } else if (item.type === 'circle') {
          const [x, y] = pt(item.a, item.c);
          out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(item.r)}" stroke-width="${n(weight)}"/>`);
        } else if (item.type === 'number') {
          const [x, y] = pt(item.a, item.c);
          out.push(
            `<text x="${n(x)}" y="${n(y)}" font-family="${mono}" font-size="${n(item.size)}" ` +
              `text-anchor="middle" dominant-baseline="middle" fill="${muted}" stroke="none">${item.text}</text>`
          );
        }
      }
      const label = `${geo.label}${stair.direction === 'down' ? ' ab' : ''}`;
      const [lx, ly] = pt(geo.tread * 0.6, -geo.width / 2 - 140);
      out.push(
        `<text x="${n(lx)}" y="${n(ly)}" font-family="${mono}" font-size="180" fill="${muted}" stroke="none">${label}</text>`
      );
    }
    out.push('</g>');
  }

  // Sockets, switches and lights, from the same primitives the canvas draws.
  if (show.fixtures !== false && plan.fixtures?.length) {
    out.push(`<g fill="none" stroke="${ink}" stroke-width="${n(stroke)}" stroke-linecap="round">`);
    for (const fixture of plan.fixtures) {
      const placement = fixturePlacement(plan, fixture);
      const map = (a, c) => {
        const w = fixtureToWorld(placement, a, c);
        return [w.x, w.y];
      };
      for (const item of fixtureSymbol(fixture)) {
        const width = item.heavy ? stroke * 1.8 : stroke;
        if (item.type === 'line') {
          const [x1, y1] = map(item.a1, item.c1);
          const [x2, y2] = map(item.a2, item.c2);
          out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke-width="${n(width)}"/>`);
        } else if (item.type === 'circle') {
          const [x, y] = map(item.a, item.c);
          out.push(
            `<circle cx="${n(x)}" cy="${n(y)}" r="${n(item.r)}" fill="${item.fill ? ink : 'none'}"/>`
          );
        } else if (item.type === 'arc') {
          // A half disc: sweep from one end of the diameter to the other.
          const turn = (placement.angle * Math.PI) / 180;
          const [sx, sy] = map(item.r * Math.cos(item.from), item.r * Math.sin(item.from));
          const [ex, ey] = map(item.r * Math.cos(item.to), item.r * Math.sin(item.to));
          const d =
            `M ${n(sx)} ${n(sy)} A ${n(item.r)} ${n(item.r)} 0 0 1 ${n(ex)} ${n(ey)}` +
            (item.fill ? ' Z' : '');
          out.push(`<path d="${d}" fill="${item.fill ? ink : 'none'}"/>`);
        } else if (item.type === 'polygon') {
          const pts = item.pts.map((q) => map(q.a, q.c));
          out.push(
            `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${item.fill ? ink : 'none'}"/>`
          );
        } else if (item.type === 'text') {
          const [x, y] = map(item.a, item.c);
          const turn = ((placement.angle % 360) + 360) % 360;
          const upright = turn > 90 && turn < 270 ? placement.angle + 180 : placement.angle;
          out.push(
            `<text x="0" y="0" transform="translate(${n(x)} ${n(y)}) rotate(${n(upright)})" ` +
              `font-family="${mono}" font-size="${n(item.size)}" text-anchor="middle" ` +
              `dominant-baseline="middle" fill="${ink}" stroke="none">${esc(item.text)}</text>`
          );
        }
      }
    }
    out.push('</g>');
  }

  if (show.furniture !== false && plan.furniture.length) {
    out.push(`<g fill="none" stroke="${ink}" stroke-width="${n(stroke * 0.8)}" opacity="0.9">`);
    for (const item of plan.furniture) {
      out.push(`<g transform="translate(${n(item.x)} ${n(item.y)}) rotate(${n(item.rotation ?? 0)})">`);
      out.push(...svgSymbol(item));
      out.push('</g>');
    }
    out.push('</g>');
  }

  if (show.dimensions !== false) {
    out.push(`<g stroke="${muted}" stroke-width="${n(stroke * 0.7)}" fill="${muted}">`);
    for (const dim of plan.dimensions) {
      const line = dimensionLine(plan, dim);
      if (!line) continue;
      out.push(`<line x1="${n(line.x1)}" y1="${n(line.y1)}" x2="${n(line.x2)}" y2="${n(line.y2)}"/>`);
      out.push(
        `<line x1="${n(line.ax)}" y1="${n(line.ay)}" x2="${n(line.x1)}" y2="${n(line.y1)}" opacity="0.5"/>`
      );
      out.push(
        `<line x1="${n(line.bx)}" y1="${n(line.by)}" x2="${n(line.x2)}" y2="${n(line.y2)}" opacity="0.5"/>`
      );
      // Slanted ticks at each end, the way a drafter marks a dimension.
      const tick = Math.max(60, stroke * 8);
      const dirX = (line.x2 - line.x1) / (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1);
      const dirY = (line.y2 - line.y1) / (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1);
      for (const [tx, ty] of [
        [line.x1, line.y1],
        [line.x2, line.y2],
      ]) {
        const ox = (dirX - dirY) * tick * 0.5;
        const oy = (dirY + dirX) * tick * 0.5;
        out.push(`<line x1="${n(tx - ox)}" y1="${n(ty - oy)}" x2="${n(tx + ox)}" y2="${n(ty + oy)}"/>`);
      }
      const angle = (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
      const flip = Math.abs(angle) > 90 ? 180 : 0;
      out.push(
        `<text x="0" y="${n(-stroke * 6)}" transform="translate(${n((line.x1 + line.x2) / 2)} ` +
          `${n((line.y1 + line.y2) / 2)}) rotate(${n(angle + flip)})" font-family="${mono}" ` +
          `font-size="200" text-anchor="middle" stroke="none" fill="${muted}">${esc(formatLength(line.length))}</text>`
      );
    }
    out.push('</g>');
  }

  if (show.rooms !== false) {
    for (const room of geometry.rooms) {
      if (room.kept === false) continue;
      // Fixed on the sheet, not a function of how big the room happens to be — a
      // cupboard and a hall are labelled in the same hand.
      const size = TEXT_MM * denominator;
      if (room.name) {
        out.push(
          `<text x="${n(room.centroid.x)}" y="${n(room.centroid.y - size * 0.2)}" font-family="${sans}" ` +
            `font-size="${n(size)}" font-weight="500" text-anchor="middle" fill="${ink}">${esc(room.name)}</text>`
        );
        out.push(
          `<text x="${n(room.centroid.x)}" y="${n(room.centroid.y + size)}" font-family="${mono}" ` +
            `font-size="${n(size * 0.8)}" text-anchor="middle" fill="${muted}">${esc(formatArea(roomFloorArea(plan, room)))}</text>`
        );
      } else {
        out.push(
          `<text x="${n(room.centroid.x)}" y="${n(room.centroid.y + size * 0.3)}" font-family="${mono}" ` +
            `font-size="${n(size * 0.9)}" text-anchor="middle" fill="${muted}">${esc(formatArea(roomFloorArea(plan, room)))}</text>`
        );
      }
    }
  }

  if (show.labels !== false) {
    for (const label of plan.labels) {
      out.push(
        `<text x="${n(label.x)}" y="${n(label.y)}" font-family="${sans}" font-size="${n(label.size ?? 260)}" ` +
          `fill="${ink}">${esc(label.text)}</text>`
      );
    }
  }

  // ---- title block, bottom right, the way a sheet is signed off ----
  if (options.titleBlock !== false) {
    const lines = [
      { text: options.projectName ?? plan.name, weight: '600' },
      { text: `${plan.name} · 1:${Math.round(denominator)}` },
      { text: `${formatArea(livingArea(plan))} living · ${formatArea(totalArea(plan))} floor` },
      { text: `${Math.round(plan.height ?? 2500)} mm clear · ${plan.walls.length} walls` },
    ];
    // Size the block from its longest line so nothing runs over the edge, and keep
    // a strip on the right clear for the north arrow.
    const textSize = Math.max(150, width * 0.016);
    const longest = Math.max(...lines.map((l) => l.text.length));
    const textWidth = longest * textSize * 0.56;
    const arrowStrip = textSize * 3.4;
    const bw = Math.max(2600, textWidth + arrowStrip + textSize * 1.6);
    const bh = textSize * 1.55 * lines.length + textSize * 1.1;
    const bx = minX + width - bw - padding * 0.2;
    const by = minY + height - bh - padding * 0.2;
    out.push(`<g stroke="${ink}" stroke-width="${n(stroke * 0.8)}" fill="none">`);
    out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(bw)}" height="${n(bh)}" fill="#ffffff"/>`);
    out.push('</g>');
    let cursor = by + textSize * 1.5;
    for (const line of lines) {
      const size = line.weight ? textSize * 1.15 : textSize;
      out.push(
        `<text x="${n(bx + textSize * 0.7)}" y="${n(cursor)}" font-family="${line.weight ? sans : mono}" ` +
          `font-size="${n(size)}"${line.weight ? ` font-weight="${line.weight}"` : ''} ` +
          `fill="${line.weight ? ink : muted}">${esc(line.text)}</text>`
      );
      cursor += textSize * 1.55;
    }
    // north arrow, inside the strip reserved for it
    const nx0 = bx + bw - arrowStrip / 2;
    const ny0 = by + bh * 0.6;
    const r = Math.min(bh * 0.3, arrowStrip * 0.4);
    out.push(
      `<path d="M ${n(nx0)} ${n(ny0 - r)} L ${n(nx0 + r * 0.42)} ${n(ny0 + r * 0.7)} L ${n(nx0)} ${n(ny0 + r * 0.32)} ` +
        `L ${n(nx0 - r * 0.42)} ${n(ny0 + r * 0.7)} Z" fill="${ink}"/>`
    );
    out.push(
      `<text x="${n(nx0)}" y="${n(ny0 - r * 1.3)}" font-family="${mono}" font-size="${n(textSize * 0.9)}" ` +
        `text-anchor="middle" fill="${muted}">N</text>`
    );
  }

  out.push('</svg>');
  return out.join('\n');
}

/** The paper sizes a plan of a house is drawn on, in millimetres. */
export const PAPERS = [
  { id: 'A4', label: 'A4', width: 210, height: 297 },
  { id: 'A3', label: 'A3', width: 297, height: 420 },
  { id: 'A2', label: 'A2', width: 420, height: 594 },
];

/** The scales a house is drawn at, biggest first. */
export const SHEET_SCALES = [50, 100, 200];

export function paperSize(id, orientation = 'landscape') {
  const paper = PAPERS.find((p) => p.id === id) ?? PAPERS[1];
  const portrait = orientation === 'portrait';
  return {
    id: paper.id,
    width: portrait ? paper.width : paper.height,
    height: portrait ? paper.height : paper.width,
  };
}

/**
 * The largest of the standard scales at which the drawing fits the sheet.
 *
 * Nobody draws a house at 1:137. A drawing is at 1:50 or 1:100 or 1:200, and which one
 * is decided by what fits — so that is what this works out, rather than making you try
 * each in turn and read the overflow off the edge of the paper.
 *
 * @returns a denominator, or null if it will not go on that sheet even at the smallest
 */
export function scaleToFit(plan, paper, margin, block) {
  const bounds = exportBounds(plan);
  const across = Math.max(1, paper.width - margin * 2);
  const down = Math.max(1, paper.height - margin * 2 - block);
  for (const denominator of SHEET_SCALES) {
    if (bounds.width / denominator <= across && bounds.height / denominator <= down) return denominator;
  }
  return null;
}

/**
 * The plan set out on a sheet of paper, with a border and a title block.
 *
 * The tight export is the drawing and nothing else, which is what you want for CAD. This
 * is the other thing: a sheet you can print at 100% and hand to somebody, with the frame
 * and the block a drawing is read by. The plan is centred in what the frame leaves,
 * scaled by its denominator alone — printed at 100% a metre on the building is exactly
 * a metre over the denominator on the paper, which is the only thing that makes a scale
 * worth printing.
 */
export function planToSheetSvg(plan, options = {}) {
  const paper = paperSize(options.paper ?? 'A3', options.orientation ?? 'landscape');
  const margin = options.margin ?? 10;
  const blockHeight = 26;
  const denominator = options.denominator ?? scaleToFit(plan, paper, margin, blockHeight) ?? 200;
  const ink = options.ink ?? '#16212b';
  const muted = options.muted ?? '#677885';
  const sans = options.sans ?? "'Helvetica Neue', Arial, sans-serif";
  const mono = options.mono ?? "'SFMono-Regular', Menlo, monospace";

  const bounds = exportBounds(plan);
  const drawnWidth = bounds.width / denominator;
  const drawnHeight = bounds.height / denominator;
  const frame = {
    x: margin,
    y: margin,
    width: paper.width - margin * 2,
    height: paper.height - margin * 2,
  };
  const room = { width: frame.width, height: frame.height - blockHeight };
  // Centred in what the frame leaves above the block.
  const offsetX = frame.x + (room.width - drawnWidth) / 2 - bounds.minX / denominator;
  const offsetY = frame.y + (room.height - drawnHeight) / 2 - bounds.minY / denominator;

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(paper.width)}mm" height="${n(paper.height)}mm" ` +
      `viewBox="0 0 ${n(paper.width)} ${n(paper.height)}">`
  );
  out.push(`<title>${esc(plan.name)} — 1:${Math.round(denominator)} on ${paper.id}</title>`);
  out.push(`<rect width="${n(paper.width)}" height="${n(paper.height)}" fill="#ffffff"/>`);

  // The plan itself, dropped in as the tight drawing with its own title block left off
  // — the sheet has one of its own, and two would be a mess.
  const body = planToSvg(plan, { ...options, denominator, titleBlock: false, padding: 0 });
  const inner = body.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  out.push(`<g transform="translate(${n(offsetX)} ${n(offsetY)}) scale(${n(1 / denominator)})">`);
  out.push(inner);
  out.push('</g>');

  // The frame, and the block along the bottom of it.
  const blockTop = frame.y + frame.height - blockHeight;
  out.push(
    `<g fill="none" stroke="${ink}" stroke-width="0.4">` +
      `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}"/>` +
      `<line x1="${n(frame.x)}" y1="${n(blockTop)}" x2="${n(frame.x + frame.width)}" y2="${n(blockTop)}"/>` +
      '</g>'
  );

  const cells = [
    { label: 'Drawing', value: options.projectName ?? plan.name, wide: true },
    { label: 'Storey', value: plan.name },
    { label: 'Scale', value: `1:${Math.round(denominator)}` },
    { label: 'Living area', value: formatArea(livingArea(plan)) },
    { label: 'Sheet', value: `${paper.id} ${paper.width > paper.height ? 'landscape' : 'portrait'}` },
    { label: 'Drawn', value: options.date ?? '' },
  ];
  const units = cells.reduce((total, cell) => total + (cell.wide ? 2 : 1), 0);
  const unit = frame.width / units;
  let x = frame.x;
  for (const cell of cells) {
    const w = unit * (cell.wide ? 2 : 1);
    out.push(
      `<text x="${n(x + 2)}" y="${n(blockTop + 7)}" font-family="${mono}" font-size="2.6" fill="${muted}">` +
        `${esc(cell.label.toUpperCase())}</text>`
    );
    out.push(
      `<text x="${n(x + 2)}" y="${n(blockTop + 14)}" font-family="${sans}" font-size="4" ` +
        `font-weight="${cell.wide ? '600' : '400'}" fill="${ink}">${esc(cell.value)}</text>`
    );
    x += w;
    if (x < frame.x + frame.width - 0.5) {
      out.push(
        `<line x1="${n(x)}" y1="${n(blockTop)}" x2="${n(x)}" y2="${n(frame.y + frame.height)}" ` +
          `stroke="${ink}" stroke-width="0.25"/>`
      );
    }
  }
  // And a note if the drawing had to be shrunk to get on: better said than silent.
  if (drawnWidth > room.width + 0.5 || drawnHeight > room.height + 0.5) {
    out.push(
      `<text x="${n(frame.x + 2)}" y="${n(frame.y + 5)}" font-family="${mono}" font-size="3" fill="#a83a2e">` +
        `Does not fit ${paper.id} at 1:${Math.round(denominator)} — it runs over the frame.</text>`
    );
  }

  out.push('</svg>');
  return out.join('\n');
}

function svgSymbol(item) {
  const w = item.w;
  const h = item.h;
  const x = -w / 2;
  const y = -h / 2;
  const out = [`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#ffffff"/>`];
  switch (item.symbol) {
    case 'bed':
      out.push(`<rect x="${n(x + w * 0.06)}" y="${n(y + h * 0.04)}" width="${n(w * 0.88)}" height="${n(h * 0.24)}"/>`);
      break;
    case 'sofa':
      out.push(`<rect x="${n(x + w * 0.08)}" y="${n(y + h * 0.3)}" width="${n(w * 0.84)}" height="${n(h * 0.66)}"/>`);
      break;
    case 'round':
      out.push(`<ellipse cx="0" cy="0" rx="${n(w / 2)}" ry="${n(h / 2)}" fill="#ffffff"/>`);
      break;
    case 'bath':
      out.push(`<ellipse cx="0" cy="0" rx="${n(w / 2 - 90)}" ry="${n(h / 2 - 90)}"/>`);
      break;
    case 'shower':
      out.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + w)}" y2="${n(y + h)}"/>`);
      break;
    case 'toilet':
      out.push(`<rect x="${n(x + w * 0.15)}" y="${n(y)}" width="${n(w * 0.7)}" height="${n(h * 0.22)}"/>`);
      out.push(`<ellipse cx="0" cy="${n(h * 0.1)}" rx="${n(w * 0.44)}" ry="${n(h * 0.36)}"/>`);
      break;
    case 'basin':
      out.push(`<ellipse cx="0" cy="${n(h * 0.06)}" rx="${n(w * 0.36)}" ry="${n(h * 0.34)}"/>`);
      break;
    case 'appliance':
      out.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + w)}" y2="${n(y + h)}"/>`);
      out.push(`<line x1="${n(x + w)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y + h)}"/>`);
      break;
    case 'counter':
      out.push(`<line x1="${n(x)}" y1="${n(y + h * 0.78)}" x2="${n(x + w)}" y2="${n(y + h * 0.78)}"/>`);
      break;
    case 'wardrobe':
      out.push(`<line x1="0" y1="${n(y)}" x2="0" y2="${n(y + h)}"/>`);
      break;
    case 'stairs': {
      const steps = Math.max(3, Math.round(h / 260));
      for (let i = 1; i < steps; i++) {
        const yy = y + (h / steps) * i;
        out.push(`<line x1="${n(x)}" y1="${n(yy)}" x2="${n(x + w)}" y2="${n(yy)}"/>`);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export async function planToPngBlob(project, plan, options = {}) {
  const pxPerMm = options.pxPerMm ?? 0.16;
  const padding = options.padding ?? 400;
  const bounds = exportBounds(plan);
  const width = Math.max(200, Math.round((bounds.width + padding * 2) * pxPerMm));
  const height = Math.max(200, Math.round((bounds.height + padding * 2) * pxPerMm));
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas);
  renderer.theme = { ...readTheme(document.documentElement), paper: '#ffffff' };
  renderer.setSize(width, height, 2);
  const savedBackdrop = plan.show.backdrop;
  plan.show.backdrop = false;
  renderer.draw(
    {
      project: { ...project, activePlanId: plan.id },
      view: { x: bounds.minX - padding, y: bounds.minY - padding, scale: pxPerMm },
      selection: [],
      tool: 'none',
      gridMm: 0,
      hover: null,
    },
    {}
  );
  plan.show.backdrop = savedBackdrop;
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

export function projectToJson(project) {
  return JSON.stringify({ format: FORMAT, savedAt: new Date().toISOString(), project }, null, 1);
}

/**
 * Brings a project from any earlier shape up to the current one. Applied to
 * opened files and to whatever is sitting in browser storage, so a session saved
 * by an older version opens instead of breaking the panels.
 */
export function normaliseProject(project) {
  if (!project || !Array.isArray(project.plans)) throw new Error('That file is not a floor plan project.');
  // Where the building stands, for the sun. A drawing made before there was a sun
  // gets the default site rather than no site at all.
  const site = project.site ?? {};
  project.site = {
    latitude: Number.isFinite(site.latitude) ? site.latitude : 50.09,
    longitude: Number.isFinite(site.longitude) ? site.longitude : 8.45,
    label: site.label ?? 'Hofheim am Taunus',
    bearing: Number.isFinite(site.bearing) ? site.bearing : 0,
  };
  // Drawings briefly carried images to lay floors with. They are gone: this is a
  // drawing, not a rendering. Any that turn up in an older file are dropped, and the
  // rooms that used one fall back to a named finish on their own.
  delete project.textures;
  for (const plan of project.plans) {
    plan.nodes ??= [];
    plan.walls ??= [];
    plan.openings ??= [];
    plan.furniture ??= [];
    plan.labels ??= [];
    plan.dimensions ??= [];
    plan.rooms ??= [];
    plan.scaleDenominator ??= 100;
    plan.name ??= 'Ground floor';
    if (!['outer', 'centre', 'inner'].includes(plan.dimBasis)) plan.dimBasis = 'outer';
    plan.height ??= 2500;
    plan.floorThickness ??= 250;
    plan.cutHeight ??= 1000;
    const widthsAreLeaves = plan.openingWidths === 'leaf';
    plan.openingWidths = 'leaf';
    plan.autoDims ??= { kinds: ['openings', 'bays', 'overall', 'inside'], first: 700, gap: 700, inside: 320 };
    plan.autoDims.kinds ??= ['openings', 'bays', 'overall', 'inside'];
    plan.voids ??= [];
    for (const item of plan.voids) {
      item.w = Math.max(200, Math.round(item.w ?? 1010));
      item.h = Math.max(200, Math.round(item.h ?? 2900));
      item.rotation ??= 0;
    }
    plan.guides ??= [];
    plan.guides = plan.guides.filter((g) => (g.axis === 'x' || g.axis === 'y') && Number.isFinite(g.at));
    plan.stairs ??= [];
    plan.columns ??= [];
    delete plan.roof;
    plan.fixtures ??= [];
    if (!['mitre', 'square', 'butt'].includes(plan.joinStyle)) plan.joinStyle = 'mitre';
    for (const stair of plan.stairs) {
      stair.shape ??= 'straight';
      stair.rotation ??= 0;
      stair.direction ??= 'up';
      stair.turn ??= 'right';
      stair.railing ??= true;
      stair.newel ??= 200;
    }
    for (const room of plan.rooms) {
      room.usage ??= 'living';
    }

    // The backdrop used to carry classified layers and set-aside geometry, and
    // its page size lived on a separate `source` object.
    const old = plan.backdrop ?? {};
    const segments = (old.segments ?? []).filter((s) => !s.excluded);
    const image = old.image ?? null;
    plan.backdrop = {
      kind: old.kind ?? (image ? 'image' : segments.length ? 'pdf' : null),
      visible: old.visible !== false,
      opacity: old.opacity ?? (image ? 0.55 : 0.3),
      widthMm: old.widthMm ?? plan.source?.widthMm ?? 0,
      heightMm: old.heightMm ?? plan.source?.heightMm ?? 0,
      image,
      segments: segments.map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })),
      texts: (old.texts ?? [])
        .filter((t) => !t.excluded)
        .map((t) => ({ str: t.str, x: t.x, y: t.y, size: t.size })),
    };

    // Keep whatever the drawing was showing and only fill in the flags that have
    // to have an answer. Listing them exhaustively here silently threw away every
    // toggle added afterwards, so a setting turned on would come back off.
    const visibility = plan.show ?? plan.layerVisibility ?? {};
    plan.show = {
      ...visibility,
      rooms: visibility.rooms !== false,
      dimensions: visibility.dimensions !== false,
      labels: visibility.labels !== false,
      furniture: visibility.furniture !== false,
      backdrop: visibility.backdrop !== false,
      openingSizes: visibility.openingSizes !== false,
    };
    plan.scaleConfirmed = plan.scaleConfirmed ?? plan.source?.scaleConfirmed ?? false;
    delete plan.layerVisibility;
    delete plan.extract;
    delete plan.setAside;
    delete plan.source;

    // Openings gained a style, a hinge, a swing and a head height.
    for (const opening of plan.openings) {
      if (opening.swingAngle !== undefined && !Number.isFinite(opening.swingAngle)) delete opening.swingAngle;
      for (const key of ['boardInner', 'boardOuter', 'boardThickness', 'stock']) {
        if (opening[key] !== undefined && !Number.isFinite(opening[key])) delete opening[key];
      }
      // `width` used to mean the hole in the wall; it means the door now, so an
      // older drawing has its linings taken back off it. Done once, and marked.
      if (!widthsAreLeaves && Number.isFinite(opening.width)) {
        opening.width = Math.max(200, opening.width - (opening.kind === 'window' ? 120 : 60));
      }
      opening.kind ??= 'door';
      opening.style ??= opening.kind === 'window' ? 'turn-tilt' : 'single';
      // Every window used to be one undifferentiated "casement". They are Dreh-Kipp
      // now, which is what almost all of them are, and which the older drawings meant.
      if (opening.kind === 'window' && opening.style === 'casement') opening.style = 'turn-tilt';
      if (opening.swing !== 'in' && opening.swing !== 'out') {
        // The old model folded hinge and swing into one field.
        opening.hinge = opening.swing === 'right' || opening.hinge === 'end' ? 'end' : 'start';
        opening.swing = 'in';
      }
      opening.hinge ??= 'start';
      opening.sill ??= opening.kind === 'window' ? 900 : 0;
      opening.head ??= 2010;
      opening.width ??= 860;
      opening.offset ??= 0;
    }
    for (const wall of plan.walls) {
      wall.type = wall.type === 'interior' ? 'bearing' : wall.type;
      wall.type ??= wall.thickness > 250 ? 'exterior' : wall.thickness > 140 ? 'bearing' : 'partition';
      delete wall.manual;
    }

    // A wall standing on a corner that is not there is not a wall. Every reader of the
    // drawing looks its ends up and gets nothing back, so it draws as a blank, bounds
    // no room, and takes part in no chain — while still counting in the totals. Better
    // to say what was dropped than to carry a wall nobody can see.
    const nodes = new Set(plan.nodes.map((node) => node.id));
    const orphans = plan.walls.filter((wall) => !nodes.has(wall.a) || !nodes.has(wall.b));
    if (orphans.length) {
      const lost = new Set(orphans.map((wall) => wall.id));
      plan.walls = plan.walls.filter((wall) => !lost.has(wall.id));
      // And whatever was cut into them, which has nothing to sit in any more.
      plan.openings = plan.openings.filter((opening) => !lost.has(opening.wallId));
      plan.dropped = (plan.dropped ?? 0) + orphans.length;
    }
    // Fixtures mounted on a wall that has gone come loose rather than disappear.
    for (const fixture of plan.fixtures ?? []) {
      if (fixture.wallId && !plan.walls.some((wall) => wall.id === fixture.wallId)) delete fixture.wallId;
    }

    plan.version = 0;
  }
  project.activePlanId = project.plans.some((p) => p.id === project.activePlanId)
    ? project.activePlanId
    : project.plans[0]?.id;
  project.name ??= 'My floor plan';
  delete project.stage;
  // A drawing made before walls were joined at their junctions gets that done on
  // the way in, so its rooms and corners come out right straight away.
  healProject(project);
  return project;
}

/** What this build writes, and the oldest shape it still knows how to read. */
export const FORMAT = 'floor-planner/2';

export function projectFromJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not a floor plan — it is not even JSON.');
  }
  // The format stamp was written on every save and read on none of them, so a file
  // from a later build would have been taken apart by the migrations for an earlier
  // one and quietly mangled. It is worth one line to say so instead.
  const stamp = typeof parsed?.format === 'string' ? parsed.format : null;
  if (stamp && stamp.startsWith('floor-planner/')) {
    const made = Number(stamp.slice('floor-planner/'.length));
    const mine = Number(FORMAT.slice('floor-planner/'.length));
    if (Number.isFinite(made) && made > mine) {
      throw new Error(
        `That drawing was saved by a newer version of this page (${stamp}). Open it there, or save a copy from it first.`
      );
    }
  }
  return normaliseProject(parsed.project ?? parsed);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(name, extension) {
  const base = String(name || 'floor-plan')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'floor-plan'}.${extension}`;
}
