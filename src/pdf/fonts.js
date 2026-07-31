// Just enough font handling to turn content-stream string bytes into text and to
// advance the text matrix. Room names are the prize here; exact glyph metrics
// are not, so widths fall back to sane defaults.

const WINANSI_HIGH = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

// Glyph names that matter for German plans and dimension text.
const GLYPH_NAMES = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24, percent: 0x25,
  ampersand: 0x26, quotesingle: 0x27, parenleft: 0x28, parenright: 0x29, asterisk: 0x2a,
  plus: 0x2b, comma: 0x2c, hyphen: 0x2d, period: 0x2e, slash: 0x2f, zero: 0x30, one: 0x31,
  two: 0x32, three: 0x33, four: 0x34, five: 0x35, six: 0x36, seven: 0x37, eight: 0x38,
  nine: 0x39, colon: 0x3a, semicolon: 0x3b, less: 0x3c, equal: 0x3d, greater: 0x3e,
  question: 0x3f, at: 0x40, bracketleft: 0x5b, backslash: 0x5c, bracketright: 0x5d,
  underscore: 0x5f, braceleft: 0x7b, bar: 0x7c, braceright: 0x7d, adieresis: 0xe4,
  odieresis: 0xf6, udieresis: 0xfc, Adieresis: 0xc4, Odieresis: 0xd6, Udieresis: 0xdc,
  germandbls: 0xdf, degree: 0xb0, twosuperior: 0xb2, threesuperior: 0xb3, periodcentered: 0xb7,
  endash: 0x2013, emdash: 0x2014, quotedblleft: 0x201c, quotedblright: 0x201d, minus: 0x2212,
};

function glyphNameToUnicode(name) {
  if (GLYPH_NAMES[name] !== undefined) return GLYPH_NAMES[name];
  if (/^[A-Za-z]$/.test(name)) return name.charCodeAt(0);
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return parseInt(m[1], 16);
  m = /^(?:g|cid|c|G)(\d+)$/.exec(name);
  if (m) return -1; // subset glyph id, no meaning without ToUnicode
  return -1;
}

function parseToUnicode(text) {
  const map = new Map();
  const hex = (s) => {
    const codes = [];
    for (let i = 0; i + 3 < s.length + 1 && i < s.length; i += 4) {
      codes.push(parseInt(s.substr(i, 4), 16));
    }
    return codes;
  };
  const toStr = (s) => {
    const clean = s.replace(/[^0-9A-Fa-f]/g, '');
    if (clean.length <= 4) return String.fromCharCode(parseInt(clean.padEnd(4, '0'), 16));
    return hex(clean).map((c) => String.fromCharCode(c)).join('');
  };

  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;
  while ((block = charRe.exec(text)) !== null) {
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair;
    while ((pair = pairRe.exec(block[1])) !== null) {
      map.set(parseInt(pair[1], 16), toStr(pair[2]));
    }
  }
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = rangeRe.exec(text)) !== null) {
    const body = block[1];
    const simpleRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = simpleRe.exec(body)) !== null) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const base = parseInt(m[3].slice(-4) || '0', 16);
      const prefix = m[3].length > 4 ? toStr(m[3]).slice(0, -1) : '';
      for (let c = lo; c <= hi && c - lo < 65536; c++) {
        map.set(c, prefix + String.fromCharCode(base + (c - lo)));
      }
    }
    const listRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while ((m = listRe.exec(body)) !== null) {
      const lo = parseInt(m[1], 16);
      const items = m[3].match(/<([0-9A-Fa-f]+)>/g) ?? [];
      items.forEach((item, i) => {
        map.set(lo + i, toStr(item.slice(1, -1)));
      });
    }
  }
  return map;
}

export class Font {
  constructor() {
    this.twoByte = false;
    this.toUnicode = null;
    this.encodingMap = null; // code -> unicode
    this.widths = null; // code -> width/1000
    this.defaultWidth = 0.5;
  }

  static async create(doc, dict) {
    const font = new Font();
    if (!dict || typeof dict !== 'object') return font;
    const subtype = doc.resolveShallow(dict.Subtype);
    let target = dict;

    if (subtype === 'Type0') {
      font.twoByte = true;
      const descendants = doc.resolveShallow(dict.DescendantFonts);
      const cid = Array.isArray(descendants) ? doc.resolveShallow(descendants[0]) : null;
      if (cid) {
        target = cid;
        font.defaultWidth = (doc.resolveShallow(cid.DW) ?? 1000) / 1000;
        const w = doc.resolveShallow(cid.W);
        if (Array.isArray(w)) {
          font.widths = new Map();
          for (let i = 0; i < w.length; ) {
            const first = doc.resolveShallow(w[i]);
            const next = doc.resolveShallow(w[i + 1]);
            if (Array.isArray(next)) {
              next.forEach((val, k) => font.widths.set(first + k, doc.resolveShallow(val) / 1000));
              i += 2;
            } else {
              const width = doc.resolveShallow(w[i + 2]) / 1000;
              for (let c = first; c <= next && c - first < 65536; c++) font.widths.set(c, width);
              i += 3;
            }
          }
        }
      }
      const enc = doc.resolveShallow(dict.Encoding);
      if (typeof enc === 'string' && /Identity/.test(enc)) font.twoByte = true;
    } else {
      const firstChar = doc.resolveShallow(dict.FirstChar) ?? 0;
      const widths = doc.resolveShallow(dict.Widths);
      if (Array.isArray(widths)) {
        font.widths = new Map();
        widths.forEach((val, i) => {
          const v = doc.resolveShallow(val);
          if (typeof v === 'number') font.widths.set(firstChar + i, v / 1000);
        });
      }
      const encoding = doc.resolveShallow(dict.Encoding);
      const map = new Map();
      if (encoding && typeof encoding === 'object') {
        const diffs = doc.resolveShallow(encoding.Differences);
        if (Array.isArray(diffs)) {
          let code = 0;
          for (const item of diffs) {
            const v = doc.resolveShallow(item);
            if (typeof v === 'number') code = v;
            else if (typeof v === 'string') {
              const uni = glyphNameToUnicode(v);
              if (uni >= 0) map.set(code, String.fromCharCode(uni));
              code++;
            }
          }
        }
      }
      if (map.size) font.encodingMap = map;
    }

    const descriptor = doc.resolveShallow(target.FontDescriptor);
    if (descriptor && font.defaultWidth === 0.5) {
      const missing = doc.resolveShallow(descriptor.MissingWidth);
      if (typeof missing === 'number' && missing > 0) font.defaultWidth = missing / 1000;
    }

    if (dict.ToUnicode) {
      try {
        const bytes = await doc.streamBytes(dict.ToUnicode);
        if (bytes) {
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          font.toUnicode = parseToUnicode(s);
        }
      } catch {
        /* labels degrade to raw codes */
      }
    }
    return font;
  }

  codes(bytes) {
    const out = [];
    if (this.twoByte) {
      for (let i = 0; i + 1 < bytes.length; i += 2) out.push((bytes[i] << 8) | bytes[i + 1]);
      if (bytes.length % 2) out.push(bytes[bytes.length - 1]);
    } else {
      for (const b of bytes) out.push(b);
    }
    return out;
  }

  charFor(code) {
    if (this.toUnicode?.has(code)) return this.toUnicode.get(code);
    if (this.encodingMap?.has(code)) return this.encodingMap.get(code);
    if (this.twoByte) return code >= 32 && code < 0xffff ? String.fromCharCode(code) : '';
    if (WINANSI_HIGH[code] !== undefined) return String.fromCharCode(WINANSI_HIGH[code]);
    if (code < 32) return '';
    return String.fromCharCode(code);
  }

  widthFor(code) {
    const w = this.widths?.get(code);
    return typeof w === 'number' ? w : this.defaultWidth;
  }
}
