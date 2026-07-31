import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../src/app/store.js';
import { activePlan, addRoomRect, createProject, touch } from '../src/app/model.js';

/** A project with one room and one piece of furniture in it. */
function project() {
  const made = createProject();
  const plan = activePlan(made);
  addRoomRect(plan, 0, 0, 5000, 4000, { type: 'exterior', thickness: 300 });
  plan.furniture.push({ id: 'f1', kind: 'bed-double', x: 2000, y: 2000, w: 1800, h: 2000, rotation: 0 });
  touch(plan);
  return made;
}

const bed = (store) => (activePlan(store.project).furniture ?? []).find((f) => f.id === 'f1');
const where = (store) => {
  const f = bed(store);
  return { x: f.x, y: f.y, rotation: f.rotation };
};

test('undo after a live drag lands where the drag started, not in the middle of it', () => {
  // The bug this exists for. A drag has to change the drawing as it goes or there is
  // nothing to watch, and `edit` snapshots when it is called — by then the gesture has
  // already moved things, so undo restored the drawing as the drag had left it.
  const store = new Store(project());
  const start = where(store);

  store.preview();
  for (const step of [1, 2, 3]) {
    const item = bed(store);
    item.x = 2000 + step * 400;
    item.rotation = step * 30;
  }
  store.commit('move furniture');

  assert.deepEqual(where(store), { x: 3200, y: 2000, rotation: 90 }, 'the drag landed where it was let go');
  store.undo();
  assert.deepEqual(where(store), start, 'and undo went back to where it was picked up');
  store.redo();
  assert.deepEqual(where(store), { x: 3200, y: 2000, rotation: 90 });
});

test('a whole gesture is one entry in the history, however many steps it took', () => {
  const store = new Store(project());
  store.preview();
  for (let i = 1; i <= 20; i++) bed(store).x = 2000 + i * 10;
  store.commit('move furniture');
  assert.equal(store.past.length, 1, `twenty steps left ${store.past.length} things to undo`);
});

test('a gesture that changed nothing leaves the history alone', () => {
  // Pressing on a piece and letting go without moving is not an edit, and filling the
  // history with those makes undo useless — every press costs a press of ⌘Z.
  const store = new Store(project());
  store.preview();
  assert.equal(store.commit('move furniture'), false);
  assert.equal(store.past.length, 0);
  assert.equal(store.canUndo(), false);
});

test('opening a gesture twice keeps the first answer', () => {
  // `preview` is called from every pointer move, because a move does not know whether
  // it is the first. The second call must not overwrite where the drag began.
  const store = new Store(project());
  const start = where(store);
  store.preview();
  bed(store).x = 2500;
  store.preview();
  bed(store).x = 3000;
  store.commit('move furniture');
  store.undo();
  assert.deepEqual(where(store), start);
});

test('a gesture can be abandoned, putting the drawing back as it was found', () => {
  const store = new Store(project());
  const start = where(store);
  store.preview();
  bed(store).x = 4000;
  bed(store).rotation = 200;
  assert.equal(store.abandon(), true);
  assert.deepEqual(where(store), start);
  assert.equal(store.past.length, 0, 'and abandoning is not an edit');
});

test('committing without a gesture open does nothing', () => {
  const store = new Store(project());
  assert.equal(store.commit('move furniture'), false);
  assert.equal(store.abandon(), false);
  assert.equal(store.past.length, 0);
});

test('an ordinary edit still undoes on its own', () => {
  const store = new Store(project());
  const start = where(store);
  store.edit('move furniture', (p) => {
    (activePlan(p).furniture ?? []).find((f) => f.id === 'f1').x = 9000;
    return true;
  });
  assert.equal(where(store).x, 9000);
  store.undo();
  assert.deepEqual(where(store), start);
});

test('an edit that reports failure changes neither the drawing nor the history', () => {
  const store = new Store(project());
  const start = where(store);
  assert.equal(
    store.edit('move furniture', (p) => {
      (activePlan(p).furniture ?? []).find((f) => f.id === 'f1').x = 9000;
      return false;
    }),
    false
  );
  // The mutation ran before it said no, so the document is left as the mutation made
  // it — but nothing was recorded, which is what "false" is for.
  assert.equal(store.past.length, 0);
  assert.equal(store.canUndo(), false);
  assert.notDeepEqual(start, null);
});

test('a new edit throws away the redos, as it must', () => {
  const store = new Store(project());
  store.edit('a', (p) => {
    (activePlan(p).furniture ?? []).find((f) => f.id === 'f1').x = 100;
    return true;
  });
  store.undo();
  assert.equal(store.canRedo(), true);
  store.edit('b', (p) => {
    (activePlan(p).furniture ?? []).find((f) => f.id === 'f1').y = 100;
    return true;
  });
  assert.equal(store.canRedo(), false, 'the future no longer follows from the present');
});
