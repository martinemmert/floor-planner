import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addGuide,
  addRoomRect,
  addWall,
  clearGuides,
  createPlan,
  findGuide,
  guideAt,
  removeGuide,
  touch,
} from '../src/app/model.js';
import { computeSnap } from '../src/geom/snap.js';
import { normaliseProject } from '../src/app/export.js';

function plan() {
  const p = createPlan();
  addRoomRect(p, 0, 0, 6000, 4000, { type: 'exterior', thickness: 300 });
  touch(p);
  return p;
}

test('a guide is one line at one position', () => {
  const p = plan();
  const first = addGuide(p, 'x', 2500);
  assert.equal(first.axis, 'x');
  assert.equal(first.at, 2500);
  // Asking for the same line again gives back the one that is already there.
  assert.equal(addGuide(p, 'x', 2500), first);
  assert.equal(p.guides.length, 1);
  // A different axis at the same number is a different line.
  assert.notEqual(addGuide(p, 'y', 2500), first);
  assert.equal(p.guides.length, 2);
});

test('nonsense never becomes a guide', () => {
  const p = plan();
  assert.equal(addGuide(p, 'z', 100), null);
  assert.equal(addGuide(p, 'x', Number.NaN), null);
  assert.equal(addGuide(p, 'x', Infinity), null);
  assert.equal(p.guides.length, 0);
});

test('a guide can be found, moved and removed', () => {
  const p = plan();
  const guide = addGuide(p, 'y', 1500);
  assert.equal(findGuide(p, guide.id), guide);
  assert.equal(guideAt(p, { x: 3000, y: 1540 }, 60)?.id, guide.id);
  assert.equal(guideAt(p, { x: 3000, y: 1800 }, 60), null, 'not within reach');
  assert.equal(removeGuide(p, guide.id), true);
  assert.equal(removeGuide(p, guide.id), false, 'already gone');
  assert.equal(findGuide(p, guide.id), null);
});

test('clearing reports whether there was anything to clear', () => {
  const p = plan();
  assert.equal(clearGuides(p), false);
  addGuide(p, 'x', 1000);
  assert.equal(clearGuides(p), true);
  assert.equal(p.guides.length, 0);
});

// ---- snapping -----------------------------------------------------------

const snap = (p, x, y, extra = {}) =>
  computeSnap({ point: { x, y }, plan: p, tolerance: 120, gridMm: 50, ...extra });

test('where two guides cross is an exact point', () => {
  const p = plan();
  addGuide(p, 'x', 2500);
  addGuide(p, 'y', 1500);
  touch(p);
  const hit = snap(p, 2540, 1460);
  assert.equal(hit.kind, 'guide');
  assert.equal(Math.round(hit.x), 2500);
  assert.equal(Math.round(hit.y), 1500);
});

test('where a guide crosses a wall is an exact point too', () => {
  const p = plan();
  addGuide(p, 'x', 2500);
  touch(p);
  // The top wall runs along y = 0.
  const hit = snap(p, 2530, 30);
  assert.equal(hit.kind, 'guide');
  assert.equal(Math.round(hit.x), 2500);
  assert.equal(Math.round(hit.y), 0);
});

test('a single guide catches the cursor perpendicular to itself', () => {
  const p = plan();
  addGuide(p, 'x', 2500);
  touch(p);
  const hit = snap(p, 2470, 3000);
  assert.equal(hit.kind, 'guide');
  assert.equal(Math.round(hit.x), 2500);
  assert.equal(Math.round(hit.y), 3000, 'only the axis it constrains moves');
});

test('a guide out of reach changes nothing', () => {
  const p = plan();
  addGuide(p, 'x', 2500);
  touch(p);
  const hit = snap(p, 4000, 3000);
  assert.equal(hit.kind, 'grid');
  assert.equal(Math.round(hit.x), 4000);
});

test('a guide lined up with a corner snaps to that height', () => {
  const p = createPlan();
  addWall(p, 1000, 800, 5000, 800, { thickness: 300 });
  addGuide(p, 'x', 3000);
  touch(p);
  // The guide crosses nothing here, but it is level with the wall's own corners.
  const hit = snap(p, 3040, 760);
  assert.equal(hit.kind, 'guide');
  assert.equal(Math.round(hit.x), 3000);
  assert.equal(Math.round(hit.y), 800);
});

test('a real corner still beats a guide', () => {
  const p = plan();
  addGuide(p, 'x', 40);
  touch(p);
  // The corner at the origin and the guide are both within reach; the building wins.
  const hit = snap(p, 30, 20);
  assert.equal(hit.kind, 'node');
  assert.equal(Math.round(hit.x), 0);
  assert.equal(Math.round(hit.y), 0);
});

// ---- persistence --------------------------------------------------------

test('guides survive a save and load, and rubbish in them does not', () => {
  const p = plan();
  addGuide(p, 'x', 2500);
  addGuide(p, 'y', 1500);
  p.guides.push({ id: 'bad1', axis: 'z', at: 10 }, { id: 'bad2', axis: 'x', at: null });
  const project = normaliseProject({ plans: [p], activePlanId: p.id });
  const kept = project.plans[0].guides;
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((g) => `${g.axis}${g.at}`).sort(),
    ['x2500', 'y1500']
  );
});

test('a drawing made before guides existed loads with none', () => {
  const p = plan();
  delete p.guides;
  const project = normaliseProject({ plans: [p], activePlanId: p.id });
  assert.deepEqual(project.plans[0].guides, []);
});
