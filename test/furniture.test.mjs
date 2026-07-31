import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FURNITURE, furnitureById } from '../src/app/furniture.js';
import { furnitureParts } from '../src/app/furniture3d.js';
import { symbolBackAt } from '../src/app/symbols.js';

/**
 * Where the mass of a piece sits through its depth, above a given height.
 *
 * A back — a headboard, a sofa back, a chair rail, a cistern — is the tall thing, so
 * looking only at what stands above the seat or the mattress finds it and ignores the
 * base it stands on.
 */
function massAt(kind, spec, above) {
  const parts = furnitureParts(kind, spec.w, spec.h, spec.z);
  let weight = 0;
  let moment = 0;
  for (const p of parts) {
    if (p.z1 <= above) continue;
    const volume = (p.x1 - p.x0) * (p.y1 - p.y0) * (p.z1 - Math.max(p.z0, above));
    const centre = (p.y0 + p.y1) / 2;
    weight += volume;
    moment += volume * centre;
  }
  return weight ? moment / weight : 0;
}

test('a piece with a back has it at the back, in both views', () => {
  // The convention is that a piece faces +y and its back is at -y, against the wall.
  // The plan symbol and the 3D model each decide that for themselves, and when they
  // disagree the drawing is wrong — which is exactly what happened to the chair: its
  // rail was drawn across the front while the model built it across the back.
  const backed = [
    ['bed-double', 'bed'],
    ['bed-single', 'bed'],
    ['sofa', 'sofa'],
    ['armchair', 'sofa'],
    ['chair', 'chair'],
    ['toilet', 'toilet'],
  ];
  for (const [kind, symbol] of backed) {
    const spec = furnitureById(kind);
    const drawn = symbolBackAt(symbol);
    assert.ok(drawn !== null, `${symbol} should say where its back is`);
    assert.ok(drawn < 0.5, `${symbol}: the plan draws its back at ${drawn.toFixed(2)}, which is the front`);

    // And the model agrees: what stands tall is towards -y.
    const tall = massAt(kind, spec, spec.z * 0.75);
    assert.ok(tall < 0, `${kind}: the model puts what stands up at y=${Math.round(tall)}, which is the front`);
  }
});

test('the taps and the cistern are on the wall side', () => {
  // Plumbing goes to the wall. If the model put a tap on the open side of a basin, it
  // would be standing where somebody has to.
  for (const kind of ['basin', 'sink', 'toilet']) {
    const spec = furnitureById(kind);
    const above = kind === 'toilet' ? spec.z * 0.8 : spec.z + 60;
    assert.ok(massAt(kind, spec, above) < 0, `${kind}: its fittings face into the room`);
  }
});

test('every piece fits the size it says it is', () => {
  // The plan draws the footprint from the specification; the model builds from the
  // same numbers. A part reaching outside them is a piece that overhangs its own
  // symbol, and the clearance checks would then be measuring the wrong rectangle.
  for (const spec of FURNITURE) {
    const parts = furnitureParts(spec.id, spec.w, spec.h, spec.z);
    for (const p of parts) {
      assert.ok(p.x0 >= -spec.w / 2 - 30, `${spec.id} reaches past its left`);
      assert.ok(p.x1 <= spec.w / 2 + 30, `${spec.id} reaches past its right`);
      assert.ok(p.z0 >= -1, `${spec.id} goes below the floor`);
      assert.ok(p.x1 > p.x0 && p.y1 > p.y0 && p.z1 > p.z0, `${spec.id} has a part with no size`);
    }
  }
});

test('a piece nobody has modelled still gets a box', () => {
  const parts = furnitureParts('something-else-entirely', 800, 400, 700);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].z1, 700);
});

test('every finish names a material that exists', async () => {
  // The finishes once named materials that had been taken out of the list. Each came
  // back undefined, went into the buffer as a NaN, and the shader — which tested for
  // "plain" rather than for each pattern — dropped through to its last case and ruled
  // lines over every piece of furniture. Worse, the lines were set out from the room,
  // so they stayed put while the furniture was dragged through them.
  const { finishOf } = await import('../src/app/furniture3d.js');
  const { MATERIAL } = await import('../src/app/materials.js');
  const known = new Set(Object.values(MATERIAL));
  for (const name of ['body', 'panel', 'dark', 'timber', 'ply', 'stone', 'metal', 'fabric', 'cushion', 'linen', 'white', 'glass']) {
    const finish = finishOf(name);
    assert.ok(Number.isFinite(finish.material), `${name} resolves to ${finish.material}`);
    assert.ok(known.has(finish.material), `${name} names a material nobody has`);
  }
  // And a name nobody has still comes back as something drawable.
  assert.ok(Number.isFinite(finishOf('not-a-finish').material));
});

test('nothing that moves is ruled with lines from the room', async () => {
  // The joints in a floor are set out from where the floor is in the building, which
  // is how boards line up through a doorway. Anything that can be picked up and put
  // somewhere else has to be plain, or it slides through its own pattern.
  const { finishOf } = await import('../src/app/furniture3d.js');
  const { MATERIAL, floorSurface } = await import('../src/app/materials.js');
  for (const name of ['timber', 'stone', 'body', 'fabric']) {
    assert.equal(finishOf(name).material, MATERIAL.flat, `${name} should carry no pattern`);
  }
  // A floor, which does not move, still gets its joints.
  assert.equal(floorSurface('oak').material, MATERIAL.boards);
  assert.equal(floorSurface('tile-large').material, MATERIAL.tile);
});
