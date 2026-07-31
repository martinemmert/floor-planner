# Floor Plan Editor

Draw a floor plan in the browser with the tools a CAD program gives you: typed
lengths and angles, a room tool, snapping with guides, trim and extend, adjustable
wall thickness, doors and windows in real joinery sizes, stairs of every usual shape
with code checks, roofs, storey heights, schedules — and a 3D view of the result. A
PDF or photo can be laid faintly underneath to trace over. Everything runs
client-side; no file leaves the machine.

The deliverable is a single self-contained HTML page, published as an Artifact. The
source is split into modules and flattened at build time — a published Artifact runs
under a strict CSP, so there is no bundler, no CDN and no external request.

**[Open it →](https://martinemmert.github.io/floor-planner/)**

Nothing to install and no account. The page is the whole program, so it works offline
once loaded, and drawings are kept in the browser or saved to a file you own.

## Commands

```bash
node build.mjs
```

Writes `dist/floor-planner.html` (the artifact) and `dist/preview.html` (the same
page wrapped in the doctype/head skeleton the host adds, for local viewing).

```bash
node --test "test/*.test.mjs"
```

## Deployment

`.github/workflows/pages.yml` runs the suite, builds, and publishes
`dist/floor-planner.html` as the site's `index.html`. The tests gate the build, so what
is on the web is always a green build, and the page served is byte for byte the page
`node build.mjs` produces locally. `dist/` is not committed; it is rebuilt on every push.

## How it works

**Millimetres, y downward, one document per floor.** Walls join through shared
nodes, so dragging a corner moves every wall that meets there. Openings store an
offset along their wall, so a door rides along when the wall moves and is clamped
inside it. Rooms are derived from the wall graph after every change; only their
names and keep state are stored, matched back by centroid.

**Reference line vs faces.** Walls are stored on their centreline — the same
choice Revit (Location Line), ArchiCAD (Reference Line) and AutoCAD Architecture
(Justification) make by default, because corner joins stay symmetric and changing
a thickness doesn't shift the wall. What a drawing is dimensioned to, though, is
faces, so `wallLengths` converts. At a mitred corner the outer face runs past the
shared node and the inner face stops short of it, both by
`(t_this/2·cos θ + t_other/2) / sin θ`; where a wall carries straight on past a
partition its far face is untouched and only the face being butted into is
interrupted. `plan.dimBasis` chooses which of the three the editable fields use;
setting a face length iterates, because moving the end drags the joined wall and
so changes the very mitre being solved for.

**Moving parts of the plan rigidly.** Editing one wall's length should stretch the
plan, not shear it. `branchNodes` starts at the end that moves and refuses to
cross any wall running along the direction of travel, which collects exactly the
part that should come along: lengthening a rectangle's top wall carries the whole
right-hand side and leaves the left alone, so the corners stay square. The same
walk drives room resizing — an inside wall slides across and the room next door
gives up the space, while an outside wall moves the shell. `setWallAngle` uses the
mirror of it, swinging everything hanging off the far end as one rigid piece, and
falling back to moving only that end when the shape closes on itself.

Room boundaries come back from the wall graph geometrically: a face's node
numbering is the graph's own, so `roomBoundaryNodeIds` finds the plan's nodes lying
on the outline — including the junction where a partition butts in.
`simplifyPolygon` drops the corners that are not corners, so a rectangle with a
partition landing on it is still treated as a rectangle.

**Vertical.** Each floor carries a clear ceiling height and the thickness of the
slab above it; floor to floor is the sum, and a floor's level is the sum of the
ones below. A room may override the height. From those come volume, wall surface
(perimeter × height less the openings on that room's walls), and living area —
each room's area times a factor from its use, following the German convention that
open-air space counts at a quarter and a garage not at all.

**Stairs** (`src/app/stairs.js`) are described the way a builder describes one: the
rise to climb, the tread depth, the number of risers. The riser height, the run,
whether the stride is comfortable and whether it is legal all follow, checked
against DIN 18065 for houses of up to two dwellings. Straight, quarter turn with a
landing, quarter turn on winders, half turn and spiral all produce the same thing:
**one polygon per tread** in the stair's own frame, where tread n rises to n times
the riser. The plan, the SVG export and the 3D model are built from those polygons,
so none of them can drift apart. A winder or a spiral is judged on its walking line
a third of the way out, and on its narrow end, not on a nominal tread depth.

**Sloping ceilings** (`roomSlopes`, `ceilingHeightAt` in `src/app/model.js`) — there
is no roof. A roof object was tried and taken out again: what the drawing actually
needs is the ceiling, and the ceiling is defined well enough by the knee walls under
it. Give a wall its own height and a pitch and it becomes a Drempel; the planes
springing from it are what `ceilingHeightAt(plan, room, x, y)` samples, and what the
WoFlV two-metre and one-metre bands are clipped against. The 3D view builds those
sloping strips (`addSlopeMesh`) and deliberately leaves the middle open, so the model
can still be looked into from above.

The limits are worth knowing: with two facing pitches the ridge falls wherever the
planes happen to cross rather than where you say it does, there is no gable end, no
covering and no oversail, and nothing outside the walls is drawn.

**3D** (`src/app/mesh.js`, `src/app/view3d.js`) is raw WebGL, because a published
Artifact cannot load a library and because a depth buffer is the only honest way to
draw a building — a painter's algorithm falls apart wherever a stair passes a wall.
Walls are extruded from the floor to their own height, which is what gives a knee
wall its shape; openings are cut by splitting each wall along
its length rather than by subtracting solids, so between openings the wall is full
height and at an opening only the pieces below the sill and above the head are
built. Floors stack at their real levels. The renderer draws on demand, so it asks
for `preserveDrawingBuffer` — without it the buffer is discarded after compositing
and the canvas reads back empty.

**Drawing** (`src/geom/snap.js`) ranks snap candidates the way CAD does: exact
points (corner, intersection, midpoint) beat lines (perpendicular, on-wall,
extension, alignment), lines beat the grid, and an angle lock constrains everything
to a ray from the point you are drawing from. Every snap reports what it hit so the
canvas can draw the dashed guide that explains it.

**Numeric entry** is the source of truth while drawing: the panel by the cursor
tracks the mouse until you type, then your number wins. Enter commits.

**Rooms** (`src/geom/faces.js`) come from walking the planar faces of the wall
graph, then insetting each face edge by *that* wall's half thickness — so the area
reported is usable floor area, not centreline area.

**Openings** (`src/app/openings.js`) hold the size catalogue and, in one place, the
plan symbol for every type as primitives in the opening's own frame. The canvas and
the SVG export both render those primitives, so they cannot drift apart.

**Tracing** (`src/app/backdrop.js`) reads a PDF with `src/pdf/`, which has no
dependencies: it parses the cross-reference table or stream, expands object streams,
inflates with the browser's `DecompressionStream`, and interprets the page content
stream's path and text operators. Encrypted files open when the user password is
empty (RC4 and AES-128); AES-256 reports a clear message instead. The result is only
ever a faint reference to draw over — nothing is interpreted as walls.

## Layout

```
src/pdf/      PDF reading: lexer, document, content stream, fonts, filters, decryption
src/geom/     snapping, room detection from wall faces, scale inference, vector helpers
src/app/      model, store, backdrop, openings, stairs, mesh, view3d, sun,
              renderer, interaction, export, UI
src/ui/       stylesheet and HTML shell
test/         Node tests, including a generated architect-style PDF fixture
build.mjs     flattens the modules into the single-file artifact
```

## Testing notes

The geometry is tested against analytic values, tightly: room areas to within
0.01 m², which is what catches an edge being inset by the wrong wall's thickness.
Openings are checked through split, join and wall moves, because that is where an
offset silently drifts. `normaliseProject` has its own test that opens a document in
the previous version's shape, since browser storage may still hold one.

`test/fixtures/make-plan-pdf.mjs` generates a synthetic architect-style PDF in two
structural variants, so both cross-reference paths in the PDF reader are covered.
