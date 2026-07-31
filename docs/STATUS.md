# Where the floor planner has got to

A stocktake, first written 29 July 2026 and kept up since. 21,200 lines of source,
297 tests, one 809 kB self-contained page.

---

## What is built

### Drawing

- **Walls** by typed length and angle, or dragged with snapping and guides. Three
  types — exterior 365, load-bearing, partition 115 — each with its own thickness,
  editable per wall.
- **Rooms** as a rectangle tool, or as whatever the walls happen to enclose: rooms are
  found by walking the planar graph, not stored, so knocking a wall through merges
  two rooms without anyone having to say so.
- **Junctions.** Walls meet at shared nodes on their centre lines and are mitred at
  the corners, with a limit so a sharp corner does not grow a spike. Dragging a node
  moves every wall on it.
- **Trim and extend**, **split**, columns, floor openings for stairwells.
- **Guides** pulled off the rulers, grid snapping, ortho lock.
- **A free angle rounds to 3°**, which divides 90 so every right angle and every 45 is
  still exactly reachable and a wall at 51 is as easy as one at 90. It rounds rather
  than refuses — the angle is never limited — and an exact one can be typed while
  drawing. Ortho lock is the separate, deliberate choice to be held to right angles,
  and it outranks the object snaps; the 3° rounding yields to them, so tidying the
  angle never costs the perpendicular foot or the alignment with an existing corner.
- **Splitting a wall shows the cut first.** A cut is the one edit that leaves the
  drawing looking identical — the poché runs straight through the new corner — so the
  hovered wall carries a mark where it will be cut and the two lengths it would leave,
  both from the same function the cut itself uses. Afterwards the new corner is
  selected and the two lengths are printed.
- **The cursor is the tool.** The active tool's own glyph, drawn from the same sprite
  the toolbar uses, with its hotspot where the tool bites and a badge saying what the
  next click will actually do: armed or refused on a wall for the opening tools, pick
  or move for select, `+` while Shift adds to a selection, a broken link while Alt
  takes a wall off the one it is butted into, a target when the point has been caught
  by a snap. Space is a hand, mid-drag or not.
- **A room off a wall** — select a wall, give a depth, and three walls are built off
  its ends. The wall is shared, not copied. The depth is the room you can stand in.

### Openings

- Doors and windows in real joinery sizes (DIN 18101 leaf widths), with **stock** —
  the lining — configurable and drawn in both views. The width is always the leaf; the
  hole is the leaf plus the lining each side.
- Doors: single, double, sliding, folding. Windows in the kinds they actually come
  in: **Dreh-Kipp, Dreh, Kipp**, fixed, floor to ceiling, French.
- Swing angle up to 180°, hinge side, opening direction, sill and head heights,
  window boards inside and out.
- **A window that opens is treated as a door.** A turn sash is drawn with its leaf and
  arc once it stands open, and it sweeps a clearance zone like a leaf — measured from
  the sill up, so a worktop under the window is not in its way but a wardrobe beside
  it is. Shut, it is drawn as glass, which is what a Grundriss draws: how a window
  opens is an elevation symbol and is left to the panel and the schedule.
- In plan: German symbols with the dashed lines, the arc at the real angle, and the
  size written on the opening as `width/height` over the sill height.
- In 3D: a real frame set into the reveal, sashes hung on it, glazing bedded in the
  rebate. A door lining wraps the whole reveal, as an Umfassungszarge does.

### Stairs

Straight, quarter- and half-turn with winders, in the German manner: Laufline, break
line, numbered treads. DIN 18065 checks on rise, going and headroom, with the
stairwell opening the stair needs offered as a one-click cut.

### Rooms and areas

A room that is not a rectangle, or not square to the page, is measured too — square to
its own walls. The frame is the minimum-area rectangle over the room's own edge
directions, turned to lie within a quarter turn of the page so "width" keeps meaning
roughly across it.

A room that is not a rectangle is measured too. Its clear width and depth are given as
a range — chords the room actually has, taken near each wall and across the middle,
the same three lines the 3D view draws its dimensions on. It used to report the
bounding box, a pair of figures a tapering room never measures anywhere. What it still
withholds is the editable width and depth: "change the width and the far wall moves"
has no meaning without a rectangle.

Floor area, and **Wohnfläche to WoFlV §4** — the two-metre and one-metre bands under a
sloping ceiling worked out by exact half-plane clipping, per-room usage factors, and a
schedule that adds up.

### Dimensions

- **Automatic chains** in the German manner: openings, structure, overall, stacked
  outside each elevation, plus a chain along each internal wall that has a door in it.
  Figures written the way a plan writes them — `4,18⁵`, `24⁸`.
- Every chain runs face to face, never centre to centre.
- **Chains follow the walls, not the page.** A storey is measured square to the frame its
  walls are square to, so a building drawn on a skew — a survey of an old house — is
  dimensioned along its elevations rather than by their shadows on x and y. Drawn the old
  way a 4,50 wall read 3,59 and the two side chains, being shadows of the same thing,
  printed the same figures twice.
- **A wall running in neither chain direction gets a Maßkette of its own**, parallel to
  it and stacked outside the elevation chains, carrying its true length and any openings
  in it. A quadrilateral with no two sides parallel has no pair of chains that could
  describe it.
- **Hover either way round.** Point at a wall and the figures that measure it light
  up; point at a figure and its witness lines light up. Drawn last, so a witness line
  runs unbroken to what it measures.
- **Angles at every corner that is not a right angle**, and only those: a right angle is
  what a plan assumes, and writing 90° at each of them would bury the four that matter.
  Nothing else on the drawing tells 87° from 93°. The figure is the angle inside the
  room, found along the sector's own bisector, so the inside of an L reads 270° rather
  than its complement — which is what actually gets built.
- Manual dimensions and a measure tool as well.

### Renovation

Three phases — Bestand, Abbruch, Neubau — drawn as poché, dashed, and hatched. What
comes out stops bounding rooms, so the drawing shows the house you will have.

### Services

Sockets, switches, lights, data, radiators with type and size, thermostats,
manifolds. Radiators are built in 3D.

### Furniture

26 pieces, modelled parametrically from their real dimensions rather than as boxes: a
kitchen run has a plinth, a carcass, doors with a shadow gap and a worktop with an
overhang; a bed has a headboard, pillows and a turned-down cover. Plan symbols are
data, and a test checks that the two views agree about which way round a thing faces.

**Placed against things.** A piece brought up to a wall is turned to lie along it as
well as brought against its face — square to the wall whatever angle the wall runs at,
which is the only way to close the wedge a diagonal wall otherwise leaves. It squares
the piece without deciding which way round you wanted it: the quarter turn nearest the
way it is already lying wins, so it never swings more than 45°. The plan and the model
take the same path, so a piece dragged on the drawing lands where the same drag would
land in 3D.

**Snapping**: to the wall faces, to the other furniture's edges and centres, and to the
middle of a window or a door — a sofa goes under the window and a bed between two of
them, and that used to mean reading two figures off the chain and doing the arithmetic.
A centre line is aimed at rather than touched, so it reaches further than a wall face
does.

**Clearance checking**: door swings against furniture and against each other, the room
a WC or a basin needs in front of it (DIN 68935), things standing in the same place.

### The 3D view

- Drawn rather than rendered: near-white surfaces, a pale colour wash, joints ruled as
  hairlines, and shadow as pencil hatching set out on the paper rather than on the
  model.
- **A finish runs with the thing it is on.** A floor is laid along its own room's walls,
  not along the page, so boards in a room turned fifteen degrees are turned with it and
  every joint meets a wall square. The world is turned into the surface's frame before
  the pattern's plane is chosen — and the normal with it — so a surface on a skew is
  treated exactly as one square to the page.
- **Outlines** are the real boundaries and creases — an edge shared by two faces
  turned the same way is a seam inside a flat surface and is not drawn. A plain room
  yields eight vertical lines and no diagonals.
- Blender-style navigation, zoom towards the cursor.
- **The floor below as an underlay**: the real walls with their thickness, cut by their
  openings, in that storey's own phase, with its stairs — because an upper floor is set
  out from the one under it and a wire diagram of centrelines cannot say whether a wall
  is over another or 180 mm off it.
- **Measurements** in the model, occluded by the walls. A room is measured by a chord
  across itself rather than by its bounding box, so a room with a slanted wall reports
  a width it actually has and the line drawn for it runs inside the room. Where the two
  readings agree — any rectangle — the visible one is taken, which is what stops a
  figure flickering as the model turns; where they differ the wider one wins and stays
  put, so the number does not depend on where you are standing.
- **Furniture placed, picked, moved and turned in 3D**, snapped to walls, corners and
  other furniture; or on the **radar**, a plan inset that shows where the piece is,
  which way you are looking, and what the snap caught on. A click on the floor puts a
  piece down — only a click, so a drag still turns the model — and the options bar goes
  on offering the one control that needs: which piece. Alt-drag turns the piece, whether
  Alt goes down before the press or part way through it.
- **Only the tools the model can carry out are selectable there.** Everything else needs
  a point on a drawing, so the rail turns them off in 3D and a tool that cannot work is
  swapped for select on the way in, rather than staying in your hand and doing nothing.

### Walking about in it

Stand inside the drawing at eye height and walk. The mouse looks, W A S D or the arrows
walk, Shift hurries, Escape stands you back outside it. The walls stop you and the
doorways do not — a window is a hole you can see through, not one you can walk through,
which is also what keeps you inside an upper storey.

This is the one question a drawing cannot answer: not how big the hall is, which the
plan says, but whether it is mean. Collision is plain geometry with no renderer in it,
so it is tested: a wall stops you, a doorway does not, a Drempel is not a doorway, and
a standard door is wide enough to walk through without steering.

### Sun and shadow

The NOAA solar position for a real place on a real date and time, with European summer
time. Real cast shadows via a shadow map. Sunrise, sunset, daylight hours, and how
long the sun is on each window today. A compass bearing turns the building to match
the site.

### Quantities

What the drawing adds up to, in the terms somebody prices it in: wall run and both wall
faces less the openings, floor areas and skirting by finish, openings counted by size
with their lintels, and the one-line figures — volume, doors, windows. Every one measured
off the drawing, so it cannot disagree with what is drawn. A wall is measured on its
centreline because that is how it is built; skirting on the room's inside, because
measuring that on the centreline is out by a wall thickness at every corner.

### Files

Open and Save to your own disk, writing back over the file you opened where the
browser allows it. The document name and a dirty marker in the title bar, a warning
before losing unsaved work. A PDF or photograph can be laid underneath to trace.

Four ways out:

- **SVG, true to scale** — the drawing and nothing else, for CAD.
- **On paper** — A4, A3 or A2, wide or tall, framed with a title block carrying the
  drawing, the storey, the scale, the living area and the date. The scale is the largest
  standard one that fits, because nobody draws a house at 1:137; printed at 100% a metre
  on the building is a metre over the denominator on the paper. If it will not fit even
  at 1:200 the sheet says so on its face rather than cropping quietly.
- **PNG** of the plan, and **the 3D view as an image** at twice the screen — the
  printable vertical drawing, at a fraction of a section's cost. Drawn again at the
  bigger size rather than scaled up, because the outlines and the hatching are set out in
  pixels and an enlargement gives thick soft lines instead of drawn ones.
- **Schedules and quantities as CSV.**

### Build

Hand-written flattener, no bundler, no CDN, strict-CSP-safe. Guards that fail the
build on top-level name collisions, renamed imports, and a missing character-set
declaration.

---

## What is still open

### Asked for and not done

1. **The section drawing.** Chosen a long time ago and never built, and on 30 July
   reconsidered: nearly everything a section would tell you about your own house is
   already in the 3D view, the walk-through and the WoFlV maths. What it would still add
   is a printable vertical drawing. Not abandoned, but no longer next.
2. **Importing low-poly furniture packs.** An OBJ reader would let any CC0 pack be
   used. The parser is the easy half; imported meshes are arbitrary triangles, so they
   would miss the crease detection that gives everything its outlines, and would need
   scaling and orienting into each piece's box. My own view is that the parametric
   models are better for this job — they are correct at the sizes on your plan — but
   the importer would buy variety.
3. **Per-room internal dimensioning.** Room clear widths as chains inside each room,
   flagged as unfinished when the chains first landed.

### Named earlier, never chosen

Electrical circuits as circuits rather than as symbols. Notes and photographs pinned to
the drawing. Rollladenkästen. Reveal dimensions.

### Found by review, not yet fixed

Three personas read the source on 29 July. What they found that still stands — all of
it re-checked against the source on 30 July:

**From the drawing side.** Walls are one number with no Aufbau, so WoFlV §3 is measured
off the Rohbau face rather than the finished one. No Bauteilschraffuren.

**From the engineering side.** Nothing is reachable without a mouse: the canvas is not
focusable and there is no keyboard path to drawing. `interact.js`, `render.js` and
`view3d.js` have no tests of their own, though every module is now at least loaded by
one.

The review also called the per-frame recomputation a problem. Measured on 31 July
against a 21-wall house it is not: `allChains` 0,32 ms, `clearanceIssues` 0,41 ms and
`derived` — which is memoised — under 0,01 ms, against the 16,7 ms a frame has.
`clearanceIssues` does run with its toggle off, but that is the clearance panel counting
the problems it exists to count, not waste. Left alone.

### Found by walking a corner across the drawing, and fixed

A corner of a plain 8,00 × 6,00 was stepped from −1250 to +1250 in 250 mm steps and the
drawing read at each stop. What that turned up:

- **A corner dragged along its own wall never landed on the grid.** The walls hanging off
  a node move with it, so their line, midpoint and crossings follow the cursor about —
  and snapping to one always wins, because you are always exactly on it. It beat the
  50 mm grid: dragging sideways gave 379,7508 / 5571,36 rather than 400 / 6000, and the
  corner slid perpendicular to the drag as the wall it was stuck to swung round. The
  snapper is told to ignore the node being dragged; it now ignores that node's own walls
  too. Same three drags now give 400 / 6000, 750 / 6000, 1150 / 6000.
- **An alignment left the free axis wherever the cursor was.** Lining a corner up with
  another corner pins one coordinate exactly and leaves the other free, and a free
  coordinate may as well be a round number — rounding it keeps the alignment exact and
  costs nothing. A wall, an extension or a perpendicular foot is a point *on a line*, so
  rounding either axis there would take it off the line; those are left alone.
- **The panel's figures froze during a drag.** A gesture moves the model and asks for a
  repaint, but does not rebuild the inspector — rebuilding the schedules and quantities
  on every pointermove would cost more than the drag itself. So the corner's X and Y sat
  at what they were when the drag began while the chains beside them counted up live:
  the one place showing exact numbers was the one place not showing them. Inputs that
  mirror something the drawing is doing are now registered as live fields and refreshed
  from the render loop, skipping any the cursor is in.
- **Opening a drawing kept the tool you were holding.** `New` lands on the room tool;
  `Open` landed on whatever was in your hand, so opening a file with the furniture tool
  up put a double bed in the middle of somebody else's plan on the first click. Opening
  now lands on select, by the file picker and by drag-and-drop alike.

Not defects, and left alone: the raking chains appearing between 0 and 250 mm is the
1,15° threshold doing its job, and a threshold has to have a side; and an elevation
figure sitting a few millimetres from a raking one is two correct measurements of
different things, which the witness lines now make legible.

### Reported on 31 July, and fixed

- **A chain divided a raked wall at the wrong places.** A crossing wall's divisions were
  its centreline midpoint give or take half its thickness, which is the wall's own faces
  only when it is square to the chain. Set at an angle its footprint on the face is
  wider than it is thick — a 365 wall can stand 2,26 m of face — so it read 36⁵, and
  every figure either side of it was wrong by the difference, with phantom slivers where
  the arithmetic did not close. Divisions now come from the wall's own mitred corners
  projected onto the face: what is drawn is what is measured.
- **Then it divided by the crossing wall's bounding box**, which was the first fix
  overcorrecting. All four corners of a wall raked by a few degrees span a long way
  across the page over four metres, so a 365 return on a 4,36 m wall read 90¹. Only the
  two corners at the end that meets the face count; the other two are somewhere else
  entirely. A corner now reads its mitre — the thickness at a square junction, less at a
  sharp one, which is what the drawing actually shows.
- **A chain ran the length of the bounding box rather than the face it measures.** On a
  skewed building a corner elsewhere in the plan pushed the end past the end of the face
  and left a phantom figure of a few centimetres hanging off it. The ends of a chain are
  now the ends of its own facade, and a division that falls outside them is not on this
  face and is dropped — otherwise the openings chain would come out longer than the
  overall chain beside it, which is two figures for one face that do not agree.
- **A witness line started at the face of the building rather than at the point it
  measures.** On a wall square to its chain those are the same line and nobody could
  tell; on a raked one the figure came out with a line that started in mid-air several
  hundred millimetres from any corner, so there was nothing to say what had been
  measured. Each division now carries the point it was taken from, and its witness line
  is drawn from there — which is what makes an elevation figure legible as the *shadow*
  of a raked wall on the building's frame, dropped perpendicular onto the chain, against
  the raking chain that runs along the wall itself. Two figures that used to look like
  the same measurement taken twice now visibly answer different questions.
  `docs/examples/near-axis-rake.json` is the case: one wall raked 4,3°, described by
  6,36⁵ square to the frame and 6,38³ along itself.
- **A raking wall was dimensioned once, on its outer face.** Mitred into a corner the
  outer face runs past the inner one, so the wall a bricklayer sets out and the wall a
  room is bounded by are different lengths — on a 365 wall at a sharp corner, by a third
  of a metre. Both are drawn now: the inner face against the wall, the outer beyond it,
  each with its extension lines starting on the face it measures. A butt joint has no
  mitre, so there the two are the same and only one is drawn.
- **Strafing was inverted.** With z up, right is forward × up — (sin, −cos). Written the
  other way round D went left and A went right.
- **The measurements followed you about while walking.** They are drawn for the model
  seen from outside; standing in a room they are metres long, swing as you turn and
  measure things behind your head. They stay off while you are inside it.

### Reviewed on 31 July

A step back over the whole thing. What it turned up, and what was done:

- **Copying a floor put the copy on the same storey as its source**, so two floors both
  claimed to be the ground floor and the stack put one on top of the other at one
  height. A copy is now the storey above.
- **Walls dropped from a damaged file were counted into a field nobody read**, so a file
  that arrived short came up quietly short. It says so now.
- **Furniture can be centred on a window or a door.** The one thing everybody does that
  nothing caught.
- **Walking now keeps up with the drawing.** The walls you can bump into were worked out
  once when you set off, so changing floor or knocking a wall through left you walking
  through what was drawn and into what was not.
- **Five exports that nothing used** — `wallsAtNode`, `openingAt`, `DEFAULT_SITE`,
  `lineOffset`, `projectOnAngle` — removed rather than left looking load-bearing.
- **One Höhenkote per storey, not one per room.** Every room on a floor is at the same
  level; repeating it in each of them said nothing the first one had not, and stacked
  tight under the room's own text it read as a muddle.

### Fixed since, on 30 July

- **Undo after a live gesture.** A drag or a slider has to change the drawing as it
  goes, and `edit` took its snapshot when it was called — by then the gesture had
  already moved things, so undo restored the drawing as the gesture had left it. The
  store now owns a `preview`/`commit` pair: one entry per gesture, undoing to where it
  started. It cost real work twice before it was caught.
- **Walls can be copied**, the whole set at once so the corners they share stay shared;
  and a **whole floor can be copied**, which is how a second storey is actually drawn.
- **Floors stack by storey, not by the order they were drawn.** Nought is the ground
  floor and −1 a cellar. Drawing the ground floor first and the cellar second used to
  put the cellar on the roof.
- **Line weight and lettering come from the scale**: a 0,25 mm pen and 2,5 mm text on
  the sheet, whatever the building measures. The pen used to be the building's own width
  over 900, so a bungalow and a terrace at the same scale drew with different pens.
- **Opening marks are on the drawing**, worked out where the schedule gets them, so a
  window and its row carry the same mark. **Höhenkoten** too: OKFF per room, on the
  conventional half-filled triangle.
- **A file from a newer version is refused** rather than put through this version's
  migrations and quietly changed. The format stamp was written on every save and read on
  none.
- **A wall standing on a corner that is not there is dropped** on the way in, with a
  count, rather than carried as a wall nobody can see.
- **The question before losing unsaved work is the page's own**, not `window.confirm` —
  which a sandboxed frame refuses outright, so Open and New quietly did nothing.
- **A lost 3D context comes back.** It says so, throws away what was built on it, and
  rebuilds when the browser returns it.

### Settled since

**A window has two widths and the drawing now says both.** The figure at an opening is
the Rohbaumaß — the hole the wall is built to, which is what the dimension chain
beside it measures, so one window carries one number. The leaf, which is what gets
ordered, follows in brackets underneath and only when a lining makes the two differ:

```
1,50⁵/1,20      the hole
       90       the Brüstung
   (1,38⁵)      the leaf
```

The schedule carries both as columns, Leaf and Rohbau, and so does the CSV. It used to
print the leaf against a chain measuring the hole, and to mix the two within one label
— leaf width beside hole height.

### Rough edges

- Hover highlighting of the dimension chains only works under the select, erase, trim
  and split tools. With a drawing tool active the cursor is busy.
- A piece of furniture hidden behind a wall cannot be picked in 3D. There is no x-ray
  and no cycling through what is under the cursor.
- Only one piece can be dragged in 3D at a time.
- The radar only appears when a piece is selected.
- A tilt sash is drawn shut in 3D. Everything in the model is a prism standing square,
  and a sash leaning in at the head is not upright; the plan carries the Kipp mark and
  the panel says why the model does not.
- Save writes back in place in Chrome and Edge. Firefox and Safari have no File System
  Access API, so Save downloads a copy and says so.
- The sun study knows about the sun and nothing else: no terrain, no trees, no
  neighbouring buildings. It says so on the panel.

### Deliberately not there

**Gelb und rot for Abbruch and Neubau.** A Prüfer scans for the colours, and a review
raised it; the answer, given 30 July, is that the phases stay as patterns — poché,
dashed and hatched. This drawing is for the house, not for an authority, and a pattern
survives a black-and-white print and a photocopy where a colour does not.

Photographic textures, and images as floor finishes. Both were built and taken out
again: they made the 3D view read as a picture of a room that does not exist, which is
a promise a proposal drawing should not make.

---

## Invariants the tests hold

Worth knowing before changing anything, because each of these was a bug once.

- Room metadata survives an edit — usage and the Wohnfläche factor used to be wiped on
  the next change.
- An opening's frame is built on the hole, never on the leaf.
- Nothing in an opening runs past its jambs.
- A window frame is 40–120 mm deep whatever the wall is; a door lining wraps the whole
  reveal.
- Only a sash on side hinges swings: a Kippflügel and a fixed light get no arc and no
  clearance zone, whatever angle is set on them.
- An arc ends where its leaf shuts, whichever jamb it is hung on and whichever way it
  opens — the second leaf of a pair used to sweep the wrong way round.
- Cuts through a wall are square to it, not a fraction of each face's own length.
- Outlines are boundaries and creases, never seams.
- Furniture carries no world-space pattern, because furniture moves.
- A floor's boards run at the room's own angle, whatever angle the room is drawn at.
- The plan symbol and the 3D model agree about which way a piece faces.
- Dimension chains measure face to face, and divide at a wall's real corners rather
  than at its centreline give or take half — which is the same thing only for a wall
  square to the chain.
- A drawn file declares its character set in the first 1024 bytes.
- A room is measured across itself and square to its own walls, never across its
  bounding box on the page — outside a rectangle square to the page, that box is a
  number no edge of the room has. The plan and the 3D view take their readings on the
  same lines, from the same function, so they cannot describe different rooms.
- A chain is drawn where it is measured: its drawn length equals its span, whatever
  frame it is in.
- A quadrilateral's marked angles come to 360°, and a square room is marked nowhere.
- Solstice altitudes, daylight hours and the summer-time boundary dates.
