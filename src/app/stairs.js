// Stairs.
//
// A flight is described the way a builder describes one: the total rise it has to
// climb, how deep each tread is, and how many risers. Everything else — the run it
// takes up, the riser height, whether it is comfortable and whether it is legal —
// follows from those.
//
// Every shape produces the same thing: one polygon per tread, in the stair's own
// frame, where `a` runs along the direction of travel from the foot of the first
// riser and `c` across it, zero on the centre line. The plan drawing, the SVG
// export and the 3D model are all built from those polygons, so none of them can
// drift apart. Tread n rises to n × the riser height.

export const STAIR_SHAPES = [
  { id: 'straight', label: 'Straight', de: 'gerade Treppe' },
  { id: 'landing', label: 'Quarter, landing', de: 'Podesttreppe' },
  { id: 'winder', label: 'Quarter, winders', de: 'viertelgewendelte Treppe' },
  { id: 'halfwinder', label: 'Half turn, winders', de: 'halbgewendelte Treppe, zwei Ecken' },
  { id: 'uturn', label: 'Half turn, landing', de: 'Podesttreppe, halbgewendelt' },
  { id: 'spiral', label: 'Spiral', de: 'Spindeltreppe' },
];

// How far above the floor a plan is cut. German drawings cut at about a metre, so
// a flight is drawn solid up to there and thin beyond it, split by a break line.
export const DEFAULT_CUT_HEIGHT = 1000;

// DIN 18065, necessary stairs in houses of up to two dwellings.
export const STAIR_LIMITS = {
  maxRiser: 200,
  minTread: 230,
  minWidth: 800,
  comfortableWidth: 1000,
  strideMin: 590,
  strideMax: 650,
  strideIdeal: 630,
  minHeadroom: 2000,
  minNarrowTread: 100, // narrow end of a winder
};

export function defaultStair(riseMm = 2750) {
  const rise = Math.max(200, riseMm);
  const steps = Math.max(2, Math.round(rise / 180));
  return {
    shape: 'straight',
    width: 1000,
    treadDepth: 280,
    steps,
    rise,
    direction: 'up',
    turn: 'right',
    landingAfter: Math.max(1, Math.floor(steps / 2)),
    winderSteps: 3,
    newel: 200,
    middleSteps: 1,
    innerRadius: 200,
    sweep: 270,
    railing: true,
  };
}

export function riserHeight(stair) {
  return stair.rise / Math.max(1, Math.round(stair.steps));
}

/** Risers minus one: the treads between them, the top riser landing on the floor. */
export function treadCount(stair) {
  return Math.max(1, Math.round(stair.steps) - 1);
}

function half(stair) {
  return Math.max(300, stair.width) / 2;
}

/**
 * Where the walking line runs, measured from the inside of the flight.
 *
 * DIN 18065 puts it in the middle of the usable width up to a metre wide, and
 * half a metre from the inner handrail on anything wider. Winders are judged on
 * the tread depth there, which is why it matters.
 */
export function walkOffset(widthMm) {
  const width = Math.max(300, widthMm);
  return width <= 1000 ? width / 2 : 500;
}

function rotate(a, c, deg) {
  const r = (deg * Math.PI) / 180;
  return { a: a * Math.cos(r) - c * Math.sin(r), c: a * Math.sin(r) + c * Math.cos(r) };
}

/** Where a ray from P leaves an axis-aligned box, in the stair's frame. */
function rayExit(p, dir, box) {
  let best = Infinity;
  const check = (t) => {
    if (t > 1e-6 && t < best) {
      const a = p.a + dir.a * t;
      const c = p.c + dir.c * t;
      if (a >= box.a0 - 1e-6 && a <= box.a1 + 1e-6 && c >= box.c0 - 1e-6 && c <= box.c1 + 1e-6) best = t;
    }
  };
  if (Math.abs(dir.a) > 1e-9) {
    check((box.a0 - p.a) / dir.a);
    check((box.a1 - p.a) / dir.a);
  }
  if (Math.abs(dir.c) > 1e-9) {
    check((box.c0 - p.c) / dir.c);
    check((box.c1 - p.c) / dir.c);
  }
  if (!Number.isFinite(best)) return { a: p.a, c: p.c };
  return { a: p.a + dir.a * best, c: p.c + dir.c * best };
}

/** Wedge between two rays out of a corner, taken round the box if they differ. */
function wedge(pivot, from, to, box) {
  const pts = [pivot, from];
  // Add the box corner between the two exits, so the wedge follows the boundary.
  const corners = [
    { a: box.a1, c: box.c0 },
    { a: box.a1, c: box.c1 },
    { a: box.a0, c: box.c1 },
    { a: box.a0, c: box.c0 },
  ];
  const onEdge = (p) =>
    Math.abs(p.a - box.a0) < 1 || Math.abs(p.a - box.a1) < 1 || Math.abs(p.c - box.c0) < 1 || Math.abs(p.c - box.c1) < 1;
  const sideOf = (p) => {
    if (Math.abs(p.c - box.c0) < 1) return 0;
    if (Math.abs(p.a - box.a1) < 1) return 1;
    if (Math.abs(p.c - box.c1) < 1) return 2;
    return 3;
  };
  if (onEdge(from) && onEdge(to) && sideOf(from) !== sideOf(to)) {
    pts.push(corners[sideOf(from)]);
  }
  pts.push(to);
  return pts;
}

/**
 * One polygon per tread, plus any landings, in the stair's frame.
 * @returns {{treads, landings, walkLine, run, width, tread}}
 */
export function stairParts(stair) {
  const width = Math.max(300, stair.width);
  const h = width / 2;
  const tread = Math.max(80, stair.treadDepth);
  const total = treadCount(stair);
  const turnSign = stair.turn === 'left' ? -1 : 1;
  const treads = [];
  const landings = [];
  const walkLine = [];

  const straightBand = (step, from, to) => ({
    step,
    pts: [
      { a: from, c: -h },
      { a: to, c: -h },
      { a: to, c: h },
      { a: from, c: h },
    ],
    // The nosing: the edge you step over to reach this tread. The break line at
    // the cut plane is drawn along it.
    edge: [
      { a: from, c: -h },
      { a: from, c: h },
    ],
  });

  if (stair.shape === 'spiral') {
    // Treads radiate from the newel; the stair's own point is the newel centre.
    const inner = Math.max(60, stair.innerRadius ?? 200);
    const outer = inner + width;
    const sweep = Math.max(60, Math.min(1080, stair.sweep ?? 270));
    const per = sweep / total;
    for (let i = 0; i < total; i++) {
      const a0 = turnSign * per * i;
      const a1 = turnSign * per * (i + 1);
      const arc = [];
      const steps = Math.max(2, Math.ceil(Math.abs(per) / 8));
      for (let s = 0; s <= steps; s++) {
        const ang = a0 + ((a1 - a0) * s) / steps;
        arc.push(rotate(outer, 0, ang));
      }
      const back = [];
      for (let s = steps; s >= 0; s--) {
        const ang = a0 + ((a1 - a0) * s) / steps;
        back.push(rotate(inner, 0, ang));
      }
      treads.push({
        step: i + 1,
        pts: [...arc, ...back],
        edge: [rotate(inner, 0, a0), rotate(outer, 0, a0)],
      });
      const mid = rotate(inner + walkOffset(width), 0, (a0 + a1) / 2);
      walkLine.push(mid);
    }
    return { treads, landings, walkLine, run: outer * 2, across: outer * 2, walked: outer * 2, width, tread, inner, outer, sweep };
  }

  if (stair.shape === 'straight') {
    for (let i = 0; i < total; i++) treads.push(straightBand(i + 1, i * tread, (i + 1) * tread));
    walkLine.push({ a: tread * 0.35, c: 0 }, { a: total * tread, c: 0 });
    return { treads, landings, walkLine, run: total * tread, across: width, walked: total * tread, width, tread };
  }

  if (stair.shape === 'uturn') {
    // Up one side, a landing across the end, back down the other. The two flights
    // sit side by side, so the stair is twice as wide as one flight.
    const before = Math.min(total - 1, Math.max(1, Math.round(stair.landingAfter)));
    const after = Math.max(0, total - before - 1);
    const run1 = before * tread;
    const upC = -turnSign * h;
    const downC = turnSign * h;
    const band = (step, from, to, centre, nose = from) => ({
      step,
      pts: [
        { a: from, c: centre - h },
        { a: to, c: centre - h },
        { a: to, c: centre + h },
        { a: from, c: centre + h },
      ],
      edge: [
        { a: nose, c: centre - h },
        { a: nose, c: centre + h },
      ],
    });
    for (let i = 0; i < before; i++) treads.push(band(i + 1, i * tread, (i + 1) * tread, upC));
    const landing = {
      step: before + 1,
      pts: [
        { a: run1, c: upC - h },
        { a: run1 + width, c: upC - h },
        { a: run1 + width, c: downC + h },
        { a: run1, c: downC + h },
      ],
    };
    landings.push(landing);
    treads.push({ ...landing });
    for (let i = 0; i < after; i++) {
      // Coming back down the other side, the nosing is at the far end.
      treads.push(band(before + 2 + i, run1 - (i + 1) * tread, run1 - i * tread, downC, run1 - i * tread));
    }
    walkLine.push(
      { a: tread * 0.35, c: upC },
      { a: run1 + width / 2, c: upC },
      { a: run1 + width / 2, c: downC },
      { a: run1 - after * tread, c: downC }
    );
    return { treads, landings, walkLine, run: run1 + width, across: 2 * width, walked: (before + after) * tread + width, width, tread };
  }

  // ---- turning flights: straight runs and corners, in whatever order ----
  //
  // A quarter turn is one corner, a half turn with winders is two — the German
  // halbgewendelte Treppe that fits a stair into a hallway the width of two
  // flights. Both are the same thing walked in sequence, so they are built by
  // stepping a frame along the flight: each segment is laid out in its own
  // coordinates and the frame carries the position and heading on to the next.
  const newel = Math.max(0, Math.min(width * 0.6, stair.newel ?? 200));
  const wr = walkOffset(width);
  // Winders sit either side of the walking line, which runs at the DIN offset from
  // the inside of the turn — the middle of the flight on anything up to a metre.
  const walkC = turnSign * (h - wr);

  const before = Math.min(total - 1, Math.max(0, Math.round(stair.landingAfter)));
  const perTurn = stair.shape === 'landing' ? 1 : Math.max(1, Math.round(stair.winderSteps ?? 3));
  const corners = stair.shape === 'halfwinder' ? 2 : 1;
  const middle = stair.shape === 'halfwinder' ? Math.max(0, Math.round(stair.middleSteps ?? 1)) : 0;
  // Corners come first if the treads have to be shared out: a turn without its
  // winders is not a turn.
  const turnSteps = Math.min(perTurn, Math.max(1, Math.floor((total - 1) / corners)));
  const straightBudget = Math.max(0, total - corners * turnSteps);
  const firstRun = Math.min(before, straightBudget);
  const middleRun = Math.min(middle, straightBudget - firstRun);
  const lastRun = straightBudget - firstRun - middleRun;

  const plan = [{ kind: 'run', steps: firstRun }];
  for (let c = 0; c < corners; c++) {
    plan.push({ kind: 'turn', steps: turnSteps });
    if (c + 1 < corners) plan.push({ kind: 'run', steps: middleRun });
  }
  plan.push({ kind: 'run', steps: lastRun });

  // A frame: where the next tread starts, and which way the walker faces. Local
  // `la` runs along the flight and `lc` across it, positive to the walker's right.
  let frame = { a: 0, c: 0, angle: 0 };
  const at = (f, la, lc) => {
    const r = (f.angle * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return { a: f.a + la * cos - lc * sin, c: f.c + la * sin + lc * cos };
  };

  let step = 0;
  for (const segment of plan) {
    if (segment.kind === 'run') {
      for (let i = 0; i < segment.steps; i++) {
        const from = i * tread;
        const to = (i + 1) * tread;
        treads.push({
          step: ++step,
          pts: [at(frame, from, -h), at(frame, to, -h), at(frame, to, h), at(frame, from, h)],
          edge: [at(frame, from, -h), at(frame, from, h)],
        });
      }
      if (segment.steps > 0) {
        // The first tread's nosing is the foot of the flight, so the circle that
        // marks it sits just onto the tread rather than on the very edge.
        walkLine.push(at(frame, step === segment.steps ? tread * 0.35 : 0, walkC));
        walkLine.push(at(frame, segment.steps * tread, walkC));
        frame = { ...frame, ...at(frame, segment.steps * tread, 0) };
      }
      continue;
    }

    // A corner. The pivot is the inside of the turn; the treads fan from the inner
    // curve out to the walls of the square the turn occupies.
    const pivot = at(frame, 0, turnSign * h);
    const box = { a0: 0, a1: width, c0: -h, c1: h };
    const toBox = (la, lc) => at(frame, la, lc);
    // Work the wedges out in the frame's own coordinates, then map them.
    const localPivot = { a: 0, c: turnSign * h };
    const startDir = { a: 0, c: -turnSign };

    if (stair.shape === 'landing') {
      const corner = {
        step: ++step,
        pts: [toBox(box.a0, box.c0), toBox(box.a1, box.c0), toBox(box.a1, box.c1), toBox(box.a0, box.c1)],
        edge: [toBox(box.a0, box.c0), toBox(box.a0, box.c1)],
      };
      landings.push(corner);
      treads.push({ ...corner });
      walkLine.push(pivot ? at(frame, 0, walkC) : at(frame, 0, 0));
    } else {
      const sweepPer = 90 / segment.steps;
      for (let i = 0; i < segment.steps; i++) {
        const d0 = rotate(startDir.a, startDir.c, turnSign * sweepPer * i);
        const d1 = rotate(startDir.a, startDir.c, turnSign * sweepPer * (i + 1));
        const from = rayExit(localPivot, d0, box);
        const to = rayExit(localPivot, d1, box);
        const outer = wedge(localPivot, from, to, box).slice(1); // drop the pivot
        const arc = [];
        const arcParts = Math.max(2, Math.ceil(sweepPer / 8));
        for (let s2 = arcParts; s2 >= 0; s2--) {
          const d = rotate(startDir.a, startDir.c, turnSign * (sweepPer * i + (sweepPer * s2) / arcParts));
          arc.push({ a: localPivot.a + d.a * newel, c: localPivot.c + d.c * newel });
        }
        const shape = newel > 1 ? [...outer, ...arc] : wedge(localPivot, from, to, box);
        treads.push({
          step: ++step,
          pts: shape.map((q) => toBox(q.a, q.c)),
          edge: [
            toBox(localPivot.a + d0.a * newel, localPivot.c + d0.c * newel),
            toBox(from.a, from.c),
          ],
        });
      }
      // The walking line takes the corner as an arc about the inside of the turn.
      const arcSteps = 8;
      for (let s2 = 0; s2 <= arcSteps; s2++) {
        const d = rotate(startDir.a, startDir.c, (turnSign * 90 * s2) / arcSteps);
        walkLine.push(toBox(localPivot.a + d.a * wr, localPivot.c + d.c * wr));
      }
    }

    // Out of the corner: half a flight's width along, half across, turned square.
    const exit = at(frame, width / 2, turnSign * h);
    frame = { a: exit.a, c: exit.c, angle: frame.angle + turnSign * 90 };
  }

  // For a flight that turns, what matters is the box it has to fit in, not the
  // distance walked: `run` is how deep the footprint is and `across` how wide.
  const as = treads.flatMap((t) => t.pts.map((q) => q.a));
  const cs = treads.flatMap((t) => t.pts.map((q) => q.c));
  return {
    treads,
    landings,
    walkLine,
    run: as.length ? Math.max(...as) - Math.min(...as) : 0,
    across: cs.length ? Math.max(...cs) - Math.min(...cs) : width,
    walked: straightBudget * tread + corners * width,
    width,
    tread,
  };
}

export function stairRun(stair) {
  return stairParts(stair).run;
}

/**
 * The German number for a flight: risers, then rise and going in centimetres with
 * a comma, the way every Bauzeichnung writes it — "16 Stg 18,3/26,0".
 */
export function stairLabel(stair) {
  const cm = (mm) => (Math.round(mm) / 10).toFixed(1).replace('.', ',');
  return `${Math.round(stair.steps)} Stg ${cm(riserHeight(stair))}/${cm(walkingTread(stair))}`;
}

/**
 * The first tread whose surface is above the cut plane. The plan is cut about a
 * metre up, so everything from here on is beyond the section and drawn thin,
 * with a break line along the nosing.
 */
export function cutTreadStep(stair, cutAt = DEFAULT_CUT_HEIGHT) {
  if (!(cutAt > 0)) return null;
  const riser = riserHeight(stair);
  if (!(riser > 0)) return null;
  const step = Math.floor(cutAt / riser) + 1;
  return step > treadCount(stair) ? null : step;
}

/**
 * Drawing primitives for the plan, in the stair's own frame.
 *
 * Drawn the way a German plan draws a flight: treads solid up to the cut plane
 * and thin beyond it, a break line along the nosing where it crosses, the walking
 * line from a circle at the first riser to an arrow at the last, and the risers
 * numbered from the bottom.
 */
export function stairGeometry(stair, options = {}) {
  const parts = stairParts(stair);
  const primitives = [];
  const cutAt = options.cutAt ?? DEFAULT_CUT_HEIGHT;
  const cutStep = options.cut === false ? null : cutTreadStep(stair, cutAt);
  const numbers = options.numbers === true;
  const down = stair.direction === 'down';

  for (const t of parts.treads) {
    const above = cutStep !== null && t.step >= cutStep;
    primitives.push({ type: 'polygon', pts: t.pts, style: above ? 'above' : 'outline', step: t.step });
  }

  // The break line: along the nosing of the first tread past the cut, skewed and
  // run out past both sides of the flight so it reads as a cut and not a step.
  const cutTread = cutStep === null ? null : parts.treads.find((t) => t.step === cutStep);
  if (cutTread?.edge) {
    const [p1, p2] = cutTread.edge;
    const ex = p2.a - p1.a;
    const ey = p2.c - p1.c;
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len;
    const uy = ey / len;
    const tx = -uy; // across the nosing, along the direction of travel
    const ty = ux;
    const over = Math.min(len, parts.width) * 0.07;
    // A straight nosing is broken with a skewed line, which is what makes it read
    // as a cut rather than another step. A winder's nosing already runs at an angle
    // across the flight, so skewing it as well would put a spike on the drawing.
    const radial = cutTread.pts.length > 4;
    const skew = radial ? 0 : Math.min(parts.tread, len * 0.35) * 0.7;
    primitives.push({
      type: 'line',
      a1: p1.a - ux * over - tx * skew,
      c1: p1.c - uy * over - ty * skew,
      a2: p2.a + ux * over + tx * skew,
      c2: p2.c + uy * over + ty * skew,
      style: 'cut',
    });
  }

  // Walking line: the circle sits on the first riser, the arrow on the last, and
  // the arrow always points the way the flight climbs.
  const line = down ? [...parts.walkLine].reverse() : parts.walkLine;
  const foot = line[0] ?? { a: 0, c: 0 };
  primitives.push({
    type: 'circle',
    a: foot.a,
    c: foot.c,
    r: Math.min(90, parts.tread * 0.3),
    style: 'foot',
  });
  if (line.length >= 2) {
    primitives.push({ type: 'arrow', pts: line, style: 'arrow' });
  }

  if (numbers) {
    for (const t of parts.treads) {
      const as = t.pts.map((q) => q.a);
      const cs = t.pts.map((q) => q.c);
      primitives.push({
        type: 'number',
        a: (Math.min(...as) + Math.max(...as)) / 2,
        c: (Math.min(...cs) + Math.max(...cs)) / 2,
        text: String(t.step),
        size: Math.min(parts.tread * 0.5, parts.width * 0.22),
        style: 'number',
      });
    }
  }

  const as = parts.treads.flatMap((t) => t.pts.map((p) => p.a));
  const cs = parts.treads.flatMap((t) => t.pts.map((p) => p.c));
  const footprint = [
    { a: Math.min(...as), c: Math.min(...cs) },
    { a: Math.max(...as), c: Math.min(...cs) },
    { a: Math.max(...as), c: Math.max(...cs) },
    { a: Math.min(...as), c: Math.max(...cs) },
  ];
  return {
    primitives,
    footprint,
    run: parts.run,
    width: parts.width,
    tread: parts.tread,
    parts,
    cutStep,
    label: stairLabel(stair),
  };
}

/** Tread depth on the walking line, which is what a winder is judged on. */
export function walkingTread(stair) {
  if (stair.shape === 'spiral') {
    const inner = Math.max(60, stair.innerRadius ?? 200);
    const r = inner + walkOffset(stair.width);
    const per = (Math.max(60, stair.sweep ?? 270) / treadCount(stair)) * (Math.PI / 180);
    return r * per;
  }
  if (stair.shape === 'winder' || stair.shape === 'halfwinder') {
    const per = (90 / Math.max(1, Math.round(stair.winderSteps ?? 3))) * (Math.PI / 180);
    return walkOffset(stair.width) * per;
  }
  return stair.treadDepth;
}

/** Narrowest tread, at the inner end of a winder or spiral. */
export function narrowTread(stair) {
  if (stair.shape === 'spiral') {
    const inner = Math.max(60, stair.innerRadius ?? 200);
    const per = (Math.max(60, stair.sweep ?? 270) / treadCount(stair)) * (Math.PI / 180);
    return inner * per;
  }
  if (stair.shape === 'winder' || stair.shape === 'halfwinder') {
    // The narrow end sits on the inner curve, so it is that radius times the angle.
    const newel = Math.max(0, Math.min(stair.width * 0.6, stair.newel ?? 200));
    const per = (90 / Math.max(1, Math.round(stair.winderSteps ?? 3))) * (Math.PI / 180);
    return newel * per;
  }
  return stair.treadDepth;
}

/** What is wrong, and how wrong, in the words a builder would use. */
export function stairChecks(stair) {
  const out = [];
  const riser = riserHeight(stair);
  const tread = walkingTread(stair);
  const stride = 2 * riser + tread;
  const L = STAIR_LIMITS;

  if (riser > L.maxRiser) {
    out.push({
      level: 'bad',
      text: `Riser (Steigung) ${Math.round(riser)} mm is over the ${L.maxRiser} mm limit — add steps.`,
    });
  } else if (riser > 190) {
    out.push({ level: 'warn', text: `Riser (Steigung) ${Math.round(riser)} mm is steep, though within the limit.` });
  } else {
    out.push({ level: 'ok', text: `Riser (Steigung) ${Math.round(riser)} mm.` });
  }

  const where = stair.shape === 'straight' || stair.shape === 'landing' || stair.shape === 'uturn' ? '' : ' on the walking line';
  if (tread < L.minTread) {
    out.push({
      level: 'bad',
      text: `Going (Auftritt) ${Math.round(tread)} mm${where} is under the ${L.minTread} mm minimum.`,
    });
  } else {
    out.push({ level: 'ok', text: `Going (Auftritt) ${Math.round(tread)} mm${where}.` });
  }

  if (stride < L.strideMin || stride > L.strideMax) {
    out.push({
      level: 'warn',
      text: `Stride (Schrittmaß) 2×riser + going is ${Math.round(stride)} mm; comfortable is ${L.strideMin}–${L.strideMax}.`,
    });
  } else {
    out.push({ level: 'ok', text: `Stride (Schrittmaß) ${Math.round(stride)} mm — comfortable.` });
  }

  if (stair.shape === 'spiral' || stair.shape === 'winder' || stair.shape === 'halfwinder') {
    const narrow = narrowTread(stair);
    const widen = stair.shape === 'spiral' ? 'Widen the newel' : 'Widen the inner curve';
    if (narrow < L.minNarrowTread) {
      out.push({
        level: 'bad',
        text: `The narrow end is ${Math.round(narrow)} mm; ${L.minNarrowTread} mm is the minimum. ${widen} or add winders.`,
      });
    } else {
      out.push({ level: 'ok', text: `Narrow end ${Math.round(narrow)} mm.` });
    }
  }

  if (stair.width < L.minWidth) {
    out.push({
      level: 'bad',
      text: `Width (Laufbreite) ${Math.round(stair.width)} mm is under the ${L.minWidth} mm minimum.`,
    });
  } else if (stair.width < L.comfortableWidth) {
    out.push({ level: 'warn', text: `Width (Laufbreite) ${Math.round(stair.width)} mm is legal but tight.` });
  } else {
    out.push({ level: 'ok', text: `Width (Laufbreite) ${Math.round(stair.width)} mm.` });
  }
  return out;
}

export function worstLevel(checks) {
  if (checks.some((c) => c.level === 'bad')) return 'bad';
  if (checks.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}

/** Maps a point in the stair's frame to the drawing. */
export function stairToWorld(stair, a, c) {
  const rad = ((stair.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: stair.x + a * cos - c * sin, y: stair.y + a * sin + c * cos };
}

export function stairWorldFootprint(stair) {
  return stairGeometry(stair).footprint.map((p) => stairToWorld(stair, p.a, p.c));
}

/** Tread polygons in drawing coordinates, with the height each one rises to. */
export function stairWorldTreads(stair) {
  const riser = riserHeight(stair);
  return stairParts(stair).treads.map((t) => ({
    step: t.step,
    z: t.step * riser,
    pts: t.pts.map((p) => stairToWorld(stair, p.a, p.c)),
  }));
}
