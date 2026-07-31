import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PdfDocument } from '../src/pdf/document.js';
import { extractPage } from '../src/pdf/content.js';
import { makeClassicPdf, makeModernPdf, planWalls } from './fixtures/make-plan-pdf.mjs';

test('reads a classic xref table and finds every page', async () => {
  const doc = await PdfDocument.load(makeClassicPdf({ pages: 2 }));
  assert.equal(doc.getPages().length, 2);
  assert.deepEqual(doc.warnings, []);
});

test('reads an xref stream with object streams and a PNG predictor', async () => {
  const doc = await PdfDocument.load(makeModernPdf());
  assert.equal(doc.getPages().length, 1);
  assert.deepEqual(doc.warnings, []);
  const catalog = doc.getCatalog();
  assert.equal(catalog.Type, 'Catalog');
});

test('extracts wall geometry and room labels from the content stream', async () => {
  const doc = await PdfDocument.load(makeClassicPdf({ pages: 1 }));
  const page = doc.getPages()[0];
  const result = await extractPage(doc, page);

  assert.ok(result.width > result.height, 'A3 landscape');
  // every wall is drawn as two parallel faces, for two houses
  assert.ok(result.paths.length >= planWalls().length * 2, `got ${result.paths.length} paths`);

  const labels = result.texts.map((t) => t.str);
  assert.ok(labels.includes('Wohnen'), `labels: ${labels.join('|')}`);
  assert.ok(labels.includes('Kueche'));
  assert.ok(labels.includes('Bad'));
  assert.ok(labels.includes('GRUNDRISS EG'));
  // dimension chain text survives as decimal-comma numbers
  assert.ok(labels.some((s) => /^\d+,\d{2}$/.test(s)), `labels: ${labels.join('|')}`);
});

test('page geometry lands inside the page box, y measured downward', async () => {
  const doc = await PdfDocument.load(makeClassicPdf({ pages: 1 }));
  const result = await extractPage(doc, doc.getPages()[0]);
  for (const path of result.paths) {
    for (const [x, y] of path.pts) {
      assert.ok(x >= -1 && x <= result.width + 1, `x ${x}`);
      assert.ok(y >= -1 && y <= result.height + 1, `y ${y}`);
    }
  }
  // the title block sits in the lower right, so its text has a large y
  const title = result.texts.find((t) => t.str === 'GRUNDRISS EG');
  assert.ok(title.y > result.height * 0.8, `title y ${title.y} of ${result.height}`);
  assert.ok(title.x > result.width * 0.7, `title x ${title.x}`);
});

test('second page keeps its own content', async () => {
  const doc = await PdfDocument.load(makeClassicPdf({ pages: 2 }));
  const first = await extractPage(doc, doc.getPages()[0]);
  const second = await extractPage(doc, doc.getPages()[1]);
  assert.ok(first.texts.some((t) => t.str === 'GRUNDRISS EG'));
  assert.ok(second.texts.some((t) => t.str === 'GRUNDRISS OG'));
});

test('glyphs placed one at a time are read back as words', async () => {
  const { groupWords } = await import('../src/pdf/content.js');
  // A CAD exporter writes "5.94" as four separately positioned glyphs.
  const glyph = (str, x, y, size = 10, angle = 0) => ({ str, x, y, size, angle, width: size * 0.6 });
  const grouped = groupWords([
    glyph('5', 0, 100),
    glyph('.', 6, 100),
    glyph('9', 12, 100),
    glyph('4', 18, 100),
    glyph('Küche', 0, 60),
    glyph('12', 200, 100), // far away on the same baseline: its own word
  ]);
  const words = grouped.map((t) => t.str).sort();
  assert.deepEqual(words, ['12', '5.94', 'Küche']);
  const number = grouped.find((t) => t.str === '5.94');
  assert.equal(number.x, 0);
  assert.ok(number.width > 18 && number.width < 30, `width ${number.width}`);
});

test('words on different baselines and at different angles stay apart', async () => {
  const { groupWords } = await import('../src/pdf/content.js');
  const glyph = (str, x, y, angle = 0) => ({ str, x, y, size: 10, angle, width: 6 });
  const grouped = groupWords([
    glyph('a', 0, 100),
    glyph('b', 6, 100),
    glyph('c', 0, 80), // a line below
    glyph('d', 6, 80),
    glyph('e', 40, 100, Math.PI / 2), // written sideways, as a dimension often is
  ]);
  assert.deepEqual(grouped.map((t) => t.str).sort(), ['ab', 'cd', 'e']);
});

test('a superscript is not glued onto the number before it', async () => {
  const { groupWords } = await import('../src/pdf/content.js');
  // German plans write 5.94⁵ for 5.945 m — the superscript is smaller and raised.
  const grouped = groupWords([
    { str: '5', x: 0, y: 100, size: 10, angle: 0, width: 6 },
    { str: '.', x: 6, y: 100, size: 10, angle: 0, width: 6 },
    { str: '9', x: 12, y: 100, size: 10, angle: 0, width: 6 },
    { str: '4', x: 18, y: 100, size: 10, angle: 0, width: 6 },
    { str: '5', x: 24, y: 105, size: 6, angle: 0, width: 4 },
  ]);
  assert.ok(grouped.some((t) => t.str === '5.94'), grouped.map((t) => t.str).join('|'));
});
