// Flattens the ES modules into one inline script and writes the single-file
// artifact page. No bundler: the modules have no cycles and every top-level name
// is unique, which the build verifies before concatenating.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, 'src/app/main.js');
const OUT = resolve(here, 'dist/floor-planner.html');

const IMPORT_RE = /^import\s+[\s\S]*?from\s+(['"])(.*?)\1;?[ \t]*$/gm;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

async function collect(entry) {
  const modules = new Map();
  const order = [];

  async function visit(path, stack) {
    // The cycle check has to come first. Asked the other way round it was dead code:
    // the second time round a cycle the module is already in `modules`, so it
    // returned before ever reaching here — and the bundle came out with a module
    // emitted before the one it depends on, which the build called a success and the
    // page threw on.
    if (stack.includes(path)) {
      throw new Error(`Import cycle: ${stack.map((p) => relative(here, p)).join(' -> ')} -> ${relative(here, path)}`);
    }
    if (modules.has(path)) return;
    const source = await readFile(path, 'utf8');
    const deps = [];
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[2];
      if (!spec.startsWith('.')) throw new Error(`${relative(here, path)} imports a bare module "${spec}"`);
      deps.push(resolve(dirname(path), spec));
    }
    for (const dep of deps) await visit(dep, [...stack, path]);
    // Recorded after its dependencies, so a module cannot be marked done while it is
    // still being walked into.
    modules.set(path, { source, deps });
    order.push(path);
  }

  await visit(entry, []);
  return { modules, order };
}

function strip(source) {
  return source
    .replace(IMPORT_RE, '')
    .replace(/^export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\b)/gm, '')
    .replace(/^export\s+default\s+/gm, '');
}

function checkNames(modules, order) {
  const owner = new Map();
  const clashes = [];
  for (const path of order) {
    const source = modules.get(path).source;
    for (const match of source.matchAll(DECL_RE)) {
      const name = match[2];
      if (owner.has(name) && owner.get(name) !== path) {
        clashes.push(`${name} (${relative(here, owner.get(name))} and ${relative(here, path)})`);
      } else {
        owner.set(name, path);
      }
    }
  }
  if (clashes.length) {
    throw new Error(`Top-level names collide, so flattening would break:\n  ${clashes.join('\n  ')}`);
  }

  // Flattening drops the import statements and lets every module share one scope, so
  // a name only works if it is the same on both sides. Renaming one on the way in
  // leaves the alias undefined in the bundle while Node, which honours the import,
  // runs it perfectly — the tests pass and the built page throws.
  const renamed = [];
  for (const path of order) {
    for (const match of modules.get(path).source.matchAll(/^import\s*\{([^}]*)\}/gm)) {
      for (const part of match[1].split(',')) {
        const alias = part.match(/(\S+)\s+as\s+(\S+)/);
        if (alias) renamed.push(`${alias[1]} as ${alias[2]} in ${relative(here, path)}`);
      }
    }
  }
  if (renamed.length) {
    throw new Error(`An import cannot be renamed, because flattening keeps the original name:\n  ${renamed.join('\n  ')}`);
  }
}

const TITLE = 'Floor Plan Editor';

async function main() {
  const { modules, order } = await collect(ENTRY);
  checkNames(modules, order);

  const css = await readFile(resolve(here, 'src/ui/styles.css'), 'utf8');
  const shell = await readFile(resolve(here, 'src/ui/shell.html'), 'utf8');

  const chunks = order.map((path) => `/* ---- ${relative(here, path)} ---- */\n${strip(modules.get(path).source).trim()}`);
  const script = chunks.join('\n\n');

  if (/<\/script/i.test(script)) throw new Error('Bundle contains a closing script tag');

  // The page is full of characters that are not ASCII — the German text, the em
  // dashes, the raised millimetres on a dimension, the arrows on the guide counts.
  // Opened as a file, or served by anything that does not say what the encoding is,
  // a browser falls back to windows-1252 and every one of them turns to mojibake.
  // The host wraps this fragment in its own head; declaring it here as well costs a
  // line and means the file also stands on its own.
  const html = `<meta charset="utf-8" />
<title>${TITLE}</title>
<style>
${css.trim()}
</style>

${shell.trim()}

<script>
(function () {
  'use strict';

${script}
})();
</script>
`;

  // A browser only prescans the first 1024 bytes for the encoding, so the declaration
  // has to stay near the top however the file grows above it.
  if (!/<meta\s+charset="utf-8"/i.test(Buffer.from(html, 'utf8').subarray(0, 1024).toString('latin1'))) {
    throw new Error('The encoding must be declared in the first 1024 bytes');
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, 'utf8');

  // Local harness that mimics how the artifact host wraps the page.
  const preview = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>
${html}
</html>
`;
  await writeFile(resolve(here, 'dist/preview.html'), preview, 'utf8');

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`wrote ${relative(here, OUT)} (${kb} kB, ${order.length} modules)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
