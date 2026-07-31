// DOM shell, panels and event wiring. One screen: the editor.

import { Store } from './store.js';
import { Renderer, formatArea, formatLength } from './render.js';
import { Interaction } from './interact.js';
import {
  COLUMN_SHAPES,
  DIM_BASES,
  JOIN_STYLES,
  ROOM_USAGES,
  WALL_TYPES,
  PHASES,
  WALL_STATUS,
  activePlan,
  addGuide,
  planElevation,
  measureLines,
  roomChord,
  roomExtent,
  roomFrame,
  phaseOf,
  statusCounts,
  wallStatus,
  stairHeadroom,
  storeyAbove,
  storeyBelow,
  addVoid,
  findVoid,
  pointInVoid,
  roomFloorArea,
  roomHeadroomBands,
  roomLivingArea,
  clearGuides,
  findGuide,
  growRoomFromWall,
  healProject,
  removeGuide,
  looseJunctions,
  canJoinWalls,
  copyPlan,
  createPlan,
  createProject,
  derived,
  findColumn,
  findFixture,
  findNode,
  findStair,
  findWall,
  floorToFloor,
  floorsInOrder,
  livingArea,
  nextId,
  phaseWalls,
  buildingBounds,
  planBounds,
  rectBasisShift,
  rescalePlan,
  roomAxes,
  roomClearSize,
  roomHeight,
  roomMetaFor,
  roomSizeOn,
  roomVolume,
  inPhase,
  openingGeometry,
  roomWallArea,
  setRoomSize,
  setWallAngle,
  setWallLengthOn,
  totalArea,
  touch,
  wallAngle,
  wallLength,
  isKneeWall,
  kneeWalls,
  usageSpec,
  wallCorners,
  wallEnds,
  wallHeight,
  wallLengths,
  wallTypeFor,
} from './model.js';
import {
  DEFAULT_CUT_HEIGHT,
  STAIR_SHAPES,
  cutTreadStep,
  stairChecks,
  stairLabel,
  stairParts,
  stairWorldTreads,
  walkOffset,
  walkingTread,
  worstLevel,
} from './stairs.js';
import {
  RADIATOR_HEIGHTS,
  RADIATOR_TYPES,
  fixtureGroups,
  fixtureSpec,
  isRadiator,
  radiatorSpec,
} from './fixtures.js';
import {
  clearanceIssues,
  openingGuides,
  furnitureFootprint,
  pieceGuides,
  snapPlacement,
  wallGuides,
} from './clearance.js';
import { allChains, chainGeometry, dimLabel } from './dimensions.js';
import { buildMesh, meshBounds, segmentBlocked, segmentThrough } from './mesh.js';
import { documentName, openFile, saveFileAs, wasCancelled, writeTo } from './files.js';
import {
  PLACES,
  SEASONS,
  bearingOf,
  clock,
  compassPoint,
  daylight,
  dayOfYear,
  fromDayOfYear,
  sunPosition,
  sunVector,
  timezoneMinutes,
  windowSunHours,
} from './sun.js';
import { FLOOR_FINISHES, WALL_FINISHES } from './materials.js';
import { FOV_DEG, View3D } from './view3d.js';
import { pointInPolygon } from '../geom/vec.js';
import {
  backdropBounds,
  backdropFromImage,
  backdropFromPage,
  emptyBackdrop,
  readPdfPages,
  UnsupportedEncryption,
} from './backdrop.js';
import {
  OPENING_KINDS,
  describeOpening,
  defaultsFor,
  kindSpec,
  openingHeight,
  openingMarks,
  openingWidth,
  stockOf,
  styleSpec,
  swingsOpen,
  tiltsOpen,
} from './openings.js';
import { MAX_SWING, boardOf, swingAngle } from './opening3d.js';
import { cursorCss, cursorFor } from './cursor.js';
import { floorQuantities, openingQuantities, quantitiesCsv, summaryQuantities, wallQuantities } from './quantities.js';
import { EYE, HURRY, PACE, startingPoint, stepTo, walkBlockers } from './walk.js';
import { STANDARD_SCALES } from '../geom/scale.js';
import { FURNITURE, FURNITURE_GROUPS, furnitureById } from './furniture.js';
import {
  downloadBlob,
  normaliseProject,
  PAPERS,
  paperSize,
  planToPngBlob,
  planToSheetSvg,
  scaleToFit,
  planToSvg,
  projectFromJson,
  projectToJson,
  safeFilename,
} from './export.js';

/** What a storey is called on the drawing, in the German way: EG, 1.OG, KG. */
function storeyLabel(storey) {
  if (!Number.isFinite(storey)) return '—';
  if (storey === 0) return 'EG';
  if (storey > 0) return `${storey}.OG`;
  return storey === -1 ? 'KG' : `${-storey}.UG`;
}

// `label` is what the tool's button says on hover; `short` is what the options bar
// is titled with, which has to stay a couple of words to fit.
//
// `in3d` marks the tools the model can actually carry out. Everything else needs a
// point on a drawing — a wall runs between two corners on a plan, a door goes on a wall
// you clicked — and there is nothing sensible for it to do in a perspective view. Those
// are turned off there rather than left selectable and silent.
const TOOLS = [
  { id: 'select', icon: 'i-cursor', label: 'Select and move', short: 'Select', key: 'V', in3d: true },
  { id: 'wall', icon: 'i-wall', label: 'Draw walls', short: 'Wall', key: 'W' },
  { id: 'rect', icon: 'i-rect', label: 'Draw a room', short: 'Room', key: 'R' },
  { sep: true },
  { id: 'door', icon: 'i-door', label: 'Place a door', short: 'Door', key: 'D' },
  { id: 'window', icon: 'i-window', label: 'Place a window', short: 'Window', key: 'N' },
  { id: 'opening', icon: 'i-opening', label: 'Place a plain opening', short: 'Opening', key: 'P' },
  { sep: true },
  { id: 'trim', icon: 'i-trim', label: 'Trim or extend a wall to another', short: 'Trim', key: 'T' },
  { id: 'split', icon: 'i-split', label: 'Split a wall', short: 'Split', key: 'X' },
  { sep: true },
  { id: 'stair', icon: 'i-stair', label: 'Place a stair', short: 'Stair', key: 'S' },
  { id: 'column', icon: 'i-column', label: 'Place a column', short: 'Column', key: 'C' },
  { id: 'void', icon: 'i-void', label: 'Cut an opening in the floor', short: 'Floor opening', key: 'H' },
  { sep: true },
  { id: 'fixture', icon: 'i-socket', label: 'Place sockets, switches and lights', short: 'Fixture', key: 'A' },
  { id: 'furniture', icon: 'i-furniture', label: 'Place furniture', short: 'Furniture', key: 'F', in3d: true },
  { id: 'label', icon: 'i-label', label: 'Add a label', short: 'Label', key: 'L' },
  { id: 'dimension', icon: 'i-dimension', label: 'Add a dimension', short: 'Dimension', key: 'M' },
  { id: 'measure', icon: 'i-measure', label: 'Measure a distance', short: 'Measure', key: 'Q' },
  { sep: true },
  { id: 'erase', icon: 'i-erase', label: 'Delete by clicking', short: 'Erase', key: 'E' },
];

// Toggles that start out on, so an absent flag still reads as ticked.
// What can be shown or hidden. The popover renders it and the command palette reads
// it, so a new flag turns up in both places by adding it here once.
const VIEW_GROUPS = [
  {
    label: 'The drawing',
    items: [
      ['rooms', 'Room tints, names and areas'],
      ['dimensions', 'Dimension lines you placed'],
      ['autoDims', 'Dimension chains round the building'],
      ['angles', 'Angles at corners that are not square'],
      ['labels', 'Labels'],
      ['openingSizes', 'Opening widths'],
      ['openingMarks', 'Opening marks (D1, W1)'],
      ['levels', 'Höhenkoten — the floor level'],
    ],
  },
  {
    label: 'What is in it',
    items: [
      ['furniture', 'Furniture'],
      ['fixtures', 'Sockets, switches and lights'],
    ],
  },
  {
    label: 'Walls and stairs',
    items: [
      ['wallHeights', 'Height of any knee wall'],
      ['allWallHeights', 'Height of every wall'],
      ['stairCut', 'Break stairs at the cut plane'],
      ['stairNumbers', 'Number the steps'],
    ],
  },
  {
    label: 'Underneath',
    items: [
      ['clearances', 'Door swings and clearances'],
      ['guides', 'Guides'],
      ['floorBelow', 'The floor below'],
      ['backdrop', 'Traced plan'],
    ],
  },
];

const DEFAULT_ON = new Set(['rooms', 'dimensions', 'labels', 'furniture', 'fixtures', 'backdrop', 'guides', 'autoDims', 'angles', 'openingMarks', 'levels']);

const HINTS = {
  wall: 'Click to start, click each corner. Type a length and angle for exact walls. Esc ends the run.',
  rect: 'Drag out a room, or click two opposite corners. Type its width and depth for an exact size.',
  door: 'Click on a wall. Drag the door along the wall, and use the panel to change size or swing.',
  window: 'Click on a wall. Sizes and sill height are in the panel on the right.',
  opening: 'Click on a wall to cut a plain opening with no door.',
  trim: 'Click the wall to change, near the end that should move. Then click the wall to meet.',
  split: 'Click a wall where it should be cut in two.',
  stair: 'Click where the bottom step starts. The rise comes from the storey height; R turns it.',
  column: 'Click to drop a column. R turns it.',
  void: 'Click to cut a hole in this floor — a stair well. The stair below it then has somewhere to come up.',
  fixture: 'Pick a fixture on the right, then click near a wall — it mounts on the face you clicked.',
  furniture: 'Pick a piece on the right, then click to place it. R rotates the selection.',
  label: 'Click where the text should sit.',
  dimension: 'Click the two points to measure, then drag the line to set its distance from the wall.',
  measure: 'Click two points. The distance is shown until you press Esc.',
  erase: 'Click anything to delete it.',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function icon(id, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export class App {
  constructor(root = document) {
    this.root = root;
    this.canvas = root.querySelector('#board');
    this.canvasWrap = root.querySelector('#canvas-wrap');
    this.inspector = root.querySelector('#inspector');
    this.railEl = root.querySelector('#rail');
    this.statusEl = root.querySelector('#statusbar');
    this.hintEl = root.querySelector('#hint');
    this.flashEl = root.querySelector('#flash');
    this.numericEl = root.querySelector('#numeric');
    this.fileInput = root.querySelector('#file-input');
    this.optbarEl = root.querySelector('#optbar');
    this.stageEl = root.querySelector('#stage');
    this.rulerH = root.querySelector('#ruler-h');
    this.rulerV = root.querySelector('#ruler-v');
    this.drawerEl = root.querySelector('#settings-drawer');

    this.store = new Store(createProject({ now: Date.now() }));
    // Every edit ends with the junctions made real, so a partition drawn onto the
    // middle of a wall is joined to it from that moment on.
    this.store.afterEdit = (project) => healProject(project);
    Object.assign(this.store.state, {
      tool: 'rect',
      // Off, because a free angle now rounds to 3° rather than running loose, so a
      // square building is still easy to draw without being held to ninety. The lock
      // is still there (\) for when only right angles will do.
      orthoLock: false,
      gridMm: 50,
      newWall: { type: 'exterior', thickness: wallTypeFor('exterior').thickness },
      newOpening: defaultsFor('door'),
      pendingFurniture: null,
    });
    this.renderer = new Renderer(this.canvas);
    this.interaction = new Interaction({
      store: this.store,
      renderer: this.renderer,
      canvas: this.canvas,
      ui: {
        requestRender: () => this.requestFrame(),
        flash: (msg) => this.flash(msg),
        onRenameRoom: (id) => this.renameRoom(id),
        onEditLabel: (id) => this.editLabel(id),
        requestLabel: (point) => this.createLabel(point),
        onDraftChange: (draft) => {
          this.renderNumeric(draft);
          this.renderHint();
        },
        onMeasured: () => {
          if (this.calibrating) this.offerCalibration();
        },
      },
    });
    this.frame = null;
    this.pendingPages = null;
    this.mode = '2d';
    this.canvas3d = root.querySelector('#board3d');
    this.marks3d = root.querySelector('#board3d-marks');
    this.view3d = new View3D(this.canvas3d);
    // The context can be taken away — a machine waking from sleep is enough. Say so
    // rather than showing a blank rectangle, and rebuild when it comes back.
    this.view3d.onContextLost = () => {
      this.meshVersion = null;
      const note = this.root.querySelector('#view3d-note');
      if (note && this.mode === '3d') {
        note.hidden = false;
        note.textContent = 'The 3D view lost its graphics context. It comes back on its own — the drawing is safe.';
      }
    };
    this.view3d.onContextRestored = () => {
      const note = this.root.querySelector('#view3d-note');
      if (note) note.hidden = true;
      this.meshVersion = null;
      if (this.mode === '3d') this.rebuildMesh(true);
      this.requestFrame();
    };
    this.meshVersion = null;
    this.showRulers = true;
    this.show3dMarks = true;
    this.outlined3d = true;
    this.view3d.outlined = true;
    this.washed3d = true;
    this.sunDate = { month: 6, day: 21 };
    this.sunTime = 15 * 60;
    // The file this drawing came from, if any, and whether it has moved on since.
    this.file = null;
    this.dirty = false;
    this.cursor = null; // world position, for the marks on the rulers
    this.shiftHeld = false;
    this.cursorKey = null; // what the cursor says now, so it is only rewritten when it changes
    this.liveFields = []; // panel inputs that follow the drawing while a gesture runs
    this.glyphs = new Map();
    this.viewPopover = null;
    // Walking about inside the model: where you are, which keys are down, and the
    // animation that keeps you moving while they are.
    this.walking = null;
    this.walkKeys = new Set();
    this.walkFrame = null;
  }

  /**
   * Stand inside the drawing, or stop standing in it.
   *
   * A plan gives the sizes and the model gives the shape, but neither tells you what it
   * is like to be in the room — whether the hall is mean, whether you can see the
   * garden from the kitchen door. That is the one question a drawing cannot answer.
   */
  setWalking(on) {
    if (on && this.mode !== '3d') this.setMode('3d');
    if (on === Boolean(this.walking)) return;
    if (!on) {
      this.walking = null;
      this.walkKeys.clear();
      if (this.walkFrame) cancelAnimationFrame(this.walkFrame);
      this.walkFrame = null;
      this.view3d.walk(null);
      if (document.pointerLockElement === this.canvas3d) document.exitPointerLock?.();
      this.renderViewHelp();
      this.renderAll();
      return;
    }
    const plan = activePlan(this.store.project);
    const start = startingPoint(plan, derived(plan).rooms);
    this.walking = {
      x: start.x,
      y: start.y,
      z: planElevation(this.store.project, plan) + EYE,
      yaw: start.yaw,
      pitch: 0,
      last: null,
    };
    this.walkBlockers = walkBlockers(plan);
    this.view3d.walk(this.walking);
    this.canvas3d.requestPointerLock?.();
    this.renderViewHelp();
    this.renderAll();
    this.requestFrame();
  }

  /**
   * Put the walker back in step with the drawing.
   *
   * The blockers and the eye height both belong to the floor being shown, so both are
   * taken again. If the drawing has moved out from under the walker — a floor with no
   * walls at all — walking stops rather than leaving you in a void.
   */
  refreshWalk() {
    if (!this.walking) return;
    const plan = activePlan(this.store.project);
    this.walkBlockers = walkBlockers(plan);
    const floor = planElevation(this.store.project, plan);
    this.walking.z = floor + EYE;
    if (!plan.walls.length) {
      this.setWalking(false);
      this.flash('Nothing to walk about in on this floor.');
    }
  }

  /** One frame of walking: whatever keys are down, for however long the frame took. */
  stepWalk(now) {
    this.walkFrame = null;
    if (!this.walking) return;
    const held = this.walkKeys;
    const last = this.walking.last ?? now;
    // Capped, or a tab left in the background comes back with one enormous stride.
    const seconds = Math.min(0.1, (now - last) / 1000);
    this.walking.last = now;

    const ahead = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
    const side = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    if (ahead || side) {
      const pace = (held.has('shift') ? HURRY : PACE) * seconds;
      const yaw = this.walking.yaw;
      const len = Math.hypot(ahead, side) || 1;
      // Right is forward turned towards it, which with z up is forward × up —
      // (sin, −cos), not (−sin, cos). Written the other way round D strafed left and A
      // strafed right, which is unusable and takes about two steps to notice.
      const dx = (Math.cos(yaw) * ahead + Math.sin(yaw) * side) / len;
      const dy = (Math.sin(yaw) * ahead - Math.cos(yaw) * side) / len;
      const from = { x: this.walking.x, y: this.walking.y };
      const to = { x: from.x + dx * pace, y: from.y + dy * pace };
      const at = stepTo(this.walkBlockers ?? [], from, to);
      this.walking.x = at.x;
      this.walking.y = at.y;
      this.view3d.walk(this.walking);
      this.requestFrame();
    }
    if (held.size) this.walkFrame = requestAnimationFrame((t) => this.stepWalk(t));
  }

  /** Keep walking while anything is held down. */
  walkOn() {
    if (this.walking && !this.walkFrame) {
      this.walking.last = null;
      this.walkFrame = requestAnimationFrame((t) => this.stepWalk(t));
    }
  }

  async start() {
    this.buildRail();
    this.bindEvents();
    const saved = await this.store
      .load()
      // Storage may hold a project saved by an older version of this page.
      .then((project) => (project ? normaliseProject(project) : null))
      .catch(() => null);
    if (saved?.plans?.some((p) => p.walls.length || p.backdrop?.kind)) {
      this.store.replaceProject(saved, { record: false });
      this.reportDropped(saved);
      this.flash('Restored your last drawing.');
    }
    this.store.subscribe((state, reason) => {
      if (reason === 'edit') {
        this.reportHealing(state.lastHeal);
        // Anything that changes the drawing puts the file out of date with it.
        this.dirty = true;
        this.renderTitle();
      }
      this.renderAll();
    });
    // The browser will not let a page stop you leaving, but it will let it ask.
    window.addEventListener('beforeunload', (event) => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
    this.renderAll();
    this.renderTitle();
    this.fitView();
  }

  // ---- chrome ---------------------------------------------------------

  buildRail() {
    const nodes = [];
    for (const tool of TOOLS) {
      if (tool.sep) {
        nodes.push(el('div', { class: 'rail-sep' }));
        continue;
      }
      nodes.push(
        el(
          'button',
          {
            class: 'tool',
            type: 'button',
            title: `${tool.label} (${tool.key})`,
            'aria-label': tool.label,
            dataset: { tool: tool.id, key: tool.key },
            onclick: () => this.setTool(tool.id),
          },
          [icon(tool.icon)]
        )
      );
    }
    nodes.push(el('div', { class: 'rail-sep' }));
    nodes.push(
      el(
        'button',
        {
          class: 'tool',
          type: 'button',
          title: 'Zoom to fit (0)',
          'aria-label': 'Zoom to fit',
          onclick: () => this.fitView(),
        },
        [icon('i-fit')]
      )
    );
    this.railEl.replaceChildren(...nodes);
  }

  bindEvents() {
    const wrap = this.canvasWrap;
    wrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      wrap.classList.add('dropping');
    });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('dropping'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('dropping');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.handleFile(file);
    });
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) this.handleFile(file);
    });

    this.root.querySelector('#undo').addEventListener('click', () => this.store.undo());
    this.root.querySelector('#redo').addEventListener('click', () => this.store.redo());
    this.root.querySelector('#export-btn').addEventListener('click', () => this.showExportDialog());
    this.root.querySelector('#import-btn').addEventListener('click', () => this.fileInput.click());
    this.root.querySelector('#open-file-btn').addEventListener('click', () => this.openDocument());
    this.root.querySelector('#save-file-btn').addEventListener('click', () => this.saveDocument());
    this.root.querySelector('#new-btn').addEventListener('click', () => this.confirmNew());
    this.root.querySelector('#help-btn').addEventListener('click', () => this.showShortcuts());
    this.root.querySelector('#settings-btn').addEventListener('click', () => this.toggleSettings());
    this.root.querySelector('#view-btn').addEventListener('click', () => this.toggleViewPopover());
    this.root.querySelector('#ruler-corner').addEventListener('click', () => {
      const plan = activePlan(this.store.project);
      if (!(plan.guides ?? []).length) {
        this.flash('Drag off a ruler to pull out a guide; this clears them again.');
        return;
      }
      this.store.edit('clear guides', (project) => clearGuides(activePlan(project)));
      this.flash('Guides cleared.');
    });
    this.bindRulers();
    for (const button of this.root.querySelectorAll('#view-switch .switch-btn')) {
      button.addEventListener('click', () => this.setMode(button.dataset.mode));
    }
    this.bind3dEvents();
    this.bindRadar();
    this.root.querySelector('#panel-toggle').addEventListener('click', () => {
      this.inspector.classList.toggle('open');
    });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.pendingFit) this.fitView();
      this.requestFrame();
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        const changed = this.renderer.resize();
        if (this.pendingFit) this.fitView();
        else if (changed) this.requestFrame();
      }).observe(this.canvasWrap);
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      this.renderer.refreshTheme();
      this.requestFrame();
    });
    new MutationObserver(() => {
      this.renderer.refreshTheme();
      this.requestFrame();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      if (this.walking) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const walkKey = { w: 'w', a: 'a', s: 's', d: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd' }[key];
        if (e.key === 'Shift') this.walkKeys.delete('shift');
        else if (walkKey) this.walkKeys.delete(walkKey);
      }
      if (e.code === 'Space') {
        this.interaction.spaceHeld = false;
        this.applyCursor();
      }
      if (e.key === 'Shift') {
        this.shiftHeld = false;
        this.applyCursor();
      }
      if (e.key === 'Alt') {
        this.altHeld = false;
        this.renderViewHelp();
        this.applyCursor();
      }
    });
    window.addEventListener('blur', () => {
      // Nothing is held any more, and no key-up is coming to say so.
      this.altHeld = false;
      this.shiftHeld = false;
      this.interaction.spaceHeld = false;
      this.applyCursor();
    });
  }

  onKeyDown(event) {
    // Walking takes the keyboard: W is not the wall tool while you are in the building.
    if (this.walking) {
      if (event.key === 'Escape') {
        this.setWalking(false);
        return;
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const walkKey = { w: 'w', a: 'a', s: 's', d: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd' }[key];
      if (walkKey || event.key === 'Shift') {
        if (event.key === 'Shift') this.walkKeys.add('shift');
        else this.walkKeys.add(walkKey);
        this.walkOn();
        event.preventDefault();
        return;
      }
      return;
    }

    const typing =
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName) || event.target?.isContentEditable === true;
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === 'Alt') {
      this.altHeld = true;
      this.renderViewHelp();
      this.applyCursor();
    }
    if (event.key === 'Shift') {
      this.shiftHeld = true;
      this.applyCursor();
    }

    // A field that has the focus owns the keyboard. This guard used to be tested
    // after the ⌘ shortcuts, so undoing while renaming a room undid the drawing
    // rather than the typing, and select-all took the whole plan instead of the text.
    // Only the commands with no meaning in a text box are taken from it.
    if (typing) {
      const app = meta && ['s', 'o', 'k'].includes(event.key.toLowerCase());
      if (!app) {
        if (event.key === 'Escape') {
          event.target.blur();
          this.renderNumeric(this.interaction.draft);
        }
        return;
      }
    }

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveDocument(event.shiftKey);
      return;
    }
    if (meta && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      this.openDocument();
      return;
    }
    if (meta && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.showPalette();
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.interaction.selectAll();
      return;
    }
    if (meta && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.interaction.duplicateSelection();
      return;
    }
    if (event.code === 'Space') {
      // A focused control owns the space bar: it is how a button is pressed without
      // a mouse. Swallowing it here made every button in the app unusable from the
      // keyboard, which is not a trade worth making for a panning modifier.
      if (event.target?.closest?.('button, [role="button"], a[href], summary')) return;
      this.interaction.spaceHeld = true;
      this.applyCursor();
      event.preventDefault();
      return;
    }
    // Typing a digit while drawing jumps straight into the length field.
    if (this.interaction.draft && /^[0-9.,]$/.test(event.key)) {
      const input = this.numericEl.querySelector('input');
      if (input) {
        input.value = event.key === ',' ? '.' : event.key;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'Escape') {
      if (this.closeModal()) return;
      if (this.interaction.cancelDraft()) return;
      this.store.set({ selection: [] });
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.interaction.deleteSelection();
      return;
    }
    if (event.key === '0') {
      // Nought only. It also answered to F, which is the furniture tool's own key and
      // is reached further down — so the tool the rail advertises as F could never be
      // picked up with it, and the drawing zoomed to fit instead.
      if (this.mode === '3d') this.rebuildMesh(true);
      else this.fitView();
      this.requestFrame();
      return;
    }
    if (event.key === '3') {
      this.setMode(this.mode === '3d' ? '2d' : '3d');
      return;
    }
    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      event.preventDefault();
      this.showShortcuts();
      return;
    }
    if (event.key === ',') {
      event.preventDefault();
      this.toggleSettings();
      return;
    }
    if (event.key === 'y' || event.key === 'Y') {
      event.preventDefault();
      this.toggleViewPopover();
      return;
    }
    if (event.key === 'R' && event.shiftKey) {
      event.preventDefault();
      this.showRulers = !this.showRulers;
      this.renderAll();
      this.flash(this.showRulers ? 'Rulers on' : 'Rulers off');
      return;
    }
    if (event.key === 'o' || event.key === 'O' || event.key === 'F8') {
      event.preventDefault();
      this.store.set({ orthoLock: !this.store.state.orthoLock });
      this.flash(this.store.state.orthoLock ? 'Ortho lock on' : 'Ortho lock off');
      return;
    }
    if (event.key === 'g' || event.key === 'G') {
      this.store.set({ snapEnabled: !this.store.state.snapEnabled });
      this.flash(this.store.state.snapEnabled ? 'Snapping on' : 'Snapping off');
      return;
    }
    if (event.key === 'j' || event.key === 'J') {
      this.interaction.joinSelected();
      return;
    }
    if (event.key === 'r' && this.store.state.selection.some((s) => s.kind === 'furniture')) {
      // In 3D the interaction layer is not the one holding the selection, so the
      // turning is done here and both views get it.
      if (this.mode === '3d') this.rotateFurniture(event.shiftKey ? -90 : 90);
      else this.interaction.rotateSelection(event.shiftKey ? -90 : 90);
      return;
    }
    // Only while an opening is selected, or these swallow the tool keys behind them —
    // H is the floor-opening tool — for a command with nothing to act on.
    const flippable = this.store.state.selection.some((s) => s.kind === 'opening');
    if (flippable && (event.key === 'h' || event.key === 'H')) {
      this.interaction.flipSelectedOpenings('hinge');
      return;
    }
    if (flippable && (event.key === 'b' || event.key === 'B')) {
      this.interaction.flipSelectedOpenings('swing');
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      this.interaction.nudge(...arrows[event.key]);
      return;
    }
    const tool = TOOLS.find((t) => !t.sep && t.key.toLowerCase() === event.key.toLowerCase());
    if (tool) this.setTool(tool.id);
  }

  /** Whether a tool can do anything in the view that is up. */
  toolWorksHere(id) {
    if (this.mode !== '3d') return true;
    return Boolean(TOOLS.find((t) => !t.sep && t.id === id)?.in3d);
  }

  setTool(id) {
    if (!this.toolWorksHere(id)) {
      const tool = TOOLS.find((t) => !t.sep && t.id === id);
      this.flash(`${tool?.short ?? 'That tool'} needs the plan — switch back to draw.`);
      return;
    }
    this.interaction.cancelDraft();
    // Picking a tool means the user is ready to draw, so the opening card gets
    // out of the way instead of covering the middle of the canvas.
    this.startDismissed = true;
    this.store.set({ tool: id });
  }

  // ---- render loop ----------------------------------------------------

  // ---- 3D ------------------------------------------------------------

  setMode(mode) {
    this.mode = mode === '3d' ? '3d' : '2d';
    const is3d = this.mode === '3d';
    // A tool the model cannot carry out does not stay in your hand across the switch,
    // or the rail shows a tool that is off and pressed at the same time.
    if (is3d && !this.toolWorksHere(this.store.state.tool)) {
      this.interaction.cancelDraft();
      this.store.set({ tool: 'select' });
    }
    this.canvas.hidden = is3d;
    this.canvas3d.hidden = !is3d;
    if (this.marks3d) this.marks3d.hidden = !is3d;
    // Hidden while the model is up, and put back in the hands of whatever owns them
    // when the plan returns. Written as `hidden || is3d` these only ever went one way:
    // once the model had hidden them, coming back left them hidden.
    if (is3d) {
      this.numericEl.hidden = true;
      this.hintEl.hidden = true;
    }
    for (const button of this.root.querySelectorAll('#view-switch .switch-btn')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    }
    const note = this.root.querySelector('#view3d-note');
    if (is3d) {
      this.applySun();
      this.renderViewHelp();
      if (!this.view3d.init()) {
        note.hidden = false;
        note.textContent = `3D is not available here: ${this.view3d.failure}`;
      } else {
        note.hidden = true;
        this.rebuildMesh(true);
      }
    } else {
      note.hidden = true;
    }
    // Both ways round: the card and the radar belong to the 3D view and have to go
    // when it does, not only turn up when it arrives.
    this.renderViewHelp();
    this.drawRadar();
    // Everything, not a chosen few. Switching view changes what the options bar, the
    // hint, the rail and the numeric entry should each be showing, and picking off the
    // three that came to mind left the bar describing the view you had just left.
    this.renderAll();
  }


  /**
   * Pulling a guide off a ruler.
   *
   * Dragging down off the top bar leaves a horizontal line behind, dragging out of
   * the side bar a vertical one — the way every drawing program does it. The guide
   * exists from the first move, so it can be seen while it is being placed, and
   * letting go back on the ruler throws it away again.
   */
  bindRulers() {
    for (const [bar, axis] of [
      [this.rulerH, 'y'],
      [this.rulerV, 'x'],
    ]) {
      if (!bar) continue;
      let dragging = null;
      bar.addEventListener('pointerdown', (event) => {
        if (this.mode !== '2d') return;
        bar.setPointerCapture(event.pointerId);
        dragging = { id: null };
        event.preventDefault();
      });
      bar.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const at = this.worldFromRuler(axis, event);
        const plan = activePlan(this.store.project);
        if (!dragging.id) {
          const guide = addGuide(plan, axis, at);
          dragging.id = guide?.id ?? null;
          if (dragging.id) this.store.set({ selection: [{ kind: 'guide', id: dragging.id }] });
        } else {
          const guide = findGuide(plan, dragging.id);
          if (guide) guide.at = Math.round(at);
        }
        touch(plan);
        this.requestFrame();
      });
      const finish = (event) => {
        if (!dragging) return;
        const id = dragging.id;
        dragging = null;
        if (!id) return;
        // Let go still over the ruler and the guide is dropped rather than placed.
        const box = bar.getBoundingClientRect();
        const inside =
          event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
        const plan = activePlan(this.store.project);
        const guide = findGuide(plan, id);
        const at = guide?.at ?? 0;
        removeGuide(plan, id);
        this.store.set({ selection: [] });
        if (!inside) {
          this.store.edit('add a guide', (project) => Boolean(addGuide(activePlan(project), axis, at)));
        } else {
          touch(plan);
          this.requestFrame();
        }
      };
      bar.addEventListener('pointerup', finish);
      bar.addEventListener('pointercancel', finish);
    }
  }

  /**
   * Where a point on a ruler falls in the drawing, taken to the grid — a guide at
   * 808 mm is no use to anybody, one at 800 is.
   */
  worldFromRuler(axis, event) {
    const view = this.store.state.view;
    const board = this.canvas.getBoundingClientRect();
    const raw =
      axis === 'x' ? (event.clientX - board.left) / view.scale + view.x : (event.clientY - board.top) / view.scale + view.y;
    const grid = this.store.state.snapEnabled === false ? 0 : this.store.state.gridMm || 0;
    return grid ? Math.round(raw / grid) * grid : Math.round(raw);
  }

  /** Rebuilds the 3D model when the drawing has changed under it. */
  rebuildMesh(reframe = false) {
    if (this.mode !== '3d' || !this.view3d.gl) return;
    const project = this.store.project;
    const signature =
      project.plans.map((p) => `${p.id}:${p.version}`).join('|') +
      `/${this.themeName()}/${this.only3dFloor ? activePlan(project).id : 'all'}`;
    if (!reframe && signature === this.meshVersion) return;
    this.meshVersion = signature;
    const theme = this.themeName();
    const mesh = buildMesh(project, {
      theme,
      onlyPlanId: this.only3dFloor ? activePlan(project).id : null,
    });
    const bounds = meshBounds(mesh);
    const paper = this.renderer.theme.paper;
    this.view3d.setTheme(theme, cssToRgb(paper) ?? (theme === 'dark' ? [0.06, 0.09, 0.1] : [0.93, 0.94, 0.95]));
    this.view3d.setMesh(mesh);
    this.view3d.setGrid(bounds);
    if (reframe) this.view3d.frame(bounds);
    if (!mesh.count) {
      const note = this.root.querySelector('#view3d-note');
      note.hidden = false;
      note.textContent = 'Nothing to show yet — draw some walls and they will stand up here.';
    } else {
      this.root.querySelector('#view3d-note').hidden = true;
    }
  }

  themeName() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Moving about in 3D, using the habits Blender and 3ds Max share.
   *
   * Scroll zooms towards whatever is under the pointer rather than the middle of
   * the screen, which is the thing that makes a viewport feel like a viewport. The
   * rest is bound both ways round, because the two programs disagree about the
   * middle button and muscle memory is not worth arguing with:
   *
   *   drag                orbit          (and Alt-drag, for Max and Maya hands)
   *   middle-drag         pan            (Max) — Shift with it orbits, as Blender does
   *   Shift-drag          pan
   *   right-drag, Ctrl    dolly
   *   scroll              zoom to the pointer
   *   double-click, F, 0  frame it all
   */
  /**
   * What the 3D view responds to, for whatever is going on right now.
   *
   * The controls change depending on whether a piece is picked, and a card that said
   * the same thing either way would be a card nobody reads. `live` is whichever row
   * is happening at this moment, which is what makes it worth looking at while you
   * are in the middle of a drag.
   */
  renderViewHelp() {
    const card = this.root.querySelector('#view3d-help');
    if (!card) return;
    if (this.mode !== '3d') {
      card.hidden = true;
      return;
    }
    const picked = this.store.state.selection.some((s) => s.kind === 'furniture');
    const doing = this.doing3d ?? null;
    const placing = this.store.state.tool === 'furniture' && !picked;
    if (this.walking) {
      card.hidden = false;
      card.replaceChildren(
        el('h3', { text: 'Walking about' }),
        el('div', { class: 'help-rows' }, [
          ['W A S D', 'Walk', this.walkKeys.size > 0],
          ['Mouse', 'Look around', false],
          ['⇧', 'Hurry', this.walkKeys.has('shift')],
          ['Esc', 'Stand back and look at it', false],
        ].flatMap(([key, what, live]) => [
          el('span', { class: `help-key${live ? ' live' : ''}`, text: key }),
          el('span', { class: 'help-what', text: what }),
        ]))
      );
      return;
    }
    const rows = placing
      ? [
          ['Click', 'Put one down here', false],
          ['Drag', 'Turn the model', doing === 'orbit'],
          ['⇧-drag', 'Slide it', doing === 'pan'],
          ['Scroll', 'Zoom where you point', false],
          ['V', 'Back to picking things up', false],
        ]
      : picked
      ? [
          ['Drag', 'Move it on the floor', doing === 'move'],
          ['Alt-drag', 'Turn it', doing === 'turn'],
          ['R / ⇧R', 'Turn a quarter', false],
          ['⌫', 'Take it out', false],
          ['Esc', 'Let go of it', false],
        ]
      : [
          ['Drag', 'Turn the model', doing === 'orbit'],
          ['⇧-drag', 'Slide it', doing === 'pan'],
          ['⌃-drag', 'In and out', doing === 'dolly'],
          ['Scroll', 'Zoom where you point', false],
          ['Click', 'Pick a piece of furniture', false],
        ];
    card.replaceChildren(
      el('h3', { text: placing ? 'Placing furniture' : picked ? 'The piece you picked' : 'Getting about' }),
      el(
        'div',
        { class: 'help-rows' },
        rows.flatMap(([key, what, live]) => [
          el('span', { class: `help-key${live ? ' live' : ''}`, text: key }),
          el('span', { class: 'help-what', text: what }),
        ])
      )
    );
    card.hidden = false;
  }

  /**
   * A small plan of the drawing, with the picked piece marked on it.
   *
   * Placing furniture in a perspective view is guesswork: the far end of a room is
   * smaller than the near end and nothing is square to anything. A plan alongside
   * says where the thing actually is, and the wedge shows which way you are looking
   * so the two views can be told apart at a glance.
   */
  drawRadar() {
    const host = this.root.querySelector('#radar');
    const canvas = this.root.querySelector('#radar-canvas');
    const label = this.root.querySelector('#radar-label');
    if (!host || !canvas) return;
    const plan = activePlan(this.store.project);
    const picked = this.store.state.selection.find((s) => s.kind === 'furniture');
    const item = picked ? (plan.furniture ?? []).find((f) => f.id === picked.id) : null;
    if (this.mode !== '3d' || !item) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 190;
    const h = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // The scale comes from the building, not from everything in the drawing. Fitting
    // the lot means dragging a piece out of the front door zooms the whole radar out
    // to keep it in frame, and the plan you were working against shrinks away from
    // under you. The building does not move, so neither does the scale.
    const bounds = buildingBounds(plan);
    const pad = 10;
    const scale = Math.min((w - pad * 2) / Math.max(1, bounds.width), (h - pad * 2) / Math.max(1, bounds.height));

    // Centred on the building, and slid along only as far as it takes to keep the
    // piece you are holding on the radar.
    //
    // Held still while it is being dragged on, though. The pan follows the piece, and
    // if the mapping moves under the cursor mid-drag then the piece is somewhere else
    // next time the pointer is read — which moves it further, which pans further. It
    // ran away down the room from a nudge.
    let ox;
    let oy;
    if (this.radarHeld) {
      ({ ox, oy } = this.radarHeld);
    } else {
      let cx = bounds.minX + bounds.width / 2;
      let cy = bounds.minY + bounds.height / 2;
      const reachX = (w / 2 - pad * 2) / scale;
      const reachY = (h / 2 - pad * 2) / scale;
      cx = Math.min(Math.max(cx, item.x - reachX), item.x + reachX);
      cy = Math.min(Math.max(cy, item.y - reachY), item.y + reachY);
      ox = w / 2 - cx * scale;
      oy = h / 2 - cy * scale;
    }
    const at = (p) => [ox + p.x * scale, oy + p.y * scale];
    // Kept so the radar can be worked on as well as looked at.
    this.radarView = { scale, ox, oy };
    const theme = this.renderer.theme;

    // What the camera can see, laid down first so the plan is drawn over it. Put on
    // top it flattened everything underneath; put underneath it can be as wide as it
    // really is and still read as a beam of attention rather than as a wash.
    const eye = this.view3d.eye();
    const target = this.view3d.camera.target;
    const look = Math.atan2(target[1] - eye[1], target[0] - eye[0]);
    const aspect = Math.max(0.2, this.view3d.width / Math.max(1, this.view3d.height));
    const spread = Math.atan(Math.tan((FOV_DEG * Math.PI) / 360) * aspect);
    let [ex, ey] = at({ x: eye[0], y: eye[1] });
    // A camera outside the radar is pulled to its edge, so the beam always has a
    // visible source and you can see which side you are standing on.
    const edge = 9;
    ex = Math.max(edge, Math.min(w - edge, ex));
    ey = Math.max(edge, Math.min(h - edge, ey));
    const far = Math.hypot(w, h);
    const beam = ctx.createRadialGradient(ex, ey, 0, ex, ey, far);
    beam.addColorStop(0, theme.accent);
    beam.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.arc(ex, ey, far, look - spread, look + spread);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const ring = (points, fill, stroke, width) => {
      if (points.length < 3) return;
      ctx.beginPath();
      points.forEach((p, i) => {
        const [x, y] = at(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width ?? 1;
        ctx.stroke();
      }
    };

    for (const room of derived(plan).rooms) ring(room.inner, theme.roomFill, null);
    for (const wall of phaseWalls(plan)) {
      const corners = wallCorners(plan, wall);
      if (corners) ring(corners, theme.ink, null);
    }
    // The openings, as gaps in the walls with a line across a window — the same way
    // the plan shows them, so the two read as the same drawing.
    for (const opening of plan.openings ?? []) {
      if (!inPhase(plan, opening.wallId)) continue;
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const half = geo.thickness * 0.55;
      const hole = [
        { x: geo.x1 + geo.nx * half, y: geo.y1 + geo.ny * half },
        { x: geo.x2 + geo.nx * half, y: geo.y2 + geo.ny * half },
        { x: geo.x2 - geo.nx * half, y: geo.y2 - geo.ny * half },
        { x: geo.x1 - geo.nx * half, y: geo.y1 - geo.ny * half },
      ];
      ring(hole, theme.surface, null);
      if ((opening.kind ?? 'door') === 'window') {
        const [ax, ay] = at({ x: geo.x1, y: geo.y1 });
        const [bx, by] = at({ x: geo.x2, y: geo.y2 });
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // The room names, faint, so you can tell which room you are working in without
    // them competing with the thing you are moving.
    ctx.font = `9px ${theme.sans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.muted;
    ctx.globalAlpha = 0.75;
    for (const room of derived(plan).rooms) {
      if (room.kept === false || !room.name) continue;
      const [tx, ty] = at(room.centroid);
      ctx.fillText(room.name, tx, ty);
    }
    ctx.globalAlpha = 1;

    // Everything else in the room, quietly, so the picked piece has somewhere to be.
    for (const other of plan.furniture ?? []) {
      if (other.id === item.id) continue;
      ring(furnitureFootprint(other), null, theme.muted, 0.8);
    }
    ring(furnitureFootprint(item), theme.selectSoft ?? 'rgba(184,96,26,0.35)', theme.select, 1.6);

    // And where you are standing.
    ctx.fillStyle = theme.accent;
    ctx.strokeStyle = theme.surface;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (label) {
      const spec = furnitureById(item.kind ?? item.id);
      // Where it is as well as which way it faces: the two things you are adjusting.
      // Filtered, because replaceChildren turns a null into the word "null".
      label.replaceChildren(
        ...[
          el('b', { text: spec?.label ?? 'Piece' }),
          el('span', {
            text: `${Math.round(item.rotation ?? 0)}° · ${formatLength(Math.round(item.x))} / ${formatLength(Math.round(item.y))}`,
          }),
          // What it caught on, while it is being dragged, so the snap is not a
          // mystery. Always drawn, empty or not: the radar sits on the bottom of the
          // window, so a line that comes and goes shoves the whole thing up and down
          // while you are trying to aim with it.
          el('span', {
            class: 'radar-snap',
            text: this.doing3d === 'move' && this.snappedTo?.length ? `against ${this.snappedTo.join(' and ')}` : '\u00a0',
          }),
        ].filter(Boolean)
      );
    }
  }

  /**
   * The radar is worked on, not just looked at.
   *
   * Placing something by dragging it in perspective is fiddly at the far end of a
   * room, where a millimetre of cursor is a lot of floor. On the plan it is the same
   * everywhere, so the same drag is done here with a steady hand — and it is the same
   * edit, so the two views never disagree about where a thing ended up.
   */
  bindRadar() {
    const canvas = this.root.querySelector('#radar-canvas');
    if (!canvas) return;
    let drag = null;
    const toWorld = (event) => {
      const view = this.radarView;
      if (!view) return null;
      const box = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - box.left - view.ox) / view.scale,
        y: (event.clientY - box.top - view.oy) / view.scale,
      };
    };

    canvas.addEventListener('pointerdown', (event) => {
      // The radar sits over the 3D canvas, and a click that fell through to it used
      // to reframe the whole view.
      event.stopPropagation();
      event.preventDefault();
      const at = toWorld(event);
      if (!at) return;
      const plan = activePlan(this.store.project);
      // Last drawn is nearest the top, so the search runs backwards.
      const under = [...(plan.furniture ?? [])].reverse().find((f) => pointInPolygon(at.x, at.y, furnitureFootprint(f)));
      if (!under) return;
      canvas.setPointerCapture(event.pointerId);
      this.store.set({ selection: [{ kind: 'furniture', id: under.id }] });
      // The view is pinned for the length of the drag, so what is under the cursor
      // stays under the cursor.
      this.radarHeld = { ...this.radarView };
      drag = {
        id: under.id,
        grab: [at.x - under.x, at.y - under.y],
        from: { x: under.x, y: under.y, rotation: under.rotation ?? 0 },
        turnFrom: null,
      };
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      event.stopPropagation();
      if (event.altKey || this.altHeld) {
        const from = drag.turnFrom ?? event.clientX;
        drag.turnFrom = from;
        this.turnFurniture(drag.id, drag.from.rotation + Math.round(((event.clientX - from) * 0.9) / 15) * 15);
        this.doing3d = 'turn';
      } else {
        drag.turnFrom = null;
        const at = toWorld(event);
        const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === drag.id);
        if (at && item) {
          const placed = this.snapPlacement(item, at.x - drag.grab[0], at.y - drag.grab[1]);
          this.moveFurniture(drag.id, placed.x, placed.y);
          this.turnFurniture(drag.id, placed.rotation);
        }
        this.doing3d = 'move';
      }
      this.renderViewHelp();
    });

    const stop = (event) => {
      if (!drag) return;
      event?.stopPropagation();
      this.commitFurnitureMove(drag.id, drag.from);
      drag = null;
      this.radarHeld = null;
      this.doing3d = null;
      this.renderViewHelp();
      canvas.style.cursor = 'crosshair';
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    // Nothing here should reach the view underneath.
    for (const kind of ['wheel', 'dblclick', 'contextmenu']) {
      canvas.addEventListener(kind, (e) => e.stopPropagation(), { passive: false });
    }
  }

  /**
   * The piece of furniture under the cursor in the 3D view, nearest first.
   *
   * Each piece is a box on the floor, so the ray from the eye is clipped against each
   * one in turn and the one it goes into soonest is the one you were pointing at.
   */
  furnitureAt3d(sx, sy) {
    const plan = activePlan(this.store.project);
    const baseZ = planElevation(this.store.project, plan);
    const ray = this.view3d.rayThrough(sx, sy);
    if (!ray) return null;
    const far = [ray.from[0] + ray.dir[0] * 1e6, ray.from[1] + ray.dir[1] * 1e6, ray.from[2] + ray.dir[2] * 1e6];
    let best = null;
    for (const item of plan.furniture ?? []) {
      const spec = furnitureById(item.kind ?? item.id);
      const height = Math.max(60, item.z ?? spec?.z ?? 700);
      const quad = furnitureFootprint(item);
      const hit = segmentThrough(quad, baseZ, baseZ + height, ray.from, far);
      if (hit && (!best || hit.enter < best.enter)) best = { id: item.id, enter: hit.enter };
    }
    return best?.id ?? null;
  }

  /**
   * Put a piece of furniture somewhere, from the 3D view.
   *
   * One edit per drag rather than one per frame: the store keeps a copy of the whole
   * drawing for undo, and a drag across a room is a hundred pointer moves.
   */
  moveFurniture(id, x, y) {
    this.store.preview();
    const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === id);
    if (!item || (item.x === x && item.y === y)) return;
    item.x = x;
    item.y = y;
    for (const plan of this.store.project.plans) plan.version = (plan.version ?? 0) + 1;
    // Not `true`: that means reframe, and reframing snaps the camera back to fit the
    // model on every pointer move. Bumping the version above is enough to get the
    // mesh rebuilt, because the version is what the cache is keyed on.
    this.rebuildMesh();
    this.requestFrame();
  }

  /**
   * Where a dragged piece should come to rest.
   *
   * The grid first, then the walls, because a wall is the thing furniture is actually
   * placed against and a 50 mm grid will not put a wardrobe flat against one. G turns
   * both off when you want it exactly where you dropped it.
   */
  snapPlacement(item, x, y) {
    const plan = activePlan(this.store.project);
    const asIs = { x: Math.round(x), y: Math.round(y), rotation: item.rotation ?? 0 };
    if (this.store.state.snapEnabled === false) return asIs;
    const step = this.store.state.gridMm || 0;
    const px = step ? Math.round(x / step) * step : Math.round(x);
    const py = step ? Math.round(y / step) * step : Math.round(y);
    // Everything worth lining up with: the wall faces, the other furniture and the
    // middle of each room. The piece itself is left out, or it snaps to where it
    // already is and never moves.
    const walls = phaseWalls(plan)
      .map((wall) => ({ ends: wallEnds(plan, wall), thickness: wall.thickness }))
      .filter((wall) => wall.ends);
    const others = (plan.furniture ?? []).filter((f) => f.id !== item.id);
    // Walls and the other furniture, and nothing else. The middle of a room was in
    // here too and it was a nuisance: a bed does not want to be centred in a bedroom,
    // and having it announce that it had done so was worse than the snap itself.
    // The walls, the openings and the other furniture. The middle of a room used to be
    // in here too and it was a nuisance; the middle of a window is the opposite — it is
    // exactly where a sofa goes.
    const guides = [...wallGuides(walls), ...openingGuides(plan), ...pieceGuides(others)];
    const placed = snapPlacement(item, px, py, guides);
    this.snappedTo = placed.on;
    return { x: Math.round(placed.x), y: Math.round(placed.y), rotation: placed.rotation };
  }

  /** Turn a piece while it is being dragged, without touching the history. */
  turnFurniture(id, degrees) {
    this.store.preview();
    const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === id);
    const to = (((Math.round(degrees) % 360) + 360) % 360);
    if (!item || item.rotation === to) return;
    item.rotation = to;
    for (const plan of this.store.project.plans) plan.version = (plan.version ?? 0) + 1;
    this.rebuildMesh();
    this.requestFrame();
  }

  /**
   * Close a drag: put the piece back where it started, then move it there properly.
   *
   * The drag itself moves the piece directly so it follows the cursor, which leaves
   * no undo. Rewinding and repeating it as one edit gives the whole drag a single
   * step in the history — the thing you would expect to undo is the move, not the
   * hundred pointer events it was made of.
   */
  commitFurnitureMove(id, from) {
    const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === id);
    if (!item) return;
    const turned = (item.rotation ?? 0) !== from.rotation;
    this.store.commit(turned ? 'turn furniture' : 'move furniture');
  }

  /** Turn the selected furniture, from either view. */
  rotateFurniture(by) {
    const selected = this.store.state.selection.filter((s) => s.kind === 'furniture');
    if (!selected.length) return false;
    this.store.edit('turn furniture', (project) => {
      const plan = activePlan(project);
      for (const pick of selected) {
        const item = (plan.furniture ?? []).find((f) => f.id === pick.id);
        if (item) item.rotation = (((item.rotation ?? 0) + by) % 360 + 360) % 360;
      }
      return true;
    });
    this.rebuildMesh();
    this.requestFrame();
    return true;
  }

  /**
   * Where a point on the 3D canvas lands on the floor of the storey being shown.
   *
   * A ray that leaves the camera almost level meets the floor a very long way off —
   * kilometres, for a cursor a few pixels above the horizon. Somewhere out there is
   * not an answer to "where did you drop this", so a hit well outside the building is
   * no hit at all and the piece stays where it was.
   */
  floorPoint3d(sx, sy) {
    const plan = activePlan(this.store.project);
    const baseZ = planElevation(this.store.project, plan);
    const at = this.view3d.pointOnHeight(sx, sy, baseZ);
    if (!at) return null;
    const bounds = planBounds(plan);
    const reach = Math.max(20000, Math.max(bounds.width, bounds.height) * 3);
    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;
    return Math.hypot(at[0] - cx, at[1] - cy) > reach ? null : at;
  }

  bind3dEvents() {
    const canvas = this.canvas3d;
    let dragging = null;
    const modeFor = (event) => {
      const middle = event.button === 1;
      if (event.ctrlKey || event.button === 2) return 'dolly';
      if (middle) return event.shiftKey ? 'orbit' : 'pan';
      if (event.shiftKey) return 'pan';
      return 'orbit'; // Alt lands here too
    };
    const navCursor = (mode) => (mode === 'pan' ? 'move' : mode === 'dolly' ? 'ns-resize' : 'grabbing');

    const local = (e) => {
      const box = canvas.getBoundingClientRect();
      return [e.clientX - box.left, e.clientY - box.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (this.walking) {
        // A press is a gesture the browser trusts, so this is where the lock is asked
        // for. Held, it turns the head either way.
        canvas.setPointerCapture(e.pointerId);
        dragging = { x: e.clientX, y: e.clientY, mode: 'look' };
        if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
        e.preventDefault();
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      // A drag on a piece of furniture moves it; anywhere else it turns the model.
      // Which one you meant is decided by what is under the cursor, so there is no
      // mode to be in and nothing to switch.
      //
      // Alt is allowed on the way in, because alt-drag is how a piece is turned. Ruled
      // out here along with shift and control, holding Alt before pressing meant the
      // press never found the furniture at all: the drag began as an orbit and the
      // rotate branch it was supposed to reach was never on the path. It only ever
      // worked if you started the drag plain and pressed Alt afterwards.
      const grab = e.button === 0 && !e.shiftKey && !e.ctrlKey;
      const hit = grab ? this.furnitureAt3d(...local(e)) : null;
      // Placing is a different question: that wants a bare click, with nothing held.
      const plain = grab && !e.altKey;
      // With the furniture tool in hand, a plain click on open floor puts a piece down
      // — but only a click. The model has to stay turnable, so this is remembered and
      // acted on at the release, and a drag becomes an orbit as it always did.
      const putting = plain && !hit && this.store.state.tool === 'furniture' ? this.floorPoint3d(...local(e)) : null;
      if (hit) {
        const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === hit);
        const at = this.floorPoint3d(...local(e));
        this.store.set({ selection: [{ kind: 'furniture', id: hit }] });
        dragging = {
          x: e.clientX,
          y: e.clientY,
          mode: 'move',
          id: hit,
          // Held from where the piece was grabbed, so it does not jump to the cursor.
          grab: at && item ? [at[0] - item.x, at[1] - item.y] : [0, 0],
          from: item ? { x: item.x, y: item.y, rotation: item.rotation ?? 0 } : null,
          rotation: item?.rotation ?? 0,
          // Turning measured from where you pressed when Alt was already down, and
          // from where Alt went down when it is pressed part way through a move — or
          // the piece would jump by however far it had already been dragged.
          turnFrom: e.altKey ? e.clientX : null,
        };
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      dragging = { x: e.clientX, y: e.clientY, mode: modeFor(e), putting, moved: false };
      canvas.style.cursor = navCursor(dragging.mode);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.walking) {
        // Locked, the pointer reports how far it moved rather than where it is, which
        // is what lets you keep turning past the edge of the screen. Where the browser
        // will not grant the lock — and it will not without a gesture it trusts —
        // dragging turns instead, so the walk is never unsteerable.
        const locked = document.pointerLockElement === canvas;
        if (locked || dragging?.mode === 'look') {
          this.view3d.lookAround(e.movementX ?? e.clientX - (dragging?.x ?? e.clientX), e.movementY ?? e.clientY - (dragging?.y ?? e.clientY));
          if (dragging) {
            dragging.x = e.clientX;
            dragging.y = e.clientY;
          }
          this.requestFrame();
        }
        return;
      }
      if (!dragging) {
        // Something you can pick up says so before you press.
        canvas.style.cursor = this.furnitureAt3d(...local(e)) ? 'grab' : 'default';
        return;
      }
      if (dragging.mode === 'move') {
        // Held on the event or held on the keyboard: pressing Alt part way through a
        // drag has to switch it, and by then the pointer event that started the drag
        // is long gone.
        if (e.altKey || this.altHeld) {
          // Alt turns rather than moves, so one drag does both jobs and neither
          // needs a handle to grab. Sideways is clockwise, a quarter across the
          // canvas is a quarter turn, and it settles on the nearest fifteen.
          const from = dragging.turnFrom ?? e.clientX;
          dragging.turnFrom = from;
          const by = Math.round(((e.clientX - from) * 0.5) / 15) * 15;
          this.turnFurniture(dragging.id, (dragging.rotation ?? 0) + by);
          this.doing3d = 'turn';
        } else {
          dragging.turnFrom = null;
          const at = this.floorPoint3d(...local(e));
          const item = (activePlan(this.store.project).furniture ?? []).find((f) => f.id === dragging.id);
          if (at && item) {
            const placed = this.snapPlacement(item, at[0] - dragging.grab[0], at[1] - dragging.grab[1]);
            this.moveFurniture(dragging.id, placed.x, placed.y);
            this.turnFurniture(dragging.id, placed.rotation);
          }
          this.doing3d = 'move';
        }
        this.renderViewHelp();
        return;
      }
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      dragging.x = e.clientX;
      dragging.y = e.clientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragging.moved = true;
      // A modifier picked up mid-drag switches what the drag is doing.
      dragging.mode = e.buttons === 4 || e.buttons === 2 ? dragging.mode : modeFor({ ...e, button: -1 });
      if (dragging.mode === 'pan') this.view3d.pan(dx, dy);
      else if (dragging.mode === 'dolly') this.view3d.dolly(dy);
      else this.view3d.orbit(dx, dy);
      canvas.style.cursor = navCursor(dragging.mode);
      this.doing3d = dragging.mode;
      this.renderViewHelp();
      this.requestFrame();
    });
    const stop = () => {
      if (dragging?.mode === 'move' && dragging.from) this.commitFurnitureMove(dragging.id, dragging.from);
      // A click that never became a drag, with the furniture tool in hand: put the
      // piece down where the floor was under it, snapped to the same things a piece
      // dragged about in here snaps to.
      if (dragging?.putting && !dragging.moved) {
        const spec = furnitureById(this.store.state.pendingFurniture);
        const [x, y] = dragging.putting;
        const placed = spec
          ? this.snapPlacement({ x, y, w: spec.w, h: spec.h, rotation: 0 }, x, y)
          : { x, y };
        if (this.interaction.placeFurniture(placed.x, placed.y, placed.rotation ?? 0)) {
          this.rebuildMesh(false);
          this.requestFrame();
        }
      }
      dragging = null;
      this.doing3d = null;
      this.renderViewHelp();
      canvas.style.cursor = 'default';
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const box = canvas.getBoundingClientRect();
        this.view3d.zoomAt(Math.exp(e.deltaY * 0.0006), e.clientX - box.left, e.clientY - box.top);
        this.requestFrame();
      },
      { passive: false }
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', () => {
      this.rebuildMesh(true);
      this.requestFrame();
    });
  }


  /**
   * The measurements over the 3D view.
   *
   * Drawn on a canvas laid over the model rather than built into it, because a
   * figure has to face you however the model is turned. Each room gets its two
   * sides and the storey its height, with the line, the arrows and the figure in a
   * pill — the way a furniture planner shows you what will fit.
   */
  drawMarks3d() {
    const canvas = this.marks3d;
    if (!canvas || this.mode !== '3d') return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = this.canvas3d.clientWidth;
    const h = this.canvas3d.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.show3dMarks) return;
    // Not while you are inside it. These figures are drawn for the model seen from
    // outside: standing in a room they are metres long, swing about as you turn, and
    // measure things behind your head. The plan is where you read a size.
    if (this.walking) return;

    const project = (p) => {
      const hit = this.view3d.project(p);
      if (!hit) return null;
      return { x: (hit.x / this.view3d.width) * w, y: (hit.y / this.view3d.height) * h, depth: hit.depth };
    };
    const theme = this.renderer.theme;
    const dark = this.themeName() === 'dark';
    const ink = dark ? '#e8edf0' : '#16212b';
    const pill = dark ? 'rgba(20,26,31,0.92)' : 'rgba(22,33,43,0.92)';
    const plan = activePlan(this.store.project);
    const baseZ = planElevation(this.store.project, plan);

    // What the walls hide. These figures are painted on a canvas over the model, and
    // a canvas has no idea what is in front of what — so a measurement inside a room
    // is read straight through the wall you are looking at, and its bare line, running
    // across a wall face at an angle nothing on that face runs at, reads as an edge of
    // the wall that has no business being there.
    const eye = this.view3d.eye?.();
    const blockers = eye
      ? (plan.walls ?? [])
          .map((wall) => {
            const quad = wallCorners(plan, wall);
            return quad ? { quad, z0: baseZ, z1: baseZ + wallHeight(plan, wall) } : null;
          })
          .filter(Boolean)
      : [];
    const inSight = (p) => {
      if (!blockers.length) return true;
      // Stop a touch short, or a figure sitting against a wall is hidden by it.
      const back = [0, 1, 2].map((i) => p[i] + (eye[i] - p[i]) * 0.004);
      return !blockers.some((w) => segmentBlocked(w.quad, w.z0, w.z1, eye, back));
    };

    /**
     * Whether a measurement is worth drawing at all.
     *
     * Judged on where the figure itself goes, not on both ends of the line. Asking
     * for both ends meant a room's dimension vanished the moment either of its far
     * corners slipped behind a wall — which, orbiting a building, is most of the
     * time, and it made the figures flicker on and off as you turned it. What matters
     * is whether you can see the thing the number is written on.
     */
    const worthDrawing = (from, to) => {
      const middle = [0, 1, 2].map((i) => (from[i] + to[i]) / 2);
      if (inSight(middle)) return true;
      // Unless the middle is behind something and both ends are not, which happens
      // across a doorway and is still a reading worth having.
      return inSight(from) && inSight(to);
    };

    /** One measurement: a line with arrows and the figure in a pill at its middle. */
    const mark = (from, to, mm) => {
      if (!worthDrawing(from, to)) return;
      const a = project(from);
      const b = project(to);
      if (!a || !b) return;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Too small on screen to read is too small to draw; the pill would be all there
      // was of it.
      if (len < 46) return;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      // A short bar across each end, then an arrowhead pointing outward.
      for (const [p, dir] of [
        [a, 1],
        [b, -1],
      ]) {
        ctx.moveTo(p.x - uy * 5, p.y + ux * 5);
        ctx.lineTo(p.x + uy * 5, p.y - ux * 5);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + ux * dir * 9 - uy * 4, p.y + uy * dir * 9 + ux * 4);
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + ux * dir * 9 + uy * 4, p.y + uy * dir * 9 - ux * 4);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      const text = dimLabel(mm);
      ctx.font = `600 11px ${theme.mono}`;
      const width = ctx.measureText(text).width + 14;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      ctx.fillStyle = pill;
      const radius = 5;
      const x0 = cx - width / 2;
      const y0 = cy - 9;
      ctx.beginPath();
      ctx.moveTo(x0 + radius, y0);
      ctx.arcTo(x0 + width, y0, x0 + width, y0 + 18, radius);
      ctx.arcTo(x0 + width, y0 + 18, x0, y0 + 18, radius);
      ctx.arcTo(x0, y0 + 18, x0, y0, radius);
      ctx.arcTo(x0, y0, x0 + width, y0, radius);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, y0 + 9);
    };

    const rooms = derived(plan).rooms.filter((room) => room.kept !== false);
    for (const room of rooms) {
      const lift = baseZ + 30;
      // Measured square to the room's own walls, not to the drawing. Turn a room and
      // the drawing's x and y stop describing it: a line set in from the bounding box
      // crosses the room at a corner, where it is a sliver, which is how a 15 m² room
      // came to report two metres across.
      const frame = roomFrame(room);
      const extent = frame ? roomExtent(room, frame) : null;
      if (!extent) continue;
      // The same lines the room panel takes its readings on — literally the same
      // function — so the figure in the panel and the figure on the model are the same
      // measurement rather than two that happen to be close.
      const downTheRoom = measureLines(extent.u[0], extent.u[1]);
      const acrossTheRoom = measureLines(extent.v[0], extent.v[1]);

      /**
       * A line across the room, and how far the room actually reaches along it.
       *
       * A chord rather than the bounding box it used to be. The box is only the room
       * when the room is both a rectangle and square to the page: one slanted wall, or
       * one turned through fifteen degrees, and it reports a figure no part of that
       * room measures — and draws the line for it outside the room, through the wall.
       */
      const across = (axis, at) => {
        const chord = roomChord(room, frame, axis, at);
        if (!chord || chord.length < 200) return null;
        return {
          from: [chord.from.x, chord.from.y, lift],
          to: [chord.to.x, chord.to.y, lift],
          mm: chord.length,
        };
      };

      /**
       * Which of the two candidate lines to draw.
       *
       * In a rectangular room both measure the same thing, so the visible one is taken
       * — that is what stops a figure flickering as the model turns. Where they differ
       * the room is not rectangular, and then the reading must not depend on where you
       * are standing: the wider one wins and stays put, hidden or not.
       */
      const either = (first, second) => {
        if (!first || !second) {
          const only = first ?? second;
          if (only) mark(only.from, only.to, only.mm);
          return;
        }
        const same = Math.abs(first.mm - second.mm) < 2;
        const pick = same ? (worthDrawing(first.from, first.to) ? first : second) : first.mm >= second.mm ? first : second;
        mark(pick.from, pick.to, pick.mm);
      };

      either(across('x', acrossTheRoom[0]), across('x', acrossTheRoom[2]));
      either(across('y', downTheRoom[2]), across('y', downTheRoom[0]));

      // And the storey height, up whichever corner is in sight. A corner of the room,
      // not of its bounding box — those are only the same in a rectangle, and outside
      // one the line went up through open floor or through a wall.
      const top = baseZ + (plan.height ?? 2500);
      const corner = room.inner.find((p) => worthDrawing([p.x, p.y, baseZ], [p.x, p.y, top]));
      if (corner) mark([corner.x, corner.y, baseZ], [corner.x, corner.y, top], plan.height ?? 2500);
    }

    // Whatever is picked, outlined where it stands. Without it there is no telling
    // what a keypress is about to turn.
    for (const pick of this.store.state.selection) {
      if (pick.kind !== 'furniture') continue;
      const item = (plan.furniture ?? []).find((f) => f.id === pick.id);
      if (!item) continue;
      const spec = furnitureById(item.kind ?? item.id);
      const top = baseZ + Math.max(60, item.z ?? spec?.z ?? 700);
      const ring = furnitureFootprint(item);
      const draw = (z, width, alpha) => {
        const points = ring.map((p) => project([p.x, p.y, z])).filter(Boolean);
        if (points.length < ring.length) return;
        ctx.strokeStyle = theme.select;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.stroke();
      };
      draw(baseZ + 6, 2, 0.95);
      draw(top, 1.2, 0.55);
      ctx.globalAlpha = 1;
    }

    // Every window and door: how wide it is, how high the sill sits, and how tall it
    // is. The three figures you actually order a window by.
    for (const opening of plan.openings ?? []) {
      const geo = openingGeometry(plan, opening);
      if (!geo) continue;
      const hole = openingWidth(opening);
      const sill = Math.max(0, opening.sill ?? 0);
      const head = Math.max(sill + 200, opening.head ?? 2010);
      const stand = geo.thickness / 2 + 60;
      const at = (a, c, z) => [
        geo.x1 + geo.dx * a + geo.nx * c,
        geo.y1 + geo.dy * a + geo.ny * c,
        baseZ + z,
      ];
      // On whichever face is towards the camera — the overlay draws over the model,
      // so a figure on the far side would be read straight through the wall.
      const face = [stand, -stand]
        .map((c) => ({ c, seen: project(at(hole / 2, c, (sill + head) / 2)) }))
        .filter((o) => o.seen)
        .sort((p, q) => p.seen.depth - q.seen.depth)[0];
      if (!face) continue;
      const c = face.c;
      const isWindow = (opening.kind ?? 'door') === 'window';

      mark(at(0, c, isWindow ? sill : head), at(hole, c, isWindow ? sill : head), hole);
      if (isWindow && sill > 0) {
        // Brüstungshöhe: floor to sill, which is what decides whether a radiator or a
        // worktop fits under it.
        mark(at(hole, c, 0), at(hole, c, sill), sill);
        mark(at(hole, c, sill), at(hole, c, head), head - sill);
      } else {
        mark(at(hole, c, 0), at(hole, c, head), head);
      }
    }
  }

  requestFrame() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.mode === '3d') {
        if (this.view3d.gl) {
          this.view3d.resize();
          this.rebuildMesh(false);
          this.view3d.draw();
        }
        this.drawMarks3d();
        this.drawRadar();
        this.renderStatus();
        return;
      }
      this.renderer.resize();
      if (this.pendingFit && this.renderer.width >= 40 && this.renderer.height >= 40) this.fitView();
      this.renderer.draw(this.store.state, this.interaction.extras());
      // The panel's figures follow the drawing while it is being dragged about.
      this.syncLiveFields();
      if (this.showRulers) {
        this.renderer.drawRulers(this.store.state.view, this.rulerH, this.rulerV, this.store.state.cursor);
      }
      this.renderStatus();
      this.positionNumeric();
      this.applyCursor();
    });
  }

  /** The tool glyph the toolbar draws, taken from the sprite so the two cannot drift. */
  toolGlyph(tool) {
    if (this.glyphs.has(tool)) return this.glyphs.get(tool);
    const icon = TOOLS.find((t) => t.id === tool)?.icon;
    // Scoped to the app's own root: the sprite is part of the shell, so this works
    // whether or not the page it is dropped into has anything else in it.
    const symbol = icon ? this.root.querySelector(`#${icon}`) : null;
    const markup = symbol ? symbol.innerHTML.trim() : '';
    this.glyphs.set(tool, markup);
    return markup;
  }

  /**
   * The cursor: the tool in your hand, what the next click will do to what is under
   * it, and what the key you are holding has changed about that.
   *
   * Set from one place because all three have to be read together — the interaction
   * used to set it on its own from `onMove`, which meant a modifier key could not
   * change it without the pointer moving as well.
   */
  applyCursor() {
    const state = this.store.state;
    const spec = cursorFor({
      mode: this.mode,
      tool: state.tool,
      hover: state.hover,
      drag: this.interaction.drag,
      snap: Boolean(this.interaction.snap),
      keys: { space: this.interaction.spaceHeld, shift: this.shiftHeld, alt: this.altHeld },
    });
    // Building the SVG and encoding it is not free, and a pointer move fires a lot.
    const key = `${spec.icon}|${spec.badge}|${spec.point}|${spec.native}|${this.renderer.theme.ink}`;
    if (key === this.cursorKey) return;
    this.cursorKey = key;
    this.canvas.style.cursor = cursorCss(
      this.toolGlyph(spec.icon),
      spec,
      this.renderer.theme.ink,
      this.renderer.theme.surface
    );
  }

  renderAll() {
    const state = this.store.state;
    // Walking, the walls you can bump into are worked out once when you set off. Change
    // floors or knock a wall through while you are in there and they were the old
    // floor's walls at the old floor's height — so you walked through what was drawn and
    // into what was not. Refreshed whenever the drawing changes.
    if (this.walking) this.refreshWalk();
    for (const button of this.railEl.querySelectorAll('.tool[data-tool]')) {
      button.setAttribute('aria-pressed', String(state.tool === button.dataset.tool));
      // Turned off rather than left to be clicked and do nothing.
      const works = this.toolWorksHere(button.dataset.tool);
      button.disabled = !works;
      const tool = TOOLS.find((t) => !t.sep && t.id === button.dataset.tool);
      button.title = works ? `${tool.label} (${tool.key})` : `${tool.label} — needs the plan`;
    }
    this.root.querySelector('#undo').disabled = !this.store.canUndo();
    this.root.querySelector('#redo').disabled = !this.store.canRedo();
    if (this.mode === '3d') this.rebuildMesh(false);
    this.renderStart();
    this.renderInspector();
    this.renderOptbar();
    this.renderHint();
    this.stageEl.classList.toggle('no-rulers', !this.showRulers || this.mode === '3d');
    this.renderViewHelp();
    this.ensureBackdropImage(activePlan(this.store.project));
    this.requestFrame();
  }

  renderHint() {
    // The tool's instructions live in the options bar. The pill over the drawing is
    // kept for the one thing the bar cannot say: what the shape being drawn is
    // doing right now.
    const draft = this.interaction.draft;
    const text = draft?.hint ?? null;
    this.hintEl.hidden = !text;
    if (text) this.hintEl.textContent = text;
  }

  renderStatus() {
    const state = this.store.state;
    const plan = activePlan(this.store.project);
    const cursor = state.cursor;
    const bits = [
      el('span', {}, [el('b', { text: plan.name })]),
      el('span', {}, ['1:', el('b', { text: String(plan.scaleDenominator) })]),
      el('span', {}, [
        'Cursor ',
        el('b', { text: cursor ? `${Math.round(cursor.x)}, ${Math.round(cursor.y)} mm` : '—' }),
      ]),
      el('span', {}, ['Grid ', el('b', { text: state.gridMm ? `${state.gridMm} mm` : 'off' })]),
      phaseOf(plan) === 'all'
        ? null
        : el('span', { class: 'on' }, [
            'Showing ',
            el('b', { text: PHASES.find((p) => p.id === phaseOf(plan))?.label ?? '' }),
          ]),
      el('span', { text: describeSelection(plan, state.selection) }),
      el('span', { class: 'spacer' }),
      el('span', { class: state.orthoLock ? 'on' : '' }, ['Ortho ', el('b', { text: state.orthoLock ? 'on' : 'off' })]),
      el('span', { class: state.snapEnabled !== false ? 'on' : '' }, [
        'Snap ',
        el('b', { text: state.snapEnabled !== false ? 'on' : 'off' }),
      ]),
      el('span', {}, [el('b', { text: `${Math.round(state.view.scale * 1000)} px/m` })]),
      el('span', { text: this.store.storageWorks ? 'Saved in this browser' : 'Storage off — export to keep your work' })
    ];
    this.statusEl.replaceChildren(...bits.filter(Boolean));
  }

  // Empty-canvas prompt: three ways in, nothing more.
  renderStart() {
    const plan = activePlan(this.store.project);
    const empty =
      this.mode === '2d' &&
      !this.startDismissed &&
      plan.walls.length === 0 &&
      !plan.backdrop?.kind &&
      !this.pendingPages;
    const existing = this.canvasWrap.querySelector('.start');
    if (!empty) {
      existing?.remove();
      return;
    }
    if (existing) return;
    this.canvasWrap.append(
      el('div', { class: 'start' }, [
        el('div', { class: 'start-card' }, [
          el('h1', { text: 'Draw your floor plan' }),
          el('p', {
            text: 'Start with a room, then add interior walls, doors and windows. Everything is in millimetres, and you can type exact sizes as you draw.',
          }),
          el('div', { class: 'start-actions' }, [
            el(
              'button',
              { class: 'btn btn-primary', type: 'button', onclick: () => this.setTool('rect') },
              [icon('i-rect'), 'Draw a room']
            ),
            el('button', { class: 'btn', type: 'button', onclick: () => this.setTool('wall') }, [
              icon('i-wall'),
              'Draw walls',
            ]),
            el('button', { class: 'btn', type: 'button', onclick: () => this.fileInput.click() }, [
              icon('i-upload'),
              'Trace a plan',
            ]),
          ]),
          el('p', {
            class: 'start-note',
            text: 'Tracing takes a PDF or a photo and puts it faintly underneath, so you can draw on top of it. Nothing leaves your computer.',
          }),
        ]),
      ])
    );
  }

  // ---- numeric entry --------------------------------------------------

  renderNumeric(draft) {
    if (!draft) {
      this.numericEl.hidden = true;
      this.numericEl.replaceChildren();
      this.numericDirty = false;
      return;
    }
    const isRect = draft.kind === 'rect';
    const focused = this.numericEl.contains(document.activeElement) ? document.activeElement : null;
    const focusName = focused?.dataset?.field ?? null;
    const caret = focused ? focused.selectionStart : null;
    // Once a number has been typed it is the source of truth; until then the
    // fields track the mouse.
    const values = this.numericDirty ? this.readNumeric() : null;
    const isNew = this.numericEl.hidden || this.numericEl.dataset.kind !== draft.kind;

    const plan = activePlan(this.store.project);
    const basisLabel = (DIM_BASES.find((b) => b.id === (plan.dimBasis ?? 'outer')) ?? DIM_BASES[0]).label;
    const shift = isRect ? rectBasisShift(plan.dimBasis ?? 'outer', draft.thickness) : 0;
    const fields = isRect
      ? [
          { name: 'width', label: `Width ${basisLabel.toLowerCase()}`, value: draft.width + shift },
          { name: 'depth', label: `Depth ${basisLabel.toLowerCase()}`, value: draft.depth + shift },
        ]
      : [
          { name: 'length', label: 'Length', value: draft.length },
          { name: 'angle', label: 'Angle', value: draft.angle, unit: '°' },
        ];

    const commit = () => {
      const entered = this.readNumeric();
      this.numericDirty = false;
      if (this.interaction.commitNumeric(entered)) {
        this.requestFrame();
      } else {
        this.flash('Enter a size in millimetres.');
      }
    };

    this.numericEl.replaceChildren(
      ...fields.map((field) =>
        el('label', { class: 'num-field' }, [
          el('span', { text: field.label }),
          el('input', {
            type: 'text',
            inputmode: 'decimal',
            dataset: { field: field.name },
            value: values ? values[field.name] ?? '' : String(Math.round(field.value ?? 0)),
            oninput: () => {
              this.numericDirty = true;
            },
            onkeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Tab') {
                // let the browser move focus
              } else if (e.key === 'Escape') {
                e.target.blur();
              }
            },
          }),
          field.unit ? el('span', { class: 'unit', text: field.unit }) : el('span', { class: 'unit', text: 'mm' }),
        ])
      ),
      el('button', { class: 'btn btn-primary num-go', type: 'button', onclick: commit }, 'Enter')
    );

    this.numericEl.dataset.kind = draft.kind;
    if (focusName) {
      const next = this.numericEl.querySelector(`input[data-field="${focusName}"]`);
      if (next) {
        next.focus();
        if (caret !== null) next.setSelectionRange(caret, caret);
      }
    } else if (isNew) {
      // Focus the first field as soon as drawing starts, so a typed size goes
      // straight in without having to click into the panel.
      const first = this.numericEl.querySelector('input');
      first?.focus();
      first?.select();
    }
    this.numericEl.hidden = false;
    this.positionNumeric();
  }

  readNumeric() {
    const out = {};
    for (const input of this.numericEl.querySelectorAll('input')) {
      out[input.dataset.field] = input.value.replace(',', '.');
    }
    return out;
  }

  // The panel is parked in a corner rather than following the cursor: sitting
  // under the pointer, it swallowed the moves and the click that finish a shape.
  positionNumeric() {}

  // ---- inspector ------------------------------------------------------

  panel(title, children, extra = null) {
    return el('section', { class: 'panel' }, [
      el('h2', { class: 'panel-title' }, [title, extra]),
      ...[].concat(children).filter(Boolean),
    ]);
  }

  /**
   * An input that mirrors something the drawing is doing, refreshed while it does it.
   *
   * A gesture moves the model and asks for a repaint; it does not rebuild the panel,
   * because rebuilding the schedules and the quantities on every pointermove would
   * cost more than the drag. So the panel's figures sat at what they were when the
   * drag started while the chains beside them counted up live — the one place showing
   * exact numbers was the one place not showing them.
   */
  live(input, read) {
    this.liveFields.push({ input, read });
    return input;
  }

  /** Put the current figures into those inputs. Called from the render loop. */
  syncLiveFields() {
    for (const { input, read } of this.liveFields) {
      // Never over the top of someone typing in it.
      if (input === document.activeElement || !input.isConnected) continue;
      const value = String(read());
      if (input.value !== value) input.value = value;
    }
  }

  renderInspector() {
    const plan = activePlan(this.store.project);
    const state = this.store.state;
    this.liveFields = [];
    const panels = [];
    if (this.pendingPages) {
      panels.push(this.panelPages());
    } else if (this.mode === '3d') {
      panels.push(this.panel3d(plan));
      panels.push(this.panelSun());
      panels.push(this.panelStorey(plan));
      panels.push(this.panelFloors());
    } else {
      // The inspector is about the drawing and what is picked in it. A tool's own
      // settings are in the options bar, and the drawing's are behind the gear.
      panels.push(this.panelSelection());
      panels.push(this.panelRooms(plan));
      panels.push(this.panelStorey(plan));
      panels.push(this.panelSchedules(plan));
      if (plan.walls.length) panels.push(this.panelQuantities());
      panels.push(this.panelClearances(plan));
      panels.push(this.panelFixtureSchedule(plan));
      panels.push(this.panelFloors());
    }
    this.inspector.replaceChildren(...panels.filter(Boolean));
  }


  // ---- the tool's own options ------------------------------------------
  //
  // Everything that belongs to the tool in your hand is here and nowhere else:
  // pick the wall tool and you get wall types, pick the door tool and you get door
  // sizes. What belongs to the whole drawing is behind the gear, and what belongs
  // to the thing you have selected is in the inspector. Three places, each with one
  // job, instead of one long column with all of it at once.


  // ---- settings, out of the way until you want them --------------------

  toggleSettings(force = null) {
    const open = force === null ? this.drawerEl.hidden : force;
    this.drawerEl.hidden = !open;
    this.root.querySelector('#settings-btn').setAttribute('aria-expanded', String(open));
    if (open) {
      this.closeViewPopover();
      this.renderSettings();
    }
  }

  renderSettings() {
    if (this.drawerEl.hidden) return;
    const plan = activePlan(this.store.project);
    this.drawerEl.replaceChildren(
      el('div', { class: 'drawer-head' }, [
        el('h2', { text: 'Drawing settings' }),
        el(
          'button',
          { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-label': 'Close', onclick: () => this.toggleSettings(false) },
          [icon('i-close')]
        ),
      ]),
      ...[this.panelDrawing(plan), this.panelGuides(plan), this.panelBackdrop(plan)].filter(Boolean)
    );
  }

  panelVoid(plan, id) {
    const item = findVoid(plan, id);
    if (!item) return null;
    const update = (partial) => {
      this.store.edit('floor opening', (project) => {
        const target = findVoid(activePlan(project), id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    const numberField = (label, key, min, max, step) =>
      el('label', { class: 'field grow' }, [
        label,
        el('input', {
          type: 'number',
          value: String(Math.round(item[key] ?? 0)),
          min: String(min),
          max: String(max),
          step: String(step),
          onchange: (e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value >= min) update({ [key]: value });
          },
        }),
      ]);
    // Which flight on the storey below comes up through here.
    const below = storeyBelow(this.store.project, plan);
    const served = (below?.stairs ?? []).filter((stair) =>
      stairWorldTreads(stair).some((tread) =>
        tread.pts.some((q) => pointInVoid(item, q.x, q.y))
      )
    );
    return this.panel(
      'Floor opening',
      [
        el('div', { class: 'row' }, [numberField('Width', 'w', 200, 8000, 10), numberField('Length', 'h', 200, 8000, 10)]),
        el('div', { class: 'row' }, [
          numberField('Turned by', 'rotation', -360, 360, 15),
          el('label', { class: 'field grow' }, [
            'Name',
            el('input', {
              type: 'text',
              value: item.label ?? '',
              placeholder: 'Stair well',
              onchange: (e) => update({ label: e.target.value }),
            }),
          ]),
        ]),
        el('dl', { class: 'readout' }, [
          el('dt', { text: 'Area taken' }),
          el('dd', { text: formatArea(item.w * item.h) }),
          el('dt', { text: 'Serves' }),
          el('dd', {
            text: served.length
              ? `${served.length} flight${served.length === 1 ? '' : 's'} below`
              : below
                ? 'no flight below'
                : 'the ground floor',
          }),
        ]),
        el('p', {
          class: 'note',
          text: 'A Deckenaussparung: the slab is cut away, so this floor loses the area and the flight below comes up through it.',
        }),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete opening'),
      ],
      el('span', { class: 'chip', text: `${Math.round(item.w)} × ${Math.round(item.h)}` })
    );
  }

  panelGuide(plan, id) {
    const guide = findGuide(plan, id);
    if (!guide) return null;
    return this.panel(
      guide.axis === 'x' ? 'Upright guide' : 'Level guide',
      [
        el('label', { class: 'field' }, [
          guide.axis === 'x' ? 'Across (mm from the origin)' : 'Down (mm from the origin)',
          el('input', {
            type: 'number',
            value: String(Math.round(guide.at)),
            step: '10',
            onchange: (e) => {
              const value = Number(e.target.value);
              if (!Number.isFinite(value)) return;
              this.store.edit('move a guide', (project) => {
                const target = findGuide(activePlan(project), id);
                if (!target) return false;
                target.at = Math.round(value);
                return true;
              });
            },
          }),
        ]),
        el('p', { class: 'note', text: 'Drag it anywhere, or type the exact position. Guides snap but are never exported.' }),
        el(
          'button',
          { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() },
          'Delete guide'
        ),
      ],
      el('span', { class: 'chip', text: formatLength(guide.at) })
    );
  }

  panelGuides(plan) {
    const guides = plan.guides ?? [];
    const xs = guides.filter((g) => g.axis === 'x').length;
    const ys = guides.length - xs;
    return this.panel(
      'Rulers and guides',
      [
        el('label', { class: 'toggle' }, [
          el('input', {
            type: 'checkbox',
            checked: this.showRulers,
            onchange: (e) => {
              this.showRulers = e.target.checked;
              this.renderAll();
            },
          }),
          el('span', { class: 'name', text: 'Show the rulers' }),
        ]),
        el('label', { class: 'toggle' }, [
          el('input', {
            type: 'checkbox',
            checked: plan.show.guides !== false,
            onchange: (e) => {
              plan.show.guides = e.target.checked;
              touch(plan);
              this.store.scheduleSave();
              this.requestFrame();
            },
          }),
          el('span', { class: 'name', text: 'Show the guides' }),
          el('span', { class: 'tally', text: `${xs} ↕ · ${ys} ↔` }),
        ]),
        guides.length
          ? el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => this.store.edit('clear guides', (project) => clearGuides(activePlan(project))),
              },
              'Clear all guides'
            )
          : null,
        el('p', {
          class: 'note',
          text: 'Drag down off the top ruler for a level line, out of the side ruler for an upright one. Guides snap like anything else, and never appear on an export.',
        }),
      ],
      el('span', { class: 'count', text: String(guides.length) })
    );
  }

  // ---- what to show, one click away ------------------------------------

  toggleViewPopover() {
    if (this.viewPopover) {
      this.closeViewPopover();
      return;
    }
    this.toggleSettings(false);
    const plan = activePlan(this.store.project);
    const flip = (key, value) => {
      plan.show[key] = value;
      touch(plan);
      this.store.scheduleSave();
      this.renderAll();
      this.renderViewPopover();
    };
    this.viewPopover = el('div', { class: 'popover', id: 'view-popover', role: 'dialog', 'aria-label': 'What to show' });
    this.root.querySelector('.app').appendChild(this.viewPopover);
    this.root.querySelector('#view-btn').setAttribute('aria-expanded', 'true');
    this.viewFlip = flip;
    this.renderViewPopover();
    // A click anywhere else puts it away.
    setTimeout(() => {
      this.viewAway = (event) => {
        if (this.viewPopover?.contains(event.target)) return;
        if (this.root.querySelector('#view-btn')?.contains(event.target)) return;
        this.closeViewPopover();
      };
      window.addEventListener('pointerdown', this.viewAway, true);
    }, 0);
  }

  closeViewPopover() {
    if (this.viewAway) {
      window.removeEventListener('pointerdown', this.viewAway, true);
      this.viewAway = null;
    }
    this.viewPopover?.remove();
    this.viewPopover = null;
    this.root.querySelector('#view-btn')?.setAttribute('aria-expanded', 'false');
  }

  renderViewPopover() {
    if (!this.viewPopover) return;
    const plan = activePlan(this.store.project);
    const groups = VIEW_GROUPS;
    const phase = phaseOf(plan);
    const phaseRow = [
      el('div', { class: 'group-label', text: 'The work' }),
      el(
        'div',
        { class: 'seg', style: 'margin:2px 6px 8px' },
        PHASES.map((p) =>
          el(
            'button',
            {
              class: 'seg-btn',
              type: 'button',
              title: p.hint,
              'aria-pressed': String(phase === p.id),
              onclick: () => {
                this.store.edit('what to show', (project) => {
                  activePlan(project).phase = p.id;
                  return true;
                });
                this.renderViewPopover();
              },
            },
            p.label
          )
        )
      ),
    ];
    const rows = groups.flatMap((group) => [
      el('div', { class: 'group-label', text: group.label }),
      ...group.items.map(([key, label]) =>
        el('label', { class: 'toggle' }, [
          el('input', {
            type: 'checkbox',
            checked: key === 'stairCut' ? plan.show[key] !== false : plan.show[key] === true || (plan.show[key] !== false && DEFAULT_ON.has(key)),
            onchange: (e) => this.viewFlip(key, e.target.checked),
          }),
          el('span', { class: 'name', text: label }),
        ])
      ),
    ]);
    this.viewPopover.replaceChildren(...phaseRow, ...rows);
  }

  renderOptbar() {
    const state = this.store.state;
    const plan = activePlan(this.store.project);
    if (this.mode === '3d') {
      // The furniture tool works in here, so the bar has to go on offering the one
      // control it needs — which piece. Without it the tool could be picked up in the
      // model and there was no way to say what to put down.
      const placing = state.tool === 'furniture';
      const tool = TOOLS.find((t) => !t.sep && t.id === state.tool);
      this.optbarEl.replaceChildren(
        el('div', { class: 'optbar-tool' }, [
          icon(placing ? tool.icon : 'i-plan'),
          el('b', { text: placing ? tool.short : '3D' }),
        ]),
        ...(placing ? (this.optionsForTool(state.tool, activePlan(this.store.project), state) ?? []).filter(Boolean) : []),
        el('span', {
          class: 'optbar-hint',
          text: placing
            ? 'Click the floor to put one down. Drag turns the model, so only a click places.'
            : 'Drag to turn, shift-drag to slide, scroll to zoom. Double-click to reframe.',
        })
      );
      return;
    }
    const tool = TOOLS.find((t) => t.id === state.tool) ?? TOOLS[0];
    const controls = (this.optionsForTool(state.tool, plan, state) ?? []).filter(Boolean);
    this.optbarEl.replaceChildren(
      el('div', { class: 'optbar-tool' }, [icon(tool.icon), el('b', { text: tool.short ?? tool.label })]),
      ...controls,
      el('span', { class: 'optbar-hint', text: this.hintFor(state, tool) })
    );
  }

  /** What the bar says after the controls: what this tool wants you to do next. */
  hintFor(state, tool) {
    if (tool.id === 'select') {
      return state.selection.length
        ? `${state.selection.length} selected — ⌘D duplicates, R rotates, Delete removes. Alt-drag moves a wall bodily.`
        : 'Click something to change it. Drag a box to select several. Space-drag or middle-drag pans.';
    }
    if (tool.id === 'fixture') {
      const spec = fixtureSpec(state.pendingFixture ?? 'socket');
      return spec.mount === 'wall'
        ? `Click near a wall: it mounts on the face you clicked, ${spec.height} mm up. ⌘D repeats one along the wall.`
        : `Dropped loose in the room, ${spec.height} mm up.`;
    }
    if ((tool.id === 'wall' || tool.id === 'rect') && (state.newWall?.height ?? 0) > 0) {
      const plan = activePlan(this.store.project);
      if (state.newWall.height < (plan.height ?? 2500) - 1) {
        return `${HINTS[tool.id]} At ${state.newWall.height} mm these come out as knee walls.`;
      }
    }
    return HINTS[tool.id] ?? '';
  }

  /** A labelled control for the options bar. */
  opt(name, ...children) {
    return el('div', { class: 'opt' }, [name ? el('span', { class: 'opt-name', text: name }) : null, ...children]);
  }

  optNumber(name, value, { min = 0, max = 100000, step = 10, width = null, onchange }) {
    return this.opt(
      name,
      el('input', {
        type: 'number',
        value: String(Math.round(value)),
        min: String(min),
        max: String(max),
        step: String(step),
        style: width ? `width:${width}px` : null,
        onchange: (e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next >= min && next <= max) onchange(next);
        },
      })
    );
  }

  optSeg(name, items, current, onpick) {
    return this.opt(
      name,
      el(
        'div',
        { class: 'seg' },
        items.map((item) =>
          el(
            'button',
            {
              class: 'seg-btn',
              type: 'button',
              title: item.title ?? null,
              'aria-pressed': String(item.id === current),
              onclick: () => onpick(item.id),
            },
            [item.label, item.sub ? el('span', { class: 'seg-sub', text: item.sub }) : null].filter(Boolean)
          )
        )
      )
    );
  }

  optSelect(name, groups, current, onpick) {
    return this.opt(
      name,
      el(
        'select',
        { onchange: (e) => onpick(e.target.value) },
        groups.flatMap((group) =>
          group.label
            ? [
                el(
                  'optgroup',
                  { label: group.label },
                  group.items.map((item) => el('option', { value: item.id, selected: item.id === current }, item.label))
                ),
              ]
            : group.items.map((item) => el('option', { value: item.id, selected: item.id === current }, item.label))
        )
      )
    );
  }

  optionsForTool(tool, plan, state) {
    switch (tool) {
      case 'wall':
      case 'rect': {
        const current = state.newWall;
        const set = (partial) => this.store.set({ newWall: { ...current, ...partial } });
        return [
          this.optSeg(
            null,
            WALL_TYPES.map((t) => ({ id: t.id, label: t.label, sub: String(t.thickness) })),
            current.type,
            (id) => set({ type: id, thickness: wallTypeFor(id).thickness })
          ),
          this.optNumber('Thickness', current.thickness, {
            min: 30,
            max: 900,
            step: 5,
            width: 66,
            onchange: (v) => set({ thickness: v }),
          }),
          this.optNumber('Height', current.height ?? plan.height ?? 2500, {
            min: 200,
            max: 5000,
            step: 50,
            width: 66,
            onchange: (v) => set({ height: v === (plan.height ?? 2500) ? null : v }),
          }),
          this.optSeg(
            'On the work',
            WALL_STATUS.map((st) => ({ id: st.id, label: st.de, title: `${st.label} — ${st.hint}` })),
            current.status ?? 'existing',
            (id) => set({ status: id === 'existing' ? null : id })
          ),
        ];
      }
      case 'door':
      case 'window':
      case 'opening':
        return this.optionsForOpening(tool, state);
      case 'stair':
        return this.optionsForStair(plan, state);
      case 'column': {
        const preset = state.newColumn ?? { shape: 'rect', w: 240, h: 240 };
        const set = (partial) => this.store.set({ newColumn: { ...preset, ...partial } });
        return [
          this.optSeg(null, COLUMN_SHAPES.map((c) => ({ id: c.id, label: c.label })), preset.shape, (id) => set({ shape: id })),
          this.optNumber('Size', preset.w, { min: 80, max: 1200, step: 10, width: 62, onchange: (v) => set({ w: v }) }),
          preset.shape === 'rect'
            ? this.optNumber('Depth', preset.h, { min: 80, max: 1200, step: 10, width: 62, onchange: (v) => set({ h: v }) })
            : null,
        ];
      }
      case 'void': {
        const preset = state.newVoid ?? { w: 1010, h: 2900 };
        const set = (partial) => this.store.set({ newVoid: { ...preset, ...partial } });
        return [
          this.optNumber('Width', preset.w, { min: 200, max: 8000, step: 10, width: 68, onchange: (v) => set({ w: v }) }),
          this.optNumber('Length', preset.h, { min: 200, max: 8000, step: 10, width: 68, onchange: (v) => set({ h: v }) }),
        ];
      }
      case 'fixture': {
        const groups = fixtureGroups().map((g) => ({
          label: g.group,
          items: g.items.map((f) => ({ id: f.id, label: `${f.label} · ${f.height} mm` })),
        }));
        const current = state.pendingFixture ?? 'socket';
        const spec = fixtureSpec(current);
        return [
          this.optSelect(null, groups, current, (id) => this.store.set({ pendingFixture: id })),
        ];
      }
      case 'furniture': {
        const groups = FURNITURE_GROUPS.map((group) => ({
          label: group,
          items: FURNITURE.filter((f) => f.group === group).map((f) => ({
            id: f.id,
            label: `${f.label} · ${f.w}×${f.h}`,
          })),
        }));
        const current = state.pendingFurniture ?? groups[0]?.items[0]?.id;
        return [
          this.optSelect(null, groups, current, (id) => this.store.set({ pendingFurniture: id })),
        ];
      }
      case 'dimension':
        return [
          this.optSeg(
            'Measured',
            DIM_BASES.map((b) => ({ id: b.id, label: b.label, title: b.hint })),
            plan.dimBasis ?? 'outer',
            (id) => {
              plan.dimBasis = id;
              touch(plan);
              this.store.scheduleSave();
              this.renderAll();
            }
          ),
        ];
      // Everything else is a click-and-go tool with nothing to set. The bar still
      // names it and says what to do, which is all it needs.
      default:
        return [];
    }
  }

  optionsForOpening(kind, state) {
    const preset = state.newOpening?.kind === kind ? state.newOpening : defaultsFor(kind);
    if (state.newOpening?.kind !== kind) this.store.state.newOpening = preset;
    const spec = kindSpec(kind);
    const style = styleSpec(kind, preset.style);
    const set = (partial) => this.store.set({ newOpening: { ...preset, ...partial } });
    return [
      spec.styles.length > 1
        ? this.optSelect(
            null,
            [{ items: spec.styles.map((st) => ({ id: st.id, label: st.label })) }],
            style.id,
            (id) => set({ ...defaultsFor(kind, id) })
          )
        : null,
      this.optNumber('Width', preset.width, { min: 200, max: 6000, step: 50, width: 68, onchange: (v) => set({ width: v }) }),
      this.optNumber('Stock', stockOf(preset), {
        min: 0,
        max: 200,
        step: 5,
        width: 54,
        onchange: (v) => set({ stock: v }),
      }),
      this.optNumber('Height', openingHeight(preset), {
        min: 200,
        max: 3000,
        step: 50,
        width: 68,
        onchange: (v) => set({ head: (preset.sill ?? 0) + v }),
      }),
      kind === 'window'
        ? this.optNumber('Sill', preset.sill, { min: 0, max: 2000, step: 50, width: 62, onchange: (v) => set({ sill: v }) })
        : null,
      this.optSelect(
        'Standard',
        [{ items: style.widths.map((w) => ({ id: String(w), label: `${w} mm` })) }],
        String(preset.width),
        (id) => set({ width: Number(id) })
      ),
    ];
  }

  optionsForStair(plan, state) {
    const rise = floorToFloor(plan);
    const preset = state.newStair ?? {};
    const stair = { ...defaultStair(rise), ...preset, rise };
    const set = (partial) => this.store.set({ newStair: { ...preset, ...partial } });
    const checks = stairChecks(stair);
    const level = worstLevel(checks);
    return [
      this.optSelect(
        null,
        [{ items: STAIR_SHAPES.map((sh) => ({ id: sh.id, label: sh.label })) }],
        stair.shape,
        (id) => set({ shape: id })
      ),
      this.optNumber('Steps', stair.steps, { min: 2, max: 40, step: 1, width: 54, onchange: (v) => set({ steps: v }) }),
      this.optNumber('Tread', stair.treadDepth, { min: 150, max: 450, step: 5, width: 62, onchange: (v) => set({ treadDepth: v }) }),
      this.optNumber('Width', stair.width, { min: 500, max: 3000, step: 10, width: 62, onchange: (v) => set({ width: v }) }),
      el('span', {
        class: `chip ${level === 'bad' ? 'chip-bad' : level === 'warn' ? 'chip-warn' : 'chip-good'}`,
        text: stairLabel(stair),
      }),
    ];
  }

  panelSelection() {
    const plan = activePlan(this.store.project);
    const selection = this.store.state.selection;
    if (selection.length === 0) {
      return this.panel('Drawing', [
        el('dl', { class: 'readout' }, [
          el('dt', { text: 'Walls' }),
          el('dd', { text: String(plan.walls.length) }),
          el('dt', { text: 'Doors' }),
          el('dd', { text: String(plan.openings.filter((o) => o.kind === 'door').length) }),
          el('dt', { text: 'Windows' }),
          el('dd', { text: String(plan.openings.filter((o) => o.kind === 'window').length) }),
          el('dt', { text: 'Stairs' }),
          el('dd', { text: String(plan.stairs?.length ?? 0) }),
          el('dt', { text: 'Rooms' }),
          el('dd', { text: String(derived(plan).rooms.length) }),
          el('dt', { text: 'Floor area' }),
          el('dd', { text: formatArea(totalArea(plan)) }),
          el('dt', { text: 'Living area' }),
          el('dd', { text: formatArea(livingArea(plan)) }),
        ]),
        (() => {
          const counts = statusCounts(plan);
          if (!counts.remove && !counts.new) return null;
          return el('dl', { class: 'readout', style: 'margin-bottom:10px' }, [
            el('dt', { text: 'To come out' }),
            el('dd', { text: String(counts.remove) }),
            el('dt', { text: 'Going in' }),
            el('dd', { text: String(counts.new) }),
          ]);
        })(),
        (() => {
          // Junctions are healed after every edit, so this should always read
          // clean. If it ever does not, the button is there to say so.
          const loose = looseJunctions(plan);
          const count = loose.tees + loose.crossings;
          if (!count) return null;
          return el('div', { class: 'stack' }, [
            el('p', {
              class: 'note',
              text: `${count} place${count === 1 ? '' : 's'} where walls meet without being joined — rooms and corners there will be wrong.`,
            }),
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                // The tidy-up runs after every edit anyway, so an empty edit is
                // all it takes — and it reports what it did through the usual path.
                onclick: () => this.store.edit('join junctions', () => true),
              },
              'Join them'
            ),
          ]);
        })(),
        el('p', { class: 'note', text: 'Nothing selected. Click a wall, a door, a room or a piece of furniture.' }),
      ]);
    }
    if (selection.length > 1) {
      const walls = selection.filter((s) => s.kind === 'wall');
      const joinable = walls.length === 2 && Boolean(canJoinWalls(plan, walls[0].id, walls[1].id));
      return this.panel('Selection', [
        el('p', { class: 'note', text: `${selection.length} items selected.` }),
        walls.length === 2
          ? el(
              'button',
              { class: 'btn', type: 'button', disabled: !joinable, onclick: () => this.interaction.joinSelected() },
              joinable ? 'Join into one wall (J)' : 'Not in line from one corner'
            )
          : null,
        walls.length > 1 ? this.wallBulkThickness(walls) : null,
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete all'),
      ]);
    }
    const item = selection[0];
    if (item.kind === 'wall') return this.panelWall(plan, item.id);
    if (item.kind === 'opening') return this.panelOpening(plan, item.id);
    if (item.kind === 'furniture') return this.panelFurnitureItem(plan, item.id);
    if (item.kind === 'label') return this.panelLabel(plan, item.id);
    if (item.kind === 'room') return this.panelRoomDetail(plan, item.id);
    if (item.kind === 'dimension') return this.panelDimension(plan, item.id);
    if (item.kind === 'void') return this.panelVoid(plan, item.id);
    if (item.kind === 'guide') return this.panelGuide(plan, item.id);
    if (item.kind === 'stair') return this.panelStair(plan, item.id);
    if (item.kind === 'column') return this.panelColumn(plan, item.id);
    if (item.kind === 'fixture') return this.panelFixture(plan, item.id);
    if (item.kind === 'node') {
      const node = findNode(plan, item.id);
      return this.panel('Corner', [
        el('div', { class: 'row' }, [
          el('label', { class: 'field grow' }, [
            'X',
            this.live(
              el('input', {
                type: 'number',
                value: String(Math.round(node?.x ?? 0)),
                step: '10',
                onchange: (e) => this.moveNode(item.id, Number(e.target.value), null),
              }),
              () => Math.round(findNode(activePlan(this.store.project), item.id)?.x ?? 0)
            ),
          ]),
          el('label', { class: 'field grow' }, [
            'Y',
            this.live(
              el('input', {
                type: 'number',
                value: String(Math.round(node?.y ?? 0)),
                step: '10',
                onchange: (e) => this.moveNode(item.id, null, Number(e.target.value)),
              }),
              () => Math.round(findNode(activePlan(this.store.project), item.id)?.y ?? 0)
            ),
          ]),
        ]),
        el('p', { class: 'note', text: 'Every wall that meets here moves with it.' }),
      ]);
    }
    return null;
  }

  wallBulkThickness(walls) {
    return el('label', { class: 'field' }, [
      'Thickness for all selected (mm)',
      el('input', {
        type: 'number',
        min: '30',
        step: '5',
        placeholder: 'e.g. 115',
        onchange: (e) => {
          const value = Number(e.target.value);
          if (!Number.isFinite(value) || value < 20) return;
          this.store.edit('wall thickness', (project) => {
            const plan = activePlan(project);
            for (const item of walls) {
              const wall = findWall(plan, item.id);
              if (wall) wall.thickness = value;
            }
            return true;
          });
        },
      }),
    ]);
  }

  moveNode(id, x, y) {
    this.store.edit('move corner', (project) => {
      const node = findNode(activePlan(project), id);
      if (!node) return false;
      if (x !== null && Number.isFinite(x)) node.x = x;
      if (y !== null && Number.isFinite(y)) node.y = y;
      return true;
    });
  }

  /**
   * Grow a room off the selected wall.
   *
   * The way a room is usually added: you have a wall, and the room goes on one side
   * of it. The two sides are named by where they point on a compass rather than by
   * "this side" and "that side", because the drawing is turned about and left or
   * right stops meaning anything the moment it is.
   */
  roomFromWall(plan, wall) {
    const ends = wallEnds(plan, wall);
    if (!ends) return null;
    const run = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
    if (run < 300) return null;
    const bearing = this.store.project.site?.bearing ?? 0;
    const nx = -(ends.b.y - ends.a.y) / run;
    const ny = (ends.b.x - ends.a.x) / run;
    const depth = () => Math.max(300, Math.round(Number(this.newRoomDepth) || 3000));

    const grow = (sign) => {
      let made = 0;
      this.store.edit('room off a wall', (project) => {
        const built = growRoomFromWall(activePlan(project), wall.id, depth(), sign);
        made = built.length;
        return made > 0;
      });
      if (made) this.flash(`Room added, ${formatLength(depth())} deep inside.`);
      else this.showMessage('That room could not be added', 'The wall is too short, or the depth is.');
    };

    const side = (sign) => compassPoint(bearingOf(nx * sign, ny * sign, bearing));
    return el('div', {}, [
      el('div', { class: 'group-label', text: 'A room off this wall' }),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Deep, inside',
          el('input', {
            type: 'number',
            value: String(depth()),
            min: '300',
            step: '50',
            oninput: (e) => {
              this.newRoomDepth = e.target.value;
            },
          }),
        ]),
      ]),
      el('div', { class: 'row row-wrap' }, [
        el('button', { class: 'btn grow', type: 'button', onclick: () => grow(-1) }, `To the ${side(-1)}`),
        el('button', { class: 'btn grow', type: 'button', onclick: () => grow(1) }, `To the ${side(1)}`),
      ]),
      el('p', {
        class: 'note',
        text: 'Three walls are built off the ends of this one, which it then shares. The depth is the room you get, measured inside its walls. Outside the building that is an extension; inside a room it divides it.',
      }),
    ]);
  }

  panelWall(plan, id) {
    const wall = findWall(plan, id);
    if (!wall) return null;
    const lengths = wallLengths(plan, wall);
    const basis = plan.dimBasis ?? 'outer';
    const basisSpec = DIM_BASES.find((b) => b.id === basis) ?? DIM_BASES[0];
    const angle = wallAngle(plan, wall);
    const setThickness = (value) => {
      this.store.edit('wall thickness', (project) => {
        const target = findWall(activePlan(project), id);
        if (!target) return false;
        target.thickness = value;
        return true;
      });
    };
    return this.panel(
      isKneeWall(plan, wall) ? 'Knee wall' : 'Wall',
      [
      el(
        'div',
        { class: 'seg' },
        WALL_TYPES.map((type) =>
          el(
            'button',
            {
              class: 'seg-btn',
              type: 'button',
              'aria-pressed': String(wall.type === type.id),
              onclick: () => {
                this.store.edit('wall type', (project) => {
                  const target = findWall(activePlan(project), id);
                  if (!target) return false;
                  target.type = type.id;
                  target.thickness = type.thickness;
                  return true;
                });
              },
            },
            [type.label, el('span', { class: 'seg-sub', text: `${type.thickness}` })]
          )
        )
      ),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Paint',
          el(
            'select',
            {
              onchange: (e) => {
                const paint = e.target.value;
                this.store.edit('wall paint', (project) => {
                  const target = findWall(activePlan(project), id);
                  if (!target) return false;
                  if (paint) target.paint = paint;
                  else delete target.paint;
                  return true;
                });
                this.rebuildMesh();
              },
            },
            [
              el('option', { value: '', selected: !wall.paint }, 'Undecorated'),
              ...WALL_FINISHES.map((f) =>
                el('option', { value: f.id, selected: wall.paint === f.id }, f.label)
              ),
            ]
          ),
        ]),
      ]),
      this.roomFromWall(plan, wall),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Thickness',
          el('input', {
            type: 'number',
            value: String(Math.round(wall.thickness)),
            min: '30',
            max: '900',
            step: '5',
            onchange: (e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 20) setThickness(value);
            },
          }),
        ]),
        el('label', { class: 'field grow' }, [
          `Length ${basisSpec.label.toLowerCase()}`,
          this.live(
            el('input', {
              type: 'number',
              value: String(Math.round(lengths[basis === 'centre' ? 'centre' : basis])),
              min: '50',
              step: '10',
              onchange: (e) => this.setWallLengthOn(id, Number(e.target.value), basis),
            }),
            () => {
              const live = findWall(activePlan(this.store.project), id);
              if (!live) return 0;
              return Math.round(wallLengths(activePlan(this.store.project), live)[basis === 'centre' ? 'centre' : basis]);
            }
          ),
        ]),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Height (mm)',
          el('input', {
            type: 'number',
            value: String(Math.round(wallHeight(plan, wall))),
            min: '100',
            max: '6000',
            step: '50',
            onchange: (e) => {
              const value = Number(e.target.value);
              this.store.edit('wall height', (project) => {
                const target = findWall(activePlan(project), id);
                if (!target) return false;
                target.height = Number.isFinite(value) && value > 0 ? value : null;
                return true;
              });
            },
          }),
        ]),
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            title: 'Back to the storey height',
            onclick: () => {
              this.store.edit('wall height', (project) => {
                const target = findWall(activePlan(project), id);
                if (!target) return false;
                target.height = null;
                return true;
              });
            },
          },
          'Full'
        ),
      ]),
      isKneeWall(plan, wall)
        ? el('div', {}, [
            el('p', {
              class: 'note',
              text: `A knee wall: ${Math.round((plan.height ?? 2500) - wallHeight(plan, wall))} mm short of the ${Math.round(plan.height ?? 2500)} mm ceiling. Drawn open rather than solid, because the drawing cuts above it.`,
            }),
            el('div', { class: 'row' }, [
              el('label', { class: 'field grow' }, [
                'Roof pitch above it (°)',
                el('input', {
                  type: 'number',
                  value: wall.pitch ? String(Math.round(wall.pitch)) : '',
                  placeholder: 'none',
                  min: '0',
                  max: '85',
                  step: '1',
                  onchange: (e) => {
                    const value = Number(e.target.value);
                    this.store.edit('roof pitch', (project) => {
                      const target = findWall(activePlan(project), id);
                      if (!target) return false;
                      target.pitch = Number.isFinite(value) && value > 0 && value < 89 ? value : null;
                      return true;
                    });
                  },
                }),
              ]),
            ]),
            el('p', {
              class: 'note',
              text: wall.pitch
                ? `The ceiling rises inward from here at ${Math.round(wall.pitch)}°, so the rooms behind it lose the floor area that ends up under two metres. The one and two metre lines are drawn on the plan.`
                : 'Give it the roof pitch above it and the rooms behind it get their Wohnfläche worked out under WoFlV §4 — full over two metres, half between one and two, nothing below.',
            }),
          ])
        : null,
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        'On the work',
        el(
          'div',
          { class: 'seg', style: 'margin:4px 0 0' },
          WALL_STATUS.map((status) =>
            el(
              'button',
              {
                class: 'seg-btn',
                type: 'button',
                title: `${status.de} — ${status.hint}`,
                'aria-pressed': String(wallStatus(wall) === status.id),
                onclick: () => {
                  this.store.edit('wall status', (project) => {
                    const target = findWall(activePlan(project), id);
                    if (!target) return false;
                    target.status = status.id === 'existing' ? null : status.id;
                    return true;
                  });
                },
              },
              [status.label, el('span', { class: 'seg-sub', text: status.de })]
            )
          )
        ),
      ]),
      el('label', { class: 'field' }, [
        'Angle (° anticlockwise from east)',
        el('input', {
          type: 'number',
          value: String(Math.round(angle)),
          step: '5',
          onchange: (e) => {
            const value = Number(e.target.value);
            if (!Number.isFinite(value)) return;
            const ok = this.store.edit('wall angle', (project) => setWallAngle(activePlan(project), id, value));
            if (!ok) this.flash('That angle is the one it already has.');
          },
        }),
      ]),
      el('dl', { class: 'readout' }, [
        el('dt', { text: 'Outside' }),
        el('dd', { text: formatLength(lengths.outer) }),
        el('dt', { text: 'Centreline' }),
        el('dd', { text: formatLength(lengths.centre) }),
        el('dt', { text: 'Clear inside' }),
        el('dd', { text: lengths.inner > 0 ? formatLength(lengths.inner) : '—' }),
      ]),
      el('p', {
        class: 'note',
        text: 'The wall is stored on its centreline, as in Revit and ArchiCAD; at a corner its outer face runs past the corner and its inner face stops short of it. Dragging it slides any end that butts into another wall along that wall — hold Alt to move it bodily instead.',
      }),
      el('div', { class: 'row row-wrap' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.addOpeningToWall(id, 'door') }, 'Add door'),
        el('button', { class: 'btn', type: 'button', onclick: () => this.addOpeningToWall(id, 'window') }, 'Add window'),
      ]),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete wall'),
      ],
      isKneeWall(plan, wall)
        ? el('span', { class: 'chip chip-warn', text: `${Math.round(wallHeight(plan, wall))} mm` })
        : null
    );
  }

  setWallLengthOn(id, length, basis) {
    if (!Number.isFinite(length) || length < 20) return;
    const ok = this.store.edit('wall length', (project) =>
      setWallLengthOn(activePlan(project), id, length, basis)
    );
    if (!ok) this.flash('That length is too short for this wall.');
  }

  addOpeningToWall(id, kind) {
    let created = null;
    this.store.edit(`add ${kind}`, (project) => {
      const plan = activePlan(project);
      const wall = findWall(plan, id);
      if (!wall) return false;
      const total = wallLength(plan, wall);
      const base = defaultsFor(kind);
      const width = Math.min(base.width, Math.max(300, total - 200));
      created = { id: nextId('o'), wallId: id, ...base, width, offset: Math.max(0, total / 2 - width / 2) };
      plan.openings.push(created);
      return true;
    });
    if (created) this.store.set({ selection: [{ kind: 'opening', id: created.id }] });
  }

  panelOpening(plan, id) {
    const opening = plan.openings.find((o) => o.id === id);
    if (!opening) return null;
    const wall = findWall(plan, opening.wallId);
    const total = wall ? wallLength(plan, wall) : 0;
    const spec = kindSpec(opening.kind);
    const style = styleSpec(opening.kind, opening.style);
    const update = (partial) => {
      this.store.edit('opening', (project) => {
        const target = activePlan(project).openings.find((o) => o.id === id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    // What can be flipped and swung: anything hung on side hinges, which now includes
    // a Dreh or Dreh-Kipp window — it turns into the room exactly as a door does.
    const swingable = swingsOpen(opening);
    return this.panel(describeOpening(opening), [
      el(
        'div',
        { class: 'seg' },
        OPENING_KINDS.map((k) =>
          el(
            'button',
            {
              class: 'seg-btn',
              type: 'button',
              'aria-pressed': String(opening.kind === k.id),
              onclick: () => {
                const base = defaultsFor(k.id);
                update({ kind: k.id, style: base.style, sill: base.sill, head: base.head });
              },
            },
            k.label
          )
        )
      ),
      spec.styles.length > 1
        ? el(
            'div',
            { class: 'seg' },
            spec.styles.map((s) =>
              el(
                'button',
                {
                  class: 'seg-btn',
                  type: 'button',
                  'aria-pressed': String(opening.style === s.id),
                  onclick: () => update({ style: s.id, width: s.defaultWidth }),
                },
                s.label
              )
            )
          )
        : null,
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          opening.kind === 'window' ? 'Sash width (mm)' : 'Door width (mm)',
          el('input', {
            type: 'number',
            value: String(Math.round(opening.width)),
            min: '200',
            max: '6000',
            step: '5',
            onchange: (e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 200) update({ width: value });
            },
          }),
        ]),
        el('label', { class: 'field grow' }, [
          'Height (mm)',
          el('input', {
            type: 'number',
            value: String(Math.round(openingHeight(opening))),
            min: '200',
            max: '3000',
            step: '5',
            onchange: (e) => {
              const value = Number(e.target.value);
              // Setting the height moves the head and leaves the sill where it is.
              if (Number.isFinite(value) && value >= 200) update({ head: (opening.sill ?? 0) + value });
            },
          }),
        ]),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Stock each side (mm)',
          el('input', {
            type: 'number',
            value: String(Math.round(stockOf(opening))),
            min: '0',
            max: '200',
            step: '5',
            onchange: (e) => {
              const value = Number(e.target.value);
              if (Number.isFinite(value) && value >= 0) update({ stock: value });
            },
          }),
        ]),
        el('label', { class: 'field grow' }, [
          'Hole in the wall',
          el('input', {
            type: 'number',
            value: String(Math.round(openingWidth(opening))),
            disabled: true,
          }),
        ]),
      ]),
      el('p', {
        class: 'note',
        text: 'The width is the door itself. The stock is the lining it shuts into, and the hole in the wall is the two together.',
      }),
      el('label', { class: 'field' }, [
        'A size it comes in',
        el(
          'select',
          { onchange: (e) => update({ width: Number(e.target.value) }) },
          [
            ...style.widths.map((w) => el('option', { value: String(w), selected: Math.round(opening.width) === w }, `${w} mm`)),
            style.widths.includes(Math.round(opening.width))
              ? null
              : el('option', { value: String(opening.width), selected: true }, `${Math.round(opening.width)} mm (your own)`),
          ].filter(Boolean)
        ),
      ]),
      el('label', { class: 'field' }, [
        `Distance from corner (mm) — wall is ${Math.round(total)}`,
        el('input', {
          type: 'number',
          value: String(Math.round(opening.offset)),
          min: '0',
          max: String(Math.max(0, Math.round(total - opening.width))),
          step: '10',
          onchange: (e) => update({ offset: Math.max(0, Number(e.target.value)) }),
        }),
      ]),
      el('div', { class: 'row row-wrap' }, [
        swingable
          ? el('button', { class: 'btn', type: 'button', onclick: () => this.interaction.flipSelectedOpenings('hinge') }, 'Flip hinge (H)')
          : null,
        swingable
          ? el('button', { class: 'btn', type: 'button', onclick: () => this.interaction.flipSelectedOpenings('swing') }, 'Flip swing (B)')
          : null,
      ]),
      swingable
        ? el('label', { class: 'field' }, [
            `Standing open at ${Math.round(swingAngle(opening))}° of ${MAX_SWING}${
              opening.kind === 'window' ? ' — a turn sash sweeps the room too' : ''
            }`,
            el('input', {
              type: 'range',
              min: '0',
              max: String(MAX_SWING),
              step: '5',
              value: String(Math.round(swingAngle(opening))),
              oninput: (e) => {
                // Live, so the leaf sweeps as the slider moves and you can see what
                // it clears. The store is told where this started before the first
                // change, or the undo would land somewhere in the middle of the drag.
                this.store.preview();
                opening.swingAngle = Number(e.target.value);
                touch(plan);
                this.rebuildMesh(false);
                this.requestFrame();
              },
              onchange: () => this.store.commit('swing angle'),
            }),
          ])
        : null,
      tiltsOpen(opening)
        ? el('p', {
            class: 'note',
            text: `The tilt is on the drawing but not in the model: a sash leaning in at the head is not upright, and everything in the 3D view stands square. It is drawn shut there.${
              swingable ? '' : ' A tilt sash needs no floor, so it has no clearance zone.'
            }`,
          })
        : null,
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Sill',
          el('input', {
            type: 'number',
            value: String(Math.round(opening.sill ?? 0)),
            min: '0',
            step: '50',
            // Raising the sill leaves the head where it is, the way heads line up
            // across a facade — so the opening gets shorter rather than moving.
            onchange: (e) => update({ sill: Math.max(0, Number(e.target.value)) }),
          }),
        ]),
        el('label', { class: 'field grow' }, [
          'Head',
          el('input', {
            type: 'number',
            value: String(Math.round(opening.head ?? 2010)),
            min: '100',
            step: '50',
            onchange: (e) => update({ head: Number(e.target.value) }),
          }),
        ]),
      ]),
      opening.kind === 'window' && opening.style !== 'floor' && opening.style !== 'french'
        ? el('div', {}, [
            el('div', { class: 'group-label', text: 'Window board' }),
            el('div', { class: 'row' }, [
              el('label', { class: 'field grow' }, [
                'Into the room',
                el('input', {
                  type: 'number',
                  value: String(Math.round(boardOf(opening).inner)),
                  min: '0',
                  max: '600',
                  step: '10',
                  onchange: (e) => update({ boardInner: Math.max(0, Number(e.target.value)) }),
                }),
              ]),
              el('label', { class: 'field grow' }, [
                'Outside',
                el('input', {
                  type: 'number',
                  value: String(Math.round(boardOf(opening).outer)),
                  min: '0',
                  max: '600',
                  step: '10',
                  onchange: (e) => update({ boardOuter: Math.max(0, Number(e.target.value)) }),
                }),
              ]),
              el('label', { class: 'field grow' }, [
                'Thickness',
                el('input', {
                  type: 'number',
                  value: String(Math.round(boardOf(opening).thickness)),
                  min: '5',
                  max: '200',
                  step: '5',
                  onchange: (e) => update({ boardThickness: Math.max(5, Number(e.target.value)) }),
                }),
              ]),
            ]),
            el('p', { class: 'note', text: 'Zero leaves the board off that side. Shown in 3D at whatever you set.' }),
          ])
        : null,
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete'),
    ]);
  }

  panelDimension(plan, id) {
    const dim = plan.dimensions.find((d) => d.id === id);
    if (!dim) return null;
    return this.panel('Dimension', [
      el('label', { class: 'field' }, [
        'Distance from the wall (mm)',
        el('input', {
          type: 'number',
          value: String(Math.round(dim.offset ?? 500)),
          step: '50',
          onchange: (e) => {
            const value = Number(e.target.value);
            this.store.edit('dimension offset', (project) => {
              const target = activePlan(project).dimensions.find((d) => d.id === id);
              if (!target) return false;
              target.offset = value;
              return true;
            });
          },
        }),
      ]),
      el('p', { class: 'note', text: 'Drag the line on the drawing to move it too.' }),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete'),
    ]);
  }

  panelFurnitureItem(plan, id) {
    const item = plan.furniture.find((f) => f.id === id);
    if (!item) return null;
    const update = (key, value) => {
      this.store.edit('furniture', (project) => {
        const target = activePlan(project).furniture.find((f) => f.id === id);
        if (!target) return false;
        target[key] = value;
        return true;
      });
    };
    return this.panel(item.label ?? 'Furniture', [
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Width',
          el('input', { type: 'number', value: String(Math.round(item.w)), min: '50', step: '10', onchange: (e) => update('w', Number(e.target.value)) }),
        ]),
        el('label', { class: 'field grow' }, [
          'Depth',
          el('input', { type: 'number', value: String(Math.round(item.h)), min: '50', step: '10', onchange: (e) => update('h', Number(e.target.value)) }),
        ]),
      ]),
      el('label', { class: 'field' }, [
        'Rotation',
        this.live(el('input', {
          type: 'range',
          min: '0',
          max: '355',
          step: '5',
          value: String(item.rotation ?? 0),
          oninput: (e) => {
            item.rotation = Number(e.target.value);
            touch(plan);
            this.requestFrame();
          },
          onchange: (e) => update('rotation', Number(e.target.value)),
        }), () => Math.round(activePlan(this.store.project).furniture.find((f) => f.id === id)?.rotation ?? 0)),
      ]),
      el('div', { class: 'row row-wrap' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.interaction.rotateSelection(90) }, 'Rotate 90°'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete'),
      ]),
    ]);
  }

  panelLabel(plan, id) {
    const label = plan.labels.find((l) => l.id === id);
    if (!label) return null;
    const update = (key, value) => {
      this.store.edit('label', (project) => {
        const target = activePlan(project).labels.find((l) => l.id === id);
        if (!target) return false;
        target[key] = value;
        return true;
      });
    };
    return this.panel('Label', [
      el('label', { class: 'field' }, [
        'Text',
        el('input', { type: 'text', value: label.text, onchange: (e) => update('text', e.target.value) }),
      ]),
      el('label', { class: 'field' }, [
        'Size (mm)',
        el('input', {
          type: 'number',
          value: String(Math.round(label.size ?? 260)),
          min: '60',
          step: '20',
          onchange: (e) => update('size', Number(e.target.value)),
        }),
      ]),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete label'),
    ]);
  }

  panelRoomDetail(plan, metaId) {
    const room = derived(plan).rooms.find((r) => r.metaId === metaId);
    if (!room) return null;
    const basis = plan.dimBasis ?? 'outer';
    const basisLabel = (DIM_BASES.find((b) => b.id === basis) ?? DIM_BASES[0]).label.toLowerCase();
    const axes = roomAxes(plan, room);
    const meta = roomMetaFor(plan, room);
    const sizeField = (axis, label) =>
      el('label', { class: 'field grow' }, [
        label,
        el('input', {
          type: 'number',
          value: String(Math.round(roomSizeOn(axes[axis], basis))),
          min: '300',
          step: '10',
          onchange: (e) => this.setRoomSize(metaId, axis, Number(e.target.value)),
        }),
      ]);
    return this.panel('Room', [
      el('label', { class: 'field' }, [
        'Name',
        el('input', { type: 'text', value: room.name ?? '', onchange: (e) => this.setRoomName(metaId, e.target.value) }),
      ]),
      axes
        ? el('div', { class: 'row' }, [sizeField('x', `Width ${basisLabel}`), sizeField('y', `Depth ${basisLabel}`)])
        : el('p', { class: 'note', text: 'This room is not a rectangle, so it has no single width and depth.' }),
      axes
        ? el('p', {
            class: 'note',
            text: 'Changing a size moves the far wall. An inside wall slides across and the room next door gives up the space; an outside wall moves the shell.',
          })
        : null,
      el('div', { class: 'row row-wrap' }, [
        el('button', { class: 'btn grow', type: 'button', onclick: () => this.store.set({ tool: 'select' }) }, 'Drag the room to move it'),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Floor',
          el(
            'select',
            {
              onchange: (e) => {
                const floor = e.target.value;
                this.store.edit('floor finish', (project) => {
                  const entry = activePlan(project).rooms.find((r) => r.id === metaId);
                  if (!entry) return false;
                  entry.floor = floor;
                  return true;
                });
                this.rebuildMesh();
              },
            },
            [
              ...FLOOR_FINISHES.map((f) =>
                el('option', { value: f.id, selected: (meta?.floor ?? 'oak') === f.id }, f.label)
              ),
            ]
          ),
        ]),
      ]),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Use',
          el(
            'select',
            {
              onchange: (e) => {
                const usage = e.target.value;
                this.store.edit('room use', (project) => {
                  const entry = activePlan(project).rooms.find((r) => r.id === metaId);
                  if (!entry) return false;
                  entry.usage = usage;
                  entry.areaFactor = usageSpec(usage).factor;
                  return true;
                });
              },
            },
            ROOM_USAGES.map((u) =>
              el('option', { value: u.id, selected: (meta?.usage ?? 'living') === u.id }, u.label)
            )
          ),
        ]),
        el('label', { class: 'field grow' }, [
          'Ceiling height',
          el('input', {
            type: 'number',
            value: String(Math.round(roomHeight(plan, room))),
            min: '1500',
            step: '50',
            onchange: (e) => {
              const value = Number(e.target.value);
              this.store.edit('room height', (project) => {
                const entry = activePlan(project).rooms.find((r) => r.id === metaId);
                if (!entry) return false;
                entry.height = Number.isFinite(value) && value > 0 ? value : null;
                return true;
              });
            },
          }),
        ]),
      ]),
      el('dl', { class: 'readout' }, [
        el('dt', { text: 'Floor area' }),
        el('dd', { text: formatArea(room.areaMm2) }),
        ...(() => {
          const clear = roomClearSize(room);
          if (!clear) return [];
          // Two rows rather than one, because a tapering room needs a range for each
          // and `4,18–7,90 × 2,70–3,24` on one line is a puzzle rather than a reading.
          const metres = (mm) => (mm / 1000).toFixed(2).replace('.', ',');
          const span = ({ min, max }) =>
            max - min > 5 ? `${metres(min)}–${metres(max)} m` : `${metres(min)} m`;
          return [
            el('dt', { text: 'Clear width' }),
            el('dd', { text: span(clear.width) }),
            el('dt', { text: 'Clear depth' }),
            el('dd', { text: span(clear.depth) }),
          ];
        })(),
        el('dt', { text: 'Volume' }),
        el('dd', { text: `${roomVolume(plan, room).toFixed(1)} m³` }),
        el('dt', { text: 'Wall surface' }),
        el('dd', { text: `${roomWallArea(plan, room).toFixed(1)} m²` }),
        el('dt', { text: 'Perimeter' }),
        el('dd', { text: formatLength(perimeter(room.inner)) }),
        el('dt', { text: 'Counts as' }),
        el('dd', {
          text: `${Math.round((Number.isFinite(meta?.areaFactor) ? meta.areaFactor : usageSpec(meta?.usage).factor) * 100)} %`,
        }),
      ]),
      el('label', { class: 'toggle' }, [
        el('input', {
          type: 'checkbox',
          checked: room.kept !== false,
          onchange: () => this.interaction.toggleRoom(metaId),
        }),
        el('span', { class: 'name', text: 'Count this room' }),
      ]),
      el('p', { class: 'note', text: 'Wall surface is the perimeter times the height, less the doors and windows on it — near enough for pricing paint.' }),
    ]);
  }

  panelRooms(plan) {
    const rooms = derived(plan).rooms;
    if (!rooms.length) {
      return this.panel('Rooms', [
        el('p', { class: 'note', text: 'A room appears as soon as walls enclose a space, with its floor area measured inside the walls.' }),
      ]);
    }
    const kept = rooms.filter((r) => r.kept !== false);
    return this.panel(
      'Rooms',
      [
        el(
          'ul',
          { class: 'list' },
          rooms.map((room) =>
            el(
              'li',
              {
                class: `list-item${room.kept === false ? ' dropped' : ''}`,
                'aria-selected': String(
                  this.store.state.selection.some((s) => s.kind === 'room' && s.id === room.metaId)
                ),
                onclick: () => this.store.set({ selection: [{ kind: 'room', id: room.metaId }] }),
                ondblclick: () => this.renameRoom(room.metaId),
              },
              [
                el('input', {
                  type: 'checkbox',
                  checked: room.kept !== false,
                  title: 'Count this room',
                  onclick: (e) => {
                    e.stopPropagation();
                    this.interaction.toggleRoom(room.metaId);
                  },
                }),
                el('span', { class: 'item-name', text: room.name || 'Unnamed' }),
                el('span', { class: 'item-value', text: formatArea(roomFloorArea(plan, room)) }),
              ]
            )
          )
        ),
        (() => {
          // Only worth saying when there is a slope: otherwise the two are the same.
          const bands = kept.map((room) => roomHeadroomBands(plan, room));
          if (!bands.some((b) => b.slopes.length)) return null;
          const sum = (key) => bands.reduce((total, b) => total + b[key], 0);
          return el('div', {}, [
            el('dl', { class: 'readout', style: 'margin-top:10px' }, [
              el('dt', { text: 'Over 2 m' }),
              el('dd', { text: formatArea(sum('full')) }),
              el('dt', { text: '1–2 m, half' }),
              el('dd', { text: formatArea(sum('half')) }),
              el('dt', { text: 'Under 1 m' }),
              el('dd', { text: formatArea(sum('none')) }),
            ]),
            el('p', {
              class: 'note',
              text: 'Wohnfläche under WoFlV §4: full over two metres, half between one and two, nothing below one.',
            }),
          ]);
        })(),
        el('dl', { class: 'readout', style: 'margin-top:10px' }, [
          el('dt', { text: 'Counted' }),
          el('dd', { text: `${kept.length} of ${rooms.length}` }),
          el('dt', { text: 'Floor area' }),
          el('dd', { text: formatArea(totalArea(plan)) }),
          el('dt', { text: 'Living area' }),
          el('dd', { text: formatArea(livingArea(plan)) }),
        ]),
        el('div', { class: 'row row-wrap', style: 'margin-top:10px' }, [
          el(
            'button',
            { class: 'btn grow', type: 'button', onclick: () => this.dimensionOutside() },
            'Dimension the outside'
          ),
        ]),
        el('p', { class: 'note', style: 'margin-top:8px', text: 'Double-click a room to rename it. Click a room, then drag to move it.' }),
      ],
      el('span', { class: 'count', text: String(rooms.length) })
    );
  }

  /** Puts a dimension line along each outside face of the whole plan. */
  dimensionOutside() {
    const made = this.store.edit('dimension the outside', (project) => {
      const plan = activePlan(project);
      if (plan.nodes.length < 2) return false;
      let thickest = 0;
      for (const wall of plan.walls) thickest = Math.max(thickest, wall.thickness);
      const xs = plan.nodes.map((n) => n.x);
      const ys = plan.nodes.map((n) => n.y);
      const half = thickest / 2;
      const minX = Math.min(...xs) - half;
      const maxX = Math.max(...xs) + half;
      const minY = Math.min(...ys) - half;
      const maxY = Math.max(...ys) + half;
      // Each run is ordered so its offset pushes the line away from the building.
      const runs = [
        [{ x: maxX, y: minY }, { x: minX, y: minY }],
        [{ x: minX, y: minY }, { x: minX, y: maxY }],
        [{ x: minX, y: maxY }, { x: maxX, y: maxY }],
        [{ x: maxX, y: maxY }, { x: maxX, y: minY }],
      ];
      plan.dimensions = plan.dimensions.filter((d) => !d.auto);
      for (const [from, to] of runs) {
        plan.dimensions.push({ id: nextId('d'), from, to, offset: 700, auto: true });
      }
      return true;
    });
    if (made) {
      this.fitView();
      this.flash('Outside dimensions added. Drag any line to move it.');
    } else {
      this.flash('Draw some walls first.');
    }
  }

  // ---- storey, stairs, columns ---------------------------------------

  panelStorey(plan) {
    const project = this.store.project;
    const elevation = planElevation(project, plan);
    const numberField = (label, key, min, max, step) =>
      el('label', { class: 'field grow' }, [
        label,
        el('input', {
          type: 'number',
          value: String(Math.round(plan[key])),
          min: String(min),
          max: String(max),
          step: String(step),
          onchange: (e) => {
            const value = Number(e.target.value);
            if (!Number.isFinite(value) || value < min) return;
            this.store.edit('storey height', (project2) => {
              activePlan(project2)[key] = value;
              return true;
            });
          },
        }),
      ]);
    return this.panel('Storey', [
      el('div', { class: 'row' }, [
        numberField('Ceiling height', 'height', 1800, 5000, 50),
        numberField('Slab above', 'floorThickness', 100, 800, 10),
      ]),
      el('div', { class: 'row' }, [numberField('Plan cut at', 'cutHeight', 0, 2500, 50)]),
      el('dl', { class: 'readout' }, [
        el('dt', { text: 'Floor to floor' }),
        el('dd', { text: formatLength(floorToFloor(plan)) }),
        el('dt', { text: 'Level' }),
        el('dd', { text: `+${formatLength(elevation)}` }),
      ]),
      el('label', { class: 'toggle' }, [
        el('input', {
          type: 'checkbox',
          checked: plan.show.floorBelow === true,
          onchange: (e) => {
            plan.show.floorBelow = e.target.checked;
            touch(plan);
            this.store.scheduleSave();
            this.requestFrame();
          },
        }),
        el('span', { class: 'name', text: 'Show the floor below' }),
      ]),
      (() => {
        const knees = kneeWalls(plan);
        return knees.length
          ? el('dl', { class: 'readout' }, [
              el('dt', { text: 'Knee walls' }),
              el('dd', { text: `${knees.length}, ${Math.min(...knees.map((w) => Math.round(wallHeight(plan, w))))}–${Math.max(...knees.map((w) => Math.round(wallHeight(plan, w))))} mm` }),
            ])
          : null;
      })(),
      el('p', {
        class: 'note',
        text:
          'Give any wall its own height and it becomes a knee wall — a Drempel: drawn open, called out on the plan, and only that tall in 3D. A stair takes its rise from floor to floor, and is broken where it passes the cut.',
      }),
    ]);
  }

  /**
   * The sun, for a real place on a real day.
   *
   * The thing a drawing cannot otherwise tell you: which rooms get the morning, how
   * far the winter sun reaches into the house, whether the terrace still has light at
   * six in September. It is the same calculation an architect's shading study uses,
   * and it drives the shadows in the view rather than sitting beside them.
   */
  panelSun() {
    const site = this.store.project.site ?? {};
    const when = this.sunWhen();
    const tz = timezoneMinutes(when.year, when.month, when.day);
    const position = sunPosition(site, when, tz);
    const day = daylight(site, when);
    const change = () => {
      this.applySun();
      this.renderInspector();
      this.requestFrame();
    };
    const field = (label, node) => el('label', { class: 'field grow' }, [el('span', { text: label }), node]);
    const number = (value, step, min, max, set) =>
      el('input', {
        type: 'number',
        value: String(value),
        step: String(step),
        min: String(min),
        max: String(max),
        oninput: (e) => {
          const given = Number(e.target.value);
          if (Number.isFinite(given)) {
            set(given);
            change();
          }
        },
      });

    const up = position.altitude > -0.833;
    return this.panel('Sun and shadow', [
      el('div', { class: 'row' }, [
        field(
          'Place',
          el(
            'select',
            {
              onchange: (e) => {
                const place = PLACES[Number(e.target.value)];
                if (!place) return;
                Object.assign(this.store.project.site, place);
                change();
              },
            },
            PLACES.map((p, i) =>
              el('option', { value: String(i), selected: p.label === site.label, text: p.label })
            )
          )
        ),
      ]),
      el('div', { class: 'row' }, [
        field('Latitude °N', number(site.latitude, 0.01, -90, 90, (v) => (this.store.project.site.latitude = v))),
        field('Longitude °E', number(site.longitude, 0.01, -180, 180, (v) => (this.store.project.site.longitude = v))),
      ]),
      el('div', { class: 'row' }, [
        field(
          'Day',
          el(
            'select',
            {
              onchange: (e) => {
                const season = SEASONS.find((s) => s.id === e.target.value);
                if (season) {
                  this.sunDate = { month: season.month, day: season.day };
                  change();
                }
              },
            },
            [
              el('option', { value: '', text: 'Pick a date…' }),
              ...SEASONS.map((s) =>
                el('option', {
                  value: s.id,
                  selected: this.sunDate?.month === s.month && this.sunDate?.day === s.day,
                  text: s.label,
                })
              ),
            ]
          )
        ),
        field(
          'North is at °',
          number(site.bearing ?? 0, 5, -360, 360, (v) => (this.store.project.site.bearing = v))
        ),
      ]),
      // The two that get dragged, so they are sliders rather than boxes.
      el('label', { class: 'field' }, [
        el('span', { text: `Date — ${when.day}.${when.month}.` }),
        el('input', {
          type: 'range',
          min: '1',
          max: '365',
          value: String(dayOfYear(when.month, when.day)),
          oninput: (e) => {
            this.sunDate = fromDayOfYear(Number(e.target.value));
            change();
          },
        }),
      ]),
      el('label', { class: 'field' }, [
        el('span', { text: `Time — ${clock(when.minutes)}` }),
        el('input', {
          type: 'range',
          min: '0',
          max: '1439',
          step: '5',
          value: String(when.minutes),
          oninput: (e) => {
            this.sunTime = Number(e.target.value);
            change();
          },
        }),
      ]),
      el('dl', { class: 'readout' }, [
        el('dt', { text: 'Height' }),
        el('dd', { text: up ? `${position.altitude.toFixed(1)}°` : 'below the horizon' }),
        el('dt', { text: 'Bearing' }),
        el('dd', { text: `${position.azimuth.toFixed(0)}° ${compassPoint(position.azimuth)}` }),
        el('dt', { text: 'Sunrise' }),
        el('dd', { text: clock(day.rise) }),
        el('dt', { text: 'Sunset' }),
        el('dd', { text: clock(day.set) }),
        el('dt', { text: 'Daylight' }),
        el('dd', { text: `${day.hours.toFixed(1)} h` }),
      ]),
      el('p', {
        class: 'note',
        text: up
          ? 'Shadows in the view are cast by this sun. Turn the building with “North is at” to match the site.'
          : 'The sun is down, so the view is lit by the sky alone.',
      }),
      this.panelWindowSun(),
    ]);
  }

  /** How long the sun reaches each window today — the figure you actually want. */
  panelWindowSun() {
    const plan = activePlan(this.store.project);
    const site = this.store.project.site ?? {};
    const when = this.sunWhen();
    const rows = windowSunHours(plan, site, when, openingGeometry);
    if (!rows.length) return el('span');
    return el('div', {}, [
      el('div', { class: 'group-label', text: 'Direct sun today' }),
      el(
        'table',
        { class: 'sched' },
        [
          el('tr', {}, [
            el('th', { text: 'Window' }),
            el('th', { text: 'Faces' }),
            el('th', { class: 'num', text: 'Hours' }),
            el('th', { class: 'num', text: 'From' }),
            el('th', { class: 'num', text: 'To' }),
          ]),
          ...rows.map((row) =>
            el('tr', {}, [
              el('td', { text: row.name }),
              el('td', { text: row.faces }),
              el('td', { class: 'num', text: row.hours ? row.hours.toFixed(1) : '—' }),
              el('td', { class: 'num', text: clock(row.from) }),
              el('td', { class: 'num', text: clock(row.to) }),
            ])
          ),
        ]
      ),
      el('p', {
        class: 'note',
        text: 'When the sun is up and on that side of the wall. It does not know about the neighbour’s trees.',
      }),
    ]);
  }

  /** The moment the sun panel is set to. */
  sunWhen() {
    const date = this.sunDate ?? { month: 6, day: 21 };
    return { year: new Date().getFullYear(), month: date.month, day: date.day, minutes: this.sunTime ?? 12 * 60 };
  }

  /** Point the 3D view's light where the sun actually is. */
  applySun() {
    const site = this.store.project.site ?? {};
    const position = sunPosition(site, this.sunWhen());
    const up = position.altitude > -0.833;
    this.view3d.setSun(sunVector(position, site.bearing ?? 0), up);
  }

  panel3d(plan) {
    const toggle = (label, get, set) =>
      el('label', { class: 'toggle' }, [
        el('input', {
          type: 'checkbox',
          checked: get(),
          onchange: (e) => {
            set(e.target.checked);
            this.rebuildMesh(false);
            this.renderInspector();
            this.requestFrame();
          },
        }),
        el('span', { class: 'name', text: label }),
      ]);
    return this.panel('3D view', [
      el('p', { class: 'note', text: 'Drag to turn it, shift-drag to slide, scroll to zoom.' }),
      toggle(
        'Measurements',
        () => this.show3dMarks !== false,
        (v) => {
          this.show3dMarks = v;
        }
      ),
      toggle(
        'This floor only',
        () => this.only3dFloor === true,
        (v) => {
          this.only3dFloor = v;
        }
      ),
      toggle(
        'Drawn, with outlines',
        () => this.outlined3d !== false,
        (v) => {
          this.outlined3d = v;
          this.view3d.outlined = v;
        }
      ),
      toggle(
        'Colour wash',
        () => this.washed3d !== false,
        (v) => {
          this.washed3d = v;
          this.view3d.wash = v ? 0.26 : 0;
        }
      ),
      el('div', { class: 'row row-wrap' }, [
        el(
          'button',
          {
            class: 'btn grow',
            type: 'button',
            onclick: () => {
              this.rebuildMesh(true);
              this.requestFrame();
            },
          },
          'Reframe (0)'
        ),
        el('button', { class: 'btn', type: 'button', onclick: () => this.setMode('2d') }, 'Back to the plan'),
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el(
          'button',
          {
            class: this.walking ? 'btn btn-primary grow' : 'btn grow',
            type: 'button',
            onclick: () => this.setWalking(!this.walking),
          },
          this.walking ? 'Stop walking (Esc)' : 'Walk through it'
        ),
      ]),
      el('p', {
        class: 'note',
        text: this.walking
          ? 'Move the mouse to look, W A S D or the arrows to walk, Shift to hurry. The walls stop you; the doorways do not.'
          : 'Stand inside it at eye height and walk about. The sizes are on the plan; this is the only way to find out what the rooms are like.',
      }),
      el('p', {
        class: 'note',
        text: 'Show one floor at a time to look inside at the stairs. Knee walls stand at their own height, so a Drempel reads straight away.',
      }),
    ]);
  }

  panelStair(plan, id) {
    const stair = findStair(plan, id);
    if (!stair) return null;
    const checks = stairChecks(stair);
    const level = worstLevel(checks);
    const update = (partial) => {
      this.store.edit('stair', (project) => {
        const target = findStair(activePlan(project), id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    const numberField = (label, key, min, max, step) =>
      el('label', { class: 'field grow' }, [
        label,
        el('input', {
          type: 'number',
          value: String(Math.round(stair[key])),
          min: String(min),
          max: String(max),
          step: String(step),
          onchange: (e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value >= min) update({ [key]: value });
          },
        }),
      ]);
    return this.panel(
      'Stair',
      [
        el(
          'div',
          { class: 'seg' },
          STAIR_SHAPES.map((shape) =>
            el(
              'button',
              {
                class: 'seg-btn',
                type: 'button',
                title: shape.de,
                'aria-pressed': String(stair.shape === shape.id),
                onclick: () => update({ shape: shape.id }),
              },
              shape.label
            )
          )
        ),
        el('p', { class: 'note', text: STAIR_SHAPES.find((s2) => s2.id === stair.shape)?.de ?? '' }),
        el('div', { class: 'row' }, [
          numberField('Rise', 'rise', 300, 6000, 10),
          numberField('Steps', 'steps', 2, 40, 1),
        ]),
        el('div', { class: 'row' }, [
          numberField('Tread', 'treadDepth', 150, 450, 5),
          numberField('Width', 'width', 500, 3000, 10),
        ]),
        stair.shape === 'winder' || stair.shape === 'halfwinder'
          ? el('div', {}, [
              el('div', { class: 'row' }, [
                numberField('Steps before the first turn', 'landingAfter', 0, Math.max(1, stair.steps - 2), 1),
                numberField('Winders per corner', 'winderSteps', 1, 6, 1),
              ]),
              el('div', { class: 'row' }, [
                numberField('Inner curve radius', 'newel', 0, 800, 10),
                stair.shape === 'halfwinder'
                  ? numberField('Steps between the turns', 'middleSteps', 0, 6, 1)
                  : null,
              ]),
              el('p', {
                class: 'note',
                text:
                  stair.shape === 'halfwinder'
                    ? 'Two corners, so the flight comes back alongside itself. No steps between the turns winds the whole 180° in one go; one or two steps between them widens the stairwell and gives two distinct corners.'
                    : 'Zero steps before the turn winds the flight straight off the bottom step, which is how a tight German hall is usually solved. The inner curve keeps the narrow end of each winder above the 100 mm minimum.',
              }),
            ])
          : null,
        stair.shape === 'spiral'
          ? el('div', { class: 'row' }, [
              numberField('Newel radius', 'innerRadius', 60, 1200, 20),
              numberField('Sweep (°)', 'sweep', 90, 1080, 15),
            ])
          : null,
        stair.shape === 'landing' || stair.shape === 'uturn' || stair.shape === 'winder' || stair.shape === 'halfwinder'
          ? el('div', { class: 'row' }, [
              stair.shape === 'winder' || stair.shape === 'halfwinder'
                ? null
                : numberField('Steps before the landing', 'landingAfter', 1, Math.max(1, stair.steps - 2), 1),
              el('label', { class: 'field grow' }, [
                'Turn',
                el(
                  'select',
                  { onchange: (e) => update({ turn: e.target.value }) },
                  [
                    ['right', 'To the right'],
                    ['left', 'To the left'],
                  ].map(([value, label]) => el('option', { value, selected: stair.turn === value }, label))
                ),
              ]),
            ])
          : null,
        stair.shape === 'spiral'
          ? el('label', { class: 'field' }, [
              'Winds',
              el(
                'select',
                { onchange: (e) => update({ turn: e.target.value }) },
                [
                  ['right', 'Clockwise going up'],
                  ['left', 'Anticlockwise going up'],
                ].map(([value, label]) => el('option', { value, selected: stair.turn === value }, label))
              ),
            ])
          : null,
        el('div', { class: 'row' }, [
          el('label', { class: 'field grow' }, [
            'Direction',
            el(
              'select',
              { onchange: (e) => update({ direction: e.target.value }) },
              [
                ['up', 'Up from this floor'],
                ['down', 'Down from this floor'],
              ].map(([value, label]) => el('option', { value, selected: stair.direction === value }, label))
            ),
          ]),
          el('label', { class: 'field grow' }, [
            'Turned by',
            el('input', {
              type: 'number',
              value: String(Math.round(stair.rotation ?? 0)),
              step: '15',
              onchange: (e) => update({ rotation: Number(e.target.value) }),
            }),
          ]),
        ]),
        el('dl', { class: 'readout' }, [
          el('dt', { text: 'On the plan' }),
          el('dd', { text: stairLabel(stair) }),
          el('dt', { text: 'Footprint' }),
          el('dd', {
            text: (() => {
              const parts = stairParts(stair);
              return `${formatLength(parts.run)} × ${formatLength(parts.across)}`;
            })(),
          }),
          el('dt', { text: 'Walked' }),
          el('dd', { text: formatLength(stairParts(stair).walked) }),
          el('dt', { text: 'Walking line' }),
          el('dd', { text: `${Math.round(walkingTread(stair))} mm, ${Math.round(walkOffset(stair.width))} mm in` }),
          el('dt', { text: 'Cut at' }),
          el('dd', {
            text: (() => {
              const step = cutTreadStep(stair, plan.cutHeight ?? DEFAULT_CUT_HEIGHT);
              return step === null ? 'not crossed' : `step ${step}`;
            })(),
          }),
          el('dt', { text: 'Headroom' }),
          el('dd', {
            text: (() => {
              const head = stairHeadroom(this.store.project, plan, stair);
              if (!head.worst) return '—';
              return head.worst.headroom <= 0 ? 'none' : formatLength(head.worst.headroom);
            })(),
          }),
        ]),
        (() => {
          // Two metres over every tread is what DIN 18065 asks for, and a flight to
          // the storey above only gets it through a hole in the slab.
          const head = stairHeadroom(this.store.project, plan, stair);
          if (!head.worst) return null;
          if (head.ok) {
            return el('p', {
              class: 'note',
              text: `Two metres clear over every step — the tightest is step ${head.worst.step} at ${formatLength(head.worst.headroom)}.`,
            });
          }
          const need = head.needsOpening;
          return el('div', { class: 'stack' }, [
            el('p', {
              class: 'note',
              text: head.worst.headroom <= 0
                ? `Steps ${head.shortFrom}–${head.shortTo} run into the slab above. ${
                    head.above ? 'The floor above needs an opening for the flight to come up through.' : 'There is no storey above yet.'
                  }`
                : `Step ${head.worst.step} has only ${formatLength(head.worst.headroom)} of headroom; DIN 18065 asks for 2,00 m. Steps ${head.shortFrom}–${head.shortTo} are short.`,
            }),
            head.above && need
              ? el(
                  'button',
                  {
                    class: 'btn',
                    type: 'button',
                    onclick: () => {
                      this.store.edit('cut the stair opening', (project) => {
                        const above = storeyAbove(project, activePlan(project));
                        if (!above) return false;
                        addVoid(above, need.x, need.y, { ...need, label: 'Stair well' });
                        return true;
                      });
                      this.flash(`Cut a ${Math.round(need.w)} × ${Math.round(need.h)} mm opening in the floor above.`);
                    },
                  },
                  `Cut the ${Math.round(need.w)} × ${Math.round(need.h)} opening it needs`
                )
              : null,
          ]);
        })(),
        el(
          'ul',
          { class: 'checks' },
          checks.map((c) => el('li', { class: `check check-${c.level}`, text: c.text }))
        ),
        el('p', {
          class: 'note',
          text:
            stair.shape === 'spiral'
              ? 'A spiral is placed by its newel centre; turn it to set where the first step begins. Checked against DIN 18065 for houses of up to two dwellings.'
              : 'Drawn the German way: solid up to the cut plane, thin beyond the break line, walking line from a circle at the first riser to an arrow at the last. Checked against DIN 18065 for houses of up to two dwellings.',
        }),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete stair'),
      ],
      el('span', {
        class: `chip ${level === 'bad' ? 'chip-bad' : level === 'warn' ? 'chip-warn' : 'chip-good'}`,
        text: level === 'bad' ? 'not allowed' : level === 'warn' ? 'tight' : 'fine',
      })
    );
  }

  panelColumn(plan, id) {
    const column = findColumn(plan, id);
    if (!column) return null;
    const update = (partial) => {
      this.store.edit('column', (project) => {
        const target = findColumn(activePlan(project), id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    return this.panel('Column', [
      el(
        'div',
        { class: 'seg' },
        COLUMN_SHAPES.map((shape) =>
          el(
            'button',
            {
              class: 'seg-btn',
              type: 'button',
              'aria-pressed': String(column.shape === shape.id),
              onclick: () => update({ shape: shape.id }),
            },
            shape.label
          )
        )
      ),
      el('div', { class: 'row' }, [
        el('label', { class: 'field grow' }, [
          'Width',
          el('input', {
            type: 'number',
            value: String(Math.round(column.w)),
            min: '80',
            step: '10',
            onchange: (e) => update({ w: Number(e.target.value) }),
          }),
        ]),
        el('label', { class: 'field grow' }, [
          'Depth',
          el('input', {
            type: 'number',
            value: String(Math.round(column.h)),
            min: '80',
            step: '10',
            onchange: (e) => update({ h: Number(e.target.value) }),
          }),
        ]),
      ]),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete column'),
    ]);
  }

  // ---- schedules ------------------------------------------------------

  panelSchedules(plan) {
    const rooms = derived(plan).rooms.filter((r) => r.kept !== false);
    const openings = openingSchedule(plan);
    if (!rooms.length && !openings.length) return null;
    const sloped = rooms.some((room) => roomHeadroomBands(plan, room).slopes.length);
    const roomRows = rooms.map((room) => {
      const meta = roomMetaFor(plan, room);
      const bands = roomHeadroomBands(plan, room);
      return el('tr', {}, [
        el('td', { text: room.name || '—' }),
        el('td', { text: usageSpec(meta?.usage).label }),
        el('td', { class: 'num', text: formatArea(roomFloorArea(plan, room)) }),
        sloped ? el('td', { class: 'num', text: formatArea(bands.half) }) : null,
        sloped ? el('td', { class: 'num', text: formatArea(bands.none) }) : null,
        el('td', { class: 'num', text: formatArea(roomLivingArea(plan, room)) }),
        el('td', { class: 'num', text: `${roomVolume(plan, room).toFixed(1)} m³` }),
      ].filter(Boolean));
    });
    return this.panel(
      'Schedules',
      [
        rooms.length
          ? el('table', { class: 'sched' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Room' }),
                  el('th', { text: 'Use' }),
                  el('th', { class: 'num', text: 'Floor' }),
                  sloped ? el('th', { class: 'num', text: '1–2 m' }) : null,
                  sloped ? el('th', { class: 'num', text: '<1 m' }) : null,
                  el('th', { class: 'num', text: 'Wohnfl.' }),
                  el('th', { class: 'num', text: 'Volume' }),
                ].filter(Boolean)),
              ]),
              el('tbody', {}, roomRows),
            ])
          : null,
        openings.length ? el('div', { class: 'group-label', text: 'Doors and windows' }) : null,
        openings.length
          ? el('table', { class: 'sched' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { text: 'Mark' }),
                  el('th', { text: 'Type' }),
                  el('th', { class: 'num', title: 'The leaf — what you order', text: 'Leaf' }),
                  el('th', { class: 'num', title: 'The hole in the wall', text: 'Rohbau' }),
                  el('th', { class: 'num', text: 'Sill' }),
                  el('th', { class: 'num', text: 'No.' }),
                ]),
              ]),
              el(
                'tbody',
                {},
                openings.map((row) =>
                  el('tr', {}, [
                    el('td', { text: row.mark }),
                    el('td', { text: row.label }),
                    el('td', { class: 'num', text: `${row.width} × ${row.height}` }),
                    el('td', { class: 'num', text: `${row.hole} × ${row.height}` }),
                    el('td', { class: 'num', text: String(row.sill) }),
                    el('td', { class: 'num', text: String(row.count) }),
                  ])
                )
              ),
            ])
          : null,
        el('button', { class: 'btn', type: 'button', onclick: () => this.exportSchedulesCsv() }, [
          icon('i-download'),
          'Schedules as CSV',
        ]),
      ],
      el('span', { class: 'count', text: `${rooms.length}+${openings.length}` })
    );
  }

  /**
   * What the drawing adds up to, in the terms somebody prices it in.
   *
   * A schedule says what things are; this says how much of them there is — the figures a
   * trade asks for first, and the ones most often got wrong by counting off a drawing by
   * hand. Every one is measured off the drawing, so it cannot disagree with what is
   * drawn.
   */
  panelQuantities() {
    const project = this.store.project;
    const plan = activePlan(project);
    const summary = summaryQuantities(project, plan);
    const walls = wallQuantities(plan);
    const floors = floorQuantities(plan);
    const openings = openingQuantities(plan);
    const table = (head, rows) =>
      rows.length
        ? el('table', { class: 'sched' }, [
            el('thead', {}, [el('tr', {}, head.map((h, i) => el('th', { class: i ? 'num' : '', text: h })))]),
            el(
              'tbody',
              {},
              rows.map((row) =>
                el('tr', {}, row.map((cell, i) => el('td', { class: i ? 'num' : '', text: String(cell) })))
              )
            ),
          ])
        : null;

    return this.panel(
      'Quantities',
      [
        el('dl', { class: 'readout' }, [
          el('dt', { text: 'Wall run' }),
          el('dd', { text: `${summary.wallRun.toFixed(2).replace('.', ',')} m` }),
          el('dt', { text: 'Wall faces to finish' }),
          el('dd', { text: `${summary.wallFaces.toFixed(2).replace('.', ',')} m²` }),
          el('dt', { text: 'Skirting' }),
          el('dd', { text: `${summary.skirting.toFixed(2).replace('.', ',')} m` }),
          el('dt', { text: 'Volume' }),
          el('dd', { text: `${summary.volume.toFixed(1).replace('.', ',')} m³` }),
        ]),
        el('p', { class: 'note', text: 'Wall faces are both sides, less the openings. Skirting runs round each room, less nothing — take the doorways off yourself.' }),
        table(['Wall', 'Run m', 'Faces m²'], walls.map((row) => [`${row.label} ${row.thickness}`, row.run.toFixed(2).replace('.', ','), row.faces.toFixed(2).replace('.', ',')])),
        table(['Floor', 'Area m²', 'Skirting m'], floors.map((row) => [row.label, row.area.toFixed(2).replace('.', ','), row.skirting.toFixed(2).replace('.', ',')])),
        table(['Opening', 'No.', 'Lintels m'], openings.map((row) => [`${row.kind} ${row.leaf}×${row.height}`, row.count, row.lintels.toFixed(2).replace('.', ',')])),
        el('button', { class: 'btn', type: 'button', onclick: () => this.exportQuantitiesCsv() }, [
          icon('i-download'),
          'Quantities as CSV',
        ]),
      ]
      // No count in the corner: the panel is a set of quantities, and a tally of doors
      // and windows beside that heading reads as though it were one of them.
    );
  }

  exportQuantitiesCsv() {
    const plan = activePlan(this.store.project);
    downloadBlob(
      new Blob([quantitiesCsv(this.store.project, plan)], { type: 'text/csv;charset=utf-8' }),
      safeFilename(`${plan.name} quantities`, 'csv')
    );
    this.flash('Quantities exported.');
  }

  exportSchedulesCsv() {
    const plan = activePlan(this.store.project);
    const rows = [
      [
        'Room',
        'Use',
        'Floor m2',
        'Over 2m m2',
        '1-2m m2',
        'Under 1m m2',
        'Wohnflaeche m2',
        'Height mm',
        'Volume m3',
        'Wall area m2',
      ],
    ];
    for (const room of derived(plan).rooms.filter((r) => r.kept !== false)) {
      const meta = roomMetaFor(plan, room);
      const bands = roomHeadroomBands(plan, room);
      const m2 = (mm2) => (mm2 / 1e6).toFixed(2);
      rows.push([
        room.name || '',
        usageSpec(meta?.usage).label,
        m2(roomFloorArea(plan, room)),
        m2(bands.full),
        m2(bands.half),
        m2(bands.none),
        m2(roomLivingArea(plan, room)),
        String(Math.round(roomHeight(plan, room))),
        roomVolume(plan, room).toFixed(2),
        roomWallArea(plan, room).toFixed(2),
      ]);
    }
    rows.push([]);
    rows.push(['Fixture', 'Group', 'Height mm', 'Count']);
    for (const row of fixtureSchedule(plan)) {
      rows.push([row.label, row.group, String(row.height), String(row.count)]);
    }
    rows.push([]);
    rows.push(['Mark', 'Type', 'Leaf width mm', 'Rohbau width mm', 'Height mm', 'Sill mm', 'Count']);
    for (const row of openingSchedule(plan)) {
      rows.push([row.mark, row.label, String(row.width), String(row.hole), String(row.height), String(row.sill), String(row.count)]);
    }
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), safeFilename(`${plan.name}-schedules`, 'csv'));
    this.flash('Schedules exported.');
  }

  // ---- fixtures -------------------------------------------------------

  /** Says once, plainly, when an edit had to join walls that were only touching. */
  /**
   * What had to be thrown away to open a drawing.
   *
   * `normaliseProject` drops walls standing on corners that are not there, and counts
   * them. It was counting them into a field nobody read, so a file that arrived damaged
   * came up quietly short — which is the worst way to find out.
   */
  reportDropped(project) {
    const lost = (project?.plans ?? []).reduce((total, plan) => total + (plan.dropped ?? 0), 0);
    if (!lost) return;
    for (const plan of project.plans) delete plan.dropped;
    this.flash(
      lost === 1
        ? 'One wall in that drawing stood on a corner that was not there, and was left out.'
        : `${lost} walls in that drawing stood on corners that were not there, and were left out.`
    );
  }

  reportHealing(report) {
    if (!report) return;
    const parts = [];
    if (report.tees) parts.push(`${report.tees} ${report.tees === 1 ? 'wall' : 'walls'} split where another met it`);
    if (report.crossings) parts.push(`${report.crossings} crossing${report.crossings === 1 ? '' : 's'} joined`);
    if (report.welded) parts.push(`${report.welded} loose end${report.welded === 1 ? '' : 's'} welded`);
    if (report.merged) parts.push(`${report.merged} doubled-up wall${report.merged === 1 ? '' : 's'} merged`);
    if (parts.length) this.flash(`Junctions: ${parts.join(', ')}.`);
  }

  panelFixture(plan, id) {
    const fixture = findFixture(plan, id);
    if (!fixture) return null;
    const spec = fixtureSpec(fixture.kind);
    if (isRadiator(fixture.kind)) return this.panelRadiator(plan, fixture);
    const update = (partial) => {
      this.store.edit('fixture', (project) => {
        const target = findFixture(activePlan(project), id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    const wall = fixture.wallId ? findWall(plan, fixture.wallId) : null;
    return this.panel(
      spec.label,
      [
        el('div', { class: 'row' }, [
          el('label', { class: 'field grow' }, [
            'Height above floor',
            el('input', {
              type: 'number',
              value: String(Math.round(fixture.height ?? spec.height)),
              min: '0',
              max: '3000',
              step: '50',
              onchange: (e) => update({ height: Number(e.target.value) }),
            }),
          ]),
          el('label', { class: 'field grow' }, [
            'Symbol size',
            el('input', {
              type: 'number',
              value: String(Math.round(fixture.size ?? spec.size)),
              min: '80',
              max: '2000',
              step: '20',
              onchange: (e) => update({ size: Number(e.target.value) }),
            }),
          ]),
        ]),
        wall
          ? el('label', { class: 'field' }, [
              `Along the wall (mm) — wall is ${Math.round(wallLength(plan, wall))}`,
              el('input', {
                type: 'number',
                value: String(Math.round(fixture.offset ?? 0)),
                min: '0',
                step: '10',
                onchange: (e) => update({ offset: Math.max(0, Number(e.target.value)) }),
              }),
            ])
          : el('p', { class: 'note', text: 'This one sits loose in the room rather than on a wall.' }),
        wall
          ? el('div', { class: 'row row-wrap' }, [
              el(
                'button',
                { class: 'btn', type: 'button', onclick: () => update({ side: (fixture.side ?? 1) * -1 }) },
                'Other side of the wall'
              ),
            ])
          : null,
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete'),
      ],
      el('span', { class: 'chip', text: `${Math.round(fixture.height ?? spec.height)} mm` })
    );
  }

  panelClearances(plan) {
    const issues = clearanceIssues(plan);
    const bad = issues.filter((i) => i.level === 'bad').length;
    const show = plan.show?.clearances === true;
    const toggle = el('label', { class: 'toggle' }, [
      el('input', {
        type: 'checkbox',
        checked: show,
        onchange: (e) => {
          plan.show.clearances = e.target.checked;
          touch(plan);
          this.store.scheduleSave();
          this.requestFrame();
        },
      }),
      el('span', { class: 'name', text: 'Show the zones on the drawing' }),
    ]);
    if (!issues.length) {
      // Only worth a panel at all once there is something that could clash.
      const anything = (plan.openings ?? []).length && (plan.furniture ?? []).length;
      if (!anything) return null;
      return this.panel(
        'Clearances',
        [
          el('p', { class: 'note', text: 'Every door can open and every fitting has its room.' }),
          toggle,
        ],
        el('span', { class: 'chip chip-good', text: 'clear' })
      );
    }
    return this.panel(
      'Clearances',
      [
        el(
          'ul',
          { class: 'checks' },
          issues.slice(0, 12).map((issue) =>
            el('li', {
              class: `check check-${issue.level}`,
              text: issue.text,
              style: 'cursor:pointer',
              onclick: () => {
                if (!issue.at) return;
                this.centreOn(issue.at);
              },
            })
          )
        ),
        issues.length > 12
          ? el('p', { class: 'note', text: `and ${issues.length - 12} more.` })
          : null,
        toggle,
        el('p', {
          class: 'note',
          text: 'A door needs its whole quarter circle clear, and a fitting the room a standard gives it — DIN 68935 for a WC or a basin. Click one to go to it.',
        }),
      ],
      el('span', {
        class: `chip ${bad ? 'chip-bad' : 'chip-warn'}`,
        text: bad ? `${bad} in the way` : `${issues.length} tight`,
      })
    );
  }

  /** Slides the view so a point sits in the middle of the drawing. */
  centreOn(point) {
    const view = this.store.state.view;
    view.x = point.x - this.renderer.width / 2 / view.scale;
    view.y = point.y - this.renderer.height / 2 / view.scale;
    this.requestFrame();
  }

  panelRadiator(plan, fixture) {
    const rad = radiatorSpec(fixture);
    const update = (partial) => {
      this.store.edit('radiator', (project) => {
        const target = findFixture(activePlan(project), fixture.id);
        if (!target) return false;
        Object.assign(target, partial);
        return true;
      });
    };
    const numberField = (label, key, value, min, max, step) =>
      el('label', { class: 'field grow' }, [
        label,
        el('input', {
          type: 'number',
          value: String(Math.round(value)),
          min: String(min),
          max: String(max),
          step: String(step),
          onchange: (e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next >= min) update({ [key]: next });
          },
        }),
      ]);
    return this.panel(
      'Radiator',
      [
        el(
          'div',
          { class: 'seg' },
          RADIATOR_TYPES.map((type) =>
            el(
              'button',
              {
                class: 'seg-btn',
                type: 'button',
                title: type.hint,
                'aria-pressed': String(rad.type.id === type.id),
                onclick: () => update({ radType: type.id }),
              },
              [type.label, el('span', { class: 'seg-sub', text: `${type.depth} mm` })]
            )
          )
        ),
        el('p', { class: 'note', text: rad.type.hint }),
        el('div', { class: 'row' }, [
          numberField('Length', 'size', rad.length, 200, 4000, 50),
          numberField('Height', 'panelHeight', rad.height, 200, 2200, 50),
        ]),
        el('label', { class: 'field' }, [
          'A height it comes in',
          el(
            'select',
            { onchange: (e) => update({ panelHeight: Number(e.target.value) }) },
            RADIATOR_HEIGHTS.map((h) =>
              el('option', { value: String(h), selected: Math.round(rad.height) === h }, `${h} mm`)
            )
          ),
        ]),
        numberField('Off the floor', 'height', fixture.height ?? 600, 0, 2500, 50),
        el('dl', { class: 'readout' }, [
          el('dt', { text: 'Output' }),
          el('dd', { text: `${rad.watts} W` }),
          el('dt', { text: 'Takes up' }),
          el('dd', { text: `${Math.round(rad.length)} × ${Math.round(rad.depth)} mm` }),
        ]),
        el('p', {
          class: 'note',
          text: 'Output at 75/65/20, which is what a merchant quotes. A rule of thumb wants about 60–100 W per square metre of room, more under a big window.',
        }),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.interaction.deleteSelection() }, 'Delete'),
      ],
      el('span', { class: 'chip', text: `${rad.watts} W` })
    );
  }

  panelFixtureSchedule(plan) {
    const rows = fixtureSchedule(plan);
    if (!rows.length) return null;
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    return this.panel(
      'Fixture schedule',
      [
        el('table', { class: 'sched' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Fixture' }),
              el('th', { text: 'Group' }),
              el('th', { class: 'num', text: 'Height' }),
              el('th', { class: 'num', text: 'No.' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            rows.map((row) =>
              el('tr', {}, [
                el('td', { text: row.label }),
                el('td', { text: row.group }),
                el('td', { class: 'num', text: String(row.height) }),
                el('td', { class: 'num', text: String(row.count) }),
              ])
            )
          ),
        ]),
        (() => {
          const watts = (plan.fixtures ?? [])
            .filter((f) => isRadiator(f.kind))
            .reduce((sum, f) => sum + radiatorSpec(f).watts, 0);
          if (!watts) return null;
          return el('dl', { class: 'readout', style: 'margin-top:8px' }, [
            el('dt', { text: 'Heating' }),
            el('dd', { text: `${watts} W` }),
          ]);
        })(),
        el('p', { class: 'note', text: 'Counts every socket, switch and light on this floor — the list an electrician wants for a quote.' }),
      ],
      el('span', { class: 'count', text: String(total) })
    );
  }

  panelDrawing(plan) {
    const state = this.store.state;
    plan.show ??= { rooms: true, dimensions: true, labels: true, furniture: true, backdrop: true, openingSizes: false };
    plan.show.stairCut ??= true;
    const segRow = (label, items, current, pick) =>
      el('div', { class: 'field', style: 'margin-bottom:10px' }, [
        label,
        el(
          'div',
          { class: 'seg', style: 'margin:4px 0 0' },
          items.map((item) =>
            el(
              'button',
              {
                class: 'seg-btn',
                type: 'button',
                title: item.hint ?? null,
                'aria-pressed': String(item.id === current),
                onclick: () => {
                  pick(item.id);
                  touch(plan);
                  this.store.scheduleSave();
                  this.renderAll();
                  this.renderSettings();
                },
              },
              item.label
            )
          )
        ),
      ]);
    return this.panel('Drawing', [
      segRow('Corners', JOIN_STYLES, plan.joinStyle ?? 'mitre', (id) => {
        plan.joinStyle = id;
      }),
      segRow('Sizes measured', DIM_BASES, plan.dimBasis ?? 'outer', (id) => {
        plan.dimBasis = id;
      }),
      el('div', { class: 'row row-wrap' }, [
        el(
          'button',
          {
            class: 'btn grow',
            type: 'button',
            'aria-pressed': String(state.orthoLock === true),
            onclick: () => {
              this.store.set({ orthoLock: !state.orthoLock });
              this.renderSettings();
            },
          },
          'Ortho lock (O)'
        ),
        el(
          'button',
          {
            class: 'btn grow',
            type: 'button',
            'aria-pressed': String(state.snapEnabled !== false),
            onclick: () => {
              this.store.set({ snapEnabled: state.snapEnabled === false });
              this.renderSettings();
            },
          },
          'Snapping (G)'
        ),
      ]),
      el('label', { class: 'field' }, [
        'Grid step (mm)',
        el(
          'select',
          {
            onchange: (e) => {
              this.store.set({ gridMm: Number(e.target.value) });
              this.renderSettings();
            },
          },
          [0, 10, 25, 50, 100, 250, 500].map((step) =>
            el('option', { value: String(step), selected: state.gridMm === step }, step === 0 ? 'None' : String(step))
          )
        ),
      ]),
      el('label', { class: 'field' }, [
        'Drawing scale',
        el(
          'select',
          {
            onchange: (e) => {
              plan.scaleDenominator = Number(e.target.value);
              touch(plan);
              this.store.scheduleSave();
              this.renderAll();
              this.renderSettings();
            },
          },
          STANDARD_SCALES.map((d) =>
            el('option', { value: String(d), selected: Math.round(plan.scaleDenominator ?? 100) === Math.round(d) }, `1:${Math.round(d)}`)
          )
        ),
      ]),
      el('p', { class: 'note', text: 'The scale is what an export is drawn at. It does not change any real size.' }),
    ]);
  }

  panelBackdrop(plan) {
    const backdrop = plan.backdrop;
    if (!backdrop?.kind) {
      return this.panel('Trace a plan', [
        el('p', { class: 'note', text: 'Put a PDF or a photo faintly underneath and draw on top of it.' }),
        el('button', { class: 'btn', type: 'button', onclick: () => this.fileInput.click() }, [icon('i-upload'), 'Choose a file']),
      ]);
    }
    return this.panel(
      'Traced plan',
      [
        el('label', { class: 'field' }, [
          'Fade',
          el('input', {
            type: 'range',
            min: '5',
            max: '90',
            value: String(Math.round((backdrop.opacity ?? 0.3) * 100)),
            oninput: (e) => {
              backdrop.opacity = Number(e.target.value) / 100;
              touch(plan);
              this.requestFrame();
            },
            onchange: () => this.store.scheduleSave(),
          }),
        ]),
        el('p', { class: 'note', text: 'Set the scale by measuring something you know the real length of.' }),
        el('button', { class: 'btn', type: 'button', onclick: () => this.startCalibration() }, 'Measure a known length'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.removeBackdrop() }, 'Remove'),
      ],
      el('span', { class: 'chip', text: backdrop.kind === 'pdf' ? 'PDF' : 'image' })
    );
  }

  panelFloors() {
    const project = this.store.project;
    // Listed the way a building is drawn in section: the top storey at the top. The
    // list used to be in the order the floors were drawn, which is how a cellar drawn
    // second came to sit on the roof.
    const stacked = [...floorsInOrder(project)].reverse();
    const storeyOf = (plan) => (Number.isFinite(plan.storey) ? plan.storey : floorsInOrder(project).indexOf(plan));
    return this.panel(
      'Floors',
      [
        el(
          'ul',
          { class: 'list' },
          stacked.map((plan) =>
            el(
              'li',
              {
                class: 'list-item',
                'aria-selected': String(plan.id === project.activePlanId),
                onclick: () => {
                  project.activePlanId = plan.id;
                  this.store.set({ selection: [] });
                  this.fitView();
                },
                ondblclick: () => this.renamePlan(plan.id),
              },
              [
                el('span', { class: 'item-name', text: plan.name }),
                el('span', {
                  class: 'chip',
                  title: 'Which storey this is: 0 is the ground floor, −1 a cellar',
                  text: storeyLabel(storeyOf(plan)),
                }),
                el('span', { class: 'item-value', text: formatArea(totalArea(plan)) }),
              ]
            )
          )
        ),
        (() => {
          const plan = activePlan(project);
          return el('label', { class: 'field' }, [
            `Which storey “${plan.name}” is`,
            el('input', {
              type: 'number',
              value: String(storeyOf(plan)),
              step: '1',
              min: '-5',
              max: '20',
              onchange: (e) => this.setStorey(plan.id, Number(e.target.value)),
            }),
          ]);
        })(),
        el('p', {
          class: 'note',
          text: 'Nought is the ground floor and −1 a cellar. This is what decides which floor sits on which, not the order you drew them in.',
        }),
        el('div', { class: 'row row-wrap', style: 'margin-top:10px' }, [
          el('button', { class: 'btn', type: 'button', onclick: () => this.addFloor() }, 'Add floor'),
          el('button', { class: 'btn', type: 'button', onclick: () => this.addFloor({ from: activePlan(project) }) }, 'Copy this one'),
          project.plans.length > 1
            ? el('button', { class: 'btn btn-danger', type: 'button', onclick: () => this.removeFloor() }, 'Remove')
            : null,
        ]),
        el('p', {
          class: 'note',
          style: 'margin-top:8px',
          text: 'Double-click a floor to rename it.',
        }),
      ],
      el('span', { class: 'count', text: String(project.plans.length) })
    );
  }

  /**
   * A new floor, empty or as a copy of one that is already there.
   *
   * A house is mostly the same shell storey after storey, so copying one and knocking
   * it about is the way it is actually drawn. Without this a four-storey house meant
   * drawing the same outside walls four times and hoping they matched.
   */
  addFloor({ from = null } = {}) {
    this.store.edit(from ? 'copy floor' : 'add floor', (project) => {
      const plan = from ? copyPlan(from, { name: `${from.name} copy` }) : createPlan({ name: `Floor ${project.plans.length + 1}` });
      project.plans.push(plan);
      project.activePlanId = plan.id;
      return true;
    });
    this.fitView();
  }

  /** Which storey a floor is, which is what decides where it sits in the stack. */
  setStorey(planId, storey) {
    if (!Number.isFinite(storey)) return;
    this.store.edit('floor level', (project) => {
      const plan = project.plans.find((p) => p.id === planId);
      if (!plan || plan.storey === storey) return false;
      plan.storey = Math.round(storey);
      return true;
    });
    this.fitView();
  }

  removeFloor() {
    const project = this.store.project;
    if (project.plans.length < 2) return;
    const plan = activePlan(project);
    this.confirm(`Remove “${plan.name}”?`, 'The floor and everything on it is deleted. Undo brings it back.', () => {
      this.store.edit('remove floor', (p) => {
        p.plans = p.plans.filter((x) => x.id !== plan.id);
        p.activePlanId = p.plans[0].id;
        return true;
      });
      this.fitView();
    });
  }

  // ---- files ----------------------------------------------------------

  /**
   * Open a drawing from disk, keeping hold of the file so Save can write back to it.
   */
  async openDocument() {
    if (!(await this.confirmDiscard())) return;
    try {
      const picked = await openFile();
      const project = projectFromJson(picked.text);
      this.store.replaceProject(project);
      // Somebody else's drawing, and whatever tool was in your hand before is still in
      // it: opening a file with the furniture tool up put a double bed in the middle of
      // the plan on the first click. A drawing that already exists lands on select.
      this.setTool('select');
      this.reportDropped(project);
      this.file = { handle: picked.handle, name: picked.name };
      this.dirty = false;
      this.pendingPages = null;
      this.fitView();
      this.renderAll();
      this.renderTitle();
      this.flash(`Opened ${picked.name}`);
    } catch (err) {
      if (wasCancelled(err)) return;
      this.showMessage('That file could not be opened', err.message ?? String(err));
    }
  }

  /**
   * Save. Straight back to the file it came from where the browser allows that, and
   * otherwise as a fresh copy — which is said plainly rather than pretended about.
   */
  async saveDocument(askWhere = false) {
    const text = projectToJson(this.store.project);
    try {
      if (!askWhere && this.file?.handle) {
        await writeTo(this.file.handle, text);
        this.dirty = false;
        this.renderTitle();
        this.flash(`Saved ${this.file.name}`);
        return;
      }
      const name = documentName(this.file?.name ?? this.store.project.name);
      const saved = await saveFileAs(text, name);
      this.file = saved;
      this.dirty = false;
      this.renderTitle();
      this.flash(saved.handle ? `Saved ${saved.name}` : `Downloaded ${saved.name}`);
    } catch (err) {
      if (wasCancelled(err)) return;
      this.showMessage('That drawing could not be saved', err.message ?? String(err));
    }
  }

  /** Ask before throwing away work that has not been written to a file. */
  async confirmDiscard() {
    if (!this.dirty) return true;
    const where = this.file?.name ? `since ${this.file.name} was saved` : 'yet';
    // The page's own dialog, not `window.confirm`. A sandboxed frame — which is what a
    // published artifact runs in — refuses the browser's dialogs outright and hands
    // back false without showing anything, so Open and New quietly did nothing at all
    // whenever there was unsaved work. There is one of these on the page already.
    return new Promise((resolve) => {
      this.confirmOrCancel(
        'Lose the changes?',
        `This drawing has changes not written to a file ${where}.`,
        'Lose them',
        resolve
      );
    });
  }

  /** The name of the drawing in the title bar, and whether it needs saving. */
  renderTitle() {
    const label = this.root.querySelector('#doc-name');
    if (!label) return;
    const name = this.file?.name ?? 'Not saved to a file';
    label.textContent = this.dirty ? `${name} •` : name;
    label.title = this.dirty ? 'There are changes not written to a file' : name;
    label.classList.toggle('dirty', !!this.dirty);
  }

  async handleFile(file) {
    const name = file.name ?? 'plan';
    try {
      if (/\.json$/i.test(name) || file.type === 'application/json') {
        const project = projectFromJson(await file.text());
        this.store.replaceProject(project);
        this.setTool('select');
        this.reportDropped(project);
        this.pendingPages = null;
        this.fitView();
        this.flash('Drawing loaded.');
        return;
      }
      if (file.type.startsWith('image/')) {
        await this.importImage(file);
        return;
      }
      await this.importPdf(file);
    } catch (err) {
      this.showMessage('That file could not be opened', err.message ?? String(err));
    }
  }

  showBusy(label) {
    this.hideBusy();
    const busy = el('div', { class: 'busy' }, [
      el('div', { class: 'busy-inner' }, [
        el('div', { class: 'busy-label', text: label }),
        el('div', { class: 'bar' }, [el('span', { style: 'width:6%' })]),
      ]),
    ]);
    this.canvasWrap.append(busy);
    this.busyEl = busy;
    return {
      progress: (value) => {
        const bar = busy.querySelector('.bar span');
        if (bar) bar.style.width = `${Math.max(4, Math.round(value * 100))}%`;
      },
      label: (text) => {
        const node = busy.querySelector('.busy-label');
        if (node) node.textContent = text;
      },
    };
  }

  hideBusy() {
    this.busyEl?.remove();
    this.busyEl = null;
  }

  async importPdf(file) {
    const busy = this.showBusy('Reading the PDF');
    // A timeout, not a frame: requestAnimationFrame never fires in a background
    // tab, which would stall the import indefinitely.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await readPdfPages(bytes, (index, total) => {
        busy.label(`Reading page ${index + 1} of ${total}`);
        busy.progress((index + 1) / total);
      });
      if (result.pages.length === 1) {
        this.useBackdropPage(result.pages[0]);
      } else {
        this.pendingPages = result;
        this.renderAll();
      }
    } catch (err) {
      if (err instanceof UnsupportedEncryption) this.showMessage('This PDF is protected', err.message);
      else this.showMessage('That PDF could not be read', err.message ?? String(err));
    } finally {
      this.hideBusy();
    }
  }

  panelPages() {
    const pending = this.pendingPages;
    return this.panel(
      'Which page?',
      [
        el('p', { class: 'note', text: 'One page becomes the tracing backdrop for this floor.' }),
        el(
          'div',
          { class: 'pages' },
          pending.pages.map((page) => {
            const canvas = el('canvas', { width: 240, height: 148 });
            setTimeout(() => drawPageThumb(canvas, page, this.renderer.theme), 0);
            return el(
              'button',
              { class: 'page-card', type: 'button', onclick: () => this.useBackdropPage(page) },
              [
                canvas,
                el('span', { class: 'page-meta' }, [
                  el('span', { text: `Page ${page.index + 1}` }),
                  el('span', { text: page.scale.guessed ? 'scale ?' : `1:${Math.round(page.scale.denominator)}` }),
                ]),
              ]
            );
          })
        ),
        el('button', { class: 'btn', type: 'button', onclick: () => { this.pendingPages = null; this.renderAll(); } }, 'Cancel'),
      ],
      el('span', { class: 'count', text: String(pending.pages.length) })
    );
  }

  useBackdropPage(page) {
    this.pendingPages = null;
    this.store.edit('trace a plan', (project) => {
      const plan = activePlan(project);
      plan.backdrop = backdropFromPage(page, page.scale.mmPerPt);
      plan.scaleDenominator = Math.round(page.scale.denominator);
      plan.scaleConfirmed = !page.scale.guessed;
      return true;
    });
    this.fitView();
    this.flash(
      page.scale.guessed
        ? 'The dimension figures could not be read — most CAD exporters draw them as outlines, not text. 1:100 was assumed: measure a length you know to set the scale.'
        : `Scale read as 1:${activePlan(this.store.project).scaleDenominator}. Check it against a length you know.`
    );
  }

  async importImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('The image could not be read.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The image could not be decoded.'));
      img.src = dataUrl;
    });
    this.store.edit('trace an image', (project) => {
      const plan = activePlan(project);
      plan.backdrop = backdropFromImage(image, dataUrl, 10);
      plan.scaleConfirmed = false;
      return true;
    });
    this.fitView();
    this.flash('Measure a known length so the scale is right, then trace over it.');
  }

  removeBackdrop() {
    this.store.edit('remove traced plan', (project) => {
      activePlan(project).backdrop = emptyBackdrop();
      return true;
    });
  }

  ensureBackdropImage(plan) {
    const src = plan.backdrop?.image;
    if (!src) {
      this.renderer.backdropImage = null;
      return;
    }
    if (this.renderer.backdropImage?.src === src) return;
    const img = new Image();
    img.onload = () => this.requestFrame();
    img.src = src;
    this.renderer.backdropImage = img;
  }

  // ---- scale ----------------------------------------------------------

  applyScale(denominator) {
    const plan = activePlan(this.store.project);
    if (!Number.isFinite(denominator) || denominator <= 0) return;
    const factor = denominator / plan.scaleDenominator;
    this.store.edit('set scale', (project) => {
      const target = activePlan(project);
      rescalePlan(target, factor);
      target.scaleConfirmed = true;
      return true;
    });
    this.fitView();
  }

  startCalibration() {
    this.setTool('measure');
    this.calibrating = true;
    this.flash('Click the two ends of a length you know.');
  }

  // Called from the status of the measure tool: turns a measurement into a scale.
  offerCalibration() {
    const measurement = this.interaction.measurement;
    if (!measurement) return;
    this.calibrating = false;
    this.showPrompt({
      title: 'What is that distance in reality?',
      description: `You measured ${formatLength(measurement.length)} at the current scale. Type the real length and the drawing is rescaled to match.`,
      placeholder: 'e.g. 3,74 m or 3740',
      confirm: 'Set scale',
      onSubmit: (value) => {
        const parsed = parseLengthInput(value);
        if (!parsed) {
          this.flash('Type a length such as 3,74 m or 3740 mm.');
          return false;
        }
        const factor = parsed / measurement.length;
        this.store.edit('calibrate scale', (project) => {
          const plan = activePlan(project);
          rescalePlan(plan, factor);
          plan.scaleConfirmed = true;
          return true;
        });
        this.interaction.measurement = null;
        this.setTool('select');
        this.fitView();
        this.flash(`Scale set to 1:${activePlan(this.store.project).scaleDenominator}.`);
        return true;
      },
    });
  }

  // ---- dialogs --------------------------------------------------------

  showModal(content, options = {}) {
    this.closeModal();
    const backdrop = el(
      'div',
      { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) this.closeModal(); } },
      [el('div', { class: `modal${options.wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, content)]
    );
    document.body.append(backdrop);
    this.modal = backdrop;
    // Dismissing counts as an answer for anything waiting on one, or a question closed
    // with Escape leaves whatever asked it waiting for ever.
    this.modalClosed = options.onClose ?? null;
    backdrop.querySelector('input, select, button')?.focus();
    return backdrop;
  }

  closeModal() {
    if (!this.modal) return false;
    this.modal.remove();
    this.modal = null;
    const closed = this.modalClosed;
    this.modalClosed = null;
    closed?.();
    return true;
  }

  /**
   * Everything the editor can do, in one list you can type at.
   *
   * There are seventeen tools, a dozen things to show or hide and a drawer of
   * settings, which is a lot of places to have to know about. This is the one place
   * that does not have to be learned: press ⌘K, type what you want, press return.
   */
  commands() {
    const list = [];
    for (const tool of TOOLS) {
      if (tool.sep) continue;
      list.push({
        group: 'Tool',
        label: tool.label,
        hint: tool.key ? tool.key.toUpperCase() : '',
        run: () => this.setTool(tool.id),
      });
    }
    const show = activePlan(this.store.project).show ?? {};
    for (const group of VIEW_GROUPS) {
      for (const [key, label] of group.items) {
        const on = show[key] === true || (show[key] !== false && DEFAULT_ON.has(key));
        list.push({
          group: 'Show',
          label,
          hint: on ? 'on' : 'off',
          run: () => this.viewFlip(key, !on),
        });
      }
    }
    list.push(
      { group: 'File', label: 'Open a drawing…', hint: '⌘O', run: () => this.openDocument() },
      { group: 'File', label: 'Save', hint: '⌘S', run: () => this.saveDocument() },
      { group: 'File', label: 'Save as…', hint: '⇧⌘S', run: () => this.saveDocument(true) },
      { group: 'File', label: 'Export…', run: () => this.showExportDialog() },
      { group: 'File', label: 'Start a new drawing', run: () => this.confirmNew() },
      { group: 'View', label: 'Show the plan', hint: '3', run: () => this.setMode('2d') },
      { group: 'View', label: 'Show it in 3D', hint: '3', run: () => this.setMode('3d') },
      { group: 'View', label: 'Zoom to fit', run: () => this.fitView() },
      { group: 'View', label: 'Drawing settings', hint: ',', run: () => this.toggleSettings() },
      { group: 'Edit', label: 'Undo', hint: '⌘Z', run: () => this.store.undo() },
      { group: 'Edit', label: 'Redo', hint: '⇧⌘Z', run: () => this.store.redo() },
      { group: 'Help', label: 'Keyboard shortcuts', hint: '?', run: () => this.showShortcuts() }
    );
    return list;
  }

  showPalette() {
    const all = this.commands();
    const input = el('input', {
      type: 'text',
      placeholder: 'What would you like to do?',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const list = el('div', { class: 'palette-list' });
    let matches = all;
    let cursor = 0;

    const score = (item, query) => {
      const haystack = `${item.group} ${item.label}`.toLowerCase();
      if (!query) return 0;
      // Letters in order, not necessarily together, so "plw" finds "Place a window".
      let at = 0;
      for (const ch of query) {
        at = haystack.indexOf(ch, at);
        if (at < 0) return -1;
        at += 1;
      }
      return haystack.startsWith(query) ? 2 : haystack.includes(query) ? 1 : 0;
    };

    const paint = () => {
      list.replaceChildren(
        ...matches.slice(0, 40).map((item, i) =>
          el(
            'button',
            {
              class: `palette-row${i === cursor ? ' on' : ''}`,
              type: 'button',
              onclick: () => {
                this.closeModal();
                item.run();
              },
            },
            [
              el('span', { class: 'palette-group', text: item.group }),
              el('span', { class: 'palette-label', text: item.label }),
              el('span', { class: 'palette-hint', text: item.hint ?? '' }),
            ]
          )
        )
      );
      if (!matches.length) list.replaceChildren(el('p', { class: 'note', text: 'Nothing matches that.' }));
    };

    const refilter = () => {
      const query = input.value.trim().toLowerCase();
      matches = all
        .map((item) => ({ item, rank: score(item, query) }))
        .filter((m) => m.rank >= 0)
        .sort((a, b) => b.rank - a.rank)
        .map((m) => m.item);
      cursor = 0;
      paint();
    };

    input.addEventListener('input', refilter);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        cursor = Math.max(0, Math.min(matches.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1)));
        paint();
        list.children[cursor]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = matches[cursor];
        if (chosen) {
          this.closeModal();
          chosen.run();
        }
      } else if (event.key === 'Escape') {
        // The window's own handler stands back while you are typing, so the palette
        // has to let itself go.
        event.preventDefault();
        event.stopPropagation();
        this.closeModal();
      }
    });

    paint();
    this.showModal([el('div', { class: 'palette' }, [input, list])], { wide: true });
    input.focus();
  }

  showMessage(title, body) {
    this.showModal([
      el('h2', { text: title }),
      el('p', { text: body }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.closeModal() }, 'Close'),
      ]),
    ]);
  }

  /**
   * Ask, and say which way it went — including when it is dismissed.
   *
   * `confirm` only calls back on yes, which is right for a button that starts
   * something; anything waiting on the answer needs to hear a no as well, or it hangs.
   */
  confirmOrCancel(title, body, yes, answer) {
    let said = false;
    const settle = (value) => {
      if (said) return;
      said = true;
      answer(value);
    };
    this.showModal(
      [
        el('h2', { text: title }),
        el('p', { text: body }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, 'Cancel'),
          el(
            'button',
            {
              class: 'btn btn-danger',
              type: 'button',
              onclick: () => {
                settle(true);
                this.closeModal();
              },
            },
            yes
          ),
        ]),
      ],
      { onClose: () => settle(false) }
    );
  }

  confirm(title, body, onConfirm) {
    this.showModal([
      el('h2', { text: title }),
      el('p', { text: body }),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, 'Cancel'),
        el(
          'button',
          {
            class: 'btn btn-primary',
            type: 'button',
            onclick: () => {
              this.closeModal();
              onConfirm();
            },
          },
          'Yes'
        ),
      ]),
    ]);
  }

  showPrompt({ title, description, value = '', placeholder = '', confirm = 'Save', onSubmit }) {
    const input = el('input', { type: 'text', value, placeholder });
    const submit = () => {
      if (onSubmit(input.value) !== false) this.closeModal();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    this.showModal([
      el('h2', { text: title }),
      description ? el('p', { text: description }) : null,
      input,
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'button', onclick: submit }, confirm),
      ]),
    ]);
    input.select();
  }

  renameRoom(metaId) {
    const plan = activePlan(this.store.project);
    const entry = plan.rooms.find((r) => r.id === metaId);
    this.showPrompt({
      title: 'Room name',
      value: entry?.name ?? '',
      placeholder: 'Living room',
      onSubmit: (value) => {
        this.setRoomName(metaId, value.trim());
        return true;
      },
    });
  }

  setRoomSize(metaId, axis, value) {
    const basis = activePlan(this.store.project).dimBasis ?? 'outer';
    const ok = this.store.edit('room size', (project) => {
      const plan = activePlan(project);
      const room = derived(plan).rooms.find((r) => r.metaId === metaId);
      return room ? setRoomSize(plan, room, axis, value, basis) : false;
    });
    if (!ok) this.flash('That size will not fit — try a bigger one.');
  }

  setRoomName(metaId, name) {
    this.store.edit('room name', (project) => {
      const entry = activePlan(project).rooms.find((r) => r.id === metaId);
      if (!entry) return false;
      entry.name = name;
      return true;
    });
  }

  renamePlan(id) {
    const plan = this.store.project.plans.find((p) => p.id === id);
    this.showPrompt({
      title: 'Floor name',
      value: plan?.name ?? '',
      placeholder: 'Upper floor',
      onSubmit: (value) => {
        this.store.edit('floor name', (project) => {
          const target = project.plans.find((p) => p.id === id);
          if (!target) return false;
          target.name = value.trim() || target.name;
          return true;
        });
        return true;
      },
    });
  }

  createLabel(point) {
    this.showPrompt({
      title: 'Label text',
      placeholder: 'Terrace',
      confirm: 'Place',
      onSubmit: (value) => {
        const text = value.trim();
        if (!text) return false;
        this.store.edit('add label', (project) => {
          activePlan(project).labels.push({ id: nextId('l'), text, x: point.x, y: point.y, size: 260 });
          return true;
        });
        return true;
      },
    });
  }

  editLabel(id) {
    const label = activePlan(this.store.project).labels.find((l) => l.id === id);
    this.showPrompt({
      title: 'Label text',
      value: label?.text ?? '',
      onSubmit: (value) => {
        this.store.edit('label text', (project) => {
          const target = activePlan(project).labels.find((l) => l.id === id);
          if (!target) return false;
          target.text = value;
          return true;
        });
        return true;
      },
    });
  }

  confirmNew() {
    this.confirm('Start a new drawing?', 'The current drawing is replaced. Save it first if you want to keep it.', () => {
      this.store.replaceProject(createProject({ now: Date.now() }));
      this.setTool('rect');
      this.startDismissed = false; // a fresh drawing gets the opening card back
      this.fitView();
      this.renderAll();
    });
  }

  showShortcuts() {
    this.showModal([
      el('h2', { text: 'Keyboard shortcuts' }),
      el(
        'div',
        { class: 'keys' },
        SHORTCUTS.map(([group, rows]) =>
          el('div', { class: 'keys-group' }, [
            el('div', { class: 'group-label', text: group }),
            el(
              'dl',
              { class: 'keys-list' },
              rows.flatMap(([key, what]) => [el('dt', { text: key }), el('dd', { text: what })])
            ),
          ])
        )
      ),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.closeModal() }, 'Got it'),
      ]),
    ], { wide: true });
  }

  showExportDialog() {
    const plan = activePlan(this.store.project);
    const rooms = derived(plan).rooms.filter((r) => r.kept !== false).length;
    this.showModal([
      el('h2', { text: 'Export' }),
      el('p', { text: `“${plan.name}” — ${formatArea(totalArea(plan))} across ${rooms} room${rooms === 1 ? '' : 's'}, at 1:${plan.scaleDenominator}.` }),
      el('div', { class: 'stack' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.exportSvg() }, [icon('i-download'), 'SVG — true to scale, for printing or CAD']),
        (() => {
          const plan = activePlan(this.store.project);
          const paper = this.store.state.sheet ?? { paper: 'A3', orientation: 'landscape' };
          const size = paperSize(paper.paper, paper.orientation);
          const fits = scaleToFit(plan, size, 10, 26);
          return el('div', { class: 'sheet-row' }, [
            el('div', { class: 'row row-wrap' }, [
              this.optSeg(
                null,
                PAPERS.map((p) => ({ id: p.id, label: p.label })),
                paper.paper,
                (id) => this.store.set({ sheet: { ...paper, paper: id } })
              ),
              this.optSeg(
                null,
                [
                  { id: 'landscape', label: 'Wide' },
                  { id: 'portrait', label: 'Tall' },
                ],
                paper.orientation,
                (id) => this.store.set({ sheet: { ...paper, orientation: id } })
              ),
            ]),
            el(
              'button',
              { class: 'btn', type: 'button', onclick: () => this.exportSheet() },
              [
                icon('i-download'),
                fits
                  ? `On paper — ${size.id} at 1:${fits}, with a frame and a title block`
                  : `On paper — ${size.id}, but it will not fit even at 1:200`,
              ]
            ),
          ]);
        })(),
        el('button', { class: 'btn', type: 'button', onclick: () => this.exportPng() }, [icon('i-download'), 'PNG — an image to send to anyone']),
        el('button', { class: 'btn', type: 'button', onclick: () => this.exportViewPng(2) }, [
          icon('i-download'),
          this.mode === '3d' ? 'The 3D view as an image — twice the screen' : 'The 3D view as an image (switch to 3D first)',
        ]),
        el('button', { class: 'btn', type: 'button', onclick: () => this.saveProjectFile() }, [icon('i-download'), 'Drawing file — reopen and keep editing']),
      ]),
      el('div', { class: 'modal-actions' }, [
        el('button', { class: 'btn', type: 'button', onclick: () => this.closeModal() }, 'Close'),
      ]),
    ]);
  }

  /** The plan on a sheet of paper, framed and signed off, ready to print at 100%. */
  exportSheet() {
    const plan = activePlan(this.store.project);
    const sheet = this.store.state.sheet ?? { paper: 'A3', orientation: 'landscape' };
    const size = paperSize(sheet.paper, sheet.orientation);
    const fits = scaleToFit(plan, size, 10, 26);
    const svg = planToSheetSvg(plan, {
      ...sheet,
      projectName: this.store.project.name,
      // Written on the sheet as a date, which is what a drawing is signed off with.
      date: new Date().toLocaleDateString('de-DE'),
    });
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), safeFilename(`${plan.name} ${size.id}`, 'svg'));
    this.closeModal();
    this.flash(
      fits
        ? `${size.id} sheet at 1:${fits}. Print it at 100% and the scale is true.`
        : `${size.id} sheet, but the drawing runs over the frame — try a bigger sheet.`
    );
  }

  exportSvg() {
    const plan = activePlan(this.store.project);
    downloadBlob(
      new Blob([planToSvg(plan, { projectName: this.store.project.name })], { type: 'image/svg+xml' }),
      safeFilename(plan.name, 'svg')
    );
    this.closeModal();
    this.flash('SVG exported.');
  }

  async exportPng() {
    const plan = activePlan(this.store.project);
    const blob = await planToPngBlob(this.store.project, plan, { pxPerMm: 0.16 });
    if (blob) downloadBlob(blob, safeFilename(plan.name, 'png'));
    this.closeModal();
    this.flash('PNG exported.');
  }

  /**
   * The model as an image, at whatever size you ask for.
   *
   * The nearest thing to a section without building one: a picture you can print or
   * hand to somebody that says how high things are. Two canvases go into it — the model
   * and the measurements drawn over it — so both are composited onto a third.
   *
   * The model is redrawn at the export size rather than scaled up from the screen: the
   * outlines and the hatching are set out in pixels, so an enlargement would give thick
   * soft lines instead of the drawn look.
   */
  async exportViewPng(multiple = 2) {
    if (this.mode !== '3d') {
      this.flash('Switch to 3D first — this exports the model.');
      return;
    }
    if (!this.view3d.gl) {
      this.flash('The 3D view is not available, so there is nothing to export.');
      return;
    }
    const canvas = this.canvas3d;
    const was = { width: canvas.width, height: canvas.height };
    const scale = Math.max(1, Math.min(4, multiple));
    try {
      // Drawn again at the bigger size, then put back.
      this.view3d.setSize(Math.round(was.width * scale), Math.round(was.height * scale), 1);
      this.view3d.draw();
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = this.themeName() === 'dark' ? '#1e2429' : '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0);
      if (this.show3dMarks && this.marks3d) {
        // The figures were drawn for the screen, so they are scaled up to match.
        ctx.drawImage(this.marks3d, 0, 0, out.width, out.height);
      }
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      if (blob) {
        const plan = activePlan(this.store.project);
        downloadBlob(blob, safeFilename(`${plan.name} 3D`, 'png'));
        this.flash(`Image exported at ${out.width} × ${out.height}.`);
      } else {
        this.flash('The browser would not turn the view into an image.');
      }
    } finally {
      // Whatever happened, the view goes back to the size the screen wants.
      this.view3d.setSize(was.width, was.height, 1);
      this.view3d.resize();
      this.requestFrame();
    }
    this.closeModal();
  }

  saveProjectFile() {
    const project = this.store.project;
    downloadBlob(new Blob([projectToJson(project)], { type: 'application/json' }), safeFilename(project.name, 'json'));
    this.closeModal();
    this.flash('Drawing file saved.');
  }

  // ---- view -----------------------------------------------------------

  fitView() {
    const plan = activePlan(this.store.project);
    const bounds = plan.walls.length ? planBounds(plan) : backdropBounds(plan.backdrop) ?? planBounds(plan);
    this.renderer.resize();
    // The canvas has no layout size until it is laid out and visible; fitting
    // against a zero-sized box would leave the view at the minimum zoom.
    if (this.renderer.width < 40 || this.renderer.height < 40) {
      this.pendingFit = true;
      return;
    }
    this.pendingFit = false;
    // The chains are drawn outside the building, and the interior ones stack further
    // out again. Fitting to the walls alone leaves them off the paper, which is much
    // the same as not drawing them at all.
    const box = { minX: bounds.minX, minY: bounds.minY, maxX: bounds.minX + bounds.width, maxY: bounds.minY + bounds.height };
    if (plan.show?.autoDims !== false && plan.walls.length) {
      const room = 260; // for the figures sitting on the chain
      for (const chain of allChains(plan, plan.autoDims ?? {})) {
        // Taken from where the chain is actually drawn: on a skewed drawing its ends
        // are not on an axis, so reading `from`/`to` as x or y framed the wrong box
        // and cut the chains off the sheet.
        const geo = chainGeometry(chain);
        for (const p of [geo.line.a, geo.line.b]) {
          box.minX = Math.min(box.minX, p.x - room);
          box.maxX = Math.max(box.maxX, p.x + room);
          box.minY = Math.min(box.minY, p.y - room);
          box.maxY = Math.max(box.maxY, p.y + room);
        }
      }
    }
    const spanX = Math.max(1, box.maxX - box.minX);
    const spanY = Math.max(1, box.maxY - box.minY);
    const padding = 70;
    const width = Math.max(1, this.renderer.width - padding * 2);
    const height = Math.max(1, this.renderer.height - padding * 2);
    const scale = Math.max(0.002, Math.min(1.5, Math.min(width / spanX, height / spanY)));
    this.store.state.view = {
      scale,
      x: box.minX - (this.renderer.width / scale - spanX) / 2,
      y: box.minY - (this.renderer.height / scale - spanY) / 2,
    };
    this.requestFrame();
  }

  flash(message) {
    this.flashEl.textContent = message;
    this.flashEl.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashEl.classList.remove('show'), 2600);
  }
}

const SHORTCUTS = [
  ['Tools', [
    ['V', 'Select and move'],
    ['W', 'Draw walls'],
    ['R', 'Draw a room'],
    ['D / N / P', 'Door, window, plain opening'],
    ['T / X', 'Trim or extend, split'],
    ['S / C', 'Stair, column'],
    ['A', 'Sockets, switches and lights'],
    ['Alt-drag', 'Move a wall bodily instead of sliding its ends'],
    ['Drag a ruler', 'Pull out a guide; drop it back on the ruler to bin it'],
    [',', 'Drawing settings'],
    ['Y', 'What to show'],
    ['⇧R', 'Rulers on or off'],
    ['F or 0', 'Frame the whole drawing'],
    ['Drag in 3D', 'Orbit; middle-drag or shift-drag pans; ctrl or right-drag dollies'],
    ['Scroll in 3D', 'Zoom towards the pointer'],
    ['F / L / M / Q', 'Furniture, label, dimension, measure'],
    ['E', 'Delete by clicking'],
  ]],
  ['While drawing', [
    ['type a number', 'Exact length, then Tab for the angle'],
    ['Enter', 'Place it at the typed size'],
    ['O', 'Ortho lock on or off'],
    ['G', 'Snapping on or off'],
    ['Esc', 'End the run'],
  ]],
  ['Editing', [
    ['drag a corner', 'Moves every wall meeting there'],
    ['click a room, then drag', 'Moves the whole room'],
    ['arrow keys', 'Nudge by one grid step'],
    ['J', 'Join two walls in line'],
    ['H / B', 'Flip a door’s hinge, flip its swing'],
    ['R', 'Rotate furniture, a stair or a column 90° (⇧R the other way)'],
    ['⌘D', 'Duplicate furniture or a label'],
    ['⌘A', 'Select everything'],
    ['⌫', 'Delete the selection'],
  ]],
  ['Getting around', [
    ['scroll', 'Zoom to the cursor'],
    ['space + drag', 'Pan'],
    ['0', 'Zoom to fit, or reframe in 3D'],
    ['3', 'Switch between the plan and 3D'],
    ['drag / shift + drag', 'In 3D: orbit, and pan'],
    ['⌘Z / ⇧⌘Z', 'Undo, redo'],
    ['⌘S', 'Save a drawing file'],
    ['?', 'This list'],
  ]],
];

/** Openings grouped the way a schedule groups them: one row per size, with a mark. */
export function openingSchedule(plan) {
  // The marks are worked out where the drawing gets them from, so the row and the
  // figure written beside the window on the plan are the same mark.
  return openingMarks(plan).rows;
}

/** Fixtures grouped by kind and height, which is how a quote lists them. */
export function fixtureSchedule(plan) {
  const groups = new Map();
  for (const fixture of plan.fixtures ?? []) {
    const spec = fixtureSpec(fixture.kind);
    const height = Math.round(fixture.height ?? spec.height);
    const key = `${fixture.kind}|${height}`;
    const found = groups.get(key);
    if (found) found.count += 1;
    else groups.set(key, { kind: fixture.kind, label: spec.label, group: spec.group, height, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label) || a.height - b.height
  );
}

function describeSelection(plan, selection) {
  if (!selection.length) return 'Nothing selected';
  if (selection.length > 1) return `${selection.length} selected`;
  const item = selection[0];
  if (item.kind === 'room') {
    const room = plan.rooms.find((r) => r.id === item.id);
    return `Room ${room?.name ? `“${room.name}”` : ''}`.trim();
  }
  if (item.kind === 'wall') {
    const wall = plan.walls.find((w) => w.id === item.id);
    return wall ? `${wallTypeFor(wall.type).label} wall, ${Math.round(wall.thickness)} mm` : 'Wall';
  }
  if (item.kind === 'opening') {
    const opening = plan.openings.find((o) => o.id === item.id);
    return opening ? describeOpening(opening) : 'Opening';
  }
  if (item.kind === 'furniture') {
    return plan.furniture.find((f) => f.id === item.id)?.label ?? 'Furniture';
  }
  if (item.kind === 'fixture') {
    const fixture = plan.fixtures?.find((f) => f.id === item.id);
    return fixture ? fixtureSpec(fixture.kind).label : 'Fixture';
  }
  if (item.kind === 'guide') {
    const guide = (plan.guides ?? []).find((g) => g.id === item.id);
    return guide ? `${guide.axis === 'x' ? 'Upright' : 'Level'} guide` : 'Guide';
  }
  return `${item.kind.charAt(0).toUpperCase()}${item.kind.slice(1)} selected`;
}

/** Turns a CSS colour into 0..1 rgb, so the 3D background can match the page. */
export function cssToRgb(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16) / 255);
  }
  const m = /rgba?\(([^)]+)\)/i.exec(value);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    if (parts.length >= 3) return parts.slice(0, 3).map((p) => p / 255);
  }
  return null;
}

function perimeter(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// "3,74 m", "3740", "374 cm" -> millimetres
export function parseLengthInput(raw) {
  const text = String(raw).trim().toLowerCase().replace(',', '.');
  const match = /^(\d+(?:\.\d+)?)\s*(mm|cm|dm|m)?$/.exec(text);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  if (unit === 'mm') return value;
  if (unit === 'cm') return value * 10;
  if (unit === 'dm') return value * 100;
  if (unit === 'm') return value * 1000;
  return value < 100 ? value * 1000 : value;
}

function drawPageThumb(canvas, page, theme) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(60, Math.round(rect.width || 240));
  const h = Math.max(40, Math.round(rect.height || 148));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min(w / page.width, h / page.height) * 0.94;
  const offsetX = (w - page.width * scale) / 2;
  const offsetY = (h - page.height * scale) / 2;
  ctx.strokeStyle = theme?.ink ?? '#16212b';
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  let drawn = 0;
  for (const seg of page.segments) {
    if (drawn++ > 6000) break;
    ctx.moveTo(offsetX + seg.x1 * scale, offsetY + seg.y1 * scale);
    ctx.lineTo(offsetX + seg.x2 * scale, offsetY + seg.y2 * scale);
  }
  ctx.stroke();
}
