import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BADGES, cursorCss, cursorFor } from '../src/app/cursor.js';

// What a sprite symbol's innerHTML looks like: paths with no stroke of their own, so
// they take the weight from the group they are dropped into.
const GLYPH = '<path d="M3 15h18M3 11h18M3 11v4M21 11v4" />';

test('space pans, whatever tool is in hand and whatever is under the pointer', () => {
  for (const tool of ['select', 'wall', 'door', 'erase', 'furniture']) {
    const held = cursorFor({ tool, keys: { space: true }, hover: { kind: 'wall', id: 'w1' } });
    assert.equal(held.native, 'grab', tool);
    assert.equal(held.icon, null, `${tool}: the tool gets out of the way`);
    assert.equal(cursorFor({ tool, keys: { space: true }, drag: { kind: 'pan' } }).native, 'grabbing');
  }
});

test('the cursor carries the tool that is active', () => {
  for (const tool of ['wall', 'rect', 'door', 'window', 'stair', 'column', 'furniture', 'label', 'measure']) {
    const spec = cursorFor({ tool });
    assert.equal(spec.icon, tool, `${tool} should draw its own glyph`);
    assert.equal(spec.point, true, `${tool} places something at a point, so it wants a crosshair`);
  }
  // Select is an arrow, not a crosshair: it picks things up rather than putting them
  // down. It is the only one — the arrow layout hangs the glyph off its own tip, and
  // only the arrow has a tip in that corner to hang it from.
  assert.equal(cursorFor({ tool: 'select' }).point, false);
  assert.equal(cursorFor({ tool: 'erase' }).point, true);
});

test('a tool that only works on a wall says whether it has one', () => {
  for (const tool of ['door', 'window', 'opening', 'trim', 'split']) {
    assert.equal(cursorFor({ tool }).badge, 'none', `${tool} off a wall does nothing, and should say so`);
    assert.equal(cursorFor({ tool, hover: { kind: 'wall', id: 'w1' } }).badge, 'pick', `${tool} on a wall is armed`);
  }
  // A tool that can put its thing down anywhere never shows the refusal.
  for (const tool of ['wall', 'rect', 'furniture', 'label', 'column']) {
    assert.notEqual(cursorFor({ tool }).badge, 'none', tool);
  }
});

test('what is under the pointer decides what select offers', () => {
  assert.equal(cursorFor({ tool: 'select' }).badge, null, 'over nothing, nothing is offered');
  assert.equal(cursorFor({ tool: 'select', hover: { kind: 'wall' } }).badge, 'move', 'a wall can be dragged');
  assert.equal(cursorFor({ tool: 'select', hover: { kind: 'node' } }).badge, 'move');
  assert.equal(cursorFor({ tool: 'select', hover: { kind: 'dimension' } }).badge, 'move', 'a manual dimension moves');
  // A chain figure is worked out from the drawing, so it can be read and nothing else.
  assert.equal(cursorFor({ tool: 'select', hover: { kind: 'chain' } }).badge, 'pick');
  assert.equal(cursorFor({ tool: 'erase', hover: null }).badge, 'none');
  assert.equal(cursorFor({ tool: 'erase', hover: { kind: 'wall' } }).badge, 'erase');
});

test('a held key changes what the next click will do, and says so', () => {
  const over = { kind: 'wall', id: 'w1' };
  // Shift adds to the selection instead of replacing it.
  assert.equal(cursorFor({ tool: 'select', hover: over, keys: { shift: true } }).badge, 'plus');
  assert.equal(cursorFor({ tool: 'select', hover: null, keys: { shift: true } }).badge, 'plus');
  // Alt takes a wall bodily off the one it is butted into rather than sliding along it.
  assert.equal(cursorFor({ tool: 'select', hover: over, keys: { alt: true } }).badge, 'free');
  assert.equal(cursorFor({ tool: 'select', hover: { kind: 'furniture' }, keys: { alt: true } }).badge, 'move',
    'alt means nothing to a piece of furniture, so it claims nothing');
  // And it keeps saying it mid-drag, which is when it actually matters.
  assert.equal(cursorFor({ tool: 'select', drag: { kind: 'wall' }, keys: { alt: true } }).badge, 'free');
  assert.equal(cursorFor({ tool: 'select', drag: { kind: 'wall' } }).badge, 'move');
});

test('every badge the table can name is one the drawing can draw', () => {
  const named = new Set();
  const cases = [];
  for (const tool of ['select', 'erase', 'wall', 'rect', 'door', 'window', 'opening', 'trim', 'split', 'furniture']) {
    for (const hover of [null, { kind: 'wall' }, { kind: 'node' }, { kind: 'chain' }]) {
      for (const drag of [null, { kind: 'wall' }, { kind: 'marquee' }, { kind: 'furniture' }]) {
        for (const keys of [{}, { shift: true }, { alt: true }]) {
          for (const snap of [false, true]) cases.push({ tool, hover, drag, keys, snap });
        }
      }
    }
  }
  for (const input of cases) {
    const spec = cursorFor(input);
    if (spec.badge) named.add(spec.badge);
    assert.ok(spec.native, `${input.tool}: a native fallback is always needed`);
  }
  for (const badge of named) assert.ok(BADGES[badge], `${badge} is named but not drawn`);
});

test('the cursor is a self-contained data URI with a hotspot on the point it acts at', () => {
  const value = cursorCss(GLYPH, cursorFor({ tool: 'wall' }));
  // A crosshair bites at its centre, and the fallback keeps a cursor if the URL fails.
  assert.match(value, /^url\("data:image\/svg\+xml,[^"]+"\) 8 8, crosshair$/);

  const svg = decodeURIComponent(value.slice(value.indexOf(',') + 1, value.indexOf('") ')));
  // Nothing is fetched. The one URL in it is the SVG namespace, which is an identifier
  // rather than an address — no `href`, no nested `url()`, so a strict CSP has nothing
  // to block and the cursor works offline.
  assert.equal(svg.match(/https?:/g).length, 1);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(/href|url\(|<image/.test(svg), false, 'nothing outside the cursor is referenced');

  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="32" height="32"/);
  assert.equal(svg.includes('GLYPH'), false, 'the glyph placeholder is filled in');
  assert.equal(svg.includes('FILL'), false);
  // Drawn twice: a fat halo underneath, or the cursor vanishes over wall poché.
  assert.equal(svg.split('M3 15h18').length - 1, 2, 'the glyph is drawn once for the halo and once in ink');
  assert.ok(svg.includes('stroke-width="3.5"') && svg.includes('stroke-width="1.5"'));

  // The arrow acts at its tip, not at the middle of its box.
  assert.match(cursorCss(GLYPH, cursorFor({ tool: 'select' })), /"\) 5 4, default$/);
  assert.match(cursorCss(GLYPH, cursorFor({ tool: 'select', hover: { kind: 'wall' } })), /"\) 5 4, pointer$/);
});

test('with no glyph to draw the cursor falls back to a plain keyword', () => {
  assert.equal(cursorCss(GLYPH, cursorFor({ keys: { space: true } })), 'grab');
  assert.equal(cursorCss(GLYPH, cursorFor({ mode: '3d' })), 'default');
});

test('a badge that fills is filled in ink and left hollow in the halo', () => {
  const svg = (spec) => decodeURIComponent(cursorCss(GLYPH, spec).slice(0, -1));
  const withPick = svg(cursorFor({ tool: 'door', hover: { kind: 'wall' } }));
  assert.equal(withPick.split(BADGES.pick.d).length - 1, 2);
  // Only the ink pass fills it; a filled halo would swallow the badge inside it.
  assert.equal(withPick.split('fill="#').length - 1, 1);
});
