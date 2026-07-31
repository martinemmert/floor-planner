// The cursor as the tool in your hand.
//
// Photoshop's habit, and the reason it is worth copying: the pointer *is* the tool,
// its hotspot is where the tool bites, and a badge on it says what the next click will
// actually do. You never have to look away from the drawing to find out what you are
// holding, and you never click to discover that nothing was going to happen.
//
// Three things decide it, in this order of precedence:
//
//   a key held    — space pans, whatever the tool; shift adds to a selection; alt
//                   takes a wall off the one it is butted into
//   what is under — a wall under the door tool means the click will land; nothing
//                   under it means it will not, and the cursor says so before you try
//   the tool      — the glyph itself, the same one the toolbar draws
//
// `cursorFor` is the decision and `cursorCss` is the picture. Both are pure, so the
// table can be tested without a browser and the drawing without a canvas.

/**
 * Every badge, as a path in its own 10 × 10 box. Small enough to read at cursor size,
 * which rules out anything with more than about four strokes.
 */
export const BADGES = {
  // A click will add to what is already selected, rather than replacing it.
  plus: { d: 'M5 1.4v7.2M1.4 5h7.2' },
  // What is under the pointer can be dragged.
  move: { d: 'M5 1.2 8.8 5 5 8.8 1.2 5Z' },
  // There is something here to pick up.
  pick: { d: 'M3.2 3.2h3.6v3.6h-3.6Z', fill: true },
  // Alt: the wall comes away from the one it is butted into instead of sliding along it.
  free: { d: 'M2.2 2.2h5.6v5.6h-5.6Z' },
  // This click deletes.
  erase: { d: 'M2.2 2.2l5.6 5.6M7.8 2.2l-5.6 5.6' },
  // Nothing will happen here.
  none: { d: 'M5 5m-3.6 0a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0-7.2 0M2.4 2.4l5.2 5.2' },
  // The point has been caught by something — a node, a face, a guide.
  snap: { d: 'M5 5m-2.6 0a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M5 0.8v1.4M5 7.8v1.4M0.8 5h1.4M7.8 5h1.4' },
};

// Which tools put a thing at a point, and so want a crosshair to put it at.
//
// Everything except select, in other words. The arrow layout hangs the glyph off its
// own tip, which only works for a glyph that has a tip in the top-left corner: the
// eraser's business end is halfway down its own box, so it takes the crosshair too
// rather than claiming to bite somewhere it does not.
const POINT_TOOLS = new Set([
  'erase',
  'wall',
  'rect',
  'door',
  'window',
  'opening',
  'trim',
  'split',
  'stair',
  'column',
  'void',
  'fixture',
  'furniture',
  'label',
  'dimension',
  'measure',
]);

/**
 * Tools whose click only means something on a wall. Off a wall they do nothing but
 * print a message, which is a poor way to find out.
 *
 * Exported because the interaction has to look for a wall under the pointer for
 * exactly this list. Kept as two lists, the cursor said the click would land on tools
 * where it would not.
 */
export const WALL_TOOLS = new Set(['door', 'window', 'opening', 'trim', 'split']);

// What can only be read, never moved.
//
// A dimension chain is worked out from the drawing rather than kept in it, so pointing
// at a figure lights up the witness lines that say what it measures and that is all it
// can do. Everything else the pointer can find — walls, nodes, openings, rooms,
// furniture, fixtures, labels, manual dimensions, guides, stairs, columns, voids — can
// be dragged where it stands, which is why this list is the exception rather than the
// rule: written the other way round it fell behind every time something new became
// draggable.
const READ_ONLY = new Set(['chain']);

/**
 * What the cursor should be.
 *
 * @param mode  '2d' or '3d'
 * @param tool  the active tool's id
 * @param hover what is under the pointer, as `{kind, id}`, or null
 * @param drag  what is being dragged, as `{kind}`, or null
 * @param snap  truthy while the point is caught by something
 * @param keys  `{space, shift, alt}`
 * @returns {{icon: string|null, badge: string|null, point: boolean, native: string}}
 *          `icon` is a tool id whose glyph to draw, or null for a plain native cursor.
 */
export function cursorFor({ mode = '2d', tool = 'select', hover = null, drag = null, snap = false, keys = {} } = {}) {
  const plain = (native) => ({ icon: null, badge: null, point: false, native });

  // Space pans, over anything, in any tool. It is the one gesture that has to be
  // legible even mid-drag, so it is tested before everything else.
  if (keys.space) return plain(drag ? 'grabbing' : 'grab');
  if (drag?.kind === 'pan') return plain('grabbing');
  // The model has its own navigation and no tools to be in.
  if (mode === '3d') return plain('default');

  const point = POINT_TOOLS.has(tool);
  const icon = tool;

  // Mid-drag the cursor stops advertising and starts reporting: what is moving, and
  // whether alt has taken it off its host.
  if (drag) {
    if (drag.kind === 'marquee') return { icon: 'select', badge: keys.shift ? 'plus' : null, point: false, native: 'crosshair' };
    const freed = keys.alt && (drag.kind === 'node' || drag.kind === 'wall');
    // A snap outranks the plain move: that the point has been caught is the news, and
    // that something is moving you can already see.
    return { icon, badge: freed ? 'free' : snap ? 'snap' : 'move', point, native: 'grabbing' };
  }

  if (tool === 'erase') {
    return { icon: 'erase', badge: hover ? 'erase' : 'none', point: true, native: hover ? 'pointer' : 'default' };
  }

  if (tool === 'select') {
    const badge = keys.shift
      ? 'plus'
      : keys.alt && (hover?.kind === 'node' || hover?.kind === 'wall')
        ? 'free'
        : !hover
          ? null
          : READ_ONLY.has(hover.kind)
            ? 'pick'
            : 'move';
    return { icon: 'select', badge, point: false, native: hover ? 'pointer' : 'default' };
  }

  // A drawing tool. If its click needs a wall, say whether it has one.
  if (WALL_TOOLS.has(tool)) {
    return { icon, badge: hover?.kind === 'wall' ? 'pick' : 'none', point: true, native: 'crosshair' };
  }
  return { icon, badge: snap ? 'snap' : null, point: true, native: 'crosshair' };
}

// The crosshair, with a hole in the middle so the point it marks stays visible. Centred
// on the hotspot below, not half a pixel off it.
const CROSS = 'M0.5 8h5.2M10.8 8h5.2M8 0.5v5.2M8 10.8v5.2';

// Where the pointer actually acts. A crosshair bites at its centre; the arrow bites at
// its own tip, which the sprite draws at (5, 3) of a 24 box and this places at 0.9 of
// that, one pixel in.
const HOT_POINT = [8, 8];
const HOT_ARROW = [5, 4];

/**
 * The glyph markup drawn twice: once fat in the paper colour to carry a halo, once in
 * ink on top. Without the halo the cursor disappears over wall poché, which is most of
 * a floor plan.
 */
const INK_WIDTH = 1.5;
const HALO_EXTRA = 2;

function halo(markup) {
  // Widened rather than replaced, so a glyph that sets its own weight keeps its
  // relative weight instead of every line in it coming out the same.
  return markup.replace(/stroke-width="([\d.]+)"/g, (_, w) => `stroke-width="${(Number(w) + HALO_EXTRA).toFixed(2)}"`);
}

/**
 * A CSS `cursor` value: an SVG of the tool, its badge and its hotspot.
 *
 * @param glyph the sprite symbol's own markup, or '' for no glyph
 * @param spec  what `cursorFor` returned
 * @param ink   the drawing colour
 * @param paper the halo colour
 */
export function cursorCss(glyph, spec, ink = '#111827', paper = '#ffffff') {
  if (!spec?.icon) return spec?.native ?? 'default';

  const [hx, hy] = spec.point ? HOT_POINT : HOT_ARROW;
  // The tool sits out of the way of its own hotspot: down and right of a crosshair,
  // or in the corner where an arrow already points.
  const place = spec.point ? 'translate(17 17) scale(0.61)' : 'translate(1 1) scale(0.9)';
  const badge = BADGES[spec.badge];
  // Opposite corner to the glyph, so the two never overlap.
  const badgeAt = spec.point ? 'translate(21 1)' : 'translate(21 21)';

  const body =
    (spec.point ? `<path d="${CROSS}"/>` : '') +
    `<g transform="${place}">GLYPH</g>` +
    (badge ? `<g transform="${badgeAt}"><path d="${badge.d}" FILL/></g>` : '');

  const layer = (colour, markup, width) =>
    `<g fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ` +
    `style="color:${colour}">${markup}</g>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    layer(paper, halo(body).replace('GLYPH', halo(glyph)).replace('FILL', ''), INK_WIDTH + HALO_EXTRA) +
    layer(ink, body.replace('GLYPH', glyph).replace('FILL', badge?.fill ? `fill="${ink}"` : ''), INK_WIDTH) +
    `</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${spec.native}`;
}
