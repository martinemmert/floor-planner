// What things are made of, as a drawing says it.
//
// Not as a photograph would. A finish here is a few faint lines and a wash of colour,
// which is how a floor is shown on a drawing and how somebody looking at it knows to
// read it as a proposal rather than as a picture of a room that exists. Boards get
// their joints, tiles get their grid, and everything else gets nothing but its colour.
//
// The lines are worked out from where the surface is in the building rather than from
// texture coordinates, so a floor laid across two rooms lines up through the doorway
// and the lines stay a hair wide however far you zoom in.

export const MATERIAL = {
  flat: 0, // no lines: paint, and most things
  boards: 1, // board joints, running along the building's x axis
  tile: 2, // a grid of joints
  panelled: 3, // an upright joint, for a run of cupboard doors
};

const rgb = (hex) => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/**
 * The floor finishes, in the sizes and colours these things actually come in.
 *
 * `scale` is the size of the repeat in millimetres — a board width, a tile size — so
 * a 600 tile reads as a 600 tile against the dimensions on the plan.
 */
export const FLOOR_FINISHES = [
  { id: 'oak', label: 'Boards', material: MATERIAL.boards, colour: '#c8a173', scale: 190 },
  { id: 'oak-pale', label: 'Boards, pale', material: MATERIAL.boards, colour: '#dcc9ac', scale: 190 },
  { id: 'walnut', label: 'Boards, dark', material: MATERIAL.boards, colour: '#9a7050', scale: 165 },
  { id: 'tile-large', label: 'Tile, 600', material: MATERIAL.tile, colour: '#cfd2d0', scale: 600 },
  { id: 'tile-small', label: 'Tile, 300', material: MATERIAL.tile, colour: '#cdd6d6', scale: 300 },
  { id: 'terrazzo', label: 'Stone', material: MATERIAL.flat, colour: '#d6d3ca', scale: 1 },
  { id: 'carpet', label: 'Carpet', material: MATERIAL.flat, colour: '#b3a99c', scale: 1 },
  { id: 'screed', label: 'Screed', material: MATERIAL.flat, colour: '#c4c3bf', scale: 1 },
];

/** The paint colours, which is what a wall usually is. */
export const WALL_FINISHES = [
  { id: 'white', label: 'White', colour: '#f2f1ee' },
  { id: 'chalk', label: 'Chalk', colour: '#e8e4da' },
  { id: 'clay', label: 'Clay', colour: '#ddd2c2' },
  { id: 'sage', label: 'Sage', colour: '#c3ccbd' },
  { id: 'sky', label: 'Sky', colour: '#c2d2dd' },
  { id: 'rose', label: 'Rose', colour: '#e0cbc4' },
  { id: 'slate', label: 'Slate', colour: '#9aa4ab' },
  { id: 'ink', label: 'Ink', colour: '#4b545c' },
];

export const DEFAULT_FLOOR = 'oak';
export const DEFAULT_WALL = 'white';

export function floorFinish(id) {
  return FLOOR_FINISHES.find((f) => f.id === id) ?? FLOOR_FINISHES.find((f) => f.id === DEFAULT_FLOOR);
}

export function wallFinish(id) {
  return WALL_FINISHES.find((f) => f.id === id) ?? WALL_FINISHES.find((f) => f.id === DEFAULT_WALL);
}

/** A finish as the mesh wants it: a colour, a pattern, and how big the pattern is. */
export function floorSurface(id) {
  const finish = floorFinish(id);
  return { colour: rgb(finish.colour), material: finish.material, scale: finish.scale };
}

export function wallSurface(id) {
  return { colour: rgb(wallFinish(id).colour), material: MATERIAL.flat, scale: 1 };
}

export { rgb };
