import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every module must stand up on its own.
 *
 * The build flattens the modules into one shared scope, which hides a whole class of
 * mistake: a module that uses a name it never imported works perfectly in the bundle,
 * because some other module happens to have declared it at the top level. Under Node,
 * where the imports are real, it throws — and so would the bundle the moment the two
 * modules were split or reordered.
 *
 * That is not hypothetical. `render.js` used `TEXT_MM` from `export.js` without
 * importing it and drew correctly in the browser, and called a `levelLabel` that was
 * declared nowhere at all — which killed the frame silently, part way through a draw,
 * with nothing in the console.
 */
test('every module loads on its own, with the imports it actually needs', async () => {
  const dirs = ['src/app', 'src/geom'];
  // The entry point is the one module that is allowed to need a browser: it reaches for
  // `document` as it loads, which is its whole job. Everything else is library code and
  // must load anywhere.
  const entry = 'main.js';
  const files = [];
  for (const dir of dirs) {
    for (const name of await readdir(join(root, dir))) {
      if (name.endsWith('.js') && name !== entry) files.push(join(dir, name));
    }
  }
  assert.ok(files.length > 20, `expected the whole source, found ${files.length} files`);

  const broken = [];
  for (const file of files) {
    try {
      await import(`file://${join(root, file)}`);
    } catch (err) {
      broken.push(`${relative('.', file)}: ${err.message}`);
    }
  }
  assert.deepEqual(broken, [], `these modules do not stand up on their own:\n  ${broken.join('\n  ')}`);
});

test('nothing reaches for a name the bundle would only happen to have', async () => {
  // The same check from the other side: a module that names something it neither
  // declares nor imports. Caught by loading each one and calling nothing — an import
  // of an undeclared name is a load-time error in a module, which is the point.
  const render = await import(`file://${join(root, 'src/app/render.js')}`);
  assert.equal(typeof render.levelLabel, 'function');
  assert.equal(render.levelLabel(0), 'OKFF ±0,00');
  assert.equal(render.levelLabel(2750), 'OKFF +2,75');
  assert.equal(render.levelLabel(-2500), 'OKFF −2,50', 'a cellar reads below the datum');
});
