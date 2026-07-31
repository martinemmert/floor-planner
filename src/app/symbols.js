// The plan symbols for furniture, as shapes rather than as drawing instructions.
//
// Every piece has a front and a back, and the two views have to agree about which is
// which or the drawing lies. The convention, in both:
//
//   the piece faces +y, and its back is at -y, against the wall
//
// so a bed's pillows, a WC's cistern, a sofa's back and a chair's back rail are all
// in the top half of the symbol as drawn, and in the -y half of the 3D model. Written
// out as data, that is something a test can check; written as a run of canvas calls it
// was something to be squinted at, which is how a chair ended up sitting backwards.
//
// Coordinates are fractions of the symbol's box, 0 at the back and 1 at the front.

/** Which part of a piece the shape is, where that matters. `back` is the giveaway. */
const rect = (x, y, w, h, role) => ({ kind: 'rect', x, y, w, h, role });
const line = (x1, y1, x2, y2, role) => ({ kind: 'line', x1, y1, x2, y2, role });
const ellipse = (x, y, rx, ry, role) => ({ kind: 'ellipse', x, y, rx, ry, role });
const fill = (shape) => ({ ...shape, fill: true });

const OUTLINE = rect(0, 0, 1, 1, 'outline');

export const FURNITURE_SYMBOLS = {
  bed: [OUTLINE, rect(0.06, 0.04, 0.88, 0.24, 'back'), line(0, 0.32, 1, 0.32)],
  sofa: [OUTLINE, rect(0.08, 0.3, 0.84, 0.66, 'seat')],
  // A chair's back rail is at the back, the same as everything else's. It was at the
  // front, which put it on the opposite side from the one the 3D model builds.
  chair: [OUTLINE, line(0, 0.25, 1, 0.25, 'back')],
  // A run of units against a wall: the worktop, and the line of the doors below it.
  counter: [OUTLINE, line(0, 0.22, 1, 0.22, 'back')],
  round: [fill(ellipse(0.5, 0.5, 0.5, 0.5, 'outline'))],
  appliance: [OUTLINE, line(0, 0, 1, 1), line(1, 0, 0, 1)],
  stove: [
    OUTLINE,
    ellipse(0.3, 0.3, 0.16, 0.16),
    ellipse(0.7, 0.3, 0.16, 0.16),
    ellipse(0.3, 0.7, 0.16, 0.16),
    ellipse(0.7, 0.7, 0.16, 0.16),
  ],
  sink: [OUTLINE, rect(0.12, 0.18, 0.5, 0.64), ellipse(0.8, 0.22, 0.08, 0.08, 'back')],
  bath: [OUTLINE, ellipse(0.5, 0.5, 0.38, 0.38)],
  shower: [OUTLINE, line(0, 0, 1, 1), ellipse(0.5, 0.5, 0.13, 0.13)],
  toilet: [fill(rect(0.15, 0, 0.7, 0.22, 'back')), fill(ellipse(0.5, 0.6, 0.44, 0.36))],
  basin: [OUTLINE, ellipse(0.5, 0.56, 0.36, 0.34)],
  wardrobe: [OUTLINE, line(0.5, 0, 0.5, 1)],
  table: [OUTLINE],
  rect: [OUTLINE],
  stairs: [OUTLINE, { kind: 'treads' }],
};

export function furnitureSymbol(name) {
  return FURNITURE_SYMBOLS[name] ?? FURNITURE_SYMBOLS.rect;
}

/**
 * Which half of the piece its back is in, from the symbol, as a fraction.
 *
 * Under 0.5 means the back is at -y, which is the convention. Null when the symbol
 * says nothing about which way round it goes — a round table has no back.
 */
export function symbolBackAt(name) {
  const shapes = furnitureSymbol(name);
  const shape = shapes.find((s) => s.role === 'back');
  if (shape) {
    if (shape.kind === 'rect') return shape.y + shape.h / 2;
    if (shape.kind === 'line') return (shape.y1 + shape.y2) / 2;
    return shape.y;
  }
  // A sofa is drawn as its seat inside its outline, and the back is the strip the
  // seat leaves — so where the seat starts says which way it faces just as well.
  const seat = shapes.find((s) => s.role === 'seat');
  return seat ? seat.y / 2 : null;
}
