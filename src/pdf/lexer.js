// PDF object syntax reader. Names become plain strings ("Page"), strings become
// PdfString wrappers so they never collide with names, dictionaries become plain
// objects, indirect references become Ref.

export class Ref {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
  get key() {
    return `${this.num}R${this.gen}`;
  }
}

export class PdfString {
  constructor(bytes) {
    this.bytes = bytes;
  }
  // PDF text strings are either UTF-16BE with a BOM or PDFDocEncoded.
  toText() {
    const b = this.bytes;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      let s = '';
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return s;
    }
    let s = '';
    for (const c of b) s += String.fromCharCode(c);
    return s;
  }
}

export class PdfStream {
  constructor(dict, raw) {
    this.dict = dict;
    this.raw = raw;
  }
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function isWhite(b) {
  return WHITESPACE.has(b);
}
export function isDelim(b) {
  return DELIMITER.has(b);
}
export function isRegular(b) {
  return b !== undefined && !WHITESPACE.has(b) && !DELIMITER.has(b);
}

export class Lexer {
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  skipWhite() {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WHITESPACE.has(c)) {
        this.pos++;
      } else if (c === 0x25) {
        // comment to end of line
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else {
        return;
      }
    }
  }

  peekByte() {
    return this.bytes[this.pos];
  }

  readToken() {
    this.skipWhite();
    const b = this.bytes;
    if (this.pos >= b.length) return null;
    const c = b[this.pos];
    if (c === 0x2f) return { kind: 'name', value: this.readName() };
    if (c === 0x28) return { kind: 'string', value: this.readLiteralString() };
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { kind: 'dictOpen' };
      }
      return { kind: 'string', value: this.readHexString() };
    }
    if (c === 0x3e && b[this.pos + 1] === 0x3e) {
      this.pos += 2;
      return { kind: 'dictClose' };
    }
    if (c === 0x5b) {
      this.pos++;
      return { kind: 'arrayOpen' };
    }
    if (c === 0x5d) {
      this.pos++;
      return { kind: 'arrayClose' };
    }
    if (c === 0x7b) {
      this.pos++;
      return { kind: 'procOpen' };
    }
    if (c === 0x7d) {
      this.pos++;
      return { kind: 'procClose' };
    }
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const start = this.pos;
      const num = this.readNumber();
      if (num === null) {
        this.pos = start + 1;
        return { kind: 'junk' };
      }
      return { kind: 'number', value: num };
    }
    const word = this.readKeyword();
    if (!word) {
      this.pos++;
      return { kind: 'junk' };
    }
    return { kind: 'keyword', value: word };
  }

  readNumber() {
    const b = this.bytes;
    const start = this.pos;
    let s = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      s += String.fromCharCode(b[this.pos]);
      this.pos++;
    }
    // Tolerate forms real producers emit: "--5", "4.", ".5", "6.-1"
    const cleaned = s.replace(/(?!^)-.*$/, '').replace(/^--+/, '-');
    const v = parseFloat(cleaned);
    if (Number.isNaN(v)) {
      this.pos = start;
      return null;
    }
    return v;
  }

  readKeyword() {
    const b = this.bytes;
    let s = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      s += String.fromCharCode(b[this.pos]);
      this.pos++;
    }
    return s;
  }

  readName() {
    const b = this.bytes;
    this.pos++; // '/'
    let s = '';
    while (this.pos < b.length && isRegular(b[this.pos])) {
      let c = b[this.pos];
      if (c === 0x23 && this.pos + 2 < b.length) {
        const hex = String.fromCharCode(b[this.pos + 1], b[this.pos + 2]);
        const v = parseInt(hex, 16);
        if (!Number.isNaN(v)) {
          s += String.fromCharCode(v);
          this.pos += 3;
          continue;
        }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return s;
  }

  readLiteralString() {
    const b = this.bytes;
    this.pos++; // '('
    const out = [];
    let depth = 1;
    while (this.pos < b.length) {
      let c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        switch (e) {
          case 0x6e: out.push(0x0a); break;
          case 0x72: out.push(0x0d); break;
          case 0x74: out.push(0x09); break;
          case 0x62: out.push(0x08); break;
          case 0x66: out.push(0x0c); break;
          case 0x0a: break;
          case 0x0d: if (b[this.pos] === 0x0a) this.pos++; break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let oct = e - 0x30;
              for (let k = 0; k < 2; k++) {
                const n = b[this.pos];
                if (n >= 0x30 && n <= 0x37) {
                  oct = oct * 8 + (n - 0x30);
                  this.pos++;
                } else break;
              }
              out.push(oct & 0xff);
            } else {
              out.push(e);
            }
        }
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(c);
    }
    return new PdfString(new Uint8Array(out));
  }

  readHexString() {
    const b = this.bytes;
    this.pos++; // '<'
    const out = [];
    let hi = -1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x3e) break;
      let v = -1;
      if (c >= 0x30 && c <= 0x39) v = c - 0x30;
      else if (c >= 0x41 && c <= 0x46) v = c - 0x37;
      else if (c >= 0x61 && c <= 0x66) v = c - 0x57;
      else continue;
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    return new PdfString(new Uint8Array(out));
  }
}

// Parses a full object, resolving the "num gen R" and "num gen obj" patterns
// that only reveal themselves after reading ahead.
export class ObjectParser {
  constructor(bytes, pos = 0) {
    this.lexer = new Lexer(bytes, pos);
    this.buffer = [];
  }

  get pos() {
    return this.lexer.pos;
  }
  set pos(v) {
    this.lexer.pos = v;
    this.buffer.length = 0;
  }

  next() {
    return this.buffer.length ? this.buffer.shift() : this.lexer.readToken();
  }

  push(token) {
    this.buffer.unshift(token);
  }

  parse() {
    const token = this.next();
    return this.parseFrom(token);
  }

  parseFrom(token) {
    if (token === null) return undefined;
    switch (token.kind) {
      case 'number': {
        // Look for "int int R"
        if (Number.isInteger(token.value) && token.value >= 0) {
          const save = this.lexer.pos;
          const savedBuffer = this.buffer.slice();
          const t2 = this.next();
          if (t2 && t2.kind === 'number' && Number.isInteger(t2.value)) {
            const t3 = this.next();
            if (t3 && t3.kind === 'keyword' && t3.value === 'R') {
              return new Ref(token.value, t2.value);
            }
          }
          this.lexer.pos = save;
          this.buffer = savedBuffer;
        }
        return token.value;
      }
      case 'name':
        return token.value;
      case 'string':
        return token.value;
      case 'arrayOpen': {
        const arr = [];
        for (;;) {
          const t = this.next();
          if (t === null || t.kind === 'arrayClose') break;
          if (t.kind === 'dictClose') break;
          const v = this.parseFrom(t);
          if (v !== undefined) arr.push(v);
        }
        return arr;
      }
      case 'dictOpen': {
        const dict = Object.create(null);
        for (;;) {
          const t = this.next();
          if (t === null || t.kind === 'dictClose') break;
          if (t.kind !== 'name') {
            if (t.kind === 'arrayClose' || t.kind === 'junk') continue;
            this.parseFrom(t);
            continue;
          }
          const value = this.parse();
          dict[t.value] = value;
        }
        return dict;
      }
      case 'keyword':
        if (token.value === 'true') return true;
        if (token.value === 'false') return false;
        if (token.value === 'null') return null;
        return { keyword: token.value };
      default:
        return undefined;
    }
  }
}
