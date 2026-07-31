// Doors and windows as solid parts, so the 3D view shows what is actually in the
// hole rather than the hole itself.
//
// Everything comes out in the opening's own frame — `a` along the wall from the
// opening's near jamb, `c` across it, `z` up from the storey floor — as prisms with
// four corners and a top and bottom. The plan draws the same door from the same
// numbers, so a leaf that sweeps into the room on the drawing sweeps into it here.

import { MAX_SWING, leafLayout, openingWidth, swingAngle } from './openings.js';

export { MAX_SWING, swingAngle };

const GLASS = 8;
const FRAME_DEEP = 78; // mm; how deep a window frame is, front to back
const LEAF = 40;
const SASH = 55; // the frame round a pane of glass, seen face on
const SASH_DEEP = 58; // and how thick that frame is

/** The window board, as the opening has it or as one normally comes. */
export function boardOf(opening) {
  // `null` and an empty field mean nobody has said, which is not the same as zero —
  // Number(null) is 0, so testing the coerced value alone would turn a board that
  // was never set into no board at all.
  const num = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    const given = Number(value);
    return Number.isFinite(given) ? Math.max(0, given) : fallback;
  };
  return {
    inner: num(opening.boardInner, 40),
    outer: num(opening.boardOuter, 20),
    thickness: num(opening.boardThickness, 30),
  };
}

function box(kind, a0, a1, c0, c1, z0, z1) {
  if (a1 - a0 < 1 || c1 - c0 < 0.5 || z1 - z0 < 1) return null;
  return {
    kind,
    pts: [
      { a: a0, c: c0 },
      { a: a1, c: c0 },
      { a: a1, c: c1 },
      { a: a0, c: c1 },
    ],
    z0,
    z1,
  };
}

/**
 * A slice of a leaf: the same plane, but only part of the way along it and only
 * part of the way up. What a sash is made of.
 */
function slice(kind, from, direction, la0, la1, z0, z1, thickness, bias, off = 0) {
  const start = {
    a: from.a + direction.a * la0 - direction.c * off,
    c: from.c + direction.c * la0 + direction.a * off,
  };
  return panel(kind, start, direction, la1 - la0, thickness, z0, z1, bias);
}

/**
 * A casement sash: a frame with the glass inside it, not a bare pane.
 *
 * Two stiles up the sides, two rails across, and the glazing in the middle — all in
 * the leaf's own plane, so the whole thing swings together.
 */
function sashParts(from, direction, length, z0, z1, bias) {
  const sw = Math.min(SASH, length / 4, (z1 - z0) / 4);
  const out = [
    slice('frame', from, direction, 0, sw, z0, z1, SASH_DEEP, bias),
    slice('frame', from, direction, length - sw, length, z0, z1, SASH_DEEP, bias),
    slice('frame', from, direction, sw, length - sw, z0, z0 + sw, SASH_DEEP, bias),
    slice('frame', from, direction, sw, length - sw, z1 - sw, z1, SASH_DEEP, bias),
  ];
  if (length - sw * 2 > 20 && z1 - z0 - sw * 2 > 20) {
    // Glazing sits in the middle of the sash's depth, the way it is bedded into the
    // rebate. Flush with the sash face it would share a plane with the stiles, and
    // two surfaces in one plane is what those streaks across a pane were.
    const mid = Math.sign(bias) * (SASH_DEEP - GLASS) / 2;
    out.push(slice('glass', from, direction, sw, length - sw, z0 + sw, z1 - sw, GLASS, bias, mid));
  }
  return out;
}

/**
 * A panel standing on its edge: a leaf, at whatever angle it is open to.
 *
 * `bias` decides where the panel's thickness sits relative to the line it is hung
 * on: 0 straddles it, -1 puts all of it on one side. A door is hung with its
 * material to one side of the hinge, which is what lets the leaf swing past square
 * without the wall being in the way — swing it right round and it comes to rest flat
 * against the wall face rather than inside it.
 */
function panel(kind, from, direction, length, thickness, z0, z1, bias = 0) {
  const ua = direction.a;
  const uc = direction.c;
  const na = -uc;
  const nc = ua;
  const near = bias === 0 ? thickness / 2 : bias < 0 ? 0 : thickness;
  const far = bias === 0 ? -thickness / 2 : bias < 0 ? -thickness : 0;
  return {
    kind,
    pts: [
      { a: from.a + na * near, c: from.c + nc * near },
      { a: from.a + ua * length + na * near, c: from.c + uc * length + nc * near },
      { a: from.a + ua * length + na * far, c: from.c + uc * length + nc * far },
      { a: from.a + na * far, c: from.c + nc * far },
    ],
    z0,
    z1,
    to: { a: from.a + ua * length, c: from.c + uc * length },
  };
}

/**
 * The parts of one opening, in its own frame.
 *
 * @param opening the opening from the plan
 * @param thickness the wall's thickness
 * @param ceiling how high the storey is, so a head cannot poke through it
 * @returns [{kind, pts:[{a,c}×4], z0, z1}] — kind is frame, glass, leaf, bar or sill
 */
export function openingParts(opening, thickness, ceiling = 2500) {
  // The hole, not the leaf. A door is 860 wide and its hole is 860 plus the lining
  // each side; build the frame on the leaf and it stands 60 mm short of the reveal
  // while the leaves — which are laid out on the hole — hang out past the jamb.
  const w = openingWidth(opening);
  const t = Math.max(40, thickness);
  const sill = Math.max(0, opening.sill ?? 0);
  const head = Math.min(ceiling, Math.max(sill + 200, opening.head ?? 2010));
  const side = opening.swing === 'out' ? -1 : 1;
  const kind = opening.kind ?? 'door';
  const style = opening.style ?? 'single';

  // How the frame sits in the wall's thickness — the difference between a window and
  // a door, and the reason a 365 wall was reading as a white tunnel.
  //
  // A window frame is a slab of its own, 70-odd mm front to back, set into the outer
  // third of the wall; the rest of the hole is masonry, plastered up to it, and the
  // deep reveal that leaves is exactly why the board inside is as deep as it is.
  // A door lining is the opposite — an Umfassungszarge wraps the whole reveal, so it
  // does run the full thickness. Filling the wall for both made every window frame as
  // deep as the wall, mullion and all.
  const glazedFrame = kind === 'window';
  let c0;
  let c1;
  if (glazedFrame) {
    const deep = Math.min(FRAME_DEEP, t - 20);
    const back = Math.max(0, Math.min(t - deep, t / 3)); // in from the weather side
    const outer = -side * (t / 2);
    const near = outer + side * back;
    const far = near + side * deep;
    c0 = Math.min(near, far);
    c1 = Math.max(near, far);
  } else {
    // A hair short of the wall's own faces: dead flush, the lining and the wall would
    // share a plane and fight over which of them is in front.
    c0 = -t / 2 + 2;
    c1 = t / 2 - 2;
  }
  const out = [];
  const add = (part) => {
    if (part) out.push(part);
  };

  // A plain opening is just a hole: no frame, nothing in it.
  if (kind === 'opening') return out;

  // One layout answers for the whole opening — where the frame is, where the leaves
  // hang, and how far they swing — so the plan and the model cannot disagree.
  const layout = leafLayout(opening, t);
  const fw = layout.frame; // the lining, as configured; the leaves are set out from it
  // The frame: two jambs, a head, and — on a window — a member across the bottom.
  const hasCill = kind === 'window' && style !== 'floor' && style !== 'french';
  const frameBottom = hasCill ? sill : sill;
  add(box('frame', 0, fw, c0, c1, frameBottom, head));
  add(box('frame', w - fw, w, c0, c1, frameBottom, head));
  add(box('frame', fw, w - fw, c0, c1, head - fw, head));
  if (hasCill) {
    const board = boardOf(opening);
    const on = board.inner > 0 || board.outer > 0 ? board.thickness : 0;
    add(box('frame', fw, w - fw, c0, c1, sill + on, sill + on + fw));
  }

  const boardOn = hasCill && (boardOf(opening).inner > 0 || boardOf(opening).outer > 0) ? boardOf(opening).thickness : 0;
  const glassLow = hasCill ? sill + boardOn + fw : sill;
  const glassHigh = head - fw;
  const glazed = kind === 'window' || style === 'french' || style === 'glazed';

  if (glazed) {
    // A pair of sashes has a bar between them; the layout decides when that is.
    const bar = kind === 'window' && style !== 'fixed' && layout.doubled;
    if (bar) {
      const mid = w / 2;
      add(box('bar', mid - fw / 2, mid + fw / 2, c0, c1, glassLow, glassHigh));
    }
    if (kind === 'window' && layout.leaves.length) {
      // The glass belongs to the sash, so it swings with it. A casement standing
      // open should let the light in past its own pane, not through it.
      const theta = (layout.angle * Math.PI) / 180;
      // A sash is hung on the frame, and the frame stands back from the wall face —
      // so it pivots at the frame's inner edge, not at the reveal the way a door does.
      const sashC = layout.side > 0 ? c1 : c0;
      for (const leaf of layout.leaves) {
        const dir = { a: Math.cos(theta) * leaf.dirAlong, c: Math.sin(theta) * layout.side };
        for (const part of sashParts(
          { a: leaf.hingeA, c: sashC },
          dir,
          layout.length,
          glassLow,
          glassHigh,
          -layout.side * leaf.dirAlong
        )) {
          add(part);
        }
      }
    } else {
      // A fixed light: the pane is glazed straight into the frame, so it sits in the
      // frame's own plane rather than out in the middle of the wall.
      const pane = (c0 + c1) / 2;
      const g0 = pane - GLASS / 2;
      const g1 = pane + GLASS / 2;
      if (bar) {
        const mid = w / 2;
        add(box('glass', fw, mid - fw / 2, g0, g1, glassLow, glassHigh));
        add(box('glass', mid + fw / 2, w - fw, g0, g1, glassLow, glassHigh));
      } else {
        add(box('glass', fw, w - fw, g0, g1, glassLow, glassHigh));
      }
    }
  }

  // A window board, standing out into the room, and a weathering on the outside.
  // Both are as deep as the opening says, and either can be left off.
  if (kind === 'window' && style !== 'floor' && style !== 'french') {
    const board = boardOf(opening);
    const over = Math.min(fw, board.thickness);
    // The board lies on the sill, not under it. Set below, the part of it inside
    // the wall's own thickness ends up buried in the masonry, which is what the
    // overlap at the reveal was.
    if (board.inner > 0) {
      const span = side > 0 ? [c1, t / 2 + board.inner] : [-t / 2 - board.inner, c0];
      add(box('sill', -over, w + over, span[0], span[1], sill, sill + board.thickness));
    }
    if (board.outer > 0) {
      const span = side > 0 ? [-t / 2 - board.outer, c0] : [c1, t / 2 + board.outer];
      add(box('sill', -over, w + over, span[0], span[1], sill, sill + board.thickness));
    }
  }

  // Leaves. The angle is the same one the plan swings its arc through, so the two
  // drawings cannot disagree about which way a door opens.
  //
  // A leaf is hung the way a door actually is: hinges on the face of the frame at
  // the jamb, so the pivot is at the face of the wall and the leaf's thickness sits
  // behind it. Shut, it fills the reveal flush with the wall; square, it stands out
  // into the room; right round, it lies flat against the wall — the same three
  // positions a real door has.
  const theta = (swingAngle(opening) * Math.PI) / 180;
  const leafTop = head - fw;
  const leafBottom = glazed && kind === 'window' ? glassLow : sill;
  const clear = layout.clear;
  const leafC = layout.hingeC;

  // Which side of the hinge line the leaf's own thickness sits on. It has to be the
  // reveal side whichever way the leaf runs along the wall, or the second leaf of a
  // pair — and any door hung on the far jamb — stands proud of the wall when shut.
  const biasFor = (dirAlong) => -side * dirAlong;

  const hinged = (hingeA, dirAlong, length) => {
    const dir = { a: Math.cos(theta) * dirAlong, c: Math.sin(theta) * side };
    return panel('leaf', { a: hingeA, c: leafC }, dir, length, LEAF, leafBottom, leafTop, biasFor(dirAlong));
  };

  if (kind === 'door' || style === 'french') {
    if (style === 'sliding') {
      // Slid across the face of the wall rather than swung into the room.
      const face = side * (t / 2);
      add(box('leaf', 0, w, Math.min(face, face + side * LEAF), Math.max(face, face + side * LEAF), sill, leafTop));
    } else if (style === 'folding') {
      const atEnd = opening.hinge === 'end';
      const hingeA = atEnd ? w - fw : fw;
      const dirAlong = atEnd ? -1 : 1;
      const leaf = clear / 2;
      // Two panels, folded to meet the wall again: the shape the plan draws.
      const half = Math.max(0.2, Math.sin(theta / 2));
      const first = panel(
        'leaf',
        { a: hingeA, c: leafC },
        { a: Math.cos(theta / 2) * dirAlong, c: half * side },
        leaf,
        LEAF,
        sill,
        leafTop,
        biasFor(dirAlong)
      );
      add(first);
      add(
        panel(
          'leaf',
          first.to,
          { a: Math.cos(theta / 2) * dirAlong, c: -half * side },
          leaf,
          LEAF,
          sill,
          leafTop,
          biasFor(dirAlong)
        )
      );
    } else {
      for (const leaf of layout.leaves) add(hinged(leaf.hingeA, leaf.dirAlong, layout.length));
    }
  }

  return out;
}

/** Where a part's corner sits in the drawing, given the opening's own geometry. */
export function partToWorld(geo, a, c) {
  return {
    x: geo.x1 + geo.dx * a + geo.nx * c,
    y: geo.y1 + geo.dy * a + geo.ny * c,
  };
}
