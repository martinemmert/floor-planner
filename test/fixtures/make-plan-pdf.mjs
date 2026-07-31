// Builds a synthetic architect-style PDF: two houses side by side, drawn with
// double-line walls, room labels, dimension chains, hatching and a title block.
// Two structural variants exercise both cross-reference paths.

import { deflateSync } from 'node:zlib';

const MM_PER_PT = 25.4 / 72;
const PT_PER_MM = 1 / MM_PER_PT;

export const PLAN = {
  scale: 100, // 1:100
  exteriorThickness: 300,
  interiorThickness: 115,
  houseWidth: 10000,
  houseHeight: 8000,
  gap: 4000,
  // interior wall positions relative to each house origin
  splitX: 6000,
  splitY: 5000,
  rooms: [
    { name: 'Wohnen', house: 0 },
    { name: 'Kueche', house: 0 },
    { name: 'Bad', house: 0 },
    { name: 'Wohnen', house: 1 },
    { name: 'Kueche', house: 1 },
    { name: 'Bad', house: 1 },
  ],
};

// millimetres of real world per PDF point at this drawing scale
export const MM_PER_PT_AT_SCALE = MM_PER_PT * PLAN.scale;

function houseWalls(originX) {
  const { houseWidth: w, houseHeight: h, exteriorThickness: te, interiorThickness: ti, splitX, splitY } = PLAN;
  const x0 = originX;
  const x1 = originX + w;
  return [
    { a: [x0, 0], b: [x1, 0], t: te },
    { a: [x1, 0], b: [x1, h], t: te },
    { a: [x1, h], b: [x0, h], t: te },
    { a: [x0, h], b: [x0, 0], t: te },
    { a: [x0 + splitX, 0], b: [x0 + splitX, h], t: ti },
    { a: [x0 + splitX, splitY], b: [x1, splitY], t: ti },
  ];
}

export function planWalls() {
  return [...houseWalls(0), ...houseWalls(PLAN.houseWidth + PLAN.gap)];
}

export function expectedRooms() {
  const { houseWidth: w, houseHeight: h, exteriorThickness: te, interiorThickness: ti, splitX, splitY } = PLAN;
  const half = (t) => t / 2;
  const areas = [
    ((splitX - half(te) - half(ti)) * (h - te)) / 1e6,
    ((w - splitX - half(ti) - half(te)) * (splitY - half(te) - half(ti))) / 1e6,
    ((w - splitX - half(ti) - half(te)) * (h - splitY - half(ti) - half(te))) / 1e6,
  ];
  return areas;
}

class Content {
  constructor(offsetXmm, offsetYmm, pageHeightPt) {
    this.ops = [];
    this.ox = offsetXmm;
    this.oy = offsetYmm;
    this.pageHeight = pageHeightPt;
  }
  // millimetres of real world -> PDF points, y flipped
  px(xmm) {
    return (this.ox + xmm / PLAN.scale) * PT_PER_MM;
  }
  py(ymm) {
    return this.pageHeight - (this.oy + ymm / PLAN.scale) * PT_PER_MM;
  }
  width(mm) {
    return ((mm / PLAN.scale) * PT_PER_MM).toFixed(3);
  }
  line(a, b, widthPt) {
    this.ops.push(`${widthPt} w`);
    this.ops.push(`${this.px(a[0]).toFixed(3)} ${this.py(a[1]).toFixed(3)} m`);
    this.ops.push(`${this.px(b[0]).toFixed(3)} ${this.py(b[1]).toFixed(3)} l S`);
  }
  text(str, xmm, ymm, sizePt) {
    const escaped = str.replace(/([()\\])/g, '\\$1');
    this.ops.push('BT');
    this.ops.push(`/F1 ${sizePt} Tf`);
    this.ops.push(`1 0 0 1 ${this.px(xmm).toFixed(3)} ${this.py(ymm).toFixed(3)} Tm`);
    this.ops.push(`(${escaped}) Tj`);
    this.ops.push('ET');
  }
  rect(xPt, yPt, wPt, hPt) {
    this.ops.push(`0.4 w ${xPt} ${yPt} ${wPt} ${hPt} re S`);
  }
  toString() {
    return this.ops.join('\n');
  }
}

function drawWallPair(content, wall) {
  const [ax, ay] = wall.a;
  const [bx, by] = wall.b;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const half = wall.t / 2;
  const heavy = 0.7;
  content.line([ax + nx * half, ay + ny * half], [bx + nx * half, by + ny * half], heavy);
  content.line([ax - nx * half, ay - ny * half], [bx - nx * half, by - ny * half], heavy);
}

function drawHatch(content, x0, y0, x1, y1, pitch) {
  for (let x = x0; x <= x1; x += pitch) {
    content.line([x, y0], [Math.min(x + (y1 - y0), x1), y1 - Math.max(0, x + (y1 - y0) - x1)], 0.13);
  }
}

function drawDimensionChain(content, y, x0, x1, segments) {
  const step = (x1 - x0) / segments;
  for (let i = 0; i <= segments; i++) {
    const x = x0 + i * step;
    content.line([x - 60, y - 60], [x + 60, y + 60], 0.13); // tick
    content.line([x, y - 300], [x, y + 120], 0.13); // extension line
  }
  for (let i = 0; i < segments; i++) {
    const a = x0 + i * step;
    const b = a + step;
    content.line([a, y], [b, y], 0.13); // one baseline per interval
    const metres = step / 1000;
    content.text(metres.toFixed(2).replace('.', ','), (a + b) / 2 - 350, y - 150, 5);
  }
}

export function buildPlanContent(pageWidthPt, pageHeightPt) {
  const content = new Content(20, 20, pageHeightPt);
  const { houseWidth: w, houseHeight: h, gap, splitX, splitY } = PLAN;

  for (const wall of planWalls()) drawWallPair(content, wall);

  for (const originX of [0, w + gap]) {
    content.text('Wohnen', originX + 2200, 4200, 7);
    content.text('Kueche', originX + 7300, 2600, 7);
    content.text('Bad', originX + 7600, 6700, 7);
    // hatching inside a wall run, the kind of clutter that must be stripped
    drawHatch(content, originX + 300, 200, originX + 1200, 260, 60);
    drawDimensionChain(content, h + 900, originX, originX + w, 2);
  }

  // title block in the lower right corner
  const bx = pageWidthPt - 190;
  const by = 40;
  content.rect(bx.toFixed(2), by.toFixed(2), '150', '70');
  content.ops.push('BT /F1 9 Tf 1 0 0 1 ' + (bx + 10) + ' ' + (by + 45) + ' Tm (GRUNDRISS EG) Tj ET');
  content.ops.push('BT /F1 6 Tf 1 0 0 1 ' + (bx + 10) + ' ' + (by + 28) + ' Tm (Massstab 1:100) Tj ET');
  content.ops.push('BT /F1 6 Tf 1 0 0 1 ' + (bx + 10) + ' ' + (by + 14) + ' Tm (Haus A und Haus B) Tj ET');
  return content.toString();
}

function bytesOf(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

class Writer {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  push(data) {
    const bytes = typeof data === 'string' ? bytesOf(data) : data;
    this.parts.push(bytes);
    this.length += bytes.length;
    return this.length;
  }
  concat() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

// Variant "classic": plain xref table, Flate-compressed content stream.
export function makeClassicPdf({ pages = 2 } = {}) {
  const pageWidth = 841.89; // A3 landscape
  const pageHeight = 595.28;
  const contents = [];
  for (let i = 0; i < pages; i++) {
    const body = buildPlanContent(pageWidth, pageHeight);
    const label = i === 0 ? body : body.replace('GRUNDRISS EG', 'GRUNDRISS OG');
    contents.push(deflateSync(Buffer.from(label, 'latin1')));
  }

  const w = new Writer();
  const offsets = {};
  w.push('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');

  const startObj = (num) => {
    offsets[num] = w.length;
    w.push(`${num} 0 obj\n`);
  };
  const endObj = () => w.push('\nendobj\n');

  const pageObjNums = [];
  for (let i = 0; i < pages; i++) pageObjNums.push(3 + i * 2);

  startObj(1);
  w.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  endObj();

  startObj(2);
  w.push(
    `<< /Type /Pages /Count ${pages} /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] ` +
      `/MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${3 + pages * 2} 0 R >> >> >>`
  );
  endObj();

  for (let i = 0; i < pages; i++) {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    startObj(pageNum);
    w.push(`<< /Type /Page /Parent 2 0 R /Contents ${contentNum} 0 R >>`);
    endObj();
    startObj(contentNum);
    w.push(`<< /Length ${contents[i].length} /Filter /FlateDecode >>\nstream\n`);
    w.push(new Uint8Array(contents[i]));
    w.push('\nendstream');
    endObj();
  }

  const fontNum = 3 + pages * 2;
  startObj(fontNum);
  w.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  endObj();

  const maxNum = fontNum;
  const xrefStart = w.length;
  w.push(`xref\n0 ${maxNum + 1}\n`);
  w.push('0000000000 65535 f \n');
  for (let n = 1; n <= maxNum; n++) {
    const off = String(offsets[n] ?? 0).padStart(10, '0');
    w.push(`${off} 00000 n \n`);
  }
  w.push(`trailer\n<< /Size ${maxNum + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return w.concat();
}

// Variant "modern": objects packed into an object stream, addressed by an xref
// stream with a PNG predictor.
export function makeModernPdf() {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const contentRaw = buildPlanContent(pageWidth, pageHeight);
  const contentZ = deflateSync(Buffer.from(contentRaw, 'latin1'));

  // objects 1 catalog, 2 pages, 3 page, 5 font live in object stream 6
  const packed = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R >> >> >>`],
    [3, '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>'],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
  ];
  let body = '';
  const pairs = [];
  for (const [num, text] of packed) {
    pairs.push(`${num} ${body.length}`);
    body += text + '\n';
  }
  const header = pairs.join(' ') + '\n';
  const objStmRaw = header + body;
  const objStmZ = deflateSync(Buffer.from(objStmRaw, 'latin1'));

  const w = new Writer();
  const offsets = {};
  w.push('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n');

  offsets[4] = w.length;
  w.push(`4 0 obj\n<< /Length ${contentZ.length} /Filter /FlateDecode >>\nstream\n`);
  w.push(new Uint8Array(contentZ));
  w.push('\nendstream\nendobj\n');

  offsets[6] = w.length;
  w.push(
    `6 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${header.length} ` +
      `/Length ${objStmZ.length} /Filter /FlateDecode >>\nstream\n`
  );
  w.push(new Uint8Array(objStmZ));
  w.push('\nendstream\nendobj\n');

  // xref stream, object 7, W [1 4 2], PNG-up predictor
  const entries = [];
  const add = (type, f2, f3) => entries.push([type, f2, f3]);
  add(0, 0, 65535); // object 0
  add(2, 6, 0); // 1 in objstm 6 index 0
  add(2, 6, 1); // 2
  add(2, 6, 2); // 3
  add(1, offsets[4], 0); // 4
  add(2, 6, 3); // 5
  add(1, offsets[6], 0); // 6
  const xrefOffsetPlaceholder = w.length;
  add(1, xrefOffsetPlaceholder, 0); // 7 (itself)

  const rowLen = 1 + 4 + 2;
  const raw = new Uint8Array(entries.length * (rowLen + 1));
  let prev = new Uint8Array(rowLen);
  entries.forEach((entry, i) => {
    const row = new Uint8Array(rowLen);
    row[0] = entry[0];
    row[1] = (entry[1] >>> 24) & 0xff;
    row[2] = (entry[1] >>> 16) & 0xff;
    row[3] = (entry[1] >>> 8) & 0xff;
    row[4] = entry[1] & 0xff;
    row[5] = (entry[2] >>> 8) & 0xff;
    row[6] = entry[2] & 0xff;
    const dst = i * (rowLen + 1);
    raw[dst] = 2; // PNG Up
    for (let k = 0; k < rowLen; k++) raw[dst + 1 + k] = (row[k] - prev[k]) & 0xff;
    prev = row;
  });
  const xrefZ = deflateSync(Buffer.from(raw));

  offsets[7] = w.length;
  w.push(
    `7 0 obj\n<< /Type /XRef /Size ${entries.length} /W [1 4 2] /Root 1 0 R ` +
      `/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns ${rowLen} >> ` +
      `/Length ${xrefZ.length} >>\nstream\n`
  );
  w.push(new Uint8Array(xrefZ));
  w.push('\nendstream\nendobj\n');
  w.push(`startxref\n${offsets[7]}\n%%EOF\n`);
  return w.concat();
}
