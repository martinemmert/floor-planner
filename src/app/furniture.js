// To-scale furniture, sized from the dimensions these things actually come in.
//
// Width runs along the item's local x axis, depth along y, both in millimetres, and
// `z` is how tall it stands — which is what lets a wardrobe read differently from a
// nightstand in 3D. A piece faces its local +y, the way the symbols are drawn: a bed's
// pillows and a WC's cistern are at -y, against the wall. `clear` is how much room
// has to be left in front of it, where a standard says so.

export const FURNITURE = [
  { id: 'bed-double', label: 'Double bed', w: 1800, h: 2000, z: 500, group: 'Sleeping', symbol: 'bed' },
  { id: 'bed-single', label: 'Single bed', w: 900, h: 2000, z: 500, group: 'Sleeping', symbol: 'bed' },
  { id: 'wardrobe', label: 'Wardrobe', w: 1800, h: 600, z: 2000, group: 'Sleeping', symbol: 'wardrobe' },
  { id: 'nightstand', label: 'Nightstand', w: 450, h: 400, z: 500, group: 'Sleeping', symbol: 'rect' },

  { id: 'sofa', label: 'Sofa', w: 2100, h: 900, z: 800, group: 'Living', symbol: 'sofa' },
  { id: 'sofa-corner', label: 'Corner sofa', w: 2600, h: 1800, z: 800, group: 'Living', symbol: 'sofa' },
  { id: 'armchair', label: 'Armchair', w: 850, h: 850, z: 800, group: 'Living', symbol: 'sofa' },
  { id: 'coffee-table', label: 'Coffee table', w: 1100, h: 600, z: 420, group: 'Living', symbol: 'table' },
  { id: 'tv-unit', label: 'TV unit', w: 1800, h: 400, z: 450, group: 'Living', symbol: 'rect' },
  { id: 'shelf', label: 'Shelving', w: 800, h: 320, z: 1800, group: 'Living', symbol: 'rect' },

  { id: 'dining-table', label: 'Dining table', w: 1600, h: 900, z: 750, group: 'Dining', symbol: 'table' },
  { id: 'dining-round', label: 'Round table', w: 1200, h: 1200, z: 750, group: 'Dining', symbol: 'round' },
  { id: 'chair', label: 'Chair', w: 450, h: 480, z: 850, group: 'Dining', symbol: 'chair' },

  { id: 'counter', label: 'Counter run', w: 2400, h: 600, z: 900, group: 'Kitchen', symbol: 'counter' },
  { id: 'island', label: 'Island', w: 2000, h: 1000, z: 900, group: 'Kitchen', symbol: 'counter' },
  { id: 'fridge', label: 'Fridge', w: 600, h: 650, z: 1800, clear: { width: 600, depth: 900 }, group: 'Kitchen', symbol: 'appliance' },
  { id: 'stove', label: 'Hob', w: 600, h: 600, z: 900, group: 'Kitchen', symbol: 'stove' },
  { id: 'dishwasher', label: 'Dishwasher', w: 600, h: 600, z: 850, clear: { width: 600, depth: 900 }, group: 'Kitchen', symbol: 'appliance' },
  { id: 'sink', label: 'Sink', w: 800, h: 600, z: 900, group: 'Kitchen', symbol: 'sink' },

  { id: 'bath', label: 'Bath', w: 1700, h: 750, z: 570, clear: { width: 900, depth: 550 }, group: 'Bathroom', symbol: 'bath' },
  { id: 'shower', label: 'Shower', w: 900, h: 900, z: 2000, clear: { width: 900, depth: 550 }, group: 'Bathroom', symbol: 'shower' },
  { id: 'toilet', label: 'WC', w: 400, h: 680, z: 780, clear: { width: 600, depth: 550 }, group: 'Bathroom', symbol: 'toilet' },
  { id: 'basin', label: 'Washbasin', w: 600, h: 480, z: 850, clear: { width: 900, depth: 550 }, group: 'Bathroom', symbol: 'basin' },
  { id: 'washer', label: 'Washing machine', w: 600, h: 600, z: 850, clear: { width: 600, depth: 900 }, group: 'Bathroom', symbol: 'appliance' },

  { id: 'desk', label: 'Desk', w: 1400, h: 700, z: 750, group: 'Work', symbol: 'table' },
  { id: 'stairs', label: 'Stair run', w: 1000, h: 2600, z: 1000, group: 'Work', symbol: 'stairs' },
];

export const FURNITURE_GROUPS = [...new Set(FURNITURE.map((f) => f.group))];

export function furnitureById(id) {
  return FURNITURE.find((f) => f.id === id) ?? null;
}
