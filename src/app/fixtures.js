// Sockets, switches, lights and the rest of the things that make a floor plan
// buildable.
//
// Each fixture draws from primitives in its own frame: `a` runs along the wall it
// is mounted on, `c` away from that wall into the room, origin on the wall face.
// The plan and the SVG export both render those primitives, so they cannot drift
// apart — the same arrangement the openings and stairs use.
//
// Symbols follow the shape German electrical drawings use (DIN 1356 / IEC 60617):
// a socket is a half disc with a stem, a switch a small circle with a lever, a
// ceiling light a circle crossed through.

export const FIXTURE_GROUPS = ['Power', 'Lighting', 'Data & media', 'Heating & water', 'Safety'];

export const FIXTURES = [
  // ---- power -----------------------------------------------------------
  { id: 'socket', label: 'Socket', group: 'Power', mount: 'wall', height: 300, size: 260, ways: 1 },
  { id: 'socket2', label: 'Double socket', group: 'Power', mount: 'wall', height: 300, size: 260, ways: 2 },
  { id: 'socket3', label: 'Triple socket', group: 'Power', mount: 'wall', height: 300, size: 260, ways: 3 },
  { id: 'socket-wet', label: 'Socket, splashproof', group: 'Power', mount: 'wall', height: 1050, size: 260, ways: 1, wet: true },
  { id: 'socket-floor', label: 'Floor socket', group: 'Power', mount: 'free', height: 0, size: 240 },
  { id: 'socket-oven', label: 'Cooker outlet', group: 'Power', mount: 'wall', height: 500, size: 300, ways: 1, heavy: true },
  { id: 'board', label: 'Distribution board', group: 'Power', mount: 'wall', height: 1400, size: 700 },

  // ---- lighting --------------------------------------------------------
  { id: 'light-ceiling', label: 'Ceiling light', group: 'Lighting', mount: 'free', height: 2500, size: 300 },
  { id: 'light-wall', label: 'Wall light', group: 'Lighting', mount: 'wall', height: 1900, size: 260 },
  { id: 'spot', label: 'Downlight', group: 'Lighting', mount: 'free', height: 2500, size: 200 },
  { id: 'switch', label: 'Switch', group: 'Lighting', mount: 'wall', height: 1050, size: 240 },
  { id: 'switch2', label: 'Two-way switch', group: 'Lighting', mount: 'wall', height: 1050, size: 240 },
  { id: 'switch-double', label: 'Double switch', group: 'Lighting', mount: 'wall', height: 1050, size: 240 },
  { id: 'dimmer', label: 'Dimmer', group: 'Lighting', mount: 'wall', height: 1050, size: 240 },
  { id: 'motion', label: 'Motion sensor', group: 'Lighting', mount: 'wall', height: 2200, size: 260 },

  // ---- data and media --------------------------------------------------
  { id: 'data', label: 'Network outlet', group: 'Data & media', mount: 'wall', height: 300, size: 260 },
  { id: 'tv', label: 'Aerial outlet', group: 'Data & media', mount: 'wall', height: 300, size: 260 },
  { id: 'phone', label: 'Telephone outlet', group: 'Data & media', mount: 'wall', height: 300, size: 260 },
  { id: 'doorbell', label: 'Door intercom', group: 'Data & media', mount: 'wall', height: 1500, size: 260 },

  // ---- heating and water -----------------------------------------------
  { id: 'radiator', label: 'Radiator', group: 'Heating & water', mount: 'wall', height: 600, size: 1000, radiator: true },
  { id: 'thermostat', label: 'Thermostat', group: 'Heating & water', mount: 'wall', height: 1500, size: 240 },
  { id: 'manifold', label: 'Underfloor manifold', group: 'Heating & water', mount: 'wall', height: 400, size: 600 },
  { id: 'water', label: 'Water supply', group: 'Heating & water', mount: 'wall', height: 500, size: 220 },
  { id: 'waste', label: 'Waste connection', group: 'Heating & water', mount: 'wall', height: 400, size: 240 },
  { id: 'drain', label: 'Floor drain', group: 'Heating & water', mount: 'free', height: 0, size: 260 },

  // ---- safety ----------------------------------------------------------
  { id: 'smoke', label: 'Smoke alarm', group: 'Safety', mount: 'free', height: 2500, size: 280 },
  { id: 'co', label: 'CO alarm', group: 'Safety', mount: 'wall', height: 1500, size: 280 },
];

export function fixtureSpec(kind) {
  return FIXTURES.find((f) => f.id === kind) ?? FIXTURES[0];
}

export function defaultFixture(kind) {
  const spec = fixtureSpec(kind);
  return { kind: spec.id, height: spec.height, size: spec.size, label: spec.label };
}

/**
 * The symbol, as primitives in the fixture's frame.
 *
 * line:    {type:'line', a1, c1, a2, c2, heavy?}
 * circle:  {type:'circle', a, c, r, fill?}
 * arc:     {type:'arc', a, c, r, from, to, fill?}  angles in radians, 0 along +a
 * polygon: {type:'polygon', pts:[{a,c}], fill?}
 * text:    {type:'text', a, c, text, size}
 */

// ---- radiators -----------------------------------------------------------
//
// A panel radiator is described the way a merchant sells one: how many panels and
// convector fins it has, then its length and height. The output follows from those
// — the figures below are watts per metre of length at the 75/65/20 rating German
// installers still quote, and scale with the height.

export const RADIATOR_TYPES = [
  { id: '11', label: 'Type 11', hint: 'one panel, one set of fins', depth: 60, wattsPerM: 700 },
  { id: '21', label: 'Type 21', hint: 'two panels, one set of fins', depth: 80, wattsPerM: 1000 },
  { id: '22', label: 'Type 22', hint: 'two panels, two sets of fins', depth: 100, wattsPerM: 1300 },
  { id: '33', label: 'Type 33', hint: 'three panels, three sets', depth: 155, wattsPerM: 1850 },
  { id: 'tube', label: 'Towel rail', hint: 'a bathroom ladder', depth: 40, wattsPerM: 450 },
];

export const RADIATOR_HEIGHTS = [300, 400, 500, 600, 900];

export function radiatorType(id) {
  return RADIATOR_TYPES.find((t) => t.id === id) ?? RADIATOR_TYPES[2];
}

export function isRadiator(kind) {
  return fixtureSpec(kind)?.radiator === true;
}

/** Length, height, depth and heat output for one radiator. */
export function radiatorSpec(fixture) {
  const type = radiatorType(fixture.radType);
  const length = Math.max(200, fixture.size ?? 1000);
  const height = Math.max(200, fixture.panelHeight ?? 600);
  // Output scales with length and, near enough for planning, with height.
  const watts = Math.round(((type.wattsPerM * length) / 1000) * (height / 600));
  return { type, length, height, depth: type.depth, watts };
}

export function fixtureSymbol(fixture) {
  const spec = fixtureSpec(fixture.kind);
  const s = (fixture.size ?? spec.size) / 2;
  const out = [];
  const line = (a1, c1, a2, c2, heavy) => out.push({ type: 'line', a1, c1, a2, c2, heavy });
  const circle = (a, c, r, fill) => out.push({ type: 'circle', a, c, r, fill });
  const poly = (pts, fill) => out.push({ type: 'polygon', pts, fill });
  const text = (a, c, value, size) => out.push({ type: 'text', a, c, text: value, size: size ?? s * 0.9 });

  switch (fixture.kind) {
    case 'socket':
    case 'socket2':
    case 'socket3':
    case 'socket-wet':
    case 'socket-oven': {
      // A half disc sitting on the wall, with one stem per way.
      out.push({ type: 'arc', a: 0, c: 0, r: s, from: 0, to: Math.PI, fill: true });
      line(-s, 0, s, 0);
      const ways = spec.ways ?? 1;
      for (let i = 0; i < ways; i++) {
        const at = ways === 1 ? 0 : -s * 0.55 + (i * (s * 1.1)) / (ways - 1);
        line(at, s * 0.1, at, s * 1.7, spec.heavy);
      }
      if (spec.wet) circle(0, s * 0.55, s * 0.22);
      if (spec.heavy) text(s * 1.2, s * 1.5, '3~', s * 0.8);
      break;
    }
    case 'socket-floor': {
      circle(0, 0, s);
      out.push({ type: 'arc', a: 0, c: 0, r: s * 0.62, from: 0, to: Math.PI, fill: true });
      line(-s, 0, s, 0);
      break;
    }
    case 'board': {
      poly(
        [
          { a: -s, c: 0 },
          { a: s, c: 0 },
          { a: s, c: s * 0.7 },
          { a: -s, c: s * 0.7 },
        ],
        false
      );
      for (let i = -2; i <= 2; i++) line(i * s * 0.35, 0, i * s * 0.35 + s * 0.2, s * 0.7);
      text(0, s * 1.3, 'HV', s * 0.75);
      break;
    }

    case 'light-ceiling': {
      circle(0, 0, s);
      line(-s * 0.72, -s * 0.72, s * 0.72, s * 0.72);
      line(-s * 0.72, s * 0.72, s * 0.72, -s * 0.72);
      break;
    }
    case 'light-wall': {
      out.push({ type: 'arc', a: 0, c: 0, r: s, from: 0, to: Math.PI });
      line(-s, 0, s, 0);
      line(-s * 0.7, s * 0.7, s * 0.7, s * 0.7);
      line(0, 0, 0, s);
      break;
    }
    case 'spot': {
      circle(0, 0, s);
      circle(0, 0, s * 0.42, true);
      break;
    }
    case 'switch':
    case 'switch2':
    case 'switch-double':
    case 'dimmer': {
      circle(0, s * 0.65, s * 0.5);
      line(0, s * 0.15, 0, 0); // stem down to the wall
      line(-s, 0, s, 0);
      // the lever
      line(0, s * 0.65, s * 0.95, s * 1.5);
      if (fixture.kind === 'switch2') line(s * 0.35, s * 1.5, s * 0.95, s * 1.5);
      if (fixture.kind === 'switch-double') line(-s * 0.2, s * 0.75, s * 0.7, s * 1.65);
      if (fixture.kind === 'dimmer') {
        poly(
          [
            { a: s * 0.55, c: s * 0.95 },
            { a: s * 1.15, c: s * 1.35 },
            { a: s * 0.5, c: s * 1.5 },
          ],
          true
        );
      }
      break;
    }
    case 'motion': {
      out.push({ type: 'arc', a: 0, c: 0, r: s, from: 0, to: Math.PI });
      line(-s, 0, s, 0);
      for (const k of [-0.5, 0, 0.5]) line(k * s, s * 0.3, k * s * 1.6, s * 1.5);
      break;
    }

    case 'data':
    case 'tv':
    case 'phone':
    case 'doorbell': {
      out.push({ type: 'arc', a: 0, c: 0, r: s, from: 0, to: Math.PI });
      line(-s, 0, s, 0);
      line(0, s * 0.1, 0, s * 1.6);
      const mark = { data: 'LAN', tv: 'TV', phone: 'T', doorbell: 'K' }[fixture.kind];
      text(s * 0.35, s * 1.9, mark, s * 0.8);
      break;
    }

    case 'radiator': {
      const rad = radiatorSpec(fixture);
      const half = rad.length / 2;
      poly(
        [
          { a: -half, c: 0 },
          { a: half, c: 0 },
          { a: half, c: rad.depth },
          { a: -half, c: rad.depth },
        ],
        false
      );
      // A fin per 90 mm, so a longer radiator reads as a longer radiator.
      const steps = Math.max(3, Math.round(half / 90));
      for (let i = 1; i < steps; i++) {
        const at = -half + (2 * half * i) / steps;
        line(at, 0, at, rad.depth);
      }
      break;
    }
    case 'thermostat': {
      poly(
        [
          { a: -s * 0.6, c: 0 },
          { a: s * 0.6, c: 0 },
          { a: s * 0.6, c: s * 1.2 },
          { a: -s * 0.6, c: s * 1.2 },
        ],
        false
      );
      text(-s * 0.3, s * 0.9, 'θ', s * 0.9);
      break;
    }
    case 'manifold': {
      const half = (fixture.size ?? spec.size) / 2;
      poly(
        [
          { a: -half, c: 0 },
          { a: half, c: 0 },
          { a: half, c: s * 0.8 },
          { a: -half, c: s * 0.8 },
        ],
        false
      );
      for (let i = -2; i <= 2; i++) line(i * half * 0.4, s * 0.8, i * half * 0.4, s * 1.3);
      text(0, s * 1.9, 'HKV', s * 0.7);
      break;
    }
    case 'water': {
      circle(0, s * 0.7, s * 0.55);
      line(0, 0, 0, s * 0.15);
      line(-s * 0.4, s * 0.7, s * 0.4, s * 0.7);
      line(-s, 0, s, 0);
      break;
    }
    case 'waste': {
      circle(0, s * 0.7, s * 0.6);
      circle(0, s * 0.7, s * 0.25, true);
      line(0, 0, 0, s * 0.1);
      line(-s, 0, s, 0);
      break;
    }
    case 'drain': {
      circle(0, 0, s);
      line(-s * 0.7, -s * 0.7, s * 0.7, s * 0.7);
      line(-s * 0.7, s * 0.7, s * 0.7, -s * 0.7);
      circle(0, 0, s * 0.2, true);
      break;
    }

    case 'smoke': {
      circle(0, 0, s);
      circle(0, 0, s * 0.45, true);
      text(s * 1.2, s * 0.4, 'RM', s * 0.75);
      break;
    }
    case 'co': {
      out.push({ type: 'arc', a: 0, c: 0, r: s, from: 0, to: Math.PI });
      line(-s, 0, s, 0);
      text(-s * 0.75, s * 0.75, 'CO', s * 0.7);
      break;
    }

    default: {
      circle(0, s * 0.6, s * 0.5);
      line(-s, 0, s, 0);
    }
  }
  return out;
}

/** Every kind that goes on a wall, so the tool knows to snap it there. */
export function isWallMounted(kind) {
  return fixtureSpec(kind).mount === 'wall';
}

export function fixtureGroups() {
  return FIXTURE_GROUPS.map((group) => ({
    group,
    items: FIXTURES.filter((f) => f.group === group),
  }));
}
