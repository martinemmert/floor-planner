import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAIR_LIMITS,
  cutTreadStep,
  defaultStair,
  narrowTread,
  riserHeight,
  stairChecks,
  stairGeometry,
  stairParts,
  stairLabel,
  stairRun,
  stairToWorld,
  stairWorldTreads,
  treadCount,
  walkOffset,
  walkingTread,
  worstLevel,
} from '../src/app/stairs.js';

test('a default stair for a normal storey is legal and comfortable', () => {
  const stair = { ...defaultStair(2750), x: 0, y: 0, rotation: 0 };
  const riser = riserHeight(stair);
  assert.ok(riser <= STAIR_LIMITS.maxRiser, `riser ${riser}`);
  assert.ok(stair.treadDepth >= STAIR_LIMITS.minTread);
  const stride = 2 * riser + stair.treadDepth;
  assert.ok(
    stride >= STAIR_LIMITS.strideMin && stride <= STAIR_LIMITS.strideMax,
    `stride ${stride.toFixed(0)} outside ${STAIR_LIMITS.strideMin}-${STAIR_LIMITS.strideMax}`
  );
  assert.equal(worstLevel(stairChecks(stair)), 'ok');
});

test('the risers add up to exactly the rise they have to climb', () => {
  for (const rise of [2500, 2750, 2900, 3200]) {
    const stair = defaultStair(rise);
    assert.ok(Math.abs(riserHeight(stair) * stair.steps - rise) < 1e-6, `rise ${rise}`);
  }
});

test('a straight flight takes one tread less than it has risers', () => {
  const stair = { ...defaultStair(2800), shape: 'straight', steps: 16, treadDepth: 280 };
  assert.equal(treadCount(stair), 15, '16 risers, 15 treads between them');
  assert.equal(stairRun(stair), 15 * 280);
  const parts = stairParts(stair);
  assert.equal(parts.treads.length, 15);
  // treads are numbered from the bottom and each rises by one riser
  assert.deepEqual(
    parts.treads.map((t) => t.step),
    Array.from({ length: 15 }, (_, i) => i + 1)
  );
  const tops = stairWorldTreads({ ...stair, x: 0, y: 0, rotation: 0 });
  assert.equal(Math.round(tops[0].z), Math.round(2800 / 16));
  assert.equal(Math.round(tops[14].z), Math.round((2800 / 16) * 15));
});

test('too steep, too narrow and too shallow are all reported', () => {
  const steep = { ...defaultStair(2800), steps: 12, treadDepth: 280, width: 1000 };
  assert.equal(riserHeight(steep) > STAIR_LIMITS.maxRiser, true);
  assert.equal(worstLevel(stairChecks(steep)), 'bad');

  const narrow = { ...defaultStair(2750), width: 700 };
  assert.ok(stairChecks(narrow).some((c) => c.level === 'bad' && /width/i.test(c.text)));

  const shallow = { ...defaultStair(2750), treadDepth: 200 };
  assert.ok(stairChecks(shallow).some((c) => c.level === 'bad' && /Auftritt/.test(c.text)));

  const tight = { ...defaultStair(2750), width: 900 };
  assert.equal(worstLevel(stairChecks(tight)), 'warn');
});

test('a quarter turn takes the landing and both flights into its run', () => {
  const stair = {
    ...defaultStair(2750),
    shape: 'landing',
    steps: 16,
    treadDepth: 280,
    width: 1000,
    landingAfter: 8,
  };
  // The landing is itself a step, so 15 treads means 8 up, the landing, then 6.
  const parts = stairParts(stair);
  assert.equal(parts.treads.length, 15);
  assert.equal(parts.landings.length, 1);
  // `run` is how deep the footprint is, not how far you walk: the second flight
  // runs across, so it adds nothing to the depth.
  assert.equal(stairRun(stair), 8 * 280 + 1000);
  assert.equal(stairParts(stair).walked, 14 * 280 + 1000);
  // and the landing rises by exactly one riser, like any other step
  const tops = stairWorldTreads({ ...stair, x: 0, y: 0, rotation: 0 });
  const riser = 2750 / 16;
  assert.equal(Math.round(tops[8].z), Math.round(riser * 9));
});

test('a quarter turn actually turns, and which way it turns is respected', () => {
  const base = { ...defaultStair(2750), shape: 'landing', steps: 16, treadDepth: 280, width: 1000, landingAfter: 8, x: 0, y: 0, rotation: 0 };
  const right = stairParts({ ...base, turn: 'right' });
  const left = stairParts({ ...base, turn: 'left' });
  const spread = (parts) => {
    const cs = parts.treads.flatMap((t) => t.pts.map((q) => q.c));
    return { min: Math.min(...cs), max: Math.max(...cs) };
  };
  // Turning right, the second flight reaches out past the centre line on the +c
  // side; turning left it reaches the other way.
  assert.ok(spread(right).max > base.width, `right reach ${spread(right).max}`);
  assert.ok(spread(left).min < -base.width, `left reach ${spread(left).min}`);
});

test('the frame maps into the drawing, rotation and all', () => {
  const stair = { ...defaultStair(2750), x: 1000, y: 2000, rotation: 0 };
  assert.deepEqual(stairToWorld(stair, 500, 0), { x: 1500, y: 2000 });
  const turned = { ...stair, rotation: 90 };
  const p = stairToWorld(turned, 500, 0);
  assert.ok(Math.abs(p.x - 1000) < 1e-6 && Math.abs(p.y - 2500) < 1e-6, `${JSON.stringify(p)}`);
});

test('every primitive carries finite numbers', () => {
  for (const shape of ['straight', 'landing']) {
    const geo = stairGeometry({ ...defaultStair(2750), shape, x: 0, y: 0, rotation: 0 });
    for (const item of geo.primitives) {
      const values =
        item.type === 'polygon' || item.type === 'polyline' || item.type === 'arrow'
          ? item.pts.flatMap((p) => [p.a, p.c])
          : item.type === 'circle'
            ? [item.a, item.c, item.r]
            : [item.a1, item.c1, item.a2, item.c2];
      for (const v of values) assert.ok(Number.isFinite(v), `${shape} ${item.type}: ${v}`);
    }
  }
});

// ---- curved and turning flights ---------------------------------------

test('every shape gives one tread per riser less one, and each rises evenly', () => {
  for (const shape of ['straight', 'landing', 'winder', 'uturn', 'spiral']) {
    const stair = { ...defaultStair(2750), shape, x: 0, y: 0, rotation: 0 };
    const parts = stairParts(stair);
    assert.equal(parts.treads.length, treadCount(stair), shape);
    const tops = stairWorldTreads(stair).map((t) => t.z);
    const riser = riserHeight(stair);
    tops.forEach((z, i) => {
      assert.ok(Math.abs(z - riser * (i + 1)) < 1e-6, `${shape} step ${i + 1} at ${z}`);
    });
    for (const tread of parts.treads) {
      assert.ok(tread.pts.length >= 3, `${shape} tread ${tread.step} has ${tread.pts.length} points`);
      for (const p of tread.pts) {
        assert.ok(Number.isFinite(p.a) && Number.isFinite(p.c), `${shape}: ${p.a},${p.c}`);
      }
    }
  }
});

test('winder treads fan out from the inner curve, not from a point', () => {
  const stair = {
    ...defaultStair(2750),
    shape: 'winder',
    winderSteps: 3,
    landingAfter: 5,
    width: 1000,
    newel: 200,
    x: 0,
    y: 0,
    rotation: 0,
  };
  const parts = stairParts(stair);
  const winders = parts.treads.filter((t) => t.step > 5 && t.step <= 8);
  assert.equal(winders.length, 3);
  // The inside corner of the turn is the centre the winders are struck from.
  const pivot = { a: 5 * stair.treadDepth, c: stair.width / 2 };
  for (const w of winders) {
    const radii = w.pts.map((p) => Math.hypot(p.a - pivot.a, p.c - pivot.c));
    // Nothing runs to the corner itself: the tread stops on the curve.
    assert.ok(Math.min(...radii) > 199 && Math.min(...radii) < 201, `winder ${w.step} narrow end at r=${Math.min(...radii)}`);
    // And several points sit exactly on it, forming the arc.
    assert.ok(radii.filter((r) => Math.abs(r - 200) < 0.5).length >= 3, `winder ${w.step} has no inner arc`);
  }
});

test('a winder that runs to a point is rejected, one on a curve is not', () => {
  const base = { ...defaultStair(2750), shape: 'winder', winderSteps: 3, landingAfter: 5, width: 1000 };
  const sharp = { ...base, newel: 0 };
  assert.equal(narrowTread(sharp), 0);
  assert.ok(stairChecks(sharp).some((c) => c.level === 'bad' && /narrow end/i.test(c.text)));
  const proper = { ...base, newel: 200 };
  assert.ok(narrowTread(proper) >= STAIR_LIMITS.minNarrowTread);
  assert.ok(!stairChecks(proper).some((c) => c.level === 'bad'));
});

test('a flight winding straight off the bottom step is allowed', () => {
  const stair = { ...defaultStair(2928), steps: 16, shape: 'winder', landingAfter: 0, winderSteps: 3, width: 1010, treadDepth: 260, newel: 200 };
  const parts = stairParts(stair);
  assert.equal(parts.treads[0].step, 1);
  assert.equal(parts.treads.length, 15);
  // This is the stair on the user's own drawing: 16 Stg 18,3/26,0.
  assert.equal(stairLabel(stair), '16 Stg 18,3/26,2');
  assert.equal(worstLevel(stairChecks(stair)), 'ok');
});

test('the plan is cut about a metre up and the flight breaks there', () => {
  const stair = { ...defaultStair(2750), steps: 15, treadDepth: 280, width: 1000 };
  const riser = riserHeight(stair); // ~183 mm
  assert.equal(cutTreadStep(stair, 1000), Math.floor(1000 / riser) + 1);
  // A flight shorter than the cut plane is never broken.
  assert.equal(cutTreadStep({ ...stair, steps: 4, rise: 600 }, 1000), null);

  const geo = stairGeometry(stair, { cutAt: 1000 });
  const cut = geo.primitives.filter((p) => p.style === 'cut');
  assert.equal(cut.length, 1, 'one break line');
  const above = geo.primitives.filter((p) => p.style === 'above');
  const below = geo.primitives.filter((p) => p.style === 'outline');
  assert.equal(above.length + below.length, treadCount(stair));
  assert.equal(below.length, geo.cutStep - 1, 'everything under the cut is drawn solid');
  // Turning the cut off draws the whole flight solid.
  const whole = stairGeometry(stair, { cut: false });
  assert.equal(whole.primitives.filter((p) => p.style === 'above').length, 0);
});

test('the walking line arrow points the way the flight climbs', () => {
  const up = stairGeometry({ ...defaultStair(2750), direction: 'up' });
  const down = stairGeometry({ ...defaultStair(2750), direction: 'down' });
  const head = (geo) => {
    const arrow = geo.primitives.find((p) => p.type === 'arrow');
    return arrow.pts[arrow.pts.length - 1];
  };
  assert.ok(head(up).a > head(down).a, 'up ends at the top, down ends at the foot');
  // and the circle sits at the other end, on the first riser of the climb
  const circle = (geo) => geo.primitives.find((p) => p.type === 'circle');
  assert.ok(circle(up).a < head(up).a);
  assert.ok(circle(down).a > head(down).a);
});

test('step numbers are drawn only when asked for, one per tread', () => {
  const stair = defaultStair(2750);
  assert.equal(stairGeometry(stair).primitives.filter((p) => p.type === 'number').length, 0);
  const numbered = stairGeometry(stair, { numbers: true }).primitives.filter((p) => p.type === 'number');
  assert.equal(numbered.length, treadCount(stair));
  assert.deepEqual(
    numbered.map((p) => p.text),
    Array.from({ length: treadCount(stair) }, (_, i) => String(i + 1))
  );
});

test('the walking line sits where DIN measures it', () => {
  assert.equal(walkOffset(800), 400);
  assert.equal(walkOffset(1000), 500);
  assert.equal(walkOffset(1400), 500); // half a metre from the inner handrail
  // A wider flight does not get credit for a deeper going on the walking line.
  const narrow = { ...defaultStair(2750), shape: 'winder', width: 1000, winderSteps: 3 };
  const wide = { ...narrow, width: 1400 };
  assert.equal(Math.round(walkingTread(narrow)), Math.round(walkingTread(wide)));
});

test('a half turn brings the second flight back alongside the first', () => {
  const stair = { ...defaultStair(2750), shape: 'uturn', landingAfter: 7, width: 1000, x: 0, y: 0, rotation: 0 };
  const parts = stairParts(stair);
  const cs = parts.treads.flatMap((t) => t.pts.map((p) => p.c));
  // two flights side by side plus nothing else: the stair is two widths across
  assert.ok(Math.abs(Math.max(...cs) - Math.min(...cs) - 2 * stair.width) < 1, `${Math.max(...cs) - Math.min(...cs)}`);
  const last = parts.treads[parts.treads.length - 1];
  const first = parts.treads[0];
  // the top step is back near the bottom of the flight, on the other side
  assert.ok(Math.sign(last.pts[0].c) !== Math.sign(first.pts[0].c), 'the flights are on opposite sides');
});

test('a spiral is judged on its walking line and its narrow end', () => {
  const tight = { ...defaultStair(2750), shape: 'spiral', innerRadius: 80, sweep: 360, width: 800 };
  assert.ok(narrowTread(tight) < STAIR_LIMITS.minNarrowTread, `narrow ${narrowTread(tight)}`);
  assert.ok(stairChecks(tight).some((c) => c.level === 'bad' && /narrow end/i.test(c.text)));

  const roomy = { ...defaultStair(2750), shape: 'spiral', innerRadius: 400, sweep: 360, width: 1000, steps: 15 };
  assert.ok(narrowTread(roomy) >= STAIR_LIMITS.minNarrowTread, `narrow ${narrowTread(roomy)}`);
  // the walking line is measured a third of the way out, not at the newel
  assert.ok(walkingTread(roomy) > narrowTread(roomy));
});

// ---- half turn with winders: the German halbgewendelte Treppe -----------

test('a half turn with winders takes two corners and comes back alongside', () => {
  const stair = {
    ...defaultStair(2928),
    shape: 'halfwinder',
    steps: 18,
    treadDepth: 260,
    width: 1000,
    newel: 200,
    winderSteps: 3,
    landingAfter: 5,
    middleSteps: 1,
    turn: 'right',
  };
  const parts = stairParts(stair);
  assert.equal(parts.treads.length, treadCount(stair));
  // The steps run 1..n with nothing missed or repeated.
  assert.deepEqual(
    parts.treads.map((t) => t.step),
    Array.from({ length: treadCount(stair) }, (_, i) => i + 1)
  );

  const span = (tread) => ({
    a: [Math.min(...tread.pts.map((p) => p.a)), Math.max(...tread.pts.map((p) => p.a))],
    c: [Math.min(...tread.pts.map((p) => p.c)), Math.max(...tread.pts.map((p) => p.c))],
  });
  const first = span(parts.treads[0]);
  const last = span(parts.treads[parts.treads.length - 1]);
  // The last tread is back beside the first, not beyond it: that is the U.
  assert.ok(Math.abs(last.a[0] - first.a[0]) < 1, 'the flights start level with each other');
  assert.ok(last.c[0] > first.c[1], 'the second flight is across from the first');
  // Six winders in all, three to each corner.
  const winders = parts.treads.filter((t) => t.pts.length > 4);
  assert.equal(winders.length, 6);
});

test('the half turn is judged on the same going as a quarter turn', () => {
  const base = { ...defaultStair(2928), steps: 18, treadDepth: 260, width: 1000, newel: 200, winderSteps: 3 };
  const quarter = { ...base, shape: 'winder' };
  const half = { ...base, shape: 'halfwinder' };
  assert.equal(Math.round(walkingTread(half)), Math.round(walkingTread(quarter)));
  assert.equal(Math.round(narrowTread(half)), Math.round(narrowTread(quarter)));
  assert.ok(narrowTread(half) >= STAIR_LIMITS.minNarrowTread);
  assert.ok(!stairChecks(half).some((c) => c.level === 'bad'));
  // And a nothing inner curve is caught here too.
  assert.ok(stairChecks({ ...half, newel: 0 }).some((c) => c.level === 'bad' && /narrow end/i.test(c.text)));
});

test('no steps between the turns winds the whole half turn in one sweep', () => {
  const base = {
    ...defaultStair(2928),
    shape: 'halfwinder',
    steps: 18,
    treadDepth: 260,
    width: 1000,
    newel: 200,
    winderSteps: 3,
    landingAfter: 5,
  };
  const tight = stairParts({ ...base, middleSteps: 0 });
  const spaced = stairParts({ ...base, middleSteps: 2 });
  // Steps between the corners push the flights apart, which is the whole point of
  // the setting: it widens the stairwell.
  assert.ok(spaced.across > tight.across, `${spaced.across} should exceed ${tight.across}`);
  assert.equal(Math.round(tight.across), 2 * 1000, 'with no gap the flights are side by side');
  assert.equal(Math.round(spaced.across - tight.across), 2 * 260);
  // Either way the tread count is the same; the steps come out of the straight runs.
  assert.equal(tight.treads.length, spaced.treads.length);
});

test('a footprint is reported as the box the flight needs, not the distance walked', () => {
  const stair = { ...defaultStair(2928), shape: 'halfwinder', steps: 18, treadDepth: 260, width: 1000, landingAfter: 5, middleSteps: 1, winderSteps: 3 };
  const parts = stairParts(stair);
  assert.ok(parts.walked > parts.run, 'you walk further than the footprint is deep');
  assert.ok(parts.run > 0 && parts.across > 0);
  // A straight flight walks exactly its own run.
  const straight = stairParts({ ...stair, shape: 'straight' });
  assert.equal(Math.round(straight.walked), Math.round(straight.run));
  assert.equal(Math.round(straight.across), 1000);
});

test('a half turn short of treads shares them out between both corners', () => {
  // Six treads but five straight steps and three winders per corner asked for:
  // both corners still turn, and the straight runs give up what is needed.
  const stair = {
    ...defaultStair(1200),
    steps: 7,
    treadDepth: 260,
    shape: 'halfwinder',
    width: 1000,
    landingAfter: 5,
    middleSteps: 2,
    winderSteps: 3,
    newel: 200,
  };
  const parts = stairParts(stair);
  assert.equal(parts.treads.length, 6);
  const winders = parts.treads.filter((t) => t.pts.length > 4);
  assert.equal(winders.length, 4, 'two winders to each corner');
  assert.equal(winders.length % 2, 0, 'the corners get the same number each');
  assert.deepEqual(
    parts.treads.map((t) => t.step),
    [1, 2, 3, 4, 5, 6]
  );
  // It still turns through the full half circle.
  const cs = parts.treads.flatMap((t) => t.pts.map((q) => q.c));
  assert.ok(Math.max(...cs) - Math.min(...cs) > stair.width, 'the flights are side by side');
});

test('every shape reports a footprint and a walking line', () => {
  for (const shape of ['straight', 'landing', 'winder', 'halfwinder', 'uturn', 'spiral']) {
    const stair = { ...defaultStair(2928), shape, steps: 18, treadDepth: 260, width: 1000, landingAfter: 5 };
    const parts = stairParts(stair);
    assert.ok(parts.run > 0, `${shape}: no run`);
    assert.ok(parts.across > 0, `${shape}: no width across`);
    assert.ok(parts.walked > 0, `${shape}: nothing walked`);
    assert.ok(parts.walkLine.length >= 2, `${shape}: no walking line`);
    for (const tread of parts.treads) {
      for (const p of tread.pts) {
        assert.ok(Number.isFinite(p.a) && Number.isFinite(p.c), `${shape}: non-finite tread`);
      }
    }
  }
});

test('the break line stays on the flight it breaks', () => {
  // On a winder the nosing runs radially across the flight, so skewing the break
  // line as well used to shoot it 200 mm past the corner as a spike.
  for (const shape of ['straight', 'landing', 'winder', 'halfwinder', 'uturn']) {
    const stair = {
      ...defaultStair(2928),
      shape,
      steps: 18,
      treadDepth: 260,
      width: 1000,
      landingAfter: 4,
      winderSteps: 3,
      middleSteps: 1,
      newel: 200,
    };
    const geo = stairGeometry(stair, { cutAt: 1000 });
    const as = geo.parts.treads.flatMap((t) => t.pts.map((q) => q.a));
    const cs = geo.parts.treads.flatMap((t) => t.pts.map((q) => q.c));
    const box = { a0: Math.min(...as), a1: Math.max(...as), c0: Math.min(...cs), c1: Math.max(...cs) };
    const cut = geo.primitives.find((p) => p.style === 'cut');
    assert.ok(cut, `${shape}: no break line`);
    for (const q of [
      { a: cut.a1, c: cut.c1 },
      { a: cut.a2, c: cut.c2 },
    ]) {
      const stray = Math.max(box.a0 - q.a, q.a - box.a1, box.c0 - q.c, q.c - box.c1);
      assert.ok(stray < 90, `${shape}: the break line strays ${Math.round(stray)} mm past the flight`);
    }
    // It still crosses the whole flight, or it does not read as a break.
    const across = Math.hypot(cut.a2 - cut.a1, cut.c2 - cut.c1);
    assert.ok(across > stair.width * 0.7, `${shape}: the break line is only ${Math.round(across)} mm long`);
  }
});
