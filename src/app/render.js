// Canvas renderer.
//
// Walls are filled poché with their openings punched out of an offscreen layer —
// the only way to leave a real hole in a wall without erasing the room tint
// underneath. Each opening then gets the plan symbol for its type.

import {
  derived,
  findWall,
  fixturePlacement,
  fixtureToWorld,
  isKneeWall,
  nodeDegree,
  floorsInOrder,
  phaseWalls,
  openingGeometry,
  planElevation,
  wallCorners,
  wallEnds,
  wallHeight,
  WOFLV_FULL,
  WOFLV_HALF,
  headroomLines,
  roomFloorArea,
  voidCorners,
  inPhase,
  phaseOf,
  wallInPhase,
  wallStatus,
} from './model.js';
import { fixtureSymbol, fixtureSpec } from './fixtures.js';
import { clearanceIssues, doorSwingZone, frontClearance, overlapDepth } from './clearance.js';
import { pointInPolygon } from '../geom/vec.js';
import { openingWidth, stockOf } from './openings.js';

/**
 * The pen and the lettering a plan is drawn with, in millimetres on the finished sheet.
 *
 * Fixed on the paper and worked back through the scale, which is what makes a line the
 * same weight at 1:50 as at 1:100 and what a set of drawing pens actually is. DIN 15
 * runs 0,13 / 0,18 / 0,25 / 0,35 / 0,5; this takes the middle for a general line.
 *
 * They live here, with the drawing, because the SVG export draws the same sheet and
 * imports them from here — the other way round is a cycle, since the export already
 * borrows this module's opening symbol.
 */
export const PEN_MM = 0.25;
export const TEXT_MM = 2.5;

/**
 * A level the way a plan writes it: the ground floor is the datum, so ±0,00 there and
 * a signed figure everywhere else, always to two places.
 */
export function levelLabel(mm) {
  const metres = Math.round(mm) / 1000;
  if (Math.abs(metres) < 0.005) return 'OKFF ±0,00';
  return `OKFF ${metres > 0 ? '+' : '−'}${Math.abs(metres).toFixed(2).replace('.', ',')}`;
}
import {
  allChains,
  angleLabel,
  chainGeometry,
  chainKey,
  chainMentions,
  cornerAngles,
  dimLabel,
  dimText,
} from './dimensions.js';
import { furnitureSymbol } from './symbols.js';

// What a chain can have something to say about. Hovering one of these lights up the
// figures that measure it; hovering a label or a guide has nothing to light.
const DIMENSIONABLE = new Set(['wall', 'opening']);
import { dimensionLine } from './interact.js';
import { openingMarks, openingSymbol } from './openings.js';
import { DEFAULT_CUT_HEIGHT, stairGeometry, stairToWorld, stairWorldFootprint } from './stairs.js';

export function readTheme(element) {
  const css = getComputedStyle(element);
  const get = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    ink: get('--ink', '#16212b'),
    paper: get('--paper', '#eef1f3'),
    surface: get('--surface', '#ffffff'),
    line: get('--line', '#c2ccd3'),
    faint: get('--faint', '#e0e7ea'),
    accent: get('--accent', '#1d6fa8'),
    accentSoft: get('--accent-soft', 'rgba(29,111,168,0.14)'),
    select: get('--select', '#b8601a'),
    muted: get('--muted', '#677885'),
    roomFill: get('--room-fill', 'rgba(29,111,168,0.07)'),
    roomDrop: get('--room-drop', 'rgba(103,120,133,0.1)'),
    danger: get('--danger', '#a83a2e'),
    sans: get('--font-sans', 'system-ui, sans-serif'),
    mono: get('--font-mono', 'ui-monospace, monospace'),
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wallLayer = document.createElement('canvas');
    this.wallCtx = this.wallLayer.getContext('2d');
    this.dpr = 1;
    this.theme = readTheme(canvas);
    this.width = 0;
    this.height = 0;
    this.backdropImage = null;
  }

  refreshTheme() {
    this.theme = readTheme(this.canvas);
  }

  setSize(width, height, dpr = 1) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const canvas of [this.canvas, this.wallLayer]) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
  }

  resize() {
    // Measure the container, never the canvas: the canvas is sized by CSS, and
    // reading its own box after writing to it would lock in a stale size.
    const host = this.canvas.parentElement ?? this.canvas;
    const rect = host.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (this.width === w && this.height === h && this.dpr === dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    for (const canvas of [this.canvas, this.wallLayer]) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return true;
  }

  toScreen(view, x, y) {
    return [(x - view.x) * view.scale, (y - view.y) * view.scale];
  }

  toWorld(view, sx, sy) {
    return [sx / view.scale + view.x, sy / view.scale + view.y];
  }

  draw(state, extras = {}) {
    const { ctx, dpr, theme } = this;
    const plan = state.project.plans.find((p) => p.id === state.project.activePlanId);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!plan) {
      ctx.restore();
      return;
    }
    const view = state.view;
    const show = plan.show ?? {};
    this.chainFocus = null;
    this.drawGrid(view, state.gridMm);
    if (show.backdrop !== false) this.drawBackdrop(plan, view);
    if (show.floorBelow) this.drawFloorBelow(state.project, plan, view);
    const geometry = derived(plan);
    if (show.rooms !== false) this.drawRooms(plan, geometry, view, state);
    this.drawWalls(plan, view);
    this.drawColumns(plan, view, state);
    this.drawOpenings(plan, view, state, show);
    this.drawStairs(plan, view, state);
    if (show.clearances) this.drawClearances(plan, view, state);
    if (show.voids !== false) this.drawVoids(plan, view, state);
    if (show.headroom !== false) this.drawHeadroomLines(plan, geometry, view);
    if (show.guides !== false) this.drawGuides(plan, view, state);
    if (show.fixtures !== false) this.drawFixtures(plan, view, state);
    if (show.wallHeights) this.drawWallHeights(plan, view);
    if (show.furniture !== false) this.drawFurniture(plan, view, state);
    if (show.dimensions !== false) this.drawDimensions(plan, view, state);
    if (show.autoDims !== false) this.drawChains(plan, view, state);
    if (show.angles !== false) this.drawCornerAngles(plan, geometry, view);
    if (show.rooms !== false) this.drawRoomText(plan, geometry, view);
    if (show.levels !== false) this.drawLevels(state.project, plan, geometry, view);
    if (show.labels !== false) this.drawLabels(plan, view, state);
    this.drawSelection(plan, view, state, extras);
    // Last of the drawing proper: a witness line is only useful if you can follow it.
    this.drawChainFocus();
    if (extras.rubber) this.drawRubber(view, extras.rubber);
    if (extras.draft) this.drawDraft(view, extras.draft);
    if (extras.measurement) this.drawMeasurement(view, extras.measurement);
    if (extras.splitPreview) this.drawSplitPreview(view, extras.splitPreview);
    if (extras.snap) this.drawSnap(view, extras.snap);
    ctx.restore();
  }

  /**
   * Where the split tool is about to cut, and what the two pieces would measure.
   *
   * A cut is the one edit that leaves the drawing looking identical: the poché runs
   * straight through the new corner, so the only way to know it happened — or where —
   * is to be shown it first.
   */
  drawSplitPreview(view, cut) {
    const { ctx, theme } = this;
    const [x, y] = this.toScreen(view, cut.x, cut.y);
    const [ax, ay] = this.toScreen(view, cut.x + cut.nx, cut.y + cut.ny);
    const [bx, by] = this.toScreen(view, cut.x - cut.nx, cut.y - cut.ny);
    ctx.save();
    ctx.lineCap = 'round';

    // A hairline of paper under the mark, so it reads against solid poché.
    for (const [colour, width] of [
      [theme.surface, 5],
      [theme.select, 2.2],
    ]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Which way the two pieces run, as a short arrow along the wall each way.
    const len = Math.hypot(cut.b.x - cut.a.x, cut.b.y - cut.a.y) || 1;
    const ux = ((cut.b.x - cut.a.x) / len) * (26 / view.scale);
    const uy = ((cut.b.y - cut.a.y) / len) * (26 / view.scale);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = theme.select;
    for (const sign of [1, -1]) {
      const [tx, ty] = this.toScreen(view, cut.x + ux * sign, cut.y + uy * sign);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    // The two lengths, written where each piece is.
    const at = (dist) => {
      const t = dist / len;
      return this.toScreen(view, cut.a.x + (cut.b.x - cut.a.x) * t, cut.a.y + (cut.b.y - cut.a.y) * t);
    };
    ctx.font = `600 11px ${theme.mono}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [dist, mm] of [
      [cut.at / 2, cut.first],
      [cut.at + cut.second / 2, cut.second],
    ]) {
      const [lx, ly] = at(dist);
      const text = formatLength(mm);
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = theme.surface;
      ctx.fillRect(lx - w / 2, ly - 8, w, 16);
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - w / 2, ly - 8, w, 16);
      ctx.fillStyle = theme.select;
      ctx.fillText(text, lx, ly + 0.5);
    }
    ctx.restore();
  }

  drawGrid(view, gridMm) {
    if (!gridMm) return;
    const { ctx, theme } = this;
    const step = gridMm * view.scale;
    if (step < 7) return;
    const major = 10;
    ctx.save();
    ctx.lineWidth = 1;
    const endX = view.x + this.width / view.scale;
    const endY = view.y + this.height / view.scale;
    for (let x = Math.floor(view.x / gridMm) * gridMm; x <= endX; x += gridMm) {
      const isMajor = Math.round(x / gridMm) % major === 0;
      ctx.strokeStyle = isMajor ? theme.line : theme.faint;
      ctx.globalAlpha = isMajor ? 0.5 : 0.3;
      const [sx] = this.toScreen(view, x, 0);
      ctx.beginPath();
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, this.height);
      ctx.stroke();
    }
    for (let y = Math.floor(view.y / gridMm) * gridMm; y <= endY; y += gridMm) {
      const isMajor = Math.round(y / gridMm) % major === 0;
      ctx.strokeStyle = isMajor ? theme.line : theme.faint;
      ctx.globalAlpha = isMajor ? 0.5 : 0.3;
      const [, sy] = this.toScreen(view, 0, y);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(this.width, Math.round(sy) + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBackdrop(plan, view) {
    const backdrop = plan.backdrop;
    if (!backdrop?.kind) return;
    const { ctx, theme } = this;
    ctx.save();
    if (backdrop.image && this.backdropImage?.complete) {
      ctx.globalAlpha = backdrop.opacity ?? 0.5;
      const [x, y] = this.toScreen(view, 0, 0);
      ctx.drawImage(this.backdropImage, x, y, backdrop.widthMm * view.scale, backdrop.heightMm * view.scale);
    }
    if (backdrop.segments.length) {
      ctx.globalAlpha = backdrop.opacity ?? 0.3;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const seg of backdrop.segments) {
        const [x1, y1] = this.toScreen(view, seg.x1, seg.y1);
        const [x2, y2] = this.toScreen(view, seg.x2, seg.y2);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      for (const text of backdrop.texts) {
        const size = text.size * view.scale;
        if (size < 5 || size > 80) continue;
        const [x, y] = this.toScreen(view, text.x, text.y);
        ctx.font = `${size}px ${theme.sans}`;
        ctx.fillText(text.str, x, y);
      }
    }
    ctx.restore();
  }

  wallPolygon(plan, wall, view) {
    const corners = wallCorners(plan, wall);
    if (!corners) return null;
    return corners.map((p) => this.toScreen(view, p.x, p.y));
  }

  /** A hatch across a wall's own outline, for anything not drawn as solid poché. */
  hatchPolygon(wctx, poly, colour, step = 7, alpha = 0.5) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const spanY = Math.max(...ys) - Math.min(...ys);
    wctx.save();
    wctx.beginPath();
    wctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) wctx.lineTo(poly[i][0], poly[i][1]);
    wctx.closePath();
    wctx.clip();
    wctx.strokeStyle = colour;
    wctx.globalAlpha = alpha;
    wctx.lineWidth = 1;
    for (let d = Math.min(...xs) - spanY; d < Math.max(...xs); d += step) {
      wctx.beginPath();
      wctx.moveTo(d, Math.min(...ys));
      wctx.lineTo(d + spanY, Math.max(...ys));
      wctx.stroke();
    }
    wctx.restore();
  }

  drawWalls(plan, view) {
    const { wallCtx: wctx, dpr, theme } = this;
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, this.width, this.height);
    const phase = phaseOf(plan);
    const shown = plan.walls.filter((wall) => wallInPhase(wall, phase));
    // Full-height walls first, as solid poché.
    wctx.fillStyle = theme.ink;
    wctx.beginPath();
    for (const wall of shown) {
      if (isKneeWall(plan, wall) || wallStatus(wall) === 'remove') continue;
      const poly = this.wallPolygon(plan, wall, view);
      if (!poly) continue;
      wctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) wctx.lineTo(poly[i][0], poly[i][1]);
      wctx.closePath();
    }
    wctx.fill();

    // A knee wall does not reach the ceiling, so it is drawn open rather than
    // solid — the convention for anything cut above the plane of the drawing.
    for (const wall of shown) {
      if (!isKneeWall(plan, wall) || wallStatus(wall) === 'remove') continue;
      const poly = this.wallPolygon(plan, wall, view);
      if (!poly) continue;
      wctx.beginPath();
      wctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) wctx.lineTo(poly[i][0], poly[i][1]);
      wctx.closePath();
      wctx.save();
      wctx.fillStyle = theme.surface;
      wctx.fill();
      wctx.restore();
      this.hatchPolygon(wctx, poly, theme.ink);
      wctx.save();
      wctx.strokeStyle = theme.ink;
      wctx.lineWidth = 1.4;
      wctx.beginPath();
      wctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) wctx.lineTo(poly[i][0], poly[i][1]);
      wctx.closePath();
      wctx.stroke();
      wctx.restore();
    }

    // Going in: solid, with a hatch over it so it is told apart from what is there
    // already even on a black and white print.
    for (const wall of shown) {
      if (wallStatus(wall) !== 'new') continue;
      const poly = this.wallPolygon(plan, wall, view);
      if (poly) this.hatchPolygon(wctx, poly, theme.paper, 6, 0.85);
    }

    // Coming out: dashed and empty, so what survives the work reads on its own.
    for (const wall of shown) {
      if (wallStatus(wall) !== 'remove') continue;
      const poly = this.wallPolygon(plan, wall, view);
      if (!poly) continue;
      wctx.save();
      wctx.beginPath();
      wctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) wctx.lineTo(poly[i][0], poly[i][1]);
      wctx.closePath();
      wctx.fillStyle = theme.surface;
      wctx.globalAlpha = 0.75;
      wctx.fill();
      wctx.globalAlpha = 1;
      wctx.setLineDash([6, 4]);
      wctx.lineWidth = 1.2;
      wctx.strokeStyle = theme.muted;
      wctx.stroke();
      wctx.restore();
    }

    wctx.save();
    wctx.globalCompositeOperation = 'destination-out';
    for (const opening of plan.openings) {
      if (!inPhase(plan, opening.wallId)) continue;
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const half = geo.thickness * 0.52; // just over half, so no hairline survives
      const pts = [
        this.toScreen(view, geo.x1 + geo.nx * half, geo.y1 + geo.ny * half),
        this.toScreen(view, geo.x2 + geo.nx * half, geo.y2 + geo.ny * half),
        this.toScreen(view, geo.x2 - geo.nx * half, geo.y2 - geo.ny * half),
        this.toScreen(view, geo.x1 - geo.nx * half, geo.y1 - geo.ny * half),
      ];
      wctx.beginPath();
      wctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) wctx.lineTo(pts[i][0], pts[i][1]);
      wctx.closePath();
      wctx.fill();
    }
    wctx.restore();
    this.ctx.drawImage(this.wallLayer, 0, 0, this.width, this.height);
  }

  drawOpenings(plan, view, state, show) {
    const { ctx, theme } = this;
    const marks = show.openingMarks === false ? new Map() : openingMarks(plan).markOf;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const opening of plan.openings) {
      if (!inPhase(plan, opening.wallId)) continue;
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const selected = state.selection.some((s) => s.kind === 'opening' && s.id === opening.id);
      // Local frame: `along` runs from the first jamb, `across` spans the wall.
      const pt = (along, across) =>
        this.toScreen(
          view,
          geo.x1 + geo.dx * along + geo.nx * across,
          geo.y1 + geo.dy * along + geo.ny * across
        );
      ctx.strokeStyle = selected ? theme.select : theme.ink;
      ctx.lineWidth = selected ? 2 : 1.4;
      drawOpeningSymbol(ctx, opening, geo, pt, theme.surface);
      if (show.openingSizes) {
        // The German annotation, in the order a drawing gives it:
        //
        //   1,50⁵/1,26⁵    the Rohbaumaß — the hole to be left in the wall
        //          90      a window's Brüstung, the height of its sill
        //      (1,38⁵)     the leaf, which is what you order
        //
        // The hole comes first because it is what the wall is built to, and because
        // it is what the dimension chain beside it measures — one figure for one
        // window, or the two disagree on the same sheet. The leaf is in brackets
        // underneath, and only when a lining makes the two differ.
        const size = Math.max(0, Math.min(11, 230 * view.scale));
        if (size >= 6) {
          const stock = stockOf(opening);
          const hole = openingWidth(opening);
          const head = (opening.head ?? 2010) - (opening.sill ?? 0);
          // The mark first, so the figure on the drawing and the row in the schedule
          // are visibly the same thing. The schedule minted these and nothing ever put
          // them on the plan, which left it pointing at rows nobody could find.
          const mark = marks.get(opening.id);
          const lines = [mark ? `${mark}  ${dimLabel(hole)}/${dimLabel(head)}` : `${dimLabel(hole)}/${dimLabel(head)}`];
          if (opening.kind === 'window' && (opening.sill ?? 0) > 0) lines.push(dimLabel(opening.sill));
          if (stock > 0 && opening.kind !== 'opening') lines.push(`(${dimLabel(opening.width)})`);
          const [lx, ly] = pt(hole / 2, -geo.thickness * 1.35);
          ctx.save();
          ctx.translate(lx, ly);
          const turn = ((Math.atan2(geo.dy, geo.dx) * 180) / Math.PI + 360) % 360;
          ctx.rotate(((turn > 90 && turn < 270 ? turn + 180 : turn) * Math.PI) / 180);
          ctx.fillStyle = theme.muted;
          ctx.font = `${size}px ${theme.mono}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          lines.forEach((line, i) => ctx.fillText(line, 0, -(lines.length - 1 - i) * size * 1.05));
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }


  // ---- rulers and guides -----------------------------------------------

  /**
   * Ticks along the top and down the left, in the drawing's own millimetres.
   *
   * The step is chosen so labels never crowd: a whole metre while you are zoomed
   * out, down to 10 mm when you are close in. Both bars share the board's view, so
   * a tick and the thing it measures cannot drift apart.
   */
  drawRulers(view, hCanvas, vCanvas, cursor = null) {
    if (!hCanvas || !vCanvas) return;
    const { theme } = this;
    const dpr = this.dpr;
    const thick = Math.max(8, Math.round(hCanvas.clientHeight || vCanvas.clientWidth || 22));
    for (const [canvas, w, h] of [
      [hCanvas, Math.max(1, Math.round(hCanvas.clientWidth || this.width)), thick],
      [vCanvas, thick, Math.max(1, Math.round(vCanvas.clientHeight || this.height))],
    ]) {
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
      }
    }

    // How far apart the labelled ticks are: the smallest step from the ladder that
    // still leaves room to read the number.
    const ladder = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];
    const step = ladder.find((mm) => mm * view.scale >= 58) ?? ladder[ladder.length - 1];
    const minor = step / (step % 1000 === 0 ? 10 : 5);

    const label = (mm) => {
      if (step >= 1000) return `${Math.round(mm / 1000)}`;
      const m = mm / 1000;
      return m.toFixed(step >= 100 ? 1 : 2).replace('.', ',');
    };

    const bars = [
      { canvas: hCanvas, horizontal: true, extent: hCanvas.width / dpr, from: view.x, thick },
      { canvas: vCanvas, horizontal: false, extent: vCanvas.height / dpr, from: view.y, thick },
    ];
    for (const bar of bars) {
      const ctx = bar.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, bar.horizontal ? bar.extent : bar.thick, bar.horizontal ? bar.thick : bar.extent);
      ctx.font = `9px ${theme.mono}`;
      ctx.textBaseline = 'alphabetic';
      const end = bar.from + bar.extent / view.scale;
      const start = Math.floor(bar.from / minor) * minor;

      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let mm = start; mm <= end; mm += minor) {
        const at = Math.round((mm - bar.from) * view.scale) + 0.5;
        const major = Math.abs(mm % step) < minor / 2 || Math.abs(Math.abs(mm % step) - step) < minor / 2;
        const len = major ? bar.thick * 0.55 : bar.thick * 0.28;
        if (bar.horizontal) {
          ctx.moveTo(at, bar.thick);
          ctx.lineTo(at, bar.thick - len);
        } else {
          ctx.moveTo(bar.thick, at);
          ctx.lineTo(bar.thick - len, at);
        }
      }
      ctx.stroke();

      ctx.fillStyle = theme.muted;
      for (let mm = Math.floor(bar.from / step) * step; mm <= end; mm += step) {
        const at = Math.round((mm - bar.from) * view.scale);
        const text = label(mm);
        if (bar.horizontal) {
          ctx.textAlign = 'left';
          ctx.fillText(text, at + 3, bar.thick - bar.thick * 0.62);
        } else {
          // Down the side, the numbers read bottom-up like a drawing's do.
          ctx.save();
          ctx.translate(bar.thick - bar.thick * 0.62, at - 3);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }

      // Where the cursor is, marked on both bars.
      if (cursor) {
        const world = bar.horizontal ? cursor.x : cursor.y;
        const at = Math.round((world - bar.from) * view.scale) + 0.5;
        ctx.strokeStyle = theme.select;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (bar.horizontal) {
          ctx.moveTo(at, 0);
          ctx.lineTo(at, bar.thick);
        } else {
          ctx.moveTo(0, at);
          ctx.lineTo(bar.thick, at);
        }
        ctx.stroke();
      }

      // The origin, so it is always clear where zero is.
      const zero = Math.round((0 - bar.from) * view.scale) + 0.5;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (bar.horizontal) {
        ctx.moveTo(zero, bar.thick * 0.2);
        ctx.lineTo(zero, bar.thick);
      } else {
        ctx.moveTo(bar.thick * 0.2, zero);
        ctx.lineTo(bar.thick, zero);
      }
      ctx.stroke();
    }
  }




  /**
   * What has to stay clear: a door's swing, and the room a fitting needs.
   *
   * Drawn faintly, and in red where something is standing in it — the drawing says
   * so before the joiner does.
   */
  drawClearances(plan, view, state) {
    const issues = clearanceIssues(plan);
    const { ctx, theme } = this;
    ctx.save();
    const zone = (pts, bad) => {
      if (pts.length < 3) return;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.toScreen(view, p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = bad ? theme.danger : theme.accent;
      ctx.globalAlpha = bad ? 0.16 : 0.07;
      ctx.fill();
      ctx.globalAlpha = bad ? 0.7 : 0.3;
      ctx.strokeStyle = bad ? theme.danger : theme.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash(bad ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };

    // A zone is in trouble when something the check flagged actually overlaps it —
    // testing only the flagged item's centre misses a big piece whose middle is
    // outside the sweep, which is most of them.
    const troubled = (pts) =>
      issues.some(
        (issue) =>
          issue.at &&
          (pointInPolygon(issue.at.x, issue.at.y, pts) ||
            (issue.shape && overlapDepth(pts, issue.shape, 1) > 0))
      );

    for (const opening of plan.openings ?? []) {
      if (!inPhase(plan, opening.wallId)) continue;
      const swing = doorSwingZone(plan, opening);
      if (!swing) continue;
      for (const pts of swing.zones) zone(pts, troubled(pts));
    }
    for (const item of plan.furniture ?? []) {
      const clear = frontClearance({ ...item, kind: item.kind ?? item.id });
      if (clear) zone(clear.zone, troubled(clear.zone));
    }

    // A ring round whatever is in the way.
    for (const issue of issues) {
      if (!issue.at) continue;
      const [x, y] = this.toScreen(view, issue.at.x, issue.at.y);
      const r = issue.level === 'bad' ? 11 : 8;
      ctx.strokeStyle = issue.level === 'bad' ? theme.danger : theme.select;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y - r * 0.45);
      ctx.lineTo(x + r * 0.45, y + r * 0.45);
      ctx.moveTo(x + r * 0.45, y - r * 0.45);
      ctx.lineTo(x - r * 0.45, y + r * 0.45);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Openings in the floor — a stair well, a Deckenaussparung.
   *
   * The slab is cut away here, so the plan shows the hole rather than the floor: a
   * chain-dotted outline, the way anything above or through the cut is drawn, with
   * its size called out.
   */
  drawVoids(plan, view, state) {
    if (!plan.voids?.length) return;
    const { ctx, theme } = this;
    ctx.save();
    for (const item of plan.voids) {
      const selected = state.selection.some((s) => s.kind === 'void' && s.id === item.id);
      const pts = voidCorners(item).map((p) => this.toScreen(view, p.x, p.y));
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      // The hole reads as absent floor: the paper shows through it.
      ctx.fillStyle = theme.paper;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([10, 4, 2, 4]);
      ctx.lineWidth = selected ? 2.2 : 1.4;
      ctx.strokeStyle = selected ? theme.select : theme.muted;
      ctx.stroke();
      ctx.setLineDash([]);

      const size = Math.max(0, Math.min(12, item.h * view.scale * 0.14));
      if (size < 7) continue;
      const [cx, cy] = this.toScreen(view, item.x, item.y);
      ctx.save();
      ctx.translate(cx, cy);
      const turn = ((item.rotation ?? 0) % 360 + 360) % 360;
      ctx.rotate((((turn > 90 && turn < 270 ? turn + 180 : turn) * Math.PI) / 180));
      ctx.font = `${size}px ${theme.mono}`;
      ctx.fillStyle = selected ? theme.select : theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = item.label?.trim() || 'Opening';
      ctx.fillText(label, 0, -size * 0.7);
      ctx.fillText(`${Math.round(item.w)} × ${Math.round(item.h)}`, 0, size * 0.7);
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * The one and two metre lines under a sloping ceiling.
   *
   * German plans mark them because they are where the floor area stops counting in
   * full and stops counting at all. Drawn thin with the height called out, the way a
   * Wohnflächenberechnung is drawn.
   */
  drawHeadroomLines(plan, geometry, view) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([9, 4, 2, 4]);
    for (const room of geometry.rooms) {
      if (room.kept === false) continue;
      for (const height of [WOFLV_FULL, WOFLV_HALF]) {
        for (const line of headroomLines(plan, room, height)) {
          const [x1, y1] = this.toScreen(view, line.x1, line.y1);
          const [x2, y2] = this.toScreen(view, line.x2, line.y2);
          if (Math.hypot(x2 - x1, y2 - y1) < 14) continue;
          ctx.strokeStyle = height === WOFLV_FULL ? theme.accent : theme.select;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          // The height, set along the line and kept upright.
          const size = Math.max(0, Math.min(11, 260 * view.scale));
          if (size < 7) continue;
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.setLineDash([]);
          ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
          let angle = Math.atan2(y2 - y1, x2 - x1);
          if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
          ctx.rotate(angle);
          ctx.font = `${size}px ${theme.mono}`;
          ctx.fillStyle = height === WOFLV_FULL ? theme.accent : theme.select;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${(height / 1000).toFixed(2).replace('.', ',')} m`, 0, -3);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  /** Guides: the lines you pull off a ruler to line things up against. */
  drawGuides(plan, view, state) {
    const guides = plan.guides ?? [];
    if (!guides.length) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 1;
    for (const guide of guides) {
      const selected = state.selection.some((s) => s.kind === 'guide' && s.id === guide.id);
      const hovered = state.hover?.kind === 'guide' && state.hover.id === guide.id;
      ctx.strokeStyle = selected ? theme.select : theme.accent;
      ctx.globalAlpha = selected || hovered ? 0.95 : 0.5;
      ctx.beginPath();
      if (guide.axis === 'x') {
        const [sx] = this.toScreen(view, guide.at, 0);
        ctx.moveTo(Math.round(sx) + 0.5, 0);
        ctx.lineTo(Math.round(sx) + 0.5, this.height);
      } else {
        const [, sy] = this.toScreen(view, 0, guide.at);
        ctx.moveTo(0, Math.round(sy) + 0.5);
        ctx.lineTo(this.width, Math.round(sy) + 0.5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The storey underneath, faint, so a stair or a wall can be lined up with it. */
  /**
   * The storey underneath, as an underlay to draw the one above it against.
   *
   * The whole reason for it is that an upper floor is set out from the one below: a
   * wall wants to land on a wall, a stair has to come up where the stair below comes
   * up. So it has to be the real thing — walls with their thickness, cut by their
   * openings, in the storey's own phase — not a wire diagram of centrelines. Drawn as
   * centrelines it could not answer the one question it was for: is this wall over that
   * one, or 180 mm off it?
   *
   * Faint and behind everything, so it reads as tracing paper under the sheet.
   */
  drawFloorBelow(project, plan, view) {
    // The storey below this one, by level rather than by the order the floors happened
    // to be drawn in — which had it showing the wrong floor, or none.
    const stack = floorsInOrder(project);
    const index = stack.findIndex((p) => p.id === plan.id);
    const below = index > 0 ? stack[index - 1] : null;
    if (!below) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.globalAlpha = 0.3;

    // Its walls, as they are actually built: the mitred shape, in the phase the floor
    // below is being shown in, with the openings taken out of them.
    for (const wall of phaseWalls(below)) {
      const corners = wallCorners(below, wall);
      if (!corners) continue;
      ctx.beginPath();
      corners.forEach((p, i) => {
        const [x, y] = this.toScreen(view, p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // The openings, as gaps: a doorway below is where a doorway above probably goes.
    ctx.globalAlpha = 0.5;
    for (const opening of below.openings ?? []) {
      if (!inPhase(below, opening.wallId)) continue;
      const geo = openingGeometry(below, opening);
      if (!geo) continue;
      const hole = openingWidth(opening);
      const at = (along, across) => [
        geo.x1 + geo.dx * along + geo.nx * across,
        geo.y1 + geo.dy * along + geo.ny * across,
      ];
      const half = geo.thickness / 2;
      ctx.beginPath();
      for (const [i, [along, across]] of [
        [0, -half],
        [hole, -half],
        [hole, half],
        [0, half],
      ].entries()) {
        const [x, y] = this.toScreen(view, ...at(along, across));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // Cleared back to the paper, so the opening reads as a gap in the wall rather
      // than as another line drawn over it.
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }

    // And the stairs, which are the thing an upper floor most has to line up with.
    ctx.globalAlpha = 0.34;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    for (const stair of below.stairs ?? []) {
      const poly = stairWorldFootprint(stair);
      ctx.beginPath();
      poly.forEach((p, i) => {
        const [x, y] = this.toScreen(view, p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawColumns(plan, view, state) {
    const { ctx, theme } = this;
    if (!plan.columns?.length) return;
    ctx.save();
    for (const column of plan.columns) {
      const selected = state.selection.some((s) => s.kind === 'column' && s.id === column.id);
      const [x, y] = this.toScreen(view, column.x, column.y);
      const w = column.w * view.scale;
      const h = column.h * view.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((column.rotation ?? 0) * Math.PI) / 180);
      ctx.fillStyle = theme.ink;
      ctx.beginPath();
      if (column.shape === 'round') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = theme.select;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  drawStairs(plan, view, state) {
    const { ctx, theme } = this;
    if (!plan.stairs?.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const stair of plan.stairs) {
      const selected = state.selection.some((s) => s.kind === 'stair' && s.id === stair.id);
      const geo = stairGeometry(stair, {
        cutAt: plan.cutHeight ?? DEFAULT_CUT_HEIGHT,
        cut: (plan.show?.stairCut ?? true) !== false,
        numbers: plan.show?.stairNumbers === true,
      });
      const pt = (a, c) => {
        const w = stairToWorld(stair, a, c);
        return this.toScreen(view, w.x, w.y);
      };
      const ink = selected ? theme.select : theme.ink;
      for (const item of geo.primitives) {
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = item.style === 'outline' ? (selected ? 2 : 1.5) : 1.1;
        // Beyond the cut plane the flight is drawn thin; the break line is heavy.
        if (item.style === 'above') {
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = theme.muted;
        } else if (item.style === 'cut') {
          ctx.lineWidth = selected ? 2.6 : 2.2;
        }
        if (item.type === 'polygon' || item.type === 'polyline') {
          ctx.beginPath();
          item.pts.forEach((p, i) => {
            const [x, y] = pt(p.a, p.c);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          if (item.type === 'polygon') {
            ctx.closePath();
            ctx.fillStyle = theme.surface;
            ctx.globalAlpha = item.style === 'above' ? 0.35 : 0.75;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = ink;
          }
          ctx.stroke();
        } else if (item.type === 'line') {
          const [x1, y1] = pt(item.a1, item.c1);
          const [x2, y2] = pt(item.a2, item.c2);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (item.type === 'circle') {
          const [x, y] = pt(item.a, item.c);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(2, item.r * view.scale), 0, Math.PI * 2);
          ctx.stroke();
        } else if (item.type === 'number') {
          const size = Math.max(0, Math.min(12, item.size * view.scale));
          if (size >= 6) {
            const [x, y] = pt(item.a, item.c);
            ctx.fillStyle = theme.muted;
            ctx.font = `${size}px ${theme.mono}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.text, x, y);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
          }
        } else if (item.type === 'arrow') {
          const pts = item.pts.map((p) => pt(p.a, p.c));
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
          ctx.stroke();
          // arrowhead on the last leg
          const [hx, hy] = pts[pts.length - 1];
          const [px, py] = pts[pts.length - 2] ?? pts[0];
          const angle = Math.atan2(hy - py, hx - px);
          const size = 8;
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.lineTo(hx - size * Math.cos(angle - 0.4), hy - size * Math.sin(angle - 0.4));
          ctx.lineTo(hx - size * Math.cos(angle + 0.4), hy - size * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fill();
        }
      }
      // The flight's number, the way a Bauzeichnung writes it: "16 Stg 18,3/26,0".
      const label = `${geo.label}${stair.direction === 'down' ? ' ab' : ''}`;
      const [lx, ly] = pt(geo.tread * 0.6, -geo.width / 2 - 140);
      const size = Math.max(8, Math.min(13, geo.width * view.scale * 0.13));
      if (size >= 8) {
        ctx.fillStyle = theme.muted;
        ctx.font = `${size}px ${theme.mono}`;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      }
    }
    ctx.restore();
  }

  /** Sockets, switches, lights and the rest, from their shared primitives. */
  drawFixtures(plan, view, state) {
    if (!plan.fixtures?.length) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const fixture of plan.fixtures) {
      if (!inPhase(plan, fixture.wallId)) continue;
      const placement = fixturePlacement(plan, fixture);
      const selected = state.selection.some((s) => s.kind === 'fixture' && s.id === fixture.id);
      const ink = selected ? theme.select : theme.ink;
      const pt = (a, c) => {
        const w = fixtureToWorld(placement, a, c);
        return this.toScreen(view, w.x, w.y);
      };
      const scale = view.scale;
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      const base = selected ? 1.9 : 1.3;
      // Wall poché is solid, so a filled symbol sitting on it needs a thin gap
      // around it or the two merge into one blob.
      const halo = () => {
        ctx.save();
        ctx.strokeStyle = theme.surface;
        ctx.lineWidth = base * 2.4;
        ctx.lineJoin = 'round';
        return () => ctx.restore();
      };
      for (const item of fixtureSymbol(fixture)) {
        ctx.lineWidth = item.heavy ? base * 1.8 : base;
        if (item.type === 'line') {
          const [x1, y1] = pt(item.a1, item.c1);
          const [x2, y2] = pt(item.a2, item.c2);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        } else if (item.type === 'circle') {
          const [x, y] = pt(item.a, item.c);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.5, item.r * scale), 0, Math.PI * 2);
          if (item.fill) {
            const done = halo();
            ctx.stroke();
            done();
            ctx.fill();
          } else {
            ctx.stroke();
          }
        } else if (item.type === 'arc') {
          const [x, y] = pt(item.a, item.c);
          // The symbol's frame is rotated, so the sweep turns with it.
          const turn = (placement.angle * Math.PI) / 180;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.5, item.r * scale), item.from + turn, item.to + turn);
          if (item.fill) {
            ctx.closePath();
            const done = halo();
            ctx.stroke();
            done();
            ctx.fill();
          } else {
            ctx.stroke();
          }
        } else if (item.type === 'polygon') {
          ctx.beginPath();
          item.pts.forEach((p, i) => {
            const [x, y] = pt(p.a, p.c);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
          if (item.fill) {
            const done = halo();
            ctx.stroke();
            done();
            ctx.fill();
          } else {
            ctx.stroke();
          }
        } else if (item.type === 'text') {
          const size = item.size * scale;
          if (size < 5) continue;
          const [x, y] = pt(item.a, item.c);
          ctx.save();
          ctx.translate(x, y);
          // Keep lettering upright whichever way the wall faces.
          const turn = ((placement.angle % 360) + 360) % 360;
          ctx.rotate(turn > 90 && turn < 270 ? ((placement.angle + 180) * Math.PI) / 180 : (placement.angle * Math.PI) / 180);
          ctx.font = `${size}px ${theme.mono}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.text, 0, 0);
          ctx.restore();
        }
      }
      if (selected) {
        const [x, y] = pt(0, 0);
        ctx.strokeStyle = theme.select;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(10, (fixture.size ?? 260) * scale * 0.95), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Calls out the height of anything that does not reach the ceiling. */
  /**
   * The angle at every corner that is not a right angle.
   *
   * A right angle is what a plan assumes, so it is the others that have to be written
   * down — and without them there is nothing on the drawing to tell 87° from 93°.
   * Drawn small and inside the corner, which is where a Winkelmaß goes: it belongs to
   * the corner rather than to an elevation, so it cannot be stacked outside with the
   * chains.
   */
  drawCornerAngles(plan, geometry, view) {
    const marks = cornerAngles(plan, geometry.rooms);
    if (!marks.length) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const mark of marks) {
      const [x, y] = this.toScreen(view, mark.x, mark.y);
      // Sized in millimetres so it sits in the corner, but held to a readable band on
      // screen so it is neither a dot when zoomed out nor a hoop when zoomed in.
      const radius = Math.min(46, Math.max(15, mark.radius * view.scale));
      if (radius < 15) continue;
      const sweep = mark.to - mark.from;
      // Screen y runs down, so an angle measured anticlockwise in the drawing is drawn
      // clockwise here — which is what canvas does by default.
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, y, radius, mark.from, mark.from + sweep);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const text = angleLabel(mark.degrees);
      ctx.font = `600 10px ${theme.mono}`;
      const width = ctx.measureText(text).width;
      // Just beyond the arc, on the bisector, so it never sits on either wall.
      const out = radius + 9 + width / 2;
      const lx = x + Math.cos(mark.bisector) * out;
      const ly = y + Math.sin(mark.bisector) * out;
      ctx.fillStyle = theme.surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - width / 2 - 2, ly - 6, width + 4, 12);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.muted;
      ctx.fillText(text, lx, ly + 0.5);
    }
    ctx.restore();
  }

  /**
   * Höhenkoten: the finished floor level of each room, as a plan writes it.
   *
   * A drawing has to say how high its floor is, or nothing on it can be built to.
   * The level is the storey's own — the sum of the floors below it — written the German
   * way, with the ground floor as the datum: ±0,00 there and +2,75 above it. Drawn as
   * the conventional half-filled triangle sitting on the level it marks.
   *
   * One per room, under the room's own text, and only where there is room on screen for
   * it: three lines in a cupboard is not a drawing, it is a list.
   */
  drawLevels(project, plan, geometry, view) {
    const { ctx, theme } = this;
    // One mark, not one per room. Every room on a storey is at the same level, so a
    // Höhenkote in each of them repeats the same figure as many times as there are rooms
    // and says nothing more than the first one did. It goes in the largest room, which is
    // where there is space for it and where the eye goes first.
    const rooms = geometry.rooms.filter((room) => room.kept !== false);
    if (!rooms.length) return;
    const room = [...rooms].sort((a, b) => b.areaMm2 - a.areaMm2)[0];

    const size = Math.max(9, Math.min(20, TEXT_MM * (plan.scaleDenominator ?? 100) * view.scale));
    // Only where the room can carry it, judged on its narrowest span so a big room with
    // a narrow neck does not get one crammed into the neck.
    const xs = room.inner.map((p) => p.x);
    const ys = room.inner.map((p) => p.y);
    const across = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * view.scale;
    if (across < size * 9) return;

    const text = levelLabel(planElevation(project, plan));
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `${size * 0.82}px ${theme.mono}`;
    const [cx, cy] = this.toScreen(view, room.centroid.x, room.centroid.y);
    const h = size * 0.62;
    const width = ctx.measureText(text).width;
    // The triangle and the figure are one thing, centred as one and set well clear of
    // the room's own text — stacked tight under it the two read as a single muddle.
    const left = cx - (width + h * 2 + size * 0.4) / 2;
    const base = cy + size * 2.6;

    // Half filled and sitting on the level it marks, the way one is drawn by hand.
    ctx.beginPath();
    ctx.moveTo(left, base - h);
    ctx.lineTo(left + h * 2, base - h);
    ctx.lineTo(left + h, base);
    ctx.closePath();
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left + h, base);
    ctx.lineTo(left + h * 2, base - h);
    ctx.lineTo(left + h, base - h);
    ctx.closePath();
    ctx.fillStyle = theme.muted;
    ctx.fill();
    ctx.fillText(text, left + h * 2 + size * 0.4, base - h * 0.55);
    ctx.restore();
  }

  drawWallHeights(plan, view) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const wall of plan.walls) {
      const ends = wallEnds(plan, wall);
      if (!ends) continue;
      const knee = isKneeWall(plan, wall);
      if (!knee && !plan.show.allWallHeights) continue;
      const [x, y] = this.toScreen(view, (ends.a.x + ends.b.x) / 2, (ends.a.y + ends.b.y) / 2);
      const angle = Math.atan2(ends.b.y - ends.a.y, ends.b.x - ends.a.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle);
      const label = `${Math.round(wallHeight(plan, wall))}`;
      ctx.font = `10px ${theme.mono}`;
      const pad = 3;
      const w = ctx.measureText(label).width + pad * 2;
      ctx.fillStyle = theme.surface;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-w / 2, -7, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = knee ? theme.select : theme.muted;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  drawRooms(plan, geometry, view, state) {
    const { ctx, theme } = this;
    ctx.save();
    for (const room of geometry.rooms) {
      const dropped = room.kept === false;
      const selected = state.selection.some((s) => s.kind === 'room' && s.id === room.metaId);
      ctx.beginPath();
      room.inner.forEach((p, i) => {
        const [x, y] = this.toScreen(view, p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = dropped ? theme.roomDrop : selected ? theme.accentSoft : theme.roomFill;
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawRoomText(plan, geometry, view) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of geometry.rooms) {
      const [x, y] = this.toScreen(view, room.centroid.x, room.centroid.y);
      // The same hand for every room. Sized from the drawing's own scale — 2,5 mm on
      // the sheet, which is what a plan is lettered at — rather than from how big the
      // room happens to be, which had a cupboard and a hall labelled differently and
      // made the drawing read as a chart. Held to a legible band on screen, since the
      // screen is not the sheet and a plan zoomed right out would be unreadable.
      const size = Math.max(9, Math.min(22, TEXT_MM * (plan.scaleDenominator ?? 100) * view.scale));
      if (size < 9) continue;
      const dropped = room.kept === false;
      ctx.globalAlpha = dropped ? 0.45 : 1;
      // An unnamed room shows its area alone rather than the word "Room".
      if (room.name) {
        ctx.fillStyle = dropped ? theme.muted : theme.ink;
        ctx.font = `500 ${size}px ${theme.sans}`;
        ctx.fillText(room.name, x, y - size * 0.55);
        ctx.fillStyle = theme.muted;
        ctx.font = `${size * 0.82}px ${theme.mono}`;
        ctx.fillText(formatArea(roomFloorArea(plan, room)), x, y + size * 0.72);
      } else {
        ctx.fillStyle = theme.muted;
        ctx.font = `${size * 0.9}px ${theme.mono}`;
        ctx.fillText(formatArea(roomFloorArea(plan, room)), x, y);
      }
    }
    ctx.restore();
  }

  drawFurniture(plan, view, state) {
    const { ctx, theme } = this;
    ctx.save();
    for (const item of plan.furniture) {
      const selected = state.selection.some((s) => s.kind === 'furniture' && s.id === item.id);
      const [x, y] = this.toScreen(view, item.x, item.y);
      const w = item.w * view.scale;
      const h = item.h * view.scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((item.rotation ?? 0) * (Math.PI / 180));
      ctx.lineWidth = selected ? 2 : 1.2;
      ctx.strokeStyle = selected ? theme.select : theme.ink;
      ctx.fillStyle = theme.surface;
      ctx.globalAlpha = 0.92;
      drawSymbol(ctx, item.symbol ?? 'rect', -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
  }


  /**
   * The dimension chains, drawn the way a Bauzeichnung draws them: a continuous
   * line, a stroke at 45° at every division, and the figure sitting on the line
   * with its millimetre raised.
   */
  drawChains(plan, view, state) {
    const chains = allChains(plan, plan.autoDims ?? {});
    if (!chains.length) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.lineCap = 'butt';
    const size = Math.max(0, Math.min(12, 240 * view.scale));

    // Whatever the cursor is over, the figures that measure it light up. A chain is a
    // wall of numbers otherwise, and the one you want is the hard part.
    //
    // None of it is drawn here. The chains overlap each other, and the room names and
    // labels come after them, so a witness line drawn in place would end up under the
    // next chain and under whatever text crossed it — which is precisely the line the
    // cursor is asking to follow. It is collected in screen coordinates instead and
    // replayed once everything else is down.
    const focus = DIMENSIONABLE.has(state?.hover?.kind) ? state.hover.id : null;
    // Reading a figure and finding out what a thing measures are the same question
    // asked from the two ends, so the cursor answers both: over a wall it lights the
    // figures, over a figure it lights the witness lines that fix it.
    const onFigure = state?.hover?.kind === 'chain' ? state.hover.id : null;
    const lit = [];
    this.chainFocus = lit;

    for (const chain of chains) {
      const geo = chainGeometry(chain);
      const mention = focus ? chainMentions(chain, focus) : null;
      const here = onFigure?.startsWith(`${chainKey(chain)}#`)
        ? Number(onFigure.slice(onFigure.lastIndexOf('#') + 1))
        : -1;
      // 2 measures the thing itself, 1 is set out from it, 0 is everything else.
      const rank = (owners, division) => {
        if (here >= 0) return division === here || division === here + 1 ? 2 : 0;
        if (!mention) return 0;
        if (owners?.includes(focus)) return 2;
        return mention === 'elevation' ? 1 : 0;
      };
      const segRank = (label) => {
        if (here >= 0) return label.index === here ? 2 : 0;
        if (!mention) return 0;
        if (label.owns.includes(focus)) return 2;
        if (label.touches.includes(focus)) return 1;
        return mention === 'elevation' ? 1 : 0;
      };
      const [x1, y1] = this.toScreen(view, geo.line.a.x, geo.line.a.y);
      const [x2, y2] = this.toScreen(view, geo.line.b.x, geo.line.b.y);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 30) continue;
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      const nx = -uy;
      const ny = ux;

      // Witness lines back to the building, thin and stopping just past the chain.
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 0.6;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (const [index, ext] of geo.extensions.entries()) {
        const [ax, ay] = this.toScreen(view, ext.a.x, ext.a.y);
        const [bx, by] = this.toScreen(view, ext.b.x, ext.b.y);
        const weight = rank(ext.owners, index);
        if (weight) lit.push({ kind: 'ext', weight, a: [ax, ay], b: [bx + nx * 4, by + ny * 4] });
        else {
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx + nx * 4, by + ny * 4);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = theme.ink;
      ctx.globalAlpha = 1;
      ctx.lineWidth = chain.kind === 'overall' ? 1.1 : 0.9;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // The band under a lit figure, and the run of the chain again over it.
      for (const label of geo.labels) {
        const weight = segRank(label);
        if (!weight) continue;
        const [ax, ay] = this.toScreen(view, label.a.x, label.a.y);
        const [bx, by] = this.toScreen(view, label.b.x, label.b.y);
        lit.push({ kind: 'band', weight, a: [ax, ay], b: [bx, by] });
      }

      // The 45° strokes that mark each division.
      const tick = 5;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [index, point] of geo.ticks.entries()) {
        const [tx, ty] = this.toScreen(view, point.x, point.y);
        const weight = rank(point.owners, index);
        if (weight === 2) lit.push({ kind: 'tick', weight, at: [tx, ty], u: [ux, uy], n: [nx, ny], tick });
        else {
          ctx.moveTo(tx - (ux + nx) * tick, ty - (uy + ny) * tick);
          ctx.lineTo(tx + (ux + nx) * tick, ty + (uy + ny) * tick);
        }
      }
      ctx.stroke();

      if (size < 6) continue;
      ctx.fillStyle = theme.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      let angle = Math.atan2(uy, ux);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      for (const label of geo.labels) {
        const weight = segRank(label);
        const room = label.length * view.scale;
        const { main, sup } = dimText(label.length);
        const text = main + sup;
        // A figure too tight to fit is normally left off. Not when it is the one being
        // asked for — that is the whole reason the cursor is there.
        if (weight !== 2 && room < text.length * size * 0.52) continue;
        const [lx, ly] = this.toScreen(view, label.at.x, label.at.y);
        if (weight) {
          lit.push({ kind: 'label', weight, at: [lx, ly], angle, main, sup, size });
          continue;
        }
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(angle);
        ctx.fillStyle = theme.ink;
        ctx.font = `${size}px ${theme.mono}`;
        const mainWidth = ctx.measureText(main).width;
        const supWidth = sup ? ctx.measureText(sup).width * 0.72 : 0;
        const left = -(mainWidth + supWidth) / 2;
        ctx.textAlign = 'left';
        ctx.fillText(main, left, -3);
        if (sup) {
          ctx.font = `${size * 0.72}px ${theme.mono}`;
          ctx.fillText(sup, left + mainWidth, -3 - size * 0.34);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /**
   * The lit dimensions again, over the top of the finished drawing.
   *
   * Collected while the chains were drawn and replayed here, so a witness line runs
   * unbroken from the wall face it starts at all the way out to its figure — over the
   * other chains, over the room names, over anything else in the way.
   */
  drawChainFocus() {
    const lit = this.chainFocus;
    if (!lit?.length) return;
    const { ctx, theme } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const item of lit.filter((i) => i.kind === 'band')) {
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = item.weight === 2 ? 0.22 : 0.1;
      ctx.lineWidth = 13;
      ctx.beginPath();
      ctx.moveTo(item.a[0], item.a[1]);
      ctx.lineTo(item.b[0], item.b[1]);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    for (const item of lit) {
      if (item.kind === 'ext') {
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = item.weight === 2 ? 1 : 0.9;
        ctx.lineWidth = item.weight === 2 ? 1.2 : 0.7;
        ctx.beginPath();
        ctx.moveTo(item.a[0], item.a[1]);
        ctx.lineTo(item.b[0], item.b[1]);
        ctx.stroke();
      } else if (item.kind === 'band' && item.weight === 2) {
        // The run of the chain itself, over its band.
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(item.a[0], item.a[1]);
        ctx.lineTo(item.b[0], item.b[1]);
        ctx.stroke();
      } else if (item.kind === 'tick') {
        const [ux, uy] = item.u;
        const [nx, ny] = item.n;
        ctx.strokeStyle = theme.accent;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(item.at[0] - (ux + nx) * item.tick, item.at[1] - (uy + ny) * item.tick);
        ctx.lineTo(item.at[0] + (ux + nx) * item.tick, item.at[1] + (uy + ny) * item.tick);
        ctx.stroke();
      }
    }

    ctx.textBaseline = 'alphabetic';
    for (const item of lit.filter((i) => i.kind === 'label')) {
      const { main, sup, size, weight } = item;
      ctx.save();
      ctx.translate(item.at[0], item.at[1]);
      ctx.rotate(item.angle);
      const scale = weight === 2 ? 1.15 : 1;
      ctx.font = `${weight === 2 ? '600 ' : ''}${size * scale}px ${theme.mono}`;
      const mainWidth = ctx.measureText(main).width;
      const supWidth = sup ? ctx.measureText(sup).width * 0.72 : 0;
      const left = -(mainWidth + supWidth) / 2;
      ctx.textAlign = 'left';
      // Sat on the paper, so a figure that had no room is still readable over the
      // chain it had to be squeezed into.
      if (weight === 2) {
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = theme.surface;
        ctx.fillRect(left - 3, -3 - size * scale, mainWidth + supWidth + 6, size * scale + 4);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.accent;
      ctx.fillText(main, left, -3);
      if (sup) {
        ctx.font = `${weight === 2 ? '600 ' : ''}${size * scale * 0.72}px ${theme.mono}`;
        ctx.fillText(sup, left + mainWidth, -3 - size * scale * 0.34);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  drawDimensions(plan, view, state) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.textAlign = 'center';
    for (const dim of plan.dimensions) {
      const line = dimensionLine(plan, dim);
      if (!line) continue;
      const selected = state.selection.some((s) => s.kind === 'dimension' && s.id === dim.id);
      ctx.strokeStyle = selected ? theme.select : theme.muted;
      ctx.fillStyle = selected ? theme.select : theme.muted;
      ctx.lineWidth = 1;
      const [sx1, sy1] = this.toScreen(view, line.x1, line.y1);
      const [sx2, sy2] = this.toScreen(view, line.x2, line.y2);
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      for (const [px, py, qx, qy] of [
        [line.ax, line.ay, line.x1, line.y1],
        [line.bx, line.by, line.x2, line.y2],
      ]) {
        const [ax, ay] = this.toScreen(view, px, py);
        const [bx, by] = this.toScreen(view, qx, qy);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const [tx, ty] of [
        [sx1, sy1],
        [sx2, sy2],
      ]) {
        ctx.beginPath();
        ctx.moveTo(tx - 4, ty + 4);
        ctx.lineTo(tx + 4, ty - 4);
        ctx.stroke();
      }
      const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
      ctx.save();
      ctx.translate((sx1 + sx2) / 2, (sy1 + sy2) / 2);
      ctx.rotate(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle);
      ctx.font = `11px ${theme.mono}`;
      ctx.fillText(formatLength(line.length), 0, -5);
      ctx.restore();
    }
    ctx.restore();
  }

  drawLabels(plan, view, state) {
    const { ctx, theme } = this;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const label of plan.labels) {
      const selected = state.selection.some((s) => s.kind === 'label' && s.id === label.id);
      const [x, y] = this.toScreen(view, label.x, label.y);
      const size = Math.max(9, (label.size ?? 260) * view.scale);
      ctx.font = `${size}px ${theme.sans}`;
      ctx.fillStyle = selected ? theme.select : theme.ink;
      ctx.fillText(label.text, x, y);
    }
    ctx.restore();
  }

  drawSelection(plan, view, state, extras) {
    const { ctx, theme } = this;
    ctx.save();
    for (const item of state.selection) {
      if (item.kind === 'wall') {
        const wall = findWall(plan, item.id);
        const poly = wall ? this.wallPolygon(plan, wall, view) : null;
        if (!poly) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
        ctx.strokeStyle = theme.select;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // The wall picked for trimming, and which end will move.
    if (extras.trimPick) {
      const wall = findWall(plan, extras.trimPick.wallId);
      const ends = wall ? wallEnds(plan, wall) : null;
      if (ends) {
        const node = extras.trimPick.end === 'a' ? ends.a : ends.b;
        const [x, y] = this.toScreen(view, node.x, node.y);
        ctx.strokeStyle = theme.select;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (state.tool === 'select' || state.tool === 'wall' || state.tool === 'rect') {
      for (const node of plan.nodes) {
        const [x, y] = this.toScreen(view, node.x, node.y);
        if (x < -20 || y < -20 || x > this.width + 20 || y > this.height + 20) continue;
        const selected = state.selection.some((s) => s.kind === 'node' && s.id === node.id);
        const hovered = state.hover?.kind === 'node' && state.hover.id === node.id;
        const r = selected || hovered ? 5.5 : 3.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = selected ? theme.select : theme.surface;
        ctx.fill();
        ctx.strokeStyle = selected ? theme.select : theme.accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawRubber(view, rubber) {
    const { ctx, theme } = this;
    const [x1, y1] = this.toScreen(view, rubber.x1, rubber.y1);
    const [x2, y2] = this.toScreen(view, rubber.x2, rubber.y2);
    ctx.save();
    ctx.fillStyle = theme.accentSoft;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }

  drawDraft(view, draft) {
    const { ctx, theme } = this;
    ctx.save();
    if (draft.kind === 'rect') {
      const [x1, y1] = this.toScreen(view, draft.anchor.x, draft.anchor.y);
      const [x2, y2] = this.toScreen(view, draft.x2, draft.y2);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = Math.max(2, draft.thickness * view.scale);
      ctx.globalAlpha = 0.4;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.ink;
      ctx.font = `600 12px ${theme.mono}`;
      ctx.textAlign = 'center';
      // Shown on the basis sizes are quoted on, matching the typed fields.
      const shift = draft.shift ?? 0;
      ctx.fillText(
        `${Math.round(draft.width + shift)} × ${Math.round(draft.depth + shift)}`,
        (x1 + x2) / 2,
        Math.min(y1, y2) - 8
      );
    } else {
      const [x1, y1] = this.toScreen(view, draft.anchor.x, draft.anchor.y);
      const [x2, y2] = this.toScreen(view, draft.x2, draft.y2);
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = draft.kind === 'wall' ? 0.45 : 0.85;
      ctx.lineWidth = draft.kind === 'wall' ? Math.max(2, draft.thickness * view.scale) : 1.5;
      if (draft.kind !== 'wall') ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (draft.length > 1) {
        ctx.fillStyle = theme.ink;
        ctx.font = `600 12px ${theme.mono}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          `${formatLength(draft.length)}  ${Math.round(draft.angle)}°`,
          (x1 + x2) / 2,
          (y1 + y2) / 2 - 12
        );
      }
    }
    ctx.restore();
  }

  drawMeasurement(view, measurement) {
    const { ctx, theme } = this;
    const [x1, y1] = this.toScreen(view, measurement.from.x, measurement.from.y);
    const [x2, y2] = this.toScreen(view, measurement.to.x, measurement.to.y);
    ctx.save();
    ctx.strokeStyle = theme.select;
    ctx.fillStyle = theme.select;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [px, py] of [
      [x1, y1],
      [x2, y2],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `600 12px ${theme.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(
      `${formatLength(measurement.length)}  ${Math.round(measurement.angle)}°`,
      (x1 + x2) / 2,
      (y1 + y2) / 2 - 10
    );
    ctx.restore();
  }

  drawSnap(view, snap) {
    const { ctx, theme } = this;
    ctx.save();
    // Guides first, so the marker sits on top.
    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = 0.7;
    for (const guide of snap.guides ?? []) {
      const [gx1, gy1] = this.toScreen(view, guide.x1, guide.y1);
      const [gx2, gy2] = this.toScreen(view, guide.x2, guide.y2);
      ctx.beginPath();
      ctx.moveTo(gx1, gy1);
      ctx.lineTo(gx2, gy2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const [x, y] = this.toScreen(view, snap.x, snap.y);
    ctx.lineWidth = 1.5;
    drawSnapMarker(ctx, snap.kind, x, y);
    if (snap.label) {
      ctx.fillStyle = theme.select;
      ctx.font = `10px ${theme.mono}`;
      ctx.textAlign = 'left';
      ctx.fillText(snap.label, x + 11, y - 9);
    }
    ctx.restore();
  }
}

// Each snap type gets its own marker, the way CAD marks them.
function drawSnapMarker(ctx, kind, x, y) {
  ctx.beginPath();
  switch (kind) {
    case 'node':
      ctx.rect(x - 5, y - 5, 10, 10);
      break;
    case 'midpoint':
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y + 5);
      ctx.lineTo(x - 6, y + 5);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      break;
    case 'perpendicular':
      ctx.moveTo(x - 6, y + 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x, y + 6);
      ctx.lineTo(x, y - 6);
      break;
    default:
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
  }
  ctx.stroke();
}

// Renders the shared symbol primitives onto the canvas. `pt(along, across)` maps
// the opening's own frame to screen coordinates.
export function drawOpeningSymbol(ctx, opening, geo, pt, fill = '#ffffff') {
  const baseWidth = ctx.lineWidth;
  for (const item of openingSymbol(opening, geo.thickness)) {
    if (item.type === 'line') {
      const [x1, y1] = pt(item.a1, item.c1);
      const [x2, y2] = pt(item.a2, item.c2);
      ctx.lineWidth = item.heavy ? Math.max(baseWidth, 2.4) : baseWidth;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      continue;
    }
    if (item.type === 'rect') {
      const corners = [
        pt(item.a0, item.c0),
        pt(item.a1, item.c0),
        pt(item.a1, item.c1),
        pt(item.a0, item.c1),
      ];
      ctx.save();
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = baseWidth;
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const [hx, hy] = pt(item.hinge, item.hingeC ?? 0);
    const [ax, ay] = pt(item.fromA, item.fromC);
    const [bx, by] = pt(item.toA, item.toC);
    const radius = Math.hypot(ax - hx, ay - hy);
    const start = Math.atan2(ay - hy, ax - hx);
    const end = Math.atan2(by - hy, bx - hx);
    // The symbol says how far the leaf swings, because a door open past a right
    // angle is a long way round and guessing the short way folds it back on itself.
    let delta = item.sweep;
    if (!Number.isFinite(delta)) {
      delta = end - start;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
    }
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = baseWidth;
    ctx.beginPath();
    ctx.arc(hx, hy, radius, start, start + delta, delta < 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = baseWidth;
}

export function formatArea(mm2) {
  const m2 = mm2 / 1e6;
  return `${m2.toFixed(m2 < 10 ? 2 : 1).replace('.', ',')} m²`;
}

export function formatLength(mm) {
  if (Math.abs(mm) >= 1000) return `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
  return `${Math.round(mm)} mm`;
}

/**
 * A furniture symbol, drawn from its shapes.
 *
 * The shapes are fractions of the symbol's box, with 0 at the back of the piece and 1
 * at the front, so the drawing and the 3D model cannot disagree about which way round
 * a thing goes without a test noticing.
 */
function drawSymbol(ctx, symbol, x, y, w, h) {
  const at = (fx, fy) => [x + fx * w, y + fy * h];
  for (const shape of furnitureSymbol(symbol)) {
    if (shape.kind === 'rect') {
      const [sx, sy] = at(shape.x, shape.y);
      ctx.beginPath();
      ctx.rect(sx, sy, shape.w * w, shape.h * h);
      if (shape.fill || shape.role === 'outline') ctx.fill();
      ctx.stroke();
    } else if (shape.kind === 'line') {
      const [x1, y1] = at(shape.x1, shape.y1);
      const [x2, y2] = at(shape.x2, shape.y2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    } else if (shape.kind === 'ellipse') {
      const [cx, cy] = at(shape.x, shape.y);
      ctx.beginPath();
      ctx.ellipse(cx, cy, shape.rx * w, shape.ry * h, 0, 0, Math.PI * 2);
      if (shape.fill) ctx.fill();
      ctx.stroke();
    } else if (shape.kind === 'treads') {
      const steps = Math.max(3, Math.round(h / 260));
      for (let i = 1; i < steps; i++) {
        const yy = y + (h / steps) * i;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy);
        ctx.stroke();
      }
    }
  }
}
