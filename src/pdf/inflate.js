// Stream decoding built on platform APIs only: DecompressionStream for
// Flate/LZW-free deflate, hand-rolled decoders for the simple PDF filters.

async function runStream(bytes, format) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = ds.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// Some producers emit a truncated or slightly malformed final block. Retrying
// raw-deflate and then trimming leading garbage recovers most of them.
export async function inflate(bytes) {
  const attempts = [
    () => runStream(bytes, 'deflate'),
    () => runStream(bytes, 'deflate-raw'),
    () => runStream(bytes.subarray(1), 'deflate-raw'),
    () => runStream(bytes.subarray(2), 'deflate-raw'),
  ];
  let firstError = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError ?? new Error('inflate failed');
}

export function asciiHexDecode(bytes) {
  const out = [];
  let hi = -1;
  for (const b of bytes) {
    if (b === 0x3e) break; // '>'
    let v = -1;
    if (b >= 0x30 && b <= 0x39) v = b - 0x30;
    else if (b >= 0x41 && b <= 0x46) v = b - 0x37;
    else if (b >= 0x61 && b <= 0x66) v = b - 0x57;
    else continue;
    if (hi < 0) hi = v;
    else {
      out.push((hi << 4) | v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi << 4);
  return new Uint8Array(out);
}

export function ascii85Decode(bytes) {
  const out = [];
  let tuple = [];
  let i = 0;
  if (bytes[0] === 0x3c && bytes[1] === 0x7e) i = 2; // '<~'
  for (; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x7e) break; // '~>'
    if (b <= 0x20 || b === 0) continue;
    if (b === 0x7a && tuple.length === 0) { // 'z'
      out.push(0, 0, 0, 0);
      continue;
    }
    if (b < 0x21 || b > 0x75) continue;
    tuple.push(b - 0x21);
    if (tuple.length === 5) {
      let n = 0;
      for (const t of tuple) n = n * 85 + t;
      out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
      tuple = [];
    }
  }
  if (tuple.length > 1) {
    const count = tuple.length;
    while (tuple.length < 5) tuple.push(84);
    let n = 0;
    for (const t of tuple) n = n * 85 + t;
    const full = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    for (let k = 0; k < count - 1; k++) out.push(full[k]);
  }
  return new Uint8Array(out);
}

export function runLengthDecode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i++];
    if (len === 128) break;
    if (len < 128) {
      for (let k = 0; k <= len; k++) out.push(bytes[i++]);
    } else {
      const b = bytes[i++];
      for (let k = 0; k < 257 - len; k++) out.push(b);
    }
  }
  return new Uint8Array(out);
}

export function lzwDecode(bytes, earlyChange = 1) {
  const out = [];
  const dict = [];
  const reset = () => {
    dict.length = 0;
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push(null, null); // 256 clear, 257 eod
  };
  reset();
  let codeLen = 9;
  let prev = null;
  let bitBuf = 0;
  let bitCount = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i < bytes.length) {
      bitBuf = (bitBuf << 8) | bytes[i];
      bitCount += 8;
    } else if (bitCount < codeLen) break;
    while (bitCount >= codeLen) {
      const code = (bitBuf >> (bitCount - codeLen)) & ((1 << codeLen) - 1);
      bitCount -= codeLen;
      if (code === 256) {
        reset();
        codeLen = 9;
        prev = null;
        continue;
      }
      if (code === 257) return new Uint8Array(out);
      let entry;
      if (code < dict.length && dict[code]) {
        entry = dict[code];
      } else if (prev) {
        entry = prev.concat(prev[0]);
      } else {
        return new Uint8Array(out);
      }
      out.push(...entry);
      if (prev) dict.push(prev.concat(entry[0]));
      prev = entry;
      const limit = dict.length + earlyChange;
      if (limit >= 512 && codeLen === 9) codeLen = 10;
      else if (limit >= 1024 && codeLen === 10) codeLen = 11;
      else if (limit >= 2048 && codeLen === 11) codeLen = 12;
    }
  }
  return new Uint8Array(out);
}

// PNG and TIFF predictors, used by xref streams and by some content streams.
export function applyPredictor(data, params) {
  const predictor = params.predictor ?? 1;
  if (predictor <= 1) return data;
  const colors = params.colors ?? 1;
  const bpc = params.bitsPerComponent ?? 8;
  const columns = params.columns ?? 1;
  const bpp = Math.ceil((colors * bpc) / 8);
  const rowLen = Math.ceil((colors * bpc * columns) / 8);

  if (predictor === 2) {
    if (bpc !== 8) return data;
    for (let r = 0; r + rowLen <= data.length; r += rowLen) {
      for (let i = bpp; i < rowLen; i++) {
        data[r + i] = (data[r + i] + data[r + i - bpp]) & 0xff;
      }
    }
    return data;
  }

  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prevRow = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const src = r * (rowLen + 1);
    const type = data[src];
    const row = data.subarray(src + 1, src + 1 + rowLen);
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const raw = row[i];
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prevRow[i];
      const upLeft = i >= bpp ? prevRow[i - bpp] : 0;
      let value;
      switch (type) {
        case 0: value = raw; break;
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: value = raw;
      }
      cur[i] = value & 0xff;
    }
    out.set(cur, r * rowLen);
    prevRow = cur;
  }
  return out;
}
