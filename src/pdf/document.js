// Cross-reference parsing, object access and stream decoding.
//
// Object access is synchronous: the loader resolves the xref, eagerly expands
// every object stream, and repairs broken tables by scanning the file for
// "N G obj" headers. Stream data stays asynchronous because inflation does.

import { Lexer, ObjectParser, PdfStream, PdfString, Ref } from './lexer.js';
import { inflate, applyPredictor, asciiHexDecode, ascii85Decode, runLengthDecode, lzwDecode } from './inflate.js';
import { Decryptor, UnsupportedEncryption } from './crypt.js';

function latin1(bytes) {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

export class PdfDocument {
  constructor(bytes) {
    this.bytes = bytes;
    this.text = latin1(bytes);
    this.xref = new Map(); // num -> {offset} | {stm, idx}
    this.cache = new Map(); // num -> value
    this.scanMap = null;
    this.trailer = Object.create(null);
    this.decryptor = null;
    this.warnings = [];
  }

  static async load(bytes) {
    const doc = new PdfDocument(bytes);
    await doc.init();
    return doc;
  }

  async init() {
    this.sections = [];
    try {
      this.readXrefChain();
    } catch (err) {
      this.warnings.push(`Cross-reference table unreadable (${err.message}); scanned the file instead.`);
    }
    await this.applySections();
    if (!this.trailer.Root || this.xref.size === 0) {
      this.repair();
    }
    if (this.trailer.Encrypt) {
      const enc = this.resolveShallow(this.trailer.Encrypt);
      const id = this.trailer.ID;
      const idFirst = Array.isArray(id) && id[0] instanceof PdfString ? id[0].bytes : null;
      this.decryptor = new Decryptor(enc, idFirst);
      this.encryptRef = this.trailer.Encrypt instanceof Ref ? this.trailer.Encrypt.num : -1;
    }
    await this.loadObjectStreams();
    if (!this.getCatalog()) {
      this.repair();
      await this.loadObjectStreams();
    }
  }

  // ---- cross-reference -------------------------------------------------

  readXrefChain() {
    const idx = this.text.lastIndexOf('startxref');
    if (idx < 0) throw new Error('no startxref');
    const lexer = new Lexer(this.bytes, idx + 9);
    const token = lexer.readToken();
    if (!token || token.kind !== 'number') throw new Error('bad startxref');
    const seen = new Set();
    let offset = token.value;
    while (offset !== undefined && offset !== null && !seen.has(offset)) {
      seen.add(offset);
      const trailer = this.readXrefSection(offset);
      if (!trailer) break;
      for (const key of ['Root', 'Info', 'Encrypt', 'ID']) {
        if (this.trailer[key] === undefined && trailer[key] !== undefined) {
          this.trailer[key] = trailer[key];
        }
      }
      if (trailer.XRefStm !== undefined && !seen.has(trailer.XRefStm)) {
        seen.add(trailer.XRefStm);
        try {
          this.readXrefSection(trailer.XRefStm);
        } catch {
          /* hybrid stream optional */
        }
      }
      offset = trailer.Prev;
    }
  }

  readXrefSection(offset) {
    if (!Number.isFinite(offset) || offset < 0 || offset >= this.bytes.length) return null;
    const lexer = new Lexer(this.bytes, offset);
    lexer.skipWhite();
    if (this.text.startsWith('xref', lexer.pos)) {
      return this.readXrefTable(lexer.pos + 4);
    }
    return this.readXrefStreamAt(offset);
  }

  readXrefTable(pos) {
    const parser = new ObjectParser(this.bytes, pos);
    const entries = [];
    this.sections.push({ kind: 'table', entries });
    for (;;) {
      parser.lexer.skipWhite();
      if (this.text.startsWith('trailer', parser.lexer.pos)) {
        parser.lexer.pos += 7;
        const trailer = parser.parse();
        return trailer && typeof trailer === 'object' ? trailer : Object.create(null);
      }
      const start = parser.next();
      if (!start || start.kind !== 'number') return Object.create(null);
      const count = parser.next();
      if (!count || count.kind !== 'number') return Object.create(null);
      for (let i = 0; i < count.value; i++) {
        const a = parser.next();
        const b = parser.next();
        const type = parser.next();
        if (!a || !b || !type) return Object.create(null);
        if (type.kind === 'keyword' && type.value === 'n') {
          entries.push([start.value + i, a.value]);
        }
      }
    }
  }

  readXrefStreamAt(offset) {
    const parsed = this.parseIndirectAt(offset);
    if (!parsed || !(parsed.value instanceof PdfStream)) return null;
    // Decoding needs inflation, so the section is queued and applied in chain
    // order once the whole chain has been walked.
    this.sections.push({ kind: 'stream', stream: parsed.value, num: parsed.num, gen: parsed.gen });
    return parsed.value.dict;
  }

  // Sections are applied newest first; the first writer of an object number wins,
  // which is what an incrementally updated file requires.
  async applySections() {
    for (const section of this.sections) {
      if (section.kind === 'table') {
        for (const [num, offset] of section.entries) {
          if (!this.xref.has(num)) this.xref.set(num, { offset });
        }
        continue;
      }
      try {
        const data = await this.decodeStream(section.stream, -1, -1);
        if (data instanceof Uint8Array) this.consumeXrefStream(section.stream.dict, data);
      } catch (err) {
        this.warnings.push(`An xref stream failed to decode (${err.message}).`);
      }
    }
  }

  consumeXrefStream(dict, data) {
    const w = (dict.W ?? []).map((v) => this.resolveShallow(v));
    if (w.length < 3) return;
    const size = this.resolveShallow(dict.Size) ?? 0;
    let index = this.resolveShallow(dict.Index) ?? [0, size];
    index = index.map((v) => this.resolveShallow(v));
    const rowLen = w.reduce((a, b) => a + b, 0);
    if (rowLen === 0) return;
    let at = 0;
    const readField = (width) => {
      if (width === 0) return null;
      let v = 0;
      for (let i = 0; i < width; i++) v = v * 256 + data[at++];
      return v;
    };
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s];
      const count = index[s + 1];
      for (let i = 0; i < count; i++) {
        if (at + rowLen > data.length) return;
        const type = readField(w[0]) ?? 1;
        const f2 = readField(w[1]) ?? 0;
        const f3 = readField(w[2]) ?? 0;
        const num = first + i;
        if (this.xref.has(num)) continue;
        if (type === 1) this.xref.set(num, { offset: f2 });
        else if (type === 2) this.xref.set(num, { stm: f2, idx: f3 });
      }
    }
  }

  repair() {
    this.buildScanMap();
    for (const [num, offset] of this.scanMap) {
      this.xref.set(num, { offset });
    }
    this.cache.clear();
    if (!this.trailer.Root) {
      const trailerIdx = this.text.lastIndexOf('trailer');
      if (trailerIdx >= 0) {
        const parser = new ObjectParser(this.bytes, trailerIdx + 7);
        const trailer = parser.parse();
        if (trailer && typeof trailer === 'object') {
          for (const key of ['Root', 'Info', 'Encrypt', 'ID']) {
            if (this.trailer[key] === undefined && trailer[key] !== undefined) {
              this.trailer[key] = trailer[key];
            }
          }
        }
      }
    }
    if (!this.trailer.Root) {
      // Find the catalog directly.
      for (const [num] of this.scanMap) {
        const obj = this.getObject(num);
        if (obj && typeof obj === 'object' && obj.Type === 'Catalog') {
          this.trailer.Root = new Ref(num, 0);
          break;
        }
      }
    }
  }

  buildScanMap() {
    if (this.scanMap) return this.scanMap;
    const map = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = re.exec(this.text)) !== null) {
      map.set(parseInt(m[1], 10), m.index);
    }
    this.scanMap = map;
    return map;
  }

  async loadObjectStreams() {
    const streamNums = new Set();
    for (const entry of this.xref.values()) {
      if (entry.stm !== undefined) streamNums.add(entry.stm);
    }
    this.objStmCache = new Map();
    for (const num of streamNums) {
      try {
        await this.expandObjectStream(num);
      } catch (err) {
        this.warnings.push(`Object stream ${num} failed to decode (${err.message}).`);
      }
    }
  }

  async expandObjectStream(num) {
    const stream = this.getObject(num);
    if (!(stream instanceof PdfStream)) return;
    const data = await this.decodeStream(stream, num, 0);
    const n = this.resolveShallow(stream.dict.N) ?? 0;
    const first = this.resolveShallow(stream.dict.First) ?? 0;
    const header = new ObjectParser(data, 0);
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const a = header.next();
      const b = header.next();
      if (!a || !b || a.kind !== 'number' || b.kind !== 'number') break;
      pairs.push([a.value, b.value]);
    }
    for (const [objNum, rel] of pairs) {
      const entry = this.xref.get(objNum);
      if (!entry || entry.stm !== num) {
        if (this.cache.has(objNum)) continue;
      }
      const parser = new ObjectParser(data, first + rel);
      const value = parser.parse();
      this.cache.set(objNum, value === undefined ? null : value);
    }
  }

  // ---- object access ---------------------------------------------------

  parseIndirectAt(offset, expectNum) {
    if (!Number.isFinite(offset) || offset < 0 || offset >= this.bytes.length) return null;
    const parser = new ObjectParser(this.bytes, offset);
    const t1 = parser.next();
    const t2 = parser.next();
    const t3 = parser.next();
    if (!t1 || !t2 || !t3) return null;
    if (t1.kind !== 'number' || t3.kind !== 'keyword' || t3.value !== 'obj') return null;
    if (expectNum !== undefined && t1.value !== expectNum) return null;
    const num = t1.value;
    const gen = t2.kind === 'number' ? t2.value : 0;
    let value = parser.parse();
    // stream?
    parser.lexer.skipWhite();
    if (this.text.startsWith('stream', parser.lexer.pos) && value && typeof value === 'object') {
      let p = parser.lexer.pos + 6;
      if (this.bytes[p] === 0x0d) p++;
      if (this.bytes[p] === 0x0a) p++;
      const declared = this.resolveShallow(value.Length);
      let end = -1;
      if (Number.isFinite(declared) && declared >= 0 && p + declared <= this.bytes.length) {
        const after = this.text.slice(p + declared, p + declared + 20);
        if (/^\s*endstream/.test(after)) end = p + declared;
      }
      if (end < 0) {
        const found = this.text.indexOf('endstream', p);
        end = found < 0 ? this.bytes.length : found;
        while (end > p && (this.bytes[end - 1] === 0x0a || this.bytes[end - 1] === 0x0d)) end--;
      }
      value = new PdfStream(value, this.bytes.subarray(p, end));
    }
    return { num, gen, value };
  }

  getObject(num) {
    if (this.cache.has(num)) return this.cache.get(num);
    this.cache.set(num, null); // cycle guard
    const entry = this.xref.get(num);
    let parsed = null;
    if (entry && entry.offset !== undefined) {
      parsed = this.parseIndirectAt(entry.offset, num) ?? this.parseIndirectAt(entry.offset);
    }
    if (!parsed) {
      const scan = this.buildScanMap();
      if (scan.has(num)) parsed = this.parseIndirectAt(scan.get(num), num);
    }
    const value = parsed ? parsed.value : null;
    this.cache.set(num, value);
    if (parsed) this.genOf ??= new Map(), this.genOf.set(num, parsed.gen);
    return value;
  }

  resolveShallow(value) {
    let v = value;
    let guard = 0;
    while (v instanceof Ref && guard++ < 32) v = this.getObject(v.num);
    return v;
  }

  resolve(value) {
    return this.resolveShallow(value);
  }

  dictGet(dict, ...keys) {
    if (!dict) return undefined;
    for (const key of keys) {
      const v = this.resolveShallow(dict[key]);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  // ---- streams ---------------------------------------------------------

  async decodeStream(stream, num, gen) {
    let data = stream.raw;
    if (this.decryptor && num >= 0 && num !== this.encryptRef && stream.dict.Type !== 'XRef') {
      data = await this.decryptor.decrypt(data, num, gen ?? 0);
    }
    const filters = [].concat(this.resolveShallow(stream.dict.Filter) ?? []).map((f) => this.resolveShallow(f));
    const paramsList = [].concat(this.resolveShallow(stream.dict.DecodeParms) ?? []);
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const parms = this.resolveShallow(paramsList[i]) ?? (filters.length === 1 ? this.resolveShallow(paramsList[0]) : null);
      switch (filter) {
        case 'FlateDecode':
        case 'Fl':
          data = await inflate(data);
          break;
        case 'LZWDecode':
        case 'LZW':
          data = lzwDecode(data, this.resolveShallow(parms?.EarlyChange) ?? 1);
          break;
        case 'ASCIIHexDecode':
        case 'AHx':
          data = asciiHexDecode(data);
          break;
        case 'ASCII85Decode':
        case 'A85':
          data = ascii85Decode(data);
          break;
        case 'RunLengthDecode':
        case 'RL':
          data = runLengthDecode(data);
          break;
        case 'DCTDecode':
        case 'JPXDecode':
        case 'CCITTFaxDecode':
        case 'JBIG2Decode':
          return { image: true, filter, data };
        default:
          break;
      }
      if (parms && typeof parms === 'object' && parms.Predictor) {
        data = applyPredictor(data, {
          predictor: this.resolveShallow(parms.Predictor),
          colors: this.resolveShallow(parms.Colors),
          bitsPerComponent: this.resolveShallow(parms.BitsPerComponent),
          columns: this.resolveShallow(parms.Columns),
        });
      }
    }
    return data;
  }

  async streamBytes(refOrStream) {
    let num = -1;
    let gen = 0;
    let stream = refOrStream;
    if (refOrStream instanceof Ref) {
      num = refOrStream.num;
      stream = this.getObject(num);
      gen = this.genOf?.get(num) ?? 0;
    }
    if (!(stream instanceof PdfStream)) return null;
    const out = await this.decodeStream(stream, num, gen);
    return out instanceof Uint8Array ? out : null;
  }

  // ---- page tree -------------------------------------------------------

  getCatalog() {
    const root = this.resolveShallow(this.trailer.Root);
    return root && typeof root === 'object' && !(root instanceof PdfStream) ? root : null;
  }

  getPages() {
    if (this.pages) return this.pages;
    const pages = [];
    const catalog = this.getCatalog();
    const inheritable = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
    const visit = (nodeRef, inherited, depth, seen) => {
      const node = this.resolveShallow(nodeRef);
      if (!node || typeof node !== 'object' || depth > 64) return;
      const key = nodeRef instanceof Ref ? nodeRef.key : null;
      if (key) {
        if (seen.has(key)) return;
        seen.add(key);
      }
      const next = { ...inherited };
      for (const attr of inheritable) {
        if (node[attr] !== undefined) next[attr] = node[attr];
      }
      const kids = this.resolveShallow(node.Kids);
      if (Array.isArray(kids)) {
        for (const kid of kids) visit(kid, next, depth + 1, seen);
        return;
      }
      if (node.Type === 'Page' || node.Contents !== undefined || node.MediaBox !== undefined) {
        pages.push({ dict: node, inherited: next, ref: nodeRef });
      }
    };
    const rootPages = catalog ? catalog.Pages : null;
    if (rootPages) visit(rootPages, {}, 0, new Set());
    if (pages.length === 0) {
      // Repair path: any object typed /Page.
      for (const [num] of this.buildScanMap()) {
        const obj = this.getObject(num);
        if (obj && typeof obj === 'object' && obj.Type === 'Page') {
          pages.push({ dict: obj, inherited: {}, ref: new Ref(num, 0) });
        }
      }
    }
    this.pages = pages;
    return pages;
  }

  pageBox(page) {
    const raw = this.resolveShallow(page.dict.MediaBox ?? page.inherited.MediaBox);
    const box = Array.isArray(raw) ? raw.map((v) => this.resolveShallow(v)) : [0, 0, 595.276, 841.89];
    const x0 = Math.min(box[0], box[2]);
    const y0 = Math.min(box[1], box[3]);
    const x1 = Math.max(box[0], box[2]);
    const y1 = Math.max(box[1], box[3]);
    return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
  }

  pageRotation(page) {
    const r = this.resolveShallow(page.dict.Rotate ?? page.inherited.Rotate) ?? 0;
    return ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  }

  async pageContent(page) {
    const contents = page.dict.Contents;
    const parts = [];
    const list = Array.isArray(this.resolveShallow(contents)) ? this.resolveShallow(contents) : [contents];
    for (const item of list) {
      if (item === undefined || item === null) continue;
      const bytes = await this.streamBytes(item);
      if (bytes) parts.push(bytes);
    }
    if (parts.length === 0) return new Uint8Array(0);
    let total = parts.length - 1;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], at);
      at += parts[i].length;
      if (i < parts.length - 1) out[at++] = 0x0a;
    }
    return out;
  }
}

export { UnsupportedEncryption };
