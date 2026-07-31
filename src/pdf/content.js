// Content-stream interpreter. Produces flattened polylines and positioned text
// in a page-local coordinate system: points, origin at the top-left of the
// MediaBox, y increasing downward, page rotation already applied.

import { Lexer, ObjectParser, PdfStream, PdfString } from './lexer.js';
import { Font } from './fonts.js';

const IDENTITY = [1, 0, 0, 1, 0, 0];

export function matMul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export function matApply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matScale(m) {
  const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
  return Math.sqrt(det) || Math.hypot(m[0], m[1]) || 1;
}

export function pageBaseMatrix(box, rotation) {
  // flip to y-down and move the MediaBox origin to (0, 0)
  let m = [1, 0, 0, -1, -box.x0, box.y1];
  const w = box.width;
  const h = box.height;
  if (rotation === 90) m = matMul(m, [0, 1, -1, 0, h, 0]);
  else if (rotation === 180) m = matMul(m, [-1, 0, 0, -1, w, h]);
  else if (rotation === 270) m = matMul(m, [0, -1, 1, 0, 0, w]);
  const size = rotation === 90 || rotation === 270 ? { width: h, height: w } : { width: w, height: h };
  return { matrix: m, size };
}

const MAX_POINTS = 900000;

class State {
  constructor(ctm) {
    this.ctm = ctm;
    this.lineWidth = 1;
    this.strokeGray = 0;
    this.fillGray = 0;
    this.strokeAlpha = 1;
    this.fillAlpha = 1;
    this.font = null;
    this.fontSize = 0;
    this.charSpacing = 0;
    this.wordSpacing = 0;
    this.hScale = 1;
    this.leading = 0;
    this.rise = 0;
    this.renderMode = 0;
  }
  clone() {
    const s = new State(this.ctm);
    Object.assign(s, this);
    return s;
  }
}

function componentsToGray(comps, space) {
  if (space === 'gray' || comps.length === 1) return comps[0];
  if (space === 'cmyk' || comps.length === 4) {
    const [c, m, y, k] = comps;
    return Math.max(0, 1 - Math.min(1, Math.max(c, m, y) + k));
  }
  if (comps.length >= 3) {
    return 0.299 * comps[0] + 0.587 * comps[1] + 0.114 * comps[2];
  }
  return 0;
}

export class ContentInterpreter {
  constructor(doc, options = {}) {
    this.doc = doc;
    this.paths = [];
    this.texts = [];
    this.images = [];
    this.pointCount = 0;
    this.truncated = false;
    this.fontCache = new Map();
    this.curveTolerance = options.curveTolerance ?? 0.4;
  }

  async run(bytes, resources, baseMatrix) {
    this.state = new State(baseMatrix);
    this.stack = [];
    await this.execute(bytes, resources, 0);
    return {
      paths: this.paths,
      texts: this.texts,
      images: this.images,
      truncated: this.truncated,
    };
  }

  async fontFor(resources, name) {
    const doc = this.doc;
    const fonts = doc.resolveShallow(resources?.Font);
    const entry = fonts ? fonts[name] : null;
    const key = entry && entry.num !== undefined ? `R${entry.num}` : `${name}@${this.depth ?? 0}`;
    if (this.fontCache.has(key)) return this.fontCache.get(key);
    const dict = doc.resolveShallow(entry);
    const font = await Font.create(doc, dict);
    this.fontCache.set(key, font);
    return font;
  }

  emitSubpath(pts, closed, stroke, fill, gray, isRect) {
    if (pts.length < 2) {
      if (!(pts.length === 1 && fill)) return;
    }
    if (this.pointCount + pts.length > MAX_POINTS) {
      this.truncated = true;
      return;
    }
    this.pointCount += pts.length;
    this.paths.push({
      pts,
      closed,
      stroke,
      fill,
      gray,
      rect: isRect === true,
      w: this.state.lineWidth * matScale(this.state.ctm),
    });
  }

  flattenBezier(from, c1, c2, to, out) {
    const dist =
      Math.hypot(c1[0] - from[0], c1[1] - from[1]) +
      Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
      Math.hypot(to[0] - c2[0], to[1] - c2[1]);
    const steps = Math.max(2, Math.min(24, Math.ceil(dist / Math.max(0.2, this.curveTolerance * 4))));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push([
        u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
        u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
      ]);
    }
  }

  async execute(bytes, resources, depth) {
    if (depth > 12) return;
    this.depth = depth;
    const doc = this.doc;
    const parser = new ObjectParser(bytes, 0);
    const operands = [];
    let subpaths = [];
    let current = null;
    let start = null;
    let pendingClip = false;
    const text = { tm: IDENTITY, tlm: IDENTITY, active: false };

    const num = (i) => {
      const v = operands[i];
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    };

    const beginSubpath = (x, y) => {
      const p = matApply(this.state.ctm, x, y);
      current = [p];
      start = p;
      subpaths.push({ pts: current, closed: false, isRect: false });
      return p;
    };

    const pushSubpath = (pts, closed, isRect) => {
      subpaths.push({ pts, closed, isRect });
    };

    const paint = (stroke, fill) => {
      for (const sp of subpaths) {
        const closed = sp.closed || (fill && sp.pts.length > 2);
        this.emitSubpath(sp.pts, closed, stroke, fill, stroke ? this.state.strokeGray : this.state.fillGray, sp.isRect);
      }
      subpaths = [];
      current = null;
      pendingClip = false;
    };

    for (;;) {
      const token = parser.next();
      if (token === null) break;
      if (token.kind !== 'keyword') {
        const value = parser.parseFrom(token);
        if (value !== undefined) operands.push(value);
        if (operands.length > 64) operands.splice(0, operands.length - 64);
        continue;
      }
      const op = token.value;
      switch (op) {
        case 'q':
          this.stack.push(this.state.clone());
          break;
        case 'Q':
          if (this.stack.length) this.state = this.stack.pop();
          break;
        case 'cm':
          this.state.ctm = matMul(
            [num(0), num(1), num(2), num(3), num(4), num(5)],
            this.state.ctm
          );
          break;
        case 'w':
          this.state.lineWidth = num(0);
          break;
        case 'gs': {
          const extg = doc.resolveShallow(doc.resolveShallow(resources?.ExtGState)?.[operands[0]]);
          if (extg) {
            const lw = doc.resolveShallow(extg.LW);
            if (typeof lw === 'number') this.state.lineWidth = lw;
            const ca = doc.resolveShallow(extg.ca);
            if (typeof ca === 'number') this.state.fillAlpha = ca;
            const CA = doc.resolveShallow(extg.CA);
            if (typeof CA === 'number') this.state.strokeAlpha = CA;
          }
          break;
        }
        case 'm':
          beginSubpath(num(0), num(1));
          break;
        case 'l':
          if (!current) beginSubpath(num(0), num(1));
          else current.push(matApply(this.state.ctm, num(0), num(1)));
          break;
        case 'c':
        case 'v':
        case 'y': {
          if (!current) break;
          const from = current[current.length - 1];
          let c1;
          let c2;
          let to;
          if (op === 'c') {
            c1 = matApply(this.state.ctm, num(0), num(1));
            c2 = matApply(this.state.ctm, num(2), num(3));
            to = matApply(this.state.ctm, num(4), num(5));
          } else if (op === 'v') {
            c1 = from;
            c2 = matApply(this.state.ctm, num(0), num(1));
            to = matApply(this.state.ctm, num(2), num(3));
          } else {
            c1 = matApply(this.state.ctm, num(0), num(1));
            to = matApply(this.state.ctm, num(2), num(3));
            c2 = to;
          }
          this.flattenBezier(from, c1, c2, to, current);
          break;
        }
        case 'h':
          if (current && start) {
            const last = current[current.length - 1];
            if (Math.hypot(last[0] - start[0], last[1] - start[1]) > 1e-6) current.push([...start]);
            const sp = subpaths[subpaths.length - 1];
            if (sp) subpaths[subpaths.length - 1] = { pts: sp.pts, closed: true, isRect: sp.isRect };
          }
          break;
        case 're': {
          const x = num(0);
          const y = num(1);
          const w = num(2);
          const h = num(3);
          const pts = [
            matApply(this.state.ctm, x, y),
            matApply(this.state.ctm, x + w, y),
            matApply(this.state.ctm, x + w, y + h),
            matApply(this.state.ctm, x, y + h),
          ];
          pts.push([...pts[0]]);
          pushSubpath(pts, true, true);
          current = null;
          start = pts[0];
          break;
        }
        case 'n':
          subpaths = [];
          current = null;
          pendingClip = false;
          break;
        case 'S':
          paint(true, false);
          break;
        case 's':
          if (current && start) current.push([...start]);
          paint(true, false);
          break;
        case 'f':
        case 'F':
        case 'f*':
          paint(false, true);
          break;
        case 'B':
        case 'B*':
          paint(true, true);
          break;
        case 'b':
        case 'b*':
          if (current && start) current.push([...start]);
          paint(true, true);
          break;
        case 'W':
        case 'W*':
          pendingClip = true;
          break;
        case 'g':
          this.state.fillGray = num(0);
          break;
        case 'G':
          this.state.strokeGray = num(0);
          break;
        case 'rg':
          this.state.fillGray = componentsToGray([num(0), num(1), num(2)]);
          break;
        case 'RG':
          this.state.strokeGray = componentsToGray([num(0), num(1), num(2)]);
          break;
        case 'k':
          this.state.fillGray = componentsToGray([num(0), num(1), num(2), num(3)], 'cmyk');
          break;
        case 'K':
          this.state.strokeGray = componentsToGray([num(0), num(1), num(2), num(3)], 'cmyk');
          break;
        case 'sc':
        case 'scn':
        case 'SC':
        case 'SCN': {
          const comps = operands.filter((v) => typeof v === 'number');
          if (comps.length) {
            const gray = componentsToGray(comps);
            if (op === 'sc' || op === 'scn') this.state.fillGray = gray;
            else this.state.strokeGray = gray;
          }
          break;
        }
        case 'BT':
          text.tm = IDENTITY;
          text.tlm = IDENTITY;
          text.active = true;
          break;
        case 'ET':
          text.active = false;
          break;
        case 'Tf':
          this.state.fontSize = num(1);
          this.state.font = await this.fontFor(resources, operands[0]);
          break;
        case 'Td':
          text.tlm = matMul([1, 0, 0, 1, num(0), num(1)], text.tlm);
          text.tm = text.tlm;
          break;
        case 'TD':
          this.state.leading = -num(1);
          text.tlm = matMul([1, 0, 0, 1, num(0), num(1)], text.tlm);
          text.tm = text.tlm;
          break;
        case 'Tm':
          text.tlm = [num(0), num(1), num(2), num(3), num(4), num(5)];
          text.tm = text.tlm;
          break;
        case 'T*':
          text.tlm = matMul([1, 0, 0, 1, 0, -this.state.leading], text.tlm);
          text.tm = text.tlm;
          break;
        case 'TL':
          this.state.leading = num(0);
          break;
        case 'Tc':
          this.state.charSpacing = num(0);
          break;
        case 'Tw':
          this.state.wordSpacing = num(0);
          break;
        case 'Tz':
          this.state.hScale = num(0) / 100;
          break;
        case 'Ts':
          this.state.rise = num(0);
          break;
        case 'Tr':
          this.state.renderMode = num(0);
          break;
        case 'Tj':
        case "'":
        case '"': {
          let strOperand = operands[operands.length - 1];
          if (op === "'") {
            text.tlm = matMul([1, 0, 0, 1, 0, -this.state.leading], text.tlm);
            text.tm = text.tlm;
          } else if (op === '"') {
            this.state.wordSpacing = num(0);
            this.state.charSpacing = num(1);
            text.tlm = matMul([1, 0, 0, 1, 0, -this.state.leading], text.tlm);
            text.tm = text.tlm;
          }
          if (strOperand instanceof PdfString) text.tm = this.showText(strOperand.bytes, text.tm);
          break;
        }
        case 'TJ': {
          const arr = operands[operands.length - 1];
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (item instanceof PdfString) {
                text.tm = this.showText(item.bytes, text.tm);
              } else if (typeof item === 'number') {
                const tx = (-item / 1000) * this.state.fontSize * this.state.hScale;
                text.tm = matMul([1, 0, 0, 1, tx, 0], text.tm);
              }
            }
          }
          break;
        }
        case 'Do': {
          const xobjects = doc.resolveShallow(resources?.XObject);
          const ref = xobjects ? xobjects[operands[operands.length - 1]] : null;
          const xobj = doc.resolveShallow(ref);
          if (xobj instanceof PdfStream) {
            const subtype = doc.resolveShallow(xobj.dict.Subtype);
            if (subtype === 'Image') {
              const corners = [
                matApply(this.state.ctm, 0, 0),
                matApply(this.state.ctm, 1, 0),
                matApply(this.state.ctm, 1, 1),
                matApply(this.state.ctm, 0, 1),
              ];
              const xs = corners.map((c) => c[0]);
              const ys = corners.map((c) => c[1]);
              this.images.push({
                x: Math.min(...xs),
                y: Math.min(...ys),
                w: Math.max(...xs) - Math.min(...xs),
                h: Math.max(...ys) - Math.min(...ys),
              });
            } else if (subtype === 'Form') {
              const inner = await doc.streamBytes(ref);
              if (inner) {
                const saved = this.state;
                this.stack.push(this.state.clone());
                const mtx = doc.resolveShallow(xobj.dict.Matrix);
                if (Array.isArray(mtx) && mtx.length === 6) {
                  this.state = this.state.clone();
                  this.state.ctm = matMul(mtx.map((v) => doc.resolveShallow(v)), this.state.ctm);
                }
                const innerRes = doc.resolveShallow(xobj.dict.Resources) ?? resources;
                await this.execute(inner, innerRes, depth + 1);
                this.stack.pop();
                this.state = saved;
                this.depth = depth;
              }
            }
          }
          break;
        }
        case 'BI': {
          // Inline image: skip to the matching EI so binary data never reaches
          // the tokenizer.
          const at = this.skipInlineImage(bytes, parser.lexer.pos);
          parser.pos = at;
          break;
        }
        case 'sh':
        case 'd':
        case 'i':
        case 'j':
        case 'J':
        case 'M':
        case 'ri':
        case 'cs':
        case 'CS':
        case 'BMC':
        case 'BDC':
        case 'EMC':
        case 'MP':
        case 'DP':
        case 'BX':
        case 'EX':
        case 'd0':
        case 'd1':
          break;
        default:
          break;
      }
      if (op !== 'BI') operands.length = 0;
    }
    // Unpainted geometry at end of stream (some producers omit the final paint).
    if (subpaths.length && !pendingClip) paint(true, false);
  }

  skipInlineImage(bytes, from) {
    let i = from;
    // find "ID"
    while (i + 1 < bytes.length && !(bytes[i] === 0x49 && bytes[i + 1] === 0x44)) i++;
    i += 2;
    if (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
    for (; i + 1 < bytes.length; i++) {
      if (bytes[i] === 0x45 && bytes[i + 1] === 0x49) {
        const before = bytes[i - 1];
        const after = bytes[i + 2];
        const wsBefore = before === 0x20 || before === 0x0a || before === 0x0d || before === 0x09 || before === 0x00;
        const wsAfter =
          after === undefined || after === 0x20 || after === 0x0a || after === 0x0d || after === 0x09 || after === 0x2f || after === 0x5b || after === 0x71 || after === 0x51;
        if (wsBefore && wsAfter) return i + 2;
      }
    }
    return bytes.length;
  }

  showText(bytes, tm) {
    const st = this.state;
    const font = st.font;
    if (!font) return tm;
    const codes = font.codes(bytes);
    let str = '';
    let advance = 0;
    for (const code of codes) {
      str += font.charFor(code);
      const isSpace = !font.twoByte && code === 32;
      advance +=
        font.widthFor(code) * st.fontSize + st.charSpacing + (isSpace ? st.wordSpacing : 0);
    }
    const invisible = st.renderMode === 3 || st.renderMode === 7;
    if (str.trim().length && !invisible) {
      const trm = matMul(
        [st.fontSize * st.hScale, 0, 0, st.fontSize, 0, st.rise],
        matMul(tm, st.ctm)
      );
      const origin = [trm[4], trm[5]];
      const size = Math.hypot(trm[2], trm[3]) || Math.hypot(trm[0], trm[1]);
      const angle = Math.atan2(trm[1], trm[0]);
      const end = matApply(matMul(tm, st.ctm), advance * st.hScale, 0);
      const originUser = matApply(matMul(tm, st.ctm), 0, 0);
      this.texts.push({
        str,
        x: origin[0],
        y: origin[1],
        size: Math.abs(size),
        angle,
        width: Math.hypot(end[0] - originUser[0], end[1] - originUser[1]),
      });
    }
    return matMul([1, 0, 0, 1, advance * st.hScale, 0], tm);
  }
}

/**
 * Joins the glyphs a PDF places one at a time back into words.
 *
 * CAD exporters position every character separately, so a dimension reading
 * "5.94" arrives as four text items and a room name as fifteen. Anything that
 * wants to read the drawing — the scale inference, the labels on the tracing
 * backdrop — needs the words back. Items are grouped by writing direction and
 * baseline, then joined where the gap between them is smaller than the space
 * the font would have used.
 */
export function groupWords(texts) {
  const items = texts.filter((t) => t.str && t.str.length);
  if (items.length < 2) return items;

  const buckets = new Map();
  for (const item of items) {
    const angle = item.angle ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Distance along the writing direction, and across it to the baseline.
    const along = item.x * cos + item.y * sin;
    const across = -item.x * sin + item.y * cos;
    const size = item.size || 1;
    const key = `${Math.round(angle / 0.02)}|${Math.round(across / Math.max(0.4, size * 0.35))}`;
    const list = buckets.get(key) ?? [];
    list.push({ item, along, across, size });
    buckets.set(key, list);
  }

  const out = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.along - b.along);
    let run = null;
    const flush = () => {
      if (!run) return;
      out.push({
        str: run.str,
        x: run.item.x,
        y: run.item.y,
        size: run.item.size,
        angle: run.item.angle,
        width: run.end - run.along,
      });
      run = null;
    };
    for (const entry of list) {
      const width = entry.item.width ?? entry.size * 0.5 * entry.item.str.length;
      if (!run) {
        run = { item: entry.item, str: entry.item.str, along: entry.along, end: entry.along + width, size: entry.size };
        continue;
      }
      const gap = entry.along - run.end;
      const em = Math.max(run.size, entry.size) || 1;
      // Sizes that differ a lot are a superscript or a different label entirely.
      const sameSize = Math.abs(entry.size - run.size) < run.size * 0.35 + 0.2;
      if (sameSize && gap < em * 0.22 && gap > -em * 0.9) {
        run.str += entry.item.str;
        run.end = entry.along + width;
      } else if (sameSize && gap < em * 0.9 && gap > -em * 0.9) {
        run.str += ' ' + entry.item.str;
        run.end = entry.along + width;
      } else {
        flush();
        run = { item: entry.item, str: entry.item.str, along: entry.along, end: entry.along + width, size: entry.size };
      }
    }
    flush();
  }
  return out;
}

export async function extractPage(doc, page, options = {}) {
  const box = doc.pageBox(page);
  const rotation = doc.pageRotation(page);
  const { matrix, size } = pageBaseMatrix(box, rotation);
  const bytes = await doc.pageContent(page);
  const resources = doc.resolveShallow(page.dict.Resources ?? page.inherited.Resources) ?? Object.create(null);
  const interp = new ContentInterpreter(doc, options);
  const result = await interp.run(bytes, resources, matrix);
  return {
    width: size.width,
    height: size.height,
    rotation,
    paths: result.paths,
    texts: groupWords(result.texts),
    images: result.images,
    truncated: result.truncated,
  };
}
