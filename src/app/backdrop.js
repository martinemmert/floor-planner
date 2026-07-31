// Tracing backdrop. A PDF page or a bitmap is loaded purely as a faint
// reference to draw over; nothing is interpreted as walls. The scale starts from
// whatever the dimension chains suggest and is confirmed by measuring a length
// you know.

import { PdfDocument, UnsupportedEncryption } from '../pdf/document.js';
import { extractPage } from '../pdf/content.js';
import { buildSegments } from '../geom/segments.js';
import { inferScale } from '../geom/scale.js';
import { boundsOf } from '../geom/vec.js';

export const MAX_PAGES = 40;

export async function readPdfPages(bytes, onProgress) {
  let doc;
  try {
    doc = await PdfDocument.load(bytes);
  } catch (err) {
    if (err instanceof UnsupportedEncryption) throw err;
    throw new Error(`This file could not be read as a PDF (${err.message}).`);
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error('This PDF contains no pages.');
  const limit = Math.min(pages.length, MAX_PAGES);
  const results = [];
  for (let i = 0; i < limit; i++) {
    onProgress?.(i, limit);
    const extraction = await extractPage(doc, pages[i]);
    const segments = buildSegments(extraction.paths);
    const scale = inferScale(segments, extraction.texts);
    results.push({
      index: i,
      width: extraction.width,
      height: extraction.height,
      segments,
      texts: extraction.texts,
      scale,
      isRaster: segments.length < 12 && extraction.images.length > 0,
    });
  }
  return { pages: results, totalPages: pages.length, truncated: pages.length > limit, warnings: doc.warnings };
}

// Converts a read page into the plan's backdrop, in millimetres.
export function backdropFromPage(page, mmPerPt) {
  return {
    kind: 'pdf',
    visible: true,
    opacity: 0.3,
    pageIndex: page.index,
    widthMm: page.width * mmPerPt,
    heightMm: page.height * mmPerPt,
    image: null,
    segments: page.segments.map((s) => ({
      x1: s.x1 * mmPerPt,
      y1: s.y1 * mmPerPt,
      x2: s.x2 * mmPerPt,
      y2: s.y2 * mmPerPt,
    })),
    texts: page.texts.map((t) => ({
      str: t.str,
      x: t.x * mmPerPt,
      y: t.y * mmPerPt,
      size: t.size * mmPerPt,
    })),
  };
}

export function backdropFromImage(image, dataUrl, mmPerPx = 10) {
  return {
    kind: 'image',
    visible: true,
    opacity: 0.55,
    widthMm: image.width * mmPerPx,
    heightMm: image.height * mmPerPx,
    image: dataUrl,
    segments: [],
    texts: [],
  };
}

export function emptyBackdrop() {
  return { kind: null, visible: true, opacity: 0.3, widthMm: 0, heightMm: 0, image: null, segments: [], texts: [] };
}

export function backdropBounds(backdrop) {
  if (!backdrop || !backdrop.kind) return null;
  if (backdrop.segments.length) {
    const points = [];
    for (const s of backdrop.segments) points.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
    return boundsOf(points);
  }
  return {
    minX: 0,
    minY: 0,
    maxX: backdrop.widthMm,
    maxY: backdrop.heightMm,
    width: backdrop.widthMm,
    height: backdrop.heightMm,
  };
}

// Rescales the backdrop in place when the drawing scale is corrected.
export function rescaleBackdrop(backdrop, factor) {
  if (!backdrop) return;
  for (const s of backdrop.segments) {
    s.x1 *= factor;
    s.y1 *= factor;
    s.x2 *= factor;
    s.y2 *= factor;
  }
  for (const t of backdrop.texts) {
    t.x *= factor;
    t.y *= factor;
    t.size *= factor;
  }
  backdrop.widthMm *= factor;
  backdrop.heightMm *= factor;
}

export { UnsupportedEncryption };
