// Furniture as furniture, rather than as the box it arrives in.
//
// Everything here is built from rectangular parts in the piece's own frame: x across
// its width, y through its depth, z up from the floor. The piece faces +y, so a bed's
// pillows and a WC's cistern are at -y, against the wall — the same convention the
// plan symbols are drawn to, which is what keeps a sofa turned the right way round
// when you spin it in either view.
//
// Parts are kept few and honest. A kitchen run is a plinth, a carcass, doors with a
// shadow gap between them and a worktop with an overhang, because that is what makes
// it read as a kitchen at a glance; it is not trying to be a catalogue photograph.

import { MATERIAL, rgb } from './materials.js';

// A finish is a colour and nothing else. The joints a floor is ruled with are set out
// from where the surface is in the building, which is right for a floor and wrong for
// anything that moves: a table ruled that way slides through its own lines when you
// drag it, because the lines belong to the room rather than to the table. Furniture is
// told apart by its shape and its outlines, which follow it.
const FINISH = {
  body: { colour: '#dcd7cf' },
  panel: { colour: '#cec8bf' },
  dark: { colour: '#5f5c58' },
  timber: { colour: '#b38a5c' },
  ply: { colour: '#c9a97c' },
  stone: { colour: '#c9c6bf' },
  metal: { colour: '#b4b8bd' },
  fabric: { colour: '#98a2a8' },
  cushion: { colour: '#a8b0b5' },
  linen: { colour: '#e5e3dd' },
  white: { colour: '#f2f2f0' },
  glass: { colour: '#a6c6d6', alpha: 0.3 },
};

export function finishOf(name) {
  const f = FINISH[name] ?? FINISH.body;
  return { colour: rgb(f.colour), material: MATERIAL.flat, alpha: f.alpha ?? 1, repeat: 1 };
}

/** A part, in the piece's own frame. Fractions of the piece unless given in mm. */
const part = (finish, x0, y0, z0, x1, y1, z1) => ({ finish, x0, y0, z0, x1, y1, z1 });

/**
 * A run of fronts with a shadow gap between them, which is what says "cupboard".
 *
 * Doors of about 500 across, because that is the unit a kitchen is built from, and a
 * handle line along the top of each so the eye has something to catch.
 */
function fronts(parts, finish, x0, x1, y, z0, z1, unit = 500, handles = true) {
  const span = x1 - x0;
  const count = Math.max(1, Math.round(span / unit));
  const each = span / count;
  const gap = Math.min(9, each * 0.03);
  for (let i = 0; i < count; i++) {
    const a = x0 + i * each + gap / 2;
    const b = x0 + (i + 1) * each - gap / 2;
    parts.push(part(finish, a, y, z0 + gap, b, y + 18, z1 - gap));
    if (handles && z1 - z0 > 260) {
      parts.push(part('metal', a + each * 0.18, y + 18, z1 - 78, b - each * 0.18, y + 30, z1 - 60));
    }
  }
}

/** Four legs at the corners, inset a little, as a table has. */
function legs(parts, finish, w, d, top, thick = 55, inset = 60) {
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx < 0 ? -w / 2 + inset : w / 2 - inset - thick;
      const y = sy < 0 ? -d / 2 + inset : d / 2 - inset - thick;
      parts.push(part(finish, x, y, 0, x + thick, y + thick, top));
    }
  }
}

/** A basin, bath or sink: a rim with a well inside it. */
function well(parts, finish, x0, y0, x1, y1, rim, depth, top, wall = 55) {
  parts.push(part(finish, x0, y0, rim, x1, y0 + wall, top)); // back
  parts.push(part(finish, x0, y1 - wall, rim, x1, y1, top)); // front
  parts.push(part(finish, x0, y0, rim, x0 + wall, y1, top)); // left
  parts.push(part(finish, x1 - wall, y0, rim, x1, y1, top)); // right
  parts.push(part(finish, x0, y0, depth, x1, y1, depth + 24)); // the bottom of it
}

/**
 * What a piece of furniture is made of, part by part.
 *
 * @returns [{finish, x0, y0, z0, x1, y1, z1}] in millimetres, x and y about the centre
 */
export function furnitureParts(kind, w, d, h) {
  const parts = [];
  const push = (...args) => parts.push(part(...args));
  const hw = w / 2;
  const hd = d / 2;

  switch (kind) {
    case 'bed-double':
    case 'bed-single': {
      const base = Math.min(320, h * 0.6);
      push('timber', -hw, -hd, 90, hw, hd, base); // divan
      push('linen', -hw + 40, -hd + 40, base, hw - 40, hd, h); // mattress and covers
      // Pillows at the head, which is the wall side.
      const pw = w > 1200 ? (w - 260) / 2 : w - 180;
      for (let i = 0; i < (w > 1200 ? 2 : 1); i++) {
        const x = w > 1200 ? -hw + 90 + i * (pw + 80) : -pw / 2;
        push('white', x, -hd + 120, h, x + pw, -hd + 460, h + 110);
      }
      // A turned-down cover, so the foot of the bed is not a slab.
      push('fabric', -hw + 40, hd - 620, h + 4, hw - 40, hd, h + 40);
      push('timber', -hw, -hd, base, hw, -hd + 60, h + 320); // headboard
      break;
    }

    case 'wardrobe': {
      push('panel', -hw, -hd, 0, hw, hd, h);
      fronts(parts, 'body', -hw + 16, hw - 16, hd - 6, 60, h - 16, 600);
      push('dark', -hw, -hd, 0, hw, hd, 60); // plinth, set back by the shadow
      break;
    }

    case 'nightstand':
    case 'tv-unit': {
      push('panel', -hw, -hd, 60, hw, hd, h);
      fronts(parts, 'body', -hw + 14, hw - 14, hd - 6, 80, h - 14, kind === 'tv-unit' ? 600 : 400);
      legs(parts, 'metal', w, d, 60, 34, 30);
      if (kind === 'tv-unit') push('dark', -hw + 200, -hd + 40, h, hw - 200, -hd + 90, h + 620);
      break;
    }

    case 'shelf': {
      push('panel', -hw, -hd, 0, -hw + 22, hd, h);
      push('panel', hw - 22, -hd, 0, hw, hd, h);
      push('panel', -hw, -hd, h - 22, hw, hd, h);
      const shelves = Math.max(3, Math.round(h / 380));
      for (let i = 0; i <= shelves; i++) {
        const z = (i / shelves) * (h - 40);
        push('panel', -hw + 22, -hd, z, hw - 22, hd - 20, z + 20);
      }
      push('panel', -hw, -hd, 0, hw, -hd + 12, h); // back
      break;
    }

    case 'sofa':
    case 'sofa-corner':
    case 'armchair': {
      const arm = Math.min(220, w * 0.14);
      const back = Math.min(240, d * 0.28);
      const seat = h * 0.52;
      push('fabric', -hw, -hd, 100, hw, hd, seat); // the block it sits on
      push('fabric', -hw, -hd, seat, hw, -hd + back, h); // back
      push('fabric', -hw, -hd, seat, -hw + arm, hd, h * 0.86); // arms
      push('fabric', hw - arm, -hd, seat, hw, hd, h * 0.86);
      // Seat cushions, split the way a sofa's are.
      const inner = w - arm * 2;
      const count = Math.max(1, Math.round(inner / 700));
      for (let i = 0; i < count; i++) {
        const a = -hw + arm + (i * inner) / count + 10;
        const b = -hw + arm + ((i + 1) * inner) / count - 10;
        push('cushion', a, -hd + back, seat, b, hd - 30, seat + 130);
        push('cushion', a + 40, -hd + back - 10, seat + 130, b - 40, -hd + back + 90, h - 40);
      }
      legs(parts, 'timber', w, d, 100, 46, 40);
      break;
    }

    case 'coffee-table':
    case 'dining-table':
    case 'desk': {
      push('timber', -hw, -hd, h - 40, hw, hd, h);
      legs(parts, kind === 'desk' ? 'metal' : 'timber', w, d, h - 40, kind === 'coffee-table' ? 45 : 60, 70);
      if (kind === 'desk') push('panel', -hw + 90, -hd + 40, h * 0.45, hw - 90, -hd + 58, h - 60);
      break;
    }

    case 'dining-round': {
      // A round top, as a ring of segments, on a pedestal.
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * Math.PI * 2;
        const a1 = ((i + 1) / steps) * Math.PI * 2;
        const x0 = Math.min(Math.cos(a0), Math.cos(a1)) * hw;
        const x1 = Math.max(Math.cos(a0), Math.cos(a1)) * hw;
        const y0 = Math.min(Math.sin(a0), Math.sin(a1)) * hd;
        const y1 = Math.max(Math.sin(a0), Math.sin(a1)) * hd;
        push('timber', x0, y0, h - 40, x1, y1, h);
      }
      push('metal', -90, -90, 0, 90, 90, h - 40);
      push('metal', -hw * 0.45, -hd * 0.45, 0, hw * 0.45, hd * 0.45, 30);
      break;
    }

    case 'chair': {
      const seat = h * 0.52;
      push('timber', -hw, -hd, seat, hw, hd, seat + 40);
      push('timber', -hw, -hd, seat + 40, hw, -hd + 40, h);
      legs(parts, 'timber', w, d, seat, 36, 34);
      break;
    }

    case 'counter':
    case 'island': {
      const worktop = 40;
      const plinth = 120;
      push('dark', -hw + 30, -hd + 30, 0, hw - 30, hd - 30, plinth);
      push('panel', -hw, -hd, plinth, hw, hd, h - worktop);
      fronts(parts, 'body', -hw + 12, hw - 12, hd - 8, plinth + 10, h - worktop - 10, 500);
      // The worktop, standing a little proud of the doors on every open side.
      push('stone', -hw - 12, -hd - (kind === 'island' ? 12 : 0), h - worktop, hw + 12, hd + 12, h);
      if (kind === 'counter') push('stone', -hw, -hd, h, hw, -hd + 22, h + 90); // upstand
      break;
    }

    case 'fridge': {
      push('metal', -hw, -hd, 0, hw, hd, h);
      push('panel', -hw + 10, hd - 6, 20, hw - 10, hd + 8, h * 0.62 - 6); // lower door
      push('panel', -hw + 10, hd - 6, h * 0.62 + 6, hw - 10, hd + 8, h - 20);
      push('metal', hw - 90, hd + 8, h * 0.62 - 380, hw - 62, hd + 24, h * 0.62 - 60);
      push('metal', hw - 90, hd + 8, h * 0.62 + 60, hw - 62, hd + 24, h * 0.62 + 380);
      break;
    }

    case 'stove': {
      push('panel', -hw, -hd, 120, hw, hd, h - 40);
      push('dark', -hw + 12, hd - 8, 150, hw - 12, hd + 6, h * 0.72); // oven door
      push('glass', -hw + 90, hd + 4, 260, hw - 90, hd + 12, h * 0.66);
      push('metal', -hw + 40, hd + 6, h * 0.72 + 30, hw - 40, hd + 22, h * 0.72 + 58);
      push('dark', -hw, -hd, h - 40, hw, hd, h); // the hob itself
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = sx * w * 0.22;
          const y = sy * d * 0.22;
          push('metal', x - 95, y - 95, h, x + 95, y + 95, h + 8);
        }
      }
      break;
    }

    case 'dishwasher':
    case 'washer': {
      push('panel', -hw, -hd, 60, hw, hd, h);
      push('body', -hw + 8, hd - 6, 70, hw - 8, hd + 8, h - 10);
      push('metal', -hw + 60, hd + 8, h - 90, hw - 60, hd + 24, h - 66);
      if (kind === 'washer') {
        push('glass', -hw * 0.55, hd + 8, h * 0.42, hw * 0.55, hd + 20, h * 0.42 + w * 0.55);
      }
      break;
    }

    case 'sink': {
      push('panel', -hw, -hd, 120, hw, hd, h - 40);
      fronts(parts, 'body', -hw + 12, hw - 12, hd - 8, 130, h - 50, 500);
      push('stone', -hw - 12, -hd, h - 40, hw + 12, hd + 12, h);
      well(parts, 'metal', -hw + 90, -hd + 80, hw - 90, hd - 80, h - 40, h - 220, h + 10, 40);
      push('metal', -40, -hd + 110, h, 40, -hd + 190, h + 260); // tap
      push('metal', -40, -hd + 110, h + 220, 40, hd - 260, h + 260);
      break;
    }

    case 'bath': {
      push('white', -hw, -hd, 0, hw, hd, h);
      well(parts, 'white', -hw + 70, -hd + 70, hw - 70, hd - 70, h - 40, 130, h + 12, 60);
      push('metal', -hw + 130, -hd + 110, h, -hw + 210, -hd + 200, h + 190);
      break;
    }

    case 'shower': {
      push('white', -hw, -hd, 0, hw, hd, 90); // tray
      push('white', -hw, -hd, 90, hw, hd, 110);
      push('glass', hw - 30, -hd, 110, hw, hd, h); // screens on two sides
      push('glass', -hw, -hd, 110, hw, -hd + 30, h);
      push('metal', -hw + 140, -hd + 40, h - 260, -hw + 200, -hd + 200, h - 200);
      push('metal', -hw + 120, -hd + 140, h - 300, -hw + 220, -hd + 240, h - 260);
      break;
    }

    case 'toilet': {
      push('white', -hw + 40, -hd, 0, hw - 40, hd - 120, 120); // foot
      push('white', -hw + 20, -hd + 60, 120, hw - 20, hd - 60, h * 0.52);
      push('white', -hw, -hd + 40, h * 0.52, hw, hd - 40, h * 0.52 + 45); // seat
      push('white', -hw + 10, -hd, h * 0.52 + 45, hw - 10, -hd + 210, h); // cistern
      push('metal', -60, -hd + 60, h + 4, 60, -hd + 140, h + 16);
      break;
    }

    case 'basin': {
      push('white', -hw, -hd + 60, h - 180, hw, hd, h);
      well(parts, 'white', -hw + 60, -hd + 130, hw - 60, hd - 60, h - 40, h - 150, h + 8, 45);
      push('white', -160, -hd + 60, 0, 160, -hd + 260, h - 180); // pedestal
      push('metal', -35, -hd + 110, h, 35, -hd + 180, h + 190);
      push('metal', -35, -hd + 110, h + 155, 35, -hd + 380, h + 190);
      break;
    }

    default: {
      push('panel', -hw, -hd, 0, hw, hd, h);
      break;
    }
  }
  return parts;
}
