// Door and window catalogue. Widths are structural opening widths in
// millimetres, following the sizes joinery actually comes in (DIN 18101 leaf
// widths plus their frame allowance).

// A door is ordered by its leaf, so that is what `width` means: the door, not the
// door and its lining. The hole in the wall is the leaf plus a stock each side —
// see `openingWidth`. These are the leaf widths DIN 18101 lists.
export const DOOR_WIDTHS = [610, 735, 860, 985, 1110];
export const DOUBLE_DOOR_WIDTHS = [1360, 1485, 1610, 1735, 1985];
export const WINDOW_WIDTHS = [510, 635, 760, 885, 1010, 1135, 1260, 1385, 1510, 1760, 2010, 2510];

/** The stock — the lining the leaf shuts into — as this opening has it. */
export const DEFAULT_STOCK = { door: 30, window: 60, opening: 0 };

export function stockOf(opening) {
  const given = Number(opening?.stock);
  if (Number.isFinite(given)) return Math.max(0, given);
  return DEFAULT_STOCK[opening?.kind] ?? DEFAULT_STOCK.door;
}

/**
 * How wide the hole in the wall is: the leaf, plus a stock down each side.
 *
 * Everything that cuts, masks or measures the wall wants this; everything about the
 * door itself wants `opening.width`.
 */
export function openingWidth(opening) {
  return Math.max(100, (opening?.width ?? 900) + stockOf(opening) * 2);
}

export const DOOR_STYLES = [
  { id: 'single', label: 'Single', widths: DOOR_WIDTHS, defaultWidth: 860 },
  { id: 'double', label: 'Double', widths: DOUBLE_DOOR_WIDTHS, defaultWidth: 1485 },
  { id: 'sliding', label: 'Sliding', widths: DOOR_WIDTHS, defaultWidth: 985 },
  { id: 'folding', label: 'Folding', widths: DOOR_WIDTHS, defaultWidth: 860 },
];

// How a window opens, in the kinds German windows actually come in. Dreh-Kipp is the
// default because it is what is in almost every house built since the sixties: the
// handle turns one way to swing the sash in on its side hinges, and the other way to
// tilt it in at the top for ventilation.
export const WINDOW_STYLES = [
  { id: 'turn-tilt', label: 'Turn and tilt', widths: WINDOW_WIDTHS, defaultWidth: 1135 },
  { id: 'turn', label: 'Turn', widths: WINDOW_WIDTHS, defaultWidth: 1135 },
  { id: 'tilt', label: 'Tilt only', widths: WINDOW_WIDTHS, defaultWidth: 1010 },
  { id: 'fixed', label: 'Fixed', widths: WINDOW_WIDTHS, defaultWidth: 1010 },
  { id: 'floor', label: 'Floor to ceiling', widths: WINDOW_WIDTHS, defaultWidth: 1760 },
  { id: 'french', label: 'French door', widths: DOUBLE_DOOR_WIDTHS, defaultWidth: 1735 },
];

/** Whether a window swings into the room on side hinges, as against tilting or not opening. */
export function swingsOpen(opening) {
  const kind = opening?.kind ?? 'door';
  const style = opening?.style ?? 'single';
  if (kind === 'door') return style !== 'sliding';
  if (kind === 'window') return style === 'turn' || style === 'turn-tilt' || style === 'french';
  return false;
}

/** Whether it tilts in at the head — a Kippflügel, which needs no floor to swing over. */
export function tiltsOpen(opening) {
  const style = opening?.style ?? '';
  return (opening?.kind ?? '') === 'window' && (style === 'tilt' || style === 'turn-tilt');
}

export const OPENING_KINDS = [
  { id: 'door', label: 'Door', styles: DOOR_STYLES, sill: 0, head: 2010 },
  { id: 'window', label: 'Window', styles: WINDOW_STYLES, sill: 900, head: 2100 },
  { id: 'opening', label: 'Plain opening', styles: [{ id: 'plain', label: 'No door', widths: [860, 985, 1110, 1485, 1985], defaultWidth: 985 }], sill: 0, head: 2100 },
];

export function kindSpec(kind) {
  return OPENING_KINDS.find((k) => k.id === kind) ?? OPENING_KINDS[0];
}

export function styleSpec(kind, style) {
  const spec = kindSpec(kind);
  return spec.styles.find((s) => s.id === style) ?? spec.styles[0];
}

export function defaultsFor(kind, style) {
  const spec = kindSpec(kind);
  const styles = styleSpec(kind, style);
  const sill = styles.id === 'floor' || styles.id === 'french' ? 0 : spec.sill;
  return {
    kind: spec.id,
    style: styles.id,
    width: styles.defaultWidth,
    sill,
    head: spec.head,
    hinge: 'start',
    swing: 'in',
    // The window board: how far it stands into the room, how far the weathering
    // stands out, and how thick both are. Zero for either leaves it off.
    ...(spec.id === 'window' ? { boardInner: 40, boardOuter: 20, boardThickness: 30 } : {}),
  };
}

/** How tall the opening is, which is what people set rather than a head height. */
export function openingHeight(opening) {
  return Math.max(100, (opening.head ?? 2010) - (opening.sill ?? 0));
}

export function describeOpening(opening) {
  const style = styleSpec(opening.kind, opening.style);
  const spec = kindSpec(opening.kind);
  return `${style.label} ${spec.label.toLowerCase()}`;
}

/**
 * The plan symbol for an opening, as primitives in the opening's own frame:
 * `a` runs from the first jamb toward the second, `c` spans the wall thickness
 * with 0 at the centreline. Defined once so the canvas and the SVG export can
 * never drift apart.
 *
 * line: {type:'line', a1, c1, a2, c2}
 * arc:  {type:'arc', hinge, fromA, fromC, toA, toC} — centred on (hinge, 0)
 */

/**
 * How far a leaf stands open, in degrees, and as far as it can go.
 *
 * A door is drawn open at a right angle because that is the convention and because
 * that is the room it needs; a window is drawn shut, because a facade with every
 * casement hanging open reads as a mistake. Either can be set to anything up to flat
 * against the wall.
 */
export const MAX_SWING = 180;

export function swingAngle(opening) {
  const given = Number(opening?.swingAngle);
  if (Number.isFinite(given)) return Math.max(0, Math.min(MAX_SWING, given));
  return opening?.kind === 'window' ? 0 : 90;
}

/**
 * Where a door's leaves are hung, and how far they reach.
 *
 * One answer, used by the plan symbol, the 3D model and the clearance zone alike.
 * They each used to work it out for themselves and came to three different answers:
 * the plan swung a leaf the full structural width off the outside of the jamb, the
 * model hung the real leaf on the jamb face, and the clearance sector split the
 * difference — so the drawing showed a bigger arc than the door it was drawing.
 *
 * A leaf is as wide as the clear opening, hinged on the face of the frame at the
 * jamb, and turns about the room-side face of the wall.
 */
export function leafLayout(opening, thickness = 0) {
  const w = openingWidth(opening); // the hole, which is what the leaves sit in
  const sill = Math.max(0, opening.sill ?? 0);
  const head = Math.max(sill + 200, opening.head ?? 2010);
  const frame = Math.min(stockOf(opening), w / 4, (head - sill) / 4);
  const side = opening.swing === 'out' ? -1 : 1;
  const clear = Math.max(100, w - frame * 2);
  const atEnd = opening.hinge === 'end';
  const kind = opening.kind ?? 'door';
  const style = opening.style ?? 'single';

  // What actually opens. A casement swings inward like a door, which is why a
  // radiator on the sill or a wardrobe beside it is worth knowing about; a fixed
  // light and a plain hole do not open at all.
  let count = 1;
  if (kind === 'opening') count = 0;
  // A casement wider than a metre of glass comes as a pair with a bar between.
  else if (kind === 'window') {
    // A fixed light has no sash at all; everything else has one, or a pair once the
    // glass is wide enough that one sash would be unmanageable.
    count = style === 'fixed' ? 0 : style === 'french' ? 2 : (opening.width ?? 900) > 1000 ? 2 : 1;
  }
  else if (style === 'double') count = 2;
  else if (style === 'sliding') count = 0;

  const length = count === 2 ? clear / 2 : clear;
  const leaves =
    count === 2
      ? [
          { hingeA: frame, dirAlong: 1 },
          { hingeA: w - frame, dirAlong: -1 },
        ]
      : count === 1
        ? [{ hingeA: atEnd ? w - frame : frame, dirAlong: atEnd ? -1 : 1 }]
        : [];
  return {
    width: w,
    frame,
    clear,
    length,
    side,
    doubled: count === 2,
    leaves,
    hingeC: (side * thickness) / 2,
    // A sash that only tilts, or a light that does not open at all, is drawn shut
    // whatever angle is on the opening — otherwise a Kippflügel would swing a
    // door's arc across the room, which is exactly the floor it does not need.
    angle: swingsOpen(opening) ? swingAngle(opening) : 0,
  };
}

/** Where one leaf's free edge sits at a given angle, in the opening's own frame. */
export function leafAt(layout, leaf, angleDeg = layout.angle) {
  const theta = (angleDeg * Math.PI) / 180;
  return {
    a: leaf.hingeA + Math.cos(theta) * leaf.dirAlong * layout.length,
    c: layout.hingeC + Math.sin(theta) * layout.side * layout.length,
  };
}

export function openingSymbol(opening, thickness) {
  // Everything here is laid out along the hole in the wall, from one reveal to the
  // other — not along the door, which is narrower by a stock at each end.
  const w = openingWidth(opening);
  const half = thickness / 2;
  const side = opening.swing === 'out' ? -1 : 1;
  const out = [];
  const line = (a1, c1, a2, c2) => out.push({ type: 'line', a1, c1, a2, c2 });
  const reveals = () => {
    line(0, -half, 0, half);
    line(w, -half, w, half);
  };

  /**
   * The stock: the lining the leaf shuts into, drawn as it is on a real plan —
   * a thin rectangle in each reveal, the depth of the frame.
   */
  const stock = () => {
    const layout = leafLayout(opening, thickness);
    if (layout.frame < 1) return;
    const inset = Math.min(30, thickness * 0.15);
    const d = Math.max(10, thickness / 2 - inset);
    for (const [a0, a1] of [
      [0, layout.frame],
      [w - layout.frame, w],
    ]) {
      out.push({
        type: 'rect',
        a0,
        a1,
        c0: -d,
        c1: d,
      });
    }
  };

  if (opening.kind === 'opening') {
    reveals();
    return out;
  }

  /** The leaf line and its arc, at whatever angle the opening stands open. */
  const swing = (layout) => {
    for (const leaf of layout.leaves) {
      const open = leafAt(layout, leaf);
      const shut = leafAt(layout, leaf, 0);
      line(leaf.hingeA, layout.hingeC, open.a, open.c);
      out.push({
        type: 'arc',
        hinge: leaf.hingeA,
        hingeC: layout.hingeC,
        fromA: open.a,
        fromC: open.c,
        toA: shut.a,
        toC: shut.c,
        // Signed, so an arc past a right angle is drawn the long way round it
        // rather than being folded back on itself.
        //
        // Which way round it turns depends on where the leaf is hung and which way it
        // opens, not only on how far: a leaf running back along the wall sweeps the
        // opposite way to one running forward, and so does one opening outward.
        // Fixed at minus the angle, the second leaf of a pair — and any door hung on
        // the far jamb — had its arc thrown out past its own hinge.
        sweep: (-layout.angle * leaf.dirAlong * layout.side * Math.PI) / 180,
      });
    }
  };

  if (opening.kind === 'window') {
    reveals();
    stock();
    const glazing = () => {
      line(0, -half * 0.4, w, -half * 0.4);
      line(0, half * 0.4, w, half * 0.4);
    };

    // How a window opens is not drawn in plan, and it was a mistake to try.
    //
    // The DIN opening mark — the triangle with its apex on the hinge axis — belongs
    // in the elevation, in the plane of the window, where the axis it points at is
    // actually visible. Projected down into the Grundriss it becomes a full-width
    // bowtie laid across the glazing lines, four extra lines over a symbol two lines
    // wide, and the window turns to noise. A real plan draws the glass, and where the
    // swing matters it draws the sash open with its arc, the way a door does.
    //
    // Which kind of window it is lives where it is legible: the panel, the schedule,
    // and the clearance zone the sash sweeps.
    switch (opening.style) {
      case 'fixed':
        line(0, 0, w, 0);
        break;
      case 'floor':
        line(0, -half * 0.55, w, -half * 0.55);
        line(0, half * 0.55, w, half * 0.55);
        line(0, 0, w, 0);
        break;
      case 'french':
        glazing();
        swing(leafLayout(opening, thickness));
        break;
      default: {
        glazing();
        const layout = leafLayout(opening, thickness);
        // A pair of sashes has a bar between them, and the bar is what they shut on.
        if (layout.doubled) line(w / 2, -half * 0.4, w / 2, half * 0.4);
        // Shut, the glazing lines are the sash and there is nothing to sweep; the
        // leaf line and arc only appear once it is actually standing open.
        if (layout.angle > 0) swing(layout);
      }
    }
    return out;
  }

  reveals();
  stock();
  switch (opening.style) {
    case 'sliding':
      line(0, side * half, w, side * half);
      out.push({ type: 'line', a1: w * 0.02, c1: side * half * 1.6, a2: w * 0.98, c2: side * half * 1.6, heavy: true });
      break;
    case 'folding': {
      const hinge = opening.hinge === 'end' ? w : 0;
      const dir = opening.hinge === 'end' ? -1 : 1;
      const leaf = w / 2;
      line(hinge, 0, hinge + dir * leaf * 0.7, side * leaf * 0.7);
      line(hinge + dir * leaf * 0.7, side * leaf * 0.7, hinge + dir * leaf * 1.4, 0);
      break;
    }
    case 'double':
    default:
      // The leaf and its arc, exactly where the door actually is.
      swing(leafLayout(opening, thickness));
  }
  return out;
}


/**
 * The mark each opening carries on the drawing, and the rows a schedule lists.
 *
 * One mark per size, not per opening: eight identical windows are W1 eight times, which
 * is what makes a schedule worth having — one line to order eight of. Kept here rather
 * than in the schedule panel so the figure written beside a window on the plan and the
 * row it points at cannot drift apart.
 *
 * @returns {{rows, markOf: Map}} `markOf` is opening id to mark
 */
export function openingMarks(plan) {
  const groups = new Map();
  const keyOf = (opening) => {
    const height = Math.max(0, Math.round((opening.head ?? 2010) - (opening.sill ?? 0)));
    return [
      opening.kind,
      opening.style,
      Math.round(opening.width),
      height,
      Math.round(opening.sill ?? 0),
      Math.round(openingWidth(opening)),
    ].join('|');
  };

  for (const opening of plan.openings ?? []) {
    const key = keyOf(opening);
    const found = groups.get(key);
    if (found) {
      found.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      kind: opening.kind,
      label: describeOpening(opening),
      width: Math.round(opening.width),
      height: Math.max(0, Math.round((opening.head ?? 2010) - (opening.sill ?? 0))),
      sill: Math.round(opening.sill ?? 0),
      hole: Math.round(openingWidth(opening)),
      count: 1,
    });
  }

  const prefix = { door: 'D', window: 'W', opening: 'O' };
  const counters = { D: 0, W: 0, O: 0 };
  const rows = [...groups.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.width - b.width || a.height - b.height
  );
  for (const row of rows) {
    const p = prefix[row.kind] ?? 'O';
    counters[p] += 1;
    row.mark = `${p}${counters[p]}`;
  }

  const byKey = new Map(rows.map((row) => [row.key, row.mark]));
  const markOf = new Map();
  for (const opening of plan.openings ?? []) markOf.set(opening.id, byKey.get(keyOf(opening)));
  return { rows, markOf };
}
