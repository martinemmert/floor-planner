// Pointer handling, hit testing and the tool state machine.
//
// Every drawing tool keeps a `draft` describing what is being placed. The draft
// carries a live length and angle, which the numeric entry panel both displays
// and writes back to, so the keyboard and the mouse drive the same state.

import {
  activePlan,
  addColumn,
  addOpening,
  addRoomRect,
  addStair,
  addWall,
  canJoinWalls,
  copyWalls,
  derived,
  addFixture,
  findColumn,
  findFixture,
  findNode,
  fixturePlacement,
  findStair,
  findWall,
  floorToFloor,
  joinWalls,
  nearestWallEnd,
  nextId,
  nodeDegree,
  openingGeometry,
  pruneNodes,
  removeWall,
  splitWallAt,
  touch,
  moveRoom,
  rectBasisShift,
  roomBoundaryNodeIds,
  translateNodes,
  trimWallTo,
  wallCutAt,
  wallEnds,
  wallLength,
  wallSegment,
  wallTypeFor,
  addVoid,
  guideAt,
  findGuide,
  findVoid,
  pointInVoid,
  removeGuide,
} from './model.js';
import { allChains, chainGeometry, chainKey } from './dimensions.js';
import { openingWidth } from './openings.js';
import { FURNITURE, furnitureById } from './furniture.js';
import { defaultStair, stairWorldFootprint } from './stairs.js';
import { defaultFixture, isWallMounted } from './fixtures.js';
import { WALL_TOOLS } from './cursor.js';
import { computeSnap, angleBetween, pointAtAngle } from '../geom/snap.js';
import { pointInPolygon, pointSegDistance } from '../geom/vec.js';

const PICK_PX = 9;
const SNAP_PX = 12;

/** A length the way the drawing writes it, for the messages the tools print. */
function metres(mm) {
  return `${(mm / 1000).toFixed(2).replace('.', ',')} m`;
}

export class Interaction {
  constructor({ store, renderer, canvas, ui }) {
    this.store = store;
    this.renderer = renderer;
    this.canvas = canvas;
    this.ui = ui;
    this.drag = null;
    this.draft = null;
    this.rubber = null;
    this.snap = null;
    this.trimPick = null;
    this.measurement = null;
    this.spaceHeld = false;
    this.splitPreview = null; // where the split tool would cut, for the drawing to show
    this.attach();
  }

  get state() {
    return this.store.state;
  }

  get plan() {
    return activePlan(this.store.project);
  }

  attach() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', () => this.cancel());
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const [x, y] = this.renderer.toWorld(this.state.view, sx, sy);
    return { sx, sy, x, y };
  }

  worldPerPx() {
    return 1 / this.state.view.scale;
  }

  // ---- snapping -------------------------------------------------------

  snapAt(point, anchor = null, extra = {}) {
    return computeSnap({
      point,
      anchor,
      plan: this.plan,
      tolerance: SNAP_PX * this.worldPerPx(),
      orthoLock: this.state.orthoLock === true,
      enabled: this.state.snapEnabled !== false,
      gridMm: this.state.gridMm,
      backdrop: this.plan.backdrop?.kind ? this.plan.backdrop.segments : null,
      ...extra,
    });
  }

  // ---- hit testing ----------------------------------------------------

  hitTest(point, options = {}) {
    const plan = this.plan;
    const tol = PICK_PX * this.worldPerPx();
    const guideFallback = options.guides === false ? null : guideAt(plan, point, tol * 0.8);
    if (options.nodes !== false) {
      let best = null;
      for (const node of plan.nodes) {
        const d = Math.hypot(node.x - point.x, node.y - point.y);
        if (d <= tol && (!best || d < best.d)) best = { kind: 'node', id: node.id, d };
      }
      if (best) return best;
    }
    for (const fixture of plan.fixtures ?? []) {
      const placement = fixturePlacement(plan, fixture);
      const reach = Math.max(tol, (fixture.size ?? 260) * 0.75);
      if (Math.hypot(placement.x - point.x, placement.y - point.y) <= reach) {
        return { kind: 'fixture', id: fixture.id };
      }
    }
    for (const column of plan.columns ?? []) {
      if (pointInRotatedRect(point, column)) return { kind: 'column', id: column.id };
    }
    for (const item of plan.voids ?? []) {
      if (pointInVoid(item, point.x, point.y)) return { kind: 'void', id: item.id };
    }
    for (const item of plan.furniture) {
      if (pointInRotatedRect(point, item)) return { kind: 'furniture', id: item.id };
    }
    for (const stair of plan.stairs ?? []) {
      if (pointInPolygon(point.x, point.y, stairWorldFootprint(stair))) {
        return { kind: 'stair', id: stair.id };
      }
    }
    for (const opening of plan.openings) {
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      if (Math.hypot(geo.centre.x - point.x, geo.centre.y - point.y) <= Math.max(tol * 1.3, openingWidth(opening) / 2)) {
        return { kind: 'opening', id: opening.id };
      }
    }
    for (const label of plan.labels) {
      const size = label.size ?? 260;
      const width = size * 0.6 * Math.max(1, label.text?.length ?? 1);
      if (
        point.x >= label.x - size * 0.3 &&
        point.x <= label.x + width &&
        point.y >= label.y - size * 0.8 &&
        point.y <= label.y + size * 0.8
      ) {
        return { kind: 'label', id: label.id };
      }
    }
    for (const dim of plan.dimensions) {
      const line = dimensionLine(plan, dim);
      if (line && pointSegDistance(point.x, point.y, line) <= tol * 1.5) {
        return { kind: 'dimension', id: dim.id };
      }
    }
    for (const wall of plan.walls) {
      const seg = wallSegment(plan, wall);
      if (!seg) continue;
      if (pointSegDistance(point.x, point.y, seg) <= wall.thickness / 2 + 2 * this.worldPerPx()) {
        return { kind: 'wall', id: wall.id };
      }
    }
    if (guideFallback) return { kind: 'guide', id: guideFallback.id };
    if (options.rooms !== false) {
      for (const room of derived(plan).rooms) {
        if (pointInPolygon(point.x, point.y, room.inner)) return { kind: 'room', id: room.metaId };
      }
    }
    return null;
  }

  wallAt(point) {
    const plan = this.plan;
    let best = null;
    for (const wall of plan.walls) {
      const seg = wallSegment(plan, wall);
      if (!seg) continue;
      const d = pointSegDistance(point.x, point.y, seg);
      if (d <= wall.thickness / 2 + 6 * this.worldPerPx() && (!best || d < best.d)) {
        best = { wall, d };
      }
    }
    return best?.wall ?? null;
  }

  /**
   * Where the split tool would cut, ready to draw.
   *
   * Built from the same `wallCutAt` the cut itself uses and from the same snapped
   * point, so what the drawing promises is what the click does. Splitting a wall
   * changes nothing you can see — the poché runs straight through the new corner —
   * so without this you click and cannot tell whether anything happened.
   */
  cutPreview(wall, point) {
    const snapped = this.snapAt(point, null, { constrainAngle: false });
    const cut = wallCutAt(this.plan, wall.id, snapped.x, snapped.y);
    if (!cut) return null;
    const seg = wallSegment(this.plan, wall);
    if (!seg) return null;
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) || 1;
    // Across the wall, a little past each face, the way a cut is marked by hand.
    const reach = wall.thickness / 2 + 90;
    return {
      ...cut,
      wallId: wall.id,
      nx: (-(seg.y2 - seg.y1) / len) * reach,
      ny: ((seg.x2 - seg.x1) / len) * reach,
      a: { x: seg.x1, y: seg.y1 },
      b: { x: seg.x2, y: seg.y2 },
    };
  }

  /**
   * The figure on a chain under the cursor, if there is one.
   *
   * Named by where its chain runs and which division it is, because the chains are
   * derived from the drawing and have no identity that would survive an edit.
   */
  chainAt(point) {
    const plan = this.plan;
    if (plan.show?.autoDims === false) return null;
    const reach = 9 * this.worldPerPx();
    for (const chain of allChains(plan, plan.autoDims ?? {})) {
      // Tested against the chain's own drawn geometry rather than against x and y,
      // because on a skewed drawing a chain runs along the walls and not across the
      // page — asked the old way, none of them could be pointed at.
      const geo = chainGeometry(chain);
      for (let i = 0; i < geo.labels.length; i++) {
        const label = geo.labels[i];
        if (pointSegDistance(point.x, point.y, { x1: label.a.x, y1: label.a.y, x2: label.b.x, y2: label.b.y }) > reach) {
          continue;
        }
        return { kind: 'chain', id: `${chainKey(chain)}#${label.index}` };
      }
    }
    return null;
  }

  // ---- drafts ---------------------------------------------------------

  updateDraftFromPoint(point) {
    const draft = this.draft;
    if (!draft) return;
    const snapped = this.snapAt(point, draft.anchor, { constrainAngle: draft.kind !== 'rect' });
    this.snap = snapped.kind ? snapped : null;
    draft.x2 = snapped.x;
    draft.y2 = snapped.y;
    if (draft.kind === 'rect') {
      // Stored as centreline extents; shown, and typed, on the plan's basis.
      draft.width = Math.abs(snapped.x - draft.anchor.x);
      draft.depth = Math.abs(snapped.y - draft.anchor.y);
      draft.shift = this.rectShift(draft);
    } else {
      draft.length = Math.hypot(snapped.x - draft.anchor.x, snapped.y - draft.anchor.y);
      draft.angle = angleBetween(draft.anchor, { x: snapped.x, y: snapped.y });
    }
    this.ui.onDraftChange?.(draft);
  }

  startDraft(kind, anchor) {
    this.draft = {
      kind,
      anchor: { x: anchor.x, y: anchor.y },
      x2: anchor.x,
      y2: anchor.y,
      length: 0,
      angle: 0,
      width: 0,
      depth: 0,
      thickness: this.state.newWall?.thickness ?? wallTypeFor(this.state.newWall?.type).thickness,
      type: this.state.newWall?.type ?? 'partition',
    };
    this.ui.onDraftChange?.(this.draft);
    return this.draft;
  }

  endDraft() {
    this.draft = null;
    this.snap = null;
    this.ui.onDraftChange?.(null);
  }

  // Numeric entry writes back here: exact length and angle, or width and depth.
  // How much a typed rectangle size differs from its centreline size, given the
  // basis sizes are quoted on.
  rectShift(draft) {
    return rectBasisShift(this.plan.dimBasis ?? 'outer', draft?.thickness ?? this.state.newWall?.thickness ?? 115);
  }

  commitNumeric(values) {
    const draft = this.draft;
    if (!draft) return false;
    if (draft.kind === 'rect') {
      const shift = this.rectShift(draft);
      const width = Number(values.width) - shift;
      const depth = Number(values.depth) - shift;
      if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 300 || depth < 300) return false;
      const signX = draft.x2 >= draft.anchor.x ? 1 : -1;
      const signY = draft.y2 >= draft.anchor.y ? 1 : -1;
      this.createRect(draft.anchor, {
        x: draft.anchor.x + width * signX,
        y: draft.anchor.y + depth * signY,
      });
      this.endDraft();
      return true;
    }
    const length = Number(values.length);
    if (!Number.isFinite(length) || length < 1) return false;
    const angle = Number.isFinite(Number(values.angle)) ? Number(values.angle) : draft.angle;
    const target = pointAtAngle(draft.anchor, length, angle);
    if (draft.kind === 'wall') {
      this.createWall(draft.anchor, target, draft);
      this.draft = null;
      this.startDraft('wall', target);
      return true;
    }
    if (draft.kind === 'dimension') {
      this.createDimension(draft.anchor, target);
      this.endDraft();
      return true;
    }
    if (draft.kind === 'measure') {
      this.measurement = { from: draft.anchor, to: target, length, angle };
      this.endDraft();
      this.ui.onMeasured?.(this.measurement);
      return true;
    }
    return false;
  }

  createWall(from, to, draft) {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 50) return null;
    let created = null;
    this.store.edit('draw wall', (project) => {
      const plan = activePlan(project);
      created = addWall(plan, from.x, from.y, to.x, to.y, {
        type: draft?.type ?? this.state.newWall?.type ?? 'partition',
        thickness: draft?.thickness ?? this.state.newWall?.thickness,
      });
      if (created) this.splitCrossedWalls(plan, created);
      return Boolean(created);
    });
    return created;
  }

  createRect(from, to) {
    this.store.edit('draw room', (project) => {
      const plan = activePlan(project);
      const walls = addRoomRect(plan, from.x, from.y, to.x, to.y, {
        type: this.state.newWall?.type ?? 'exterior',
        thickness: this.state.newWall?.thickness,
      });
      return walls.length > 0;
    });
  }

  createDimension(from, to) {
    this.store.edit('add dimension', (project) => {
      const plan = activePlan(project);
      plan.dimensions.push({
        id: nextId('d'),
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
        offset: 500,
      });
      return true;
    });
  }

  /**
   * Works out where a fixture should sit. Anything that belongs on a wall snaps to
   * the nearest wall face and faces into the room, so it rides along if that wall
   * is later moved; anything else is dropped where it was clicked.
   */
  fixtureAt(plan, kind, point) {
    const base = defaultFixture(kind);
    if (!isWallMounted(kind)) {
      const snapped = this.snapAt(point);
      return { ...base, x: Math.round(snapped.x), y: Math.round(snapped.y) };
    }
    let best = null;
    for (const wall of plan.walls) {
      const ends = wallEnds(plan, wall);
      if (!ends) continue;
      const len = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      if (len < 1) continue;
      const ux = (ends.b.x - ends.a.x) / len;
      const uy = (ends.b.y - ends.a.y) / len;
      let along = ((point.x - ends.a.x) * ux + (point.y - ends.a.y) * uy);
      along = Math.max(0, Math.min(len, along));
      const px = ends.a.x + ux * along;
      const py = ends.a.y + uy * along;
      const d = Math.hypot(point.x - px, point.y - py);
      if (!best || d < best.d) {
        // Which face of the wall was the click on?
        const side = (point.x - px) * -uy + (point.y - py) * ux >= 0 ? 1 : -1;
        best = { d, wall, along, side };
      }
    }
    if (!best || best.d > 1500) {
      const snapped = this.snapAt(point);
      this.ui.flash?.('Nothing to mount that on — dropped it loose in the room.');
      return { ...base, x: Math.round(snapped.x), y: Math.round(snapped.y) };
    }
    const grid = Math.max(10, this.state.gridMm || 10);
    return {
      ...base,
      wallId: best.wall.id,
      offset: Math.round(best.along / grid) * grid,
      side: best.side,
    };
  }

  // ---- pointer --------------------------------------------------------

  onDown(event) {
    if (event.button === 1 || (event.button === 0 && this.spaceHeld)) {
      this.canvas.setPointerCapture(event.pointerId);
      const p = this.pointer(event);
      this.drag = { kind: 'pan', startSx: p.sx, startSy: p.sy, startView: { ...this.state.view } };
      return;
    }
    if (event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    const p = this.pointer(event);
    const tool = this.state.tool;

    switch (tool) {
      case 'wall':
      case 'dimension':
      case 'measure': {
        const snapped = this.snapAt(p, this.draft?.anchor ?? null);
        if (!this.draft) {
          this.measurement = null;
          this.startDraft(tool, snapped);
        } else {
          const from = this.draft.anchor;
          const to = { x: snapped.x, y: snapped.y };
          if (tool === 'wall') {
            const created = this.createWall(from, to, this.draft);
            if (created) {
              this.draft = null;
              this.startDraft('wall', to);
            } else {
              this.ui.flash?.('That wall is too short — click further from the last corner.');
            }
          } else if (tool === 'dimension') {
            this.createDimension(from, to);
            this.endDraft();
          } else {
            this.measurement = {
              from,
              to,
              length: Math.hypot(to.x - from.x, to.y - from.y),
              angle: angleBetween(from, to),
            };
            this.endDraft();
            this.ui.onMeasured?.(this.measurement);
          }
        }
        this.request();
        return;
      }
      case 'rect': {
        const snapped = this.snapAt(p, this.draft?.anchor ?? null, { constrainAngle: false });
        if (!this.draft) {
          this.startDraft('rect', snapped);
        } else {
          const from = this.draft.anchor;
          const to = { x: snapped.x, y: snapped.y };
          if (Math.abs(to.x - from.x) < 300 || Math.abs(to.y - from.y) < 300) {
            this.ui.flash?.('A room needs to be at least 300 mm each way — drag further out.');
            return;
          }
          this.draft.shift = this.rectShift(this.draft);
          this.createRect(from, to);
          this.endDraft();
        }
        this.request();
        return;
      }
      case 'door':
      case 'window':
      case 'opening': {
        const wall = this.wallAt(p);
        if (!wall) {
          this.ui.flash?.('Click on a wall to cut an opening into it.');
          return;
        }
        const ends = wallEnds(this.plan, wall);
        const total = wallLength(this.plan, wall);
        const along =
          ((p.x - ends.a.x) * (ends.b.x - ends.a.x) + (p.y - ends.a.y) * (ends.b.y - ends.a.y)) / (total || 1);
        const preset = this.state.newOpening ?? {};
        let created = null;
        this.store.edit(`place ${tool}`, (project) => {
          const plan = activePlan(project);
          created = addOpening(plan, wall.id, Math.max(0, Math.min(total, along)), {
            kind: tool,
            style: preset.kind === tool ? preset.style : undefined,
            width: preset.kind === tool ? preset.width : undefined,
          });
          return Boolean(created);
        });
        if (created) this.store.set({ selection: [{ kind: 'opening', id: created.id }] });
        this.request();
        return;
      }
      case 'split': {
        const wall = this.wallAt(p);
        if (!wall) {
          this.ui.flash?.('Click the wall you want to split.');
          return;
        }
        // The same point the preview drew from, so the cut lands where it was shown.
        const cut = this.cutPreview(wall, p);
        if (!cut) {
          this.ui.flash?.('Too near the end of the wall to cut — try further along it.');
          return;
        }
        let made = null;
        this.store.edit('split wall', (project) => {
          const plan = activePlan(project);
          made = splitWallAt(plan, wall.id, cut.x, cut.y);
          return Boolean(made);
        });
        if (made) {
          // A split leaves the drawing looking exactly as it did — the poché runs
          // straight through the new corner. Selecting it, and saying the two lengths,
          // is the only way you can tell it happened.
          this.store.set({ selection: [{ kind: 'node', id: made.node.id }] });
          this.ui.flash?.(`Cut into ${metres(made.lengths[0])} and ${metres(made.lengths[1])}.`);
          this.splitPreview = null;
        }
        this.request();
        return;
      }
      case 'trim': {
        const wall = this.wallAt(p);
        if (!wall) {
          this.ui.flash?.(this.trimPick ? 'Now click the wall to trim or extend to.' : 'Click the wall you want to change.');
          return;
        }
        if (!this.trimPick) {
          this.trimPick = { wallId: wall.id, end: nearestWallEnd(this.plan, wall, p) };
          this.ui.flash?.('Now click the wall to trim or extend to.');
        } else if (this.trimPick.wallId === wall.id) {
          this.trimPick = null;
        } else {
          const pick = this.trimPick;
          this.trimPick = null;
          const done = this.store.edit('trim wall', (project) =>
            trimWallTo(activePlan(project), pick.wallId, pick.end, wall.id)
          );
          if (!done) this.ui.flash?.('Those walls are parallel, so there is nothing to trim to.');
        }
        this.request();
        return;
      }
      case 'stair': {
        const snapped = this.snapAt(p);
        let created = null;
        this.store.edit('place stair', (project) => {
          const plan = activePlan(project);
          const spec = { ...defaultStair(floorToFloor(plan)), ...(this.state.newStair ?? {}) };
          spec.rise = floorToFloor(plan);
          spec.steps = Math.max(2, Math.round(spec.rise / 180));
          created = addStair(plan, snapped.x, snapped.y, spec);
          return true;
        });
        if (created) this.store.set({ selection: [{ kind: 'stair', id: created.id }] });
        this.request();
        return;
      }
      case 'column': {
        const snapped = this.snapAt(p);
        let created = null;
        this.store.edit('place column', (project) => {
          created = addColumn(activePlan(project), snapped.x, snapped.y, this.state.newColumn ?? {});
          return true;
        });
        if (created) this.store.set({ selection: [{ kind: 'column', id: created.id }] });
        this.request();
        return;
      }
      case 'void': {
        const snapped = this.snapAt(p);
        const preset = this.state.newVoid ?? {};
        this.store.edit('cut a floor opening', (project) => {
          const item = addVoid(activePlan(project), snapped.x, snapped.y, preset);
          this.select({ kind: 'void', id: item.id });
          return true;
        });
        this.request();
        return;
      }
      case 'fixture': {
        const kind = this.state.pendingFixture;
        if (!kind) {
          this.ui.flash?.('Pick a socket, switch or light on the right first.');
          return;
        }
        let created = null;
        this.store.edit('place fixture', (project) => {
          const plan = activePlan(project);
          created = addFixture(plan, this.fixtureAt(plan, kind, p));
          return Boolean(created);
        });
        if (created) this.store.set({ selection: [{ kind: 'fixture', id: created.id }] });
        this.request();
        return;
      }
      case 'furniture': {
        const spec = furnitureById(this.state.pendingFurniture) ?? FURNITURE[0];
        const placed = this.placementAt({ w: spec.w, h: spec.h, rotation: 0 }, p.x, p.y);
        this.placeFurniture(placed.x, placed.y, placed.rotation);
        this.request();
        return;
      }
      case 'label': {
        const snapped = this.snapAt(p);
        this.ui.requestLabel?.({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
        return;
      }
      case 'erase': {
        const hit = this.hitTest(p, { rooms: false });
        if (hit) this.deleteTarget(hit);
        this.request();
        return;
      }
      default:
        break;
    }

    // select tool
    const hit = this.hitTest(p);
    if (!hit) {
      if (!event.shiftKey) this.store.set({ selection: [] });
      this.rubber = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      this.drag = { kind: 'marquee' };
      return;
    }
    const plan = this.plan;
    const alreadySelected = this.state.selection.some((s) => s.kind === hit.kind && s.id === hit.id);

    // Dragging a room moves it, but only once it is selected — so a first drag
    // inside a room can still rubber-band a selection.
    if (hit.kind === 'room') {
      if (alreadySelected) {
        const room = derived(plan).rooms.find((r) => r.metaId === hit.id);
        const ids = room ? roomBoundaryNodeIds(plan, room) : new Set();
        this.drag = {
          kind: 'room',
          id: hit.id,
          start: { x: p.x, y: p.y },
          origin: originOf(plan, ids),
          moved: false,
        };
      } else {
        this.drag = { kind: 'pendingRoom', id: hit.id, start: { x: p.x, y: p.y }, moved: false };
        this.rubber = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      }
      this.request();
      return;
    }

    // Dragging any member of a multiple selection moves the whole selection.
    if (alreadySelected && this.state.selection.length > 1) {
      const movable = selectionNodes(plan, this.state.selection);
      this.drag = {
        kind: 'selection',
        start: { x: p.x, y: p.y },
        origin: originOf(plan, movable.nodeIds),
        items: movable,
        originItems: originOfItems(plan, movable),
        moved: false,
      };
      this.request();
      return;
    }

    this.select(hit, event.shiftKey);
    if (hit.kind === 'node') {
      const node = findNode(plan, hit.id);
      this.drag = {
        kind: 'node',
        id: hit.id,
        dx: node.x - p.x,
        dy: node.y - p.y,
        host: this.hostLineAt(plan, hit.id, null),
        moved: false,
      };
    } else if (hit.kind === 'wall') {
      const wall = findWall(plan, hit.id);
      const seg = wallSegment(plan, wall);
      this.drag = {
        kind: 'wall',
        id: hit.id,
        start: { x: p.x, y: p.y },
        origin: seg,
        hostA: this.hostLineAt(plan, wall.a, wall.id),
        hostB: this.hostLineAt(plan, wall.b, wall.id),
        moved: false,
      };
    } else if (hit.kind === 'furniture') {
      const item = plan.furniture.find((f) => f.id === hit.id);
      this.drag = { kind: 'furniture', id: hit.id, dx: item.x - p.x, dy: item.y - p.y, moved: false };
    } else if (hit.kind === 'fixture') {
      const placement = fixturePlacement(plan, findFixture(plan, hit.id));
      this.drag = { kind: 'fixture', id: hit.id, dx: placement.x - p.x, dy: placement.y - p.y, moved: false };
    } else if (hit.kind === 'stair' || hit.kind === 'column' || hit.kind === 'void') {
      const item =
        hit.kind === 'stair' ? findStair(plan, hit.id) : hit.kind === 'void' ? findVoid(plan, hit.id) : findColumn(plan, hit.id);
      this.drag = { kind: hit.kind, id: hit.id, dx: item.x - p.x, dy: item.y - p.y, moved: false };
    } else if (hit.kind === 'label') {
      const label = plan.labels.find((l) => l.id === hit.id);
      this.drag = { kind: 'label', id: hit.id, dx: label.x - p.x, dy: label.y - p.y, moved: false };
    } else if (hit.kind === 'opening') {
      this.drag = { kind: 'opening', id: hit.id, moved: false };
    } else if (hit.kind === 'dimension') {
      this.drag = { kind: 'dimension', id: hit.id, start: { x: p.x, y: p.y }, moved: false };
    } else if (hit.kind === 'guide') {
      this.drag = { kind: 'guide', id: hit.id, moved: false };
    }
    this.request();
  }

  onMove(event) {
    const p = this.pointer(event);
    this.state.cursor = { x: p.x, y: p.y };
    const drag = this.drag;

    if (!drag) {
      if (this.draft) {
        this.updateDraftFromPoint(p);
      } else if (this.state.tool === 'select' || this.state.tool === 'erase') {
        // A figure on a chain answers to the cursor as well, so that reading one and
        // finding out what it measures work the same way round. It is probed only
        // where nothing solid was hit, and never by `hitTest` itself — the chains are
        // worked out from the drawing rather than part of it, so there is nothing
        // there to click, select or drag.
        const hit = this.hitTest(p) ?? this.chainAt(p);
        if (hit?.id !== this.state.hover?.id || hit?.kind !== this.state.hover?.kind) {
          this.state.hover = hit;
        }
      } else if (WALL_TOOLS.has(this.state.tool)) {
        // These tools only do anything on a wall, so which wall — or none — is what
        // the cursor needs to know to say whether the next click will land.
        const wall = this.wallAt(p);
        this.state.hover = wall ? { kind: 'wall', id: wall.id } : null;
        this.splitPreview = this.state.tool === 'split' && wall ? this.cutPreview(wall, p) : null;
      } else if (this.state.hover) {
        this.state.hover = null;
      }
      // One owner for the cursor: the tool, what is under it and what is held are all
      // read together, and setting it from here as well only fought with that.
      this.ui.applyCursor?.();
      this.request();
      return;
    }

    if (drag.kind === 'pan') {
      const view = this.state.view;
      view.x = drag.startView.x - (p.sx - drag.startSx) / view.scale;
      view.y = drag.startView.y - (p.sy - drag.startSy) / view.scale;
      this.request();
      return;
    }

    if (drag.kind === 'pendingRoom') {
      const far = Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > 8 * this.worldPerPx();
      if (far) {
        drag.kind = 'marquee'; // it turned out to be a rubber band after all
        this.rubber.x2 = p.x;
        this.rubber.y2 = p.y;
      }
      this.request();
      return;
    }

    if (drag.kind === 'marquee') {
      this.rubber.x2 = p.x;
      this.rubber.y2 = p.y;
      this.request();
      return;
    }

    if (!drag.moved) {
      drag.moved = true;
      // The store remembers where the drag found the drawing, so the whole gesture
      // undoes as one. It used to be kept here and swapped in by hand at the release;
      // the store owns it now, and the live movers in the 3D view use the same pair.
      this.store.preview();
    }
    const plan = this.plan;
    if (drag.kind === 'room' || drag.kind === 'selection') {
      const grid = this.state.gridMm || 1;
      const dx = Math.round((p.x - drag.start.x) / grid) * grid;
      const dy = Math.round((p.y - drag.start.y) / grid) * grid;
      for (const node of plan.nodes) {
        const from = drag.origin.get(node.id);
        if (!from) continue;
        node.x = from.x + dx;
        node.y = from.y + dy;
      }
      if (drag.originItems) {
        for (const item of plan.furniture) {
          const from = drag.originItems.get(`f${item.id}`);
          if (from) {
            item.x = from.x + dx;
            item.y = from.y + dy;
          }
        }
        for (const label of plan.labels) {
          const from = drag.originItems.get(`l${label.id}`);
          if (from) {
            label.x = from.x + dx;
            label.y = from.y + dy;
          }
        }
      }
      touch(plan);
      this.request();
      return;
    }
    if (drag.kind === 'node') {
      const node = findNode(plan, drag.id);
      if (drag.host && !event.altKey) {
        this.slideAlongHost(node, drag.host, p.x + drag.dx, p.y + drag.dy);
        this.snap = null;
      } else {
        const snapped = this.snapAt({ x: p.x + drag.dx, y: p.y + drag.dy }, null, { ignoreNodeId: drag.id });
        node.x = snapped.x;
        node.y = snapped.y;
        this.snap = snapped.kind ? snapped : null;
      }
      touch(plan);
    } else if (drag.kind === 'wall') {
      const wall = findWall(plan, drag.id);
      const ends = wallEnds(plan, wall);
      const grid = this.state.gridMm || 1;
      const dx = Math.round((p.x - drag.start.x) / grid) * grid;
      const dy = Math.round((p.y - drag.start.y) / grid) * grid;
      // An end that butts into a wall carrying on past it slides along that wall,
      // instead of dragging it out of line. Alt moves the wall bodily.
      const free = event.altKey;
      if (drag.hostA && !free) this.slideAlongHost(ends.a, drag.hostA, drag.origin.x1 + dx, drag.origin.y1 + dy);
      else {
        ends.a.x = drag.origin.x1 + dx;
        ends.a.y = drag.origin.y1 + dy;
      }
      if (drag.hostB && !free) this.slideAlongHost(ends.b, drag.hostB, drag.origin.x2 + dx, drag.origin.y2 + dy);
      else {
        ends.b.x = drag.origin.x2 + dx;
        ends.b.y = drag.origin.y2 + dy;
      }
      touch(plan);
    } else if (drag.kind === 'furniture') {
      const item = plan.furniture.find((f) => f.id === drag.id);
      // The same placement the model uses, so a piece dragged on the plan lands where
      // the same drag would land in 3D — against the wall's face rather than with its
      // centre on it, and turned to lie along the wall. It used to take the drawing's
      // general point snap, which knows about corners and midpoints but nothing about
      // the piece having edges.
      const placed = this.placementAt(item, p.x + drag.dx, p.y + drag.dy);
      item.x = placed.x;
      item.y = placed.y;
      item.rotation = placed.rotation;
      touch(plan);
    } else if (drag.kind === 'fixture') {
      const fixture = findFixture(plan, drag.id);
      if (fixture?.wallId) {
        const next = this.fixtureAt(plan, fixture.kind, p);
        if (next.wallId) {
          fixture.wallId = next.wallId;
          fixture.offset = next.offset;
          fixture.side = next.side;
        }
      } else if (fixture) {
        const snapped = this.snapAt({ x: p.x + drag.dx, y: p.y + drag.dy });
        fixture.x = snapped.x;
        fixture.y = snapped.y;
      }
      touch(plan);
    } else if (drag.kind === 'stair' || drag.kind === 'column' || drag.kind === 'void') {
      const item =
        drag.kind === 'stair'
          ? findStair(plan, drag.id)
          : drag.kind === 'void'
            ? findVoid(plan, drag.id)
            : findColumn(plan, drag.id);
      const snapped = this.snapAt({ x: p.x + drag.dx, y: p.y + drag.dy });
      item.x = snapped.x;
      item.y = snapped.y;
      this.snap = snapped.kind ? snapped : null;
      touch(plan);
    } else if (drag.kind === 'label') {
      const label = plan.labels.find((l) => l.id === drag.id);
      label.x = p.x + drag.dx;
      label.y = p.y + drag.dy;
      touch(plan);
    } else if (drag.kind === 'opening') {
      const opening = plan.openings.find((o) => o.id === drag.id);
      const wall = findWall(plan, opening.wallId);
      const ends = wallEnds(plan, wall);
      const total = wallLength(plan, wall);
      const hole = openingWidth(opening);
      const along =
        ((p.x - ends.a.x) * (ends.b.x - ends.a.x) + (p.y - ends.a.y) * (ends.b.y - ends.a.y)) / (total || 1);
      const grid = Math.max(5, this.state.gridMm || 5);
      opening.offset = Math.max(
        0,
        Math.min(total - hole, Math.round((along - hole / 2) / grid) * grid)
      );
      touch(plan);
    } else if (drag.kind === 'guide') {
      const guide = findGuide(plan, drag.id);
      if (guide) {
        const grid = this.state.gridMm || 1;
        // A guide lands on the grid, or on whatever the drawing offers under it.
        const snapped = this.snapAt({ x: p.x, y: p.y });
        const raw = guide.axis === 'x' ? snapped.x : snapped.y;
        guide.at = snapped.kind && snapped.kind !== 'grid' ? Math.round(raw) : Math.round(raw / grid) * grid;
        this.snap = snapped.kind ? snapped : null;
      }
      touch(plan);
    } else if (drag.kind === 'dimension') {
      const dim = plan.dimensions.find((d) => d.id === drag.id);
      const line = dimensionLine(plan, dim, 0);
      if (line) {
        const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
        const nx = -(line.y2 - line.y1) / len;
        const ny = (line.x2 - line.x1) / len;
        const rel = (p.x - line.x1) * nx + (p.y - line.y1) * ny;
        dim.offset = Math.round(rel / 50) * 50;
      }
      touch(plan);
    }
    this.request();
  }

  /**
   * The line a junction may slide along: where two walls carry straight on through
   * a node, that node belongs to their line and can only move along it. Returns
   * null where there is no such line and the node is free.
   */
  hostLineAt(plan, nodeId, exceptWallId) {
    const node = findNode(plan, nodeId);
    if (!node) return null;
    const plan2 = plan;
    const arms = [];
    for (const wall of plan2.walls) {
      if (wall.id === exceptWallId) continue;
      if (wall.a !== nodeId && wall.b !== nodeId) continue;
      const ends = wallEnds(plan2, wall);
      if (!ends) continue;
      const far = ends.a.id === nodeId ? ends.b : ends.a;
      const len = Math.hypot(far.x - node.x, far.y - node.y);
      if (len < 1) continue;
      arms.push({ x: (far.x - node.x) / len, y: (far.y - node.y) / len, len });
    }
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        // Opposite directions mean one wall runs straight through the node.
        if (arms[i].x * arms[j].x + arms[i].y * arms[j].y > -0.999) continue;
        return {
          x: node.x,
          y: node.y,
          dx: arms[j].x,
          dy: arms[j].y,
          min: -(arms[i].len - 100),
          max: arms[j].len - 100,
        };
      }
    }
    return null;
  }

  /** Puts a node at the point on its host line nearest the place it was dragged to. */
  slideAlongHost(node, host, x, y) {
    const grid = this.state.gridMm || 1;
    let t = (x - host.x) * host.dx + (y - host.y) * host.dy;
    t = Math.round(t / grid) * grid;
    t = Math.max(host.min, Math.min(host.max, t));
    node.x = host.x + host.dx * t;
    node.y = host.y + host.dy * t;
  }

  onUp(event) {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.kind === 'pan') return;

    if (drag.kind === 'pendingRoom') {
      this.rubber = null;
      this.select({ kind: 'room', id: drag.id }, event.shiftKey);
      this.request();
      return;
    }

    if (drag.kind === 'marquee') {
      const rect = this.rubber;
      this.rubber = null;
      if (rect && Math.abs(rect.x2 - rect.x1) > 20 && Math.abs(rect.y2 - rect.y1) > 20) {
        this.selectInRect(rect, event.shiftKey);
      }
      this.request();
      return;
    }

    if (drag.moved) {
      const changed = this.store.commit(`move ${drag.kind}`);
      if (changed && (drag.kind === 'node' || drag.kind === 'wall')) {
        this.store.edit('tidy', (project) => {
          pruneNodes(activePlan(project));
          return true;
        });
      }
    }
    this.snap = null;
    this.request();
  }

  onDoubleClick(event) {
    const p = this.pointer(event);
    if (this.draft) {
      this.endDraft();
      this.request();
      return;
    }
    const hit = this.hitTest(p);
    if (hit?.kind === 'room') this.ui.onRenameRoom?.(hit.id);
    else if (hit?.kind === 'label') this.ui.onEditLabel?.(hit.id);
    else if (hit?.kind === 'wall') {
      const snapped = this.snapAt(p);
      this.store.edit('split wall', (project) =>
        Boolean(splitWallAt(activePlan(project), hit.id, snapped.x, snapped.y))
      );
    }
    this.request();
  }

  onWheel(event) {
    event.preventDefault();
    const p = this.pointer(event);
    const view = this.state.view;
    const factor = Math.exp(-event.deltaY * 0.0016);
    const next = Math.max(0.002, Math.min(3, view.scale * factor));
    view.x = p.x - p.sx / next;
    view.y = p.y - p.sy / next;
    view.scale = next;
    this.request();
  }

  // ---- editing helpers ------------------------------------------------

  splitCrossedWalls(plan, wall) {
    const ends = wallEnds(plan, wall);
    if (!ends) return;
    for (const node of [ends.a, ends.b]) {
      for (const other of [...plan.walls]) {
        if (other.id === wall.id) continue;
        if (other.a === node.id || other.b === node.id) continue;
        const seg = wallSegment(plan, other);
        if (!seg) continue;
        if (pointSegDistance(node.x, node.y, seg) < 30) splitWallAt(plan, other.id, node.x, node.y);
      }
    }
  }

  select(hit, additive) {
    const entry = { kind: hit.kind, id: hit.id };
    const current = this.state.selection;
    if (additive) {
      const exists = current.some((s) => s.kind === entry.kind && s.id === entry.id);
      this.store.set({
        selection: exists
          ? current.filter((s) => !(s.kind === entry.kind && s.id === entry.id))
          : [...current, entry],
      });
    } else {
      this.store.set({ selection: [entry] });
    }
  }

  selectInRect(rect, additive) {
    const plan = this.plan;
    const minX = Math.min(rect.x1, rect.x2);
    const maxX = Math.max(rect.x1, rect.x2);
    const minY = Math.min(rect.y1, rect.y2);
    const maxY = Math.max(rect.y1, rect.y2);
    const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    const found = [];
    for (const wall of plan.walls) {
      const ends = wallEnds(plan, wall);
      if (ends && inside(ends.a.x, ends.a.y) && inside(ends.b.x, ends.b.y)) {
        found.push({ kind: 'wall', id: wall.id });
      }
    }
    for (const item of plan.furniture) if (inside(item.x, item.y)) found.push({ kind: 'furniture', id: item.id });
    for (const label of plan.labels) if (inside(label.x, label.y)) found.push({ kind: 'label', id: label.id });
    this.store.set({ selection: additive ? [...this.state.selection, ...found] : found });
  }

  toggleRoom(metaId) {
    this.store.edit('keep or drop room', (project) => {
      const entry = activePlan(project).rooms.find((r) => r.id === metaId);
      if (!entry) return false;
      entry.kept = entry.kept === false;
      return true;
    });
  }

  joinSelected() {
    const walls = this.state.selection.filter((s) => s.kind === 'wall');
    if (walls.length !== 2) {
      this.ui.flash?.('Select exactly two walls that meet at a corner.');
      return;
    }
    if (!canJoinWalls(this.plan, walls[0].id, walls[1].id)) {
      this.ui.flash?.('Those two walls do not run in line from a shared corner.');
      return;
    }
    const ok = this.store.edit('join walls', (project) =>
      joinWalls(activePlan(project), walls[0].id, walls[1].id)
    );
    if (ok) this.store.set({ selection: [{ kind: 'wall', id: walls[0].id }] });
  }

  deleteTarget(hit) {
    this.store.edit('delete', (project) => {
      const plan = activePlan(project);
      switch (hit.kind) {
        case 'wall':
          removeWall(plan, hit.id);
          return true;
        case 'furniture':
          plan.furniture = plan.furniture.filter((f) => f.id !== hit.id);
          return true;
        case 'label':
          plan.labels = plan.labels.filter((l) => l.id !== hit.id);
          return true;
        case 'opening':
          plan.openings = plan.openings.filter((o) => o.id !== hit.id);
          return true;
        case 'dimension':
          plan.dimensions = plan.dimensions.filter((d) => d.id !== hit.id);
          return true;
        case 'stair':
          plan.stairs = plan.stairs.filter((s) => s.id !== hit.id);
          return true;
        case 'guide':
          return removeGuide(plan, hit.id);
        case 'void':
          plan.voids = (plan.voids ?? []).filter((v) => v.id !== hit.id);
          return true;
        case 'column':
          plan.columns = plan.columns.filter((c) => c.id !== hit.id);
          return true;
        case 'fixture':
          plan.fixtures = plan.fixtures.filter((f) => f.id !== hit.id);
          return true;
        case 'node': {
          for (const wall of plan.walls.filter((w) => w.a === hit.id || w.b === hit.id)) {
            removeWall(plan, wall.id);
          }
          return true;
        }
        default:
          return false;
      }
    });
  }

  deleteSelection() {
    const selection = [...this.state.selection];
    if (!selection.length) return;
    this.store.edit('delete selection', (project) => {
      const plan = activePlan(project);
      for (const item of selection) {
        switch (item.kind) {
          case 'wall':
            removeWall(plan, item.id);
            break;
          case 'furniture':
            plan.furniture = plan.furniture.filter((f) => f.id !== item.id);
            break;
          case 'label':
            plan.labels = plan.labels.filter((l) => l.id !== item.id);
            break;
          case 'opening':
            plan.openings = plan.openings.filter((o) => o.id !== item.id);
            break;
          case 'dimension':
            plan.dimensions = plan.dimensions.filter((d) => d.id !== item.id);
            break;
          case 'stair':
            plan.stairs = plan.stairs.filter((s) => s.id !== item.id);
            break;
          case 'column':
            plan.columns = plan.columns.filter((c) => c.id !== item.id);
            break;
          case 'fixture':
            plan.fixtures = plan.fixtures.filter((f) => f.id !== item.id);
            break;
          case 'guide':
            removeGuide(plan, item.id);
            break;
          case 'void':
            plan.voids = (plan.voids ?? []).filter((v) => v.id !== item.id);
            break;
          case 'node':
            for (const wall of plan.walls.filter((w) => w.a === item.id || w.b === item.id)) {
              removeWall(plan, wall.id);
            }
            break;
          default:
            break;
        }
      }
      return true;
    });
    this.store.set({ selection: [] });
  }

  /** Copies whatever can stand alone: furniture and labels. */
  duplicateSelection() {
    const selection = this.state.selection;
    const copyable = selection.filter(
      (s) => s.kind === 'furniture' || s.kind === 'label' || s.kind === 'fixture' || s.kind === 'wall'
    );
    if (!copyable.length) {
      this.ui.flash?.('Select a wall, a fixture, a piece of furniture or a label to duplicate.');
      return;
    }
    const made = [];
    this.store.edit('duplicate', (project) => {
      const plan = activePlan(project);
      const step = Math.max(200, this.state.gridMm * 4 || 200);
      // Walls are copied together, in one go, because they are not separate things:
      // two walls that met at a corner have to still meet at a corner afterwards. Copy
      // them one at a time and each brings its own pair of new corners, and the copy
      // comes apart at every junction.
      const wallIds = copyable.filter((s) => s.kind === 'wall').map((s) => s.id);
      if (wallIds.length) {
        for (const copy of copyWalls(plan, wallIds, step, step)) made.push({ kind: 'wall', id: copy.id });
      }
      for (const item of copyable) {
        if (item.kind === 'wall') continue;
        if (item.kind === 'fixture') {
          const source = findFixture(plan, item.id);
          if (!source) continue;
          const copy = { ...source, id: nextId('x') };
          // Along a wall, step far enough that the two symbols do not overlap:
          // a run of sockets should read as a run.
          if (copy.wallId) {
            const clear = Math.round(Math.max(step, (copy.size ?? 260) * 1.5) / 10) * 10;
            copy.offset = (copy.offset ?? 0) + clear;
          }
          else {
            copy.x += step;
            copy.y += step;
          }
          plan.fixtures.push(copy);
          made.push({ kind: 'fixture', id: copy.id });
        } else if (item.kind === 'furniture') {
          const source = plan.furniture.find((f) => f.id === item.id);
          if (!source) continue;
          const copy = { ...source, id: nextId('f'), x: source.x + step, y: source.y + step };
          plan.furniture.push(copy);
          made.push({ kind: 'furniture', id: copy.id });
        } else {
          const source = plan.labels.find((l) => l.id === item.id);
          if (!source) continue;
          const copy = { ...source, id: nextId('l'), x: source.x + step, y: source.y + step };
          plan.labels.push(copy);
          made.push({ kind: 'label', id: copy.id });
        }
      }
      return made.length > 0;
    });
    if (made.length) this.store.set({ selection: made });
  }

  selectAll() {
    const plan = this.plan;
    const selection = [
      ...plan.walls.map((w) => ({ kind: 'wall', id: w.id })),
      ...plan.furniture.map((f) => ({ kind: 'furniture', id: f.id })),
      ...plan.labels.map((l) => ({ kind: 'label', id: l.id })),
    ];
    this.store.set({ selection });
    if (!selection.length) this.ui.flash?.('Nothing to select yet.');
  }

  nudge(dx, dy) {
    const step = this.state.gridMm || 10;
    const selection = this.state.selection;
    if (!selection.length) return;
    // A multiple selection, or a room, moves as one piece.
    if (selection.length > 1 || selection[0].kind === 'room') {
      this.store.edit('nudge', (project) => {
        const plan = activePlan(project);
        const movable = selectionNodes(plan, selection);
        translateNodes(plan, movable.nodeIds, dx * step, dy * step);
        for (const id of movable.furnitureIds) {
          const item = plan.furniture.find((f) => f.id === id);
          if (item) {
            item.x += dx * step;
            item.y += dy * step;
          }
        }
        for (const id of movable.labelIds) {
          const label = plan.labels.find((l) => l.id === id);
          if (label) {
            label.x += dx * step;
            label.y += dy * step;
          }
        }
        return true;
      });
      return;
    }
    this.store.edit('nudge', (project) => {
      const plan = activePlan(project);
      for (const item of selection) {
        if (item.kind === 'node') {
          const node = findNode(plan, item.id);
          if (node) {
            node.x += dx * step;
            node.y += dy * step;
          }
        } else if (item.kind === 'wall') {
          const ends = wallEnds(plan, findWall(plan, item.id) ?? {});
          if (ends) {
            ends.a.x += dx * step;
            ends.a.y += dy * step;
            ends.b.x += dx * step;
            ends.b.y += dy * step;
          }
        } else if (item.kind === 'furniture') {
          const f = plan.furniture.find((i) => i.id === item.id);
          if (f) {
            f.x += dx * step;
            f.y += dy * step;
          }
        } else if (item.kind === 'label') {
          const l = plan.labels.find((i) => i.id === item.id);
          if (l) {
            l.x += dx * step;
            l.y += dy * step;
          }
        } else if (item.kind === 'opening') {
          const o = plan.openings.find((i) => i.id === item.id);
          if (o) o.offset = Math.max(0, o.offset + (dx || dy) * step);
        }
      }
      return true;
    });
  }

  rotateSelection(degrees) {
    const selection = this.state.selection.filter(
      (s) => s.kind === 'furniture' || s.kind === 'stair' || s.kind === 'column'
    );
    if (!selection.length) return;
    this.store.edit('rotate', (project) => {
      const plan = activePlan(project);
      for (const item of selection) {
        const target =
          item.kind === 'furniture'
            ? plan.furniture.find((i) => i.id === item.id)
            : item.kind === 'stair'
              ? findStair(plan, item.id)
              : findColumn(plan, item.id);
        if (target) target.rotation = ((target.rotation ?? 0) + degrees + 360) % 360;
      }
      return true;
    });
  }

  // Flips every selected opening: hinge side, or swing direction.
  flipSelectedOpenings(which) {
    const openings = this.state.selection.filter((s) => s.kind === 'opening');
    if (!openings.length) return;
    this.store.edit('flip opening', (project) => {
      const plan = activePlan(project);
      for (const item of openings) {
        const o = plan.openings.find((x) => x.id === item.id);
        if (!o) continue;
        if (which === 'hinge') o.hinge = o.hinge === 'start' ? 'end' : 'start';
        else o.swing = o.swing === 'in' ? 'out' : 'in';
      }
      return true;
    });
  }

  /**
   * Put down whatever piece is chosen, at a point already snapped.
   *
   * One creation path, because the plan and the model both do this and a piece put down
   * in one of them has to be the same piece as one put down in the other — same fields,
   * same rounding, same selection afterwards.
   *
   * @returns the piece, or null if nothing was chosen
   */
  /**
   * Where a piece should come to rest, asked of whoever owns the snapping.
   *
   * The plan and the model share one answer. Falling back to the plain point snap keeps
   * this working if the view is not there to ask.
   */
  placementAt(item, x, y) {
    const placed = this.ui.snapPlacement?.(item, x, y);
    if (placed) return { x: placed.x, y: placed.y, rotation: placed.rotation ?? item.rotation ?? 0 };
    const snapped = this.snapAt({ x, y });
    return { x: Math.round(snapped.x), y: Math.round(snapped.y), rotation: item.rotation ?? 0 };
  }

  placeFurniture(x, y, rotation = 0) {
    // The bar shows the first piece in the list when nothing has been chosen, so that
    // is the piece it means. Refusing instead left it naming a bed and printing "pick a
    // piece of furniture first" when you clicked — the control and the answer at odds.
    const item = furnitureById(this.state.pendingFurniture) ?? FURNITURE[0];
    if (!item) return null;
    if (this.state.pendingFurniture !== item.id) this.store.set({ pendingFurniture: item.id });
    let created = null;
    this.store.edit('place furniture', (project) => {
      const plan = activePlan(project);
      created = {
        id: nextId('f'),
        kind: item.id,
        symbol: item.symbol,
        label: item.label,
        x: Math.round(x),
        y: Math.round(y),
        w: item.w,
        h: item.h,
        rotation,
      };
      plan.furniture.push(created);
      return true;
    });
    if (created) this.store.set({ selection: [{ kind: 'furniture', id: created.id }] });
    return created;
  }

  cancelDraft() {
    const had = Boolean(this.draft || this.rubber || this.trimPick || this.measurement);
    this.endDraft();
    this.rubber = null;
    this.trimPick = null;
    this.measurement = null;
    // The split tool's preview belongs to the split tool. It is only rebuilt on a
    // pointer move, so changing tool from the keyboard left it on the drawing —
    // labels promising a cut that the tool in your hand can no longer make. Cleared
    // silently rather than counted as something Escape did, because the pointer has
    // not moved and it would come straight back.
    this.splitPreview = null;
    this.request();
    return had;
  }

  cancel() {
    this.drag = null;
    this.request();
  }

  request() {
    this.ui.requestRender?.();
  }

  extras() {
    return {
      rubber: this.rubber,
      draft: this.draft,
      snap: this.snap,
      measurement: this.measurement,
      trimPick: this.trimPick,
      splitPreview: this.splitPreview,
    };
  }
}

export function dimensionLine(plan, dim, offsetOverride) {
  const a = dim.fromNode ? findNode(plan, dim.fromNode) : dim.from;
  const b = dim.toNode ? findNode(plan, dim.toNode) : dim.to;
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const off = offsetOverride === undefined ? dim.offset ?? 500 : offsetOverride;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return {
    x1: a.x + nx * off,
    y1: a.y + ny * off,
    x2: b.x + nx * off,
    y2: b.y + ny * off,
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    length: len,
  };
}

// Everything a selection can move: wall corners, room boundaries, and the loose
// objects that carry their own position.
export function selectionNodes(plan, selection) {
  const nodeIds = new Set();
  const furnitureIds = [];
  const labelIds = [];
  const rooms = derived(plan).rooms;
  for (const item of selection) {
    if (item.kind === 'node') nodeIds.add(item.id);
    else if (item.kind === 'wall') {
      const wall = findWall(plan, item.id);
      if (wall) {
        nodeIds.add(wall.a);
        nodeIds.add(wall.b);
      }
    } else if (item.kind === 'room') {
      const room = rooms.find((r) => r.metaId === item.id);
      if (room) for (const id of roomBoundaryNodeIds(plan, room)) nodeIds.add(id);
    } else if (item.kind === 'furniture') furnitureIds.push(item.id);
    else if (item.kind === 'label') labelIds.push(item.id);
  }
  return { nodeIds, furnitureIds, labelIds };
}

function originOf(plan, nodeIds) {
  const map = new Map();
  for (const node of plan.nodes) {
    if (nodeIds.has(node.id)) map.set(node.id, { x: node.x, y: node.y });
  }
  return map;
}

function originOfItems(plan, movable) {
  const map = new Map();
  for (const id of movable.furnitureIds) {
    const item = plan.furniture.find((f) => f.id === id);
    if (item) map.set(`f${id}`, { x: item.x, y: item.y });
  }
  for (const id of movable.labelIds) {
    const label = plan.labels.find((l) => l.id === id);
    if (label) map.set(`l${id}`, { x: label.x, y: label.y });
  }
  return map;
}

function pointInRotatedRect(point, item) {
  const angle = -((item.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - item.x;
  const dy = point.y - item.y;
  const lx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ly = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(lx) <= item.w / 2 && Math.abs(ly) <= item.h / 2;
}

