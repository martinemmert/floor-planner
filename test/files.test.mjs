import { test } from 'node:test';
import assert from 'node:assert/strict';

import { documentName, wasCancelled } from '../src/app/files.js';
import { projectFromJson, projectToJson } from '../src/app/export.js';
import { activePlan, addRoomRect, createProject, touch } from '../src/app/model.js';

test('a drawing gets a file name a file system will accept', () => {
  assert.equal(documentName('Haus B — Erdgeschoss'), 'Haus B — Erdgeschoss.floorplan');
  // The characters that no file system will take, gone.
  assert.equal(documentName('plan: 1/50 <draft>'), 'plan- 1-50 -draft-.floorplan');
  // Saving an opened file does not stack the extension up.
  assert.equal(documentName('house.floorplan'), 'house.floorplan');
  assert.equal(documentName('house.json'), 'house.floorplan');
  // And there is always a name, whatever it was handed.
  assert.equal(documentName(''), 'floor plan.floorplan');
  assert.equal(documentName('   '), 'floor plan.floorplan');
  assert.equal(documentName(null), 'floor plan.floorplan');
});

test('changing your mind is not an error worth a dialog', () => {
  // Dismissing the file picker throws, and reporting that back as a failure would be
  // telling somebody off for pressing Cancel.
  assert.equal(wasCancelled({ name: 'AbortError' }), true);
  assert.equal(wasCancelled({ name: 'NotAllowedError' }), true);
  assert.equal(wasCancelled({ name: 'NotFoundError' }), false);
  assert.equal(wasCancelled(null), false);
});

test('a drawing that carried images loses them on the way in', async () => {
  // Images as floor finishes were tried and taken out again: they made the 3D view
  // read as a photograph of a room rather than as a drawing of a proposal. An older
  // file that has them opens without them, and without trying to fetch anything.
  const { normaliseProject } = await import('../src/app/export.js');
  const project = normaliseProject({
    plans: [{ id: 'p', nodes: [], walls: [] }],
    activePlanId: 'p',
    textures: [{ id: 'x', name: 'Tile', dataUrl: 'data:image/jpeg;base64,abc' }],
  });
  assert.equal(project.textures, undefined);
});

test('a floor finish that no longer exists falls back rather than breaking', async () => {
  const { floorSurface, MATERIAL } = await import('../src/app/materials.js');
  // Rooms saved against an image now name a finish nobody has.
  const gone = floorSurface('img:whatever');
  assert.equal(gone.material, MATERIAL.boards, 'it comes back as the default, boards');
  assert.ok(gone.colour.every((c) => c > 0 && c <= 1));
});

test('a drawing from a newer build is refused rather than mangled', () => {
  // The format stamp was written on every save and read on none of them, so a file
  // from a later version would have been put through this version's migrations and
  // quietly changed. Better to say so and leave the file alone.
  const project = createProject();
  addRoomRect(activePlan(project), 0, 0, 4000, 3000, { type: 'exterior', thickness: 300 });
  touch(activePlan(project));

  const ours = projectToJson(project);
  assert.match(ours, /"format": "floor-planner\/2"/);
  assert.ok(projectFromJson(ours), 'our own file opens');

  const newer = ours.replace('floor-planner/2', 'floor-planner/7');
  assert.throws(() => projectFromJson(newer), /newer version/);

  // An older stamp is fine — that is what the migrations are for.
  assert.ok(projectFromJson(ours.replace('floor-planner/2', 'floor-planner/1')));
  // And something that is not a drawing at all fails as a drawing, not as a crash.
  assert.throws(() => projectFromJson('{}'), /not a floor plan/);
  assert.throws(() => projectFromJson('not json at all'), /not even JSON/);
});
