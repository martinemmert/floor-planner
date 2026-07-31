# Floor Plan Simplifier — Design

Date: 2026-07-27
Status: Approved for planning

## Problem

An architect delivers a multi-page PDF. Each page draws two houses side by side and
carries dimension chains, hatching, a title block, and annotation text. The user needs
one clean, to-scale, editable plan per floor for a single house, and wants to keep
editing it afterwards: move walls, add doors, name rooms, place furniture.

## Deliverable

One self-contained web page, published with the Artifact tool. A published Artifact runs
under a strict CSP: no CDN scripts, no external stylesheets, no network requests. Every
line of code and every asset ships inline. All processing happens in the browser; no file
ever leaves the machine.

## Constraints this imposes

- No pdf.js and no CAD library. The page reads PDFs with its own parser, using the
  browser's built-in `DecompressionStream` to inflate streams.
- No server, so no server-side storage. Projects persist in IndexedDB and as downloaded
  files.
- The page must work in light and dark themes and must not scroll horizontally.

## Units

Millimetres internally. Areas in m² with one decimal. German number formatting: comma as
decimal separator.

## Pipeline

Four stages. The user moves forward and back freely; the editor is the destination.

### Stage 1 — Import

The user picks a PDF. The parser lists its pages with thumbnails rendered from extracted
geometry. The user assigns pages to floors (ground floor, upper floor, basement) and
names them. A project holds one plan per floor.

Fallback: the user uploads a PNG or JPG instead. That plan enters image-trace mode, where
the bitmap becomes a locked backdrop and the user draws walls over it.

### Stage 2 — Extract

The parser returns two lists per page:

- **Paths** — polylines with stroke width and a fill flag.
- **Texts** — strings with position and font size.

The extractor classifies paths into layers and shows each layer as a toggle, with the
disabled layers dimmed rather than hidden:

| Layer | Signal |
|---|---|
| Heavy linework | Stroke width in the top cluster; long segments. Walls live here. |
| Thin linework | Stroke width in the bottom cluster. Fixtures, symbols, leader lines. |
| Hatching | Dense groups of short parallel segments at a constant angle and pitch. |
| Dimension chains | Long thin segments with tick marks, flanked by small numeric text. |
| Text | All text items. |

Classification is a starting guess, not a verdict. The user overrides any path's layer by
selecting it.

**Scale.** The extractor reads numeric dimension text, measures the chain it annotates,
and derives mm-per-PDF-unit from the ratio. It cross-checks candidates against the
standard scales 1:50, 1:100, and 1:200 and reports the agreement. The user confirms the
scale by clicking two points and typing the real distance. Without a confirmed scale the
plan carries an "unscaled" flag, and areas stay hidden.

### Stage 3 — Isolate

The user rubber-bands the house to keep. Geometry outside the band moves to a set-aside
bucket; nothing is deleted, and the user can restore it.

The extractor then infers walls and detects rooms (see Algorithms). Each detected room
appears as a tinted, clickable region with its auto-matched name and area. The user clicks
to keep or drop each one. Dropping a room discards nothing structural; it only marks the
region as not part of this plan.

### Stage 4 — Edit

From here the PDF is finished and the model is the source of truth. See Editor.

## Algorithms

Three algorithms carry the automation. Each is fallible, and each has a manual override.
Each gets Node tests against the user's real PDF.

### PDF reading

1. Locate `startxref`; parse either a classic xref table or an xref stream (PDF 1.5+),
   including PNG predictors.
2. Resolve object streams (`ObjStm`).
3. Inflate `FlateDecode` streams with `DecompressionStream('deflate')`.
4. For the chosen page, tokenize the content stream and interpret a subset of operators:
   - Graphics state: `q`, `Q`, `cm`, `w`, `gs`
   - Paths: `m`, `l`, `c`, `v`, `y`, `re`, `h`
   - Painting: `S`, `s`, `f`, `F`, `f*`, `B`, `b`, `n`
   - Text: `BT`, `ET`, `Tf`, `Td`, `TD`, `Tm`, `T*`, `Tj`, `TJ`, `'`, `"`
   - Nested content: `Do` for Form XObjects, recursively
5. Flatten Bézier curves to polylines at a fixed tolerance.
6. Map text codes to characters through the font's encoding, preferring `ToUnicode` when
   present.

Degradation is graceful and explicit. A raster page yields no paths, and the page offers
image-trace mode. A font without usable encoding yields garbled labels, and the user
retypes room names. An encrypted PDF reports that it cannot be read rather than failing
silently.

### Wall inference

CAD plans draw a wall as two parallel lines.

1. Take segments from the heavy layer.
2. Pair segments that run near-parallel and sit offset by a plausible wall thickness
   (60–500 mm), overlapping along their shared direction.
3. Collapse each pair into a centreline plus a thickness.
4. Snap centreline endpoints within a tolerance into shared nodes.
5. Split centrelines at intersections and extend near-miss endpoints to meet.
6. Report unpaired heavy segments as single-line wall candidates for the user to accept or
   reject.

### Room detection

1. Build a planar graph from wall centrelines, with segments split at every intersection.
2. Walk faces by taking the angularly-next edge at each node. Discard the outer face.
3. Reject faces below a minimum area, and faces whose shape suggests a wall cavity rather
   than a room.
4. Assign each text item to the face containing it; the longest non-numeric string becomes
   the room name, and a numeric string matching an area becomes a cross-check.

Faces recompute whenever walls change, so areas stay live.

## Model

One JSON document per project.

```
Project
  id, name, createdAt, updatedAt
  plans: [Plan]              # one per floor
  activePlanId

Plan
  id, name                   # "Ground floor"
  scale                      # mm per source unit; null while unscaled
  source                     # { kind: 'pdf'|'image', pageIndex, bytesRef }
  nodes: [Node]              # { id, x, y }        mm
  walls: [Wall]              # { id, nodeA, nodeB, thickness, kind }
  openings: [Opening]        # { id, wallId, offset, width, kind, swing }
  rooms: [Room]              # { id, faceKey, name, kept, areaOverride }
  furniture: [Furniture]     # { id, kind, x, y, w, h, rotation }
  labels: [Label]            # { id, text, x, y, size }
  dimensions: [Dimension]    # { id, fromNode, toNode, offset }
  setAside                   # geometry excluded during Isolate
  layers                     # visibility flags
```

Two decisions matter here:

**Walls reference shared nodes.** Dragging a node moves every wall meeting it, so
connections hold by construction instead of by cleanup.

**Openings store an offset along their wall.** A door rides along when its wall moves, and
never detaches.

Rooms reference a face key derived from their node loop, so a room survives edits that
leave its boundary intact.

## Editor

- Pan and zoom on a canvas.
- Snapping: node endpoints, orthogonal and 45° directions, parallel offsets, and the
  original source geometry.
- Tools: select, move node, move wall, draw wall, place door, place window, place
  furniture, add label, add dimension, delete.
- Multi-select, and undo/redo across every operation.
- Layer toggles for dimensions, labels, furniture, and source geometry.
- A furniture library of to-scale rectangles with real default sizes: bed, sofa, table,
  desk, wardrobe, kitchen counter, bath, shower, toilet, sink.
- Room panel listing every room with its name and area, and a total per floor.

## Persistence and export

- **Auto-save** to IndexedDB after every change, debounced. Reopening the page restores
  the last project. PDFs and images live in IndexedDB as blobs, which localStorage cannot
  hold.
- **Project file** — download and upload the JSON document, with source blobs embedded as
  base64.
- **Export** — SVG and PNG, per floor, with a print-friendly stylesheet.

## Build and verification

Source files in `/Users/martinemmert/floor-planner/src`. A build script inlines them into
one artifact HTML file. Development happens in modules; only the published output is a
single file.

- Node tests cover the PDF reader, wall inference, and room detection, run against the
  user's real PDF and against fixtures derived from it.
- The UI is verified in a browser: import a real plan, isolate a house, edit walls, export.
- No feature is reported as working before its test passes.

## Out of scope

3D views, stairs, roofs, sections, elevations, curved walls as true arcs, automatic
door-swing detection, collaboration, and any cloud storage.

## Open risk

The design assumes the PDF is a vector CAD export. If it turns out to be a scan, the
extraction stages yield nothing and the tool falls back to image tracing, which is the
planned fallback but a far slower workflow. Confirming this against the real file is the
first task of implementation.
