// Standard security handler, empty user password only. Architects' PDFs are
// often "protected" against editing while staying open for reading, and those
// files decrypt with the empty password. Revisions 2 to 4 (RC4 and AES-128) are
// supported; AES-256 files report a clear message instead of failing quietly.

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function md5(input) {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const len = input.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(input);
  withPad[len] = 0x80;
  const bitLen = len * 8;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 8, bitLen >>> 0, true);
  view.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let chunk = 0; chunk < withPad.length; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getInt32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  new DataView(out.buffer).setInt32(0, a0, true);
  new DataView(out.buffer).setInt32(4, b0, true);
  new DataView(out.buffer).setInt32(8, c0, true);
  new DataView(out.buffer).setInt32(12, d0, true);
  return out;
}

function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function concat(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export class UnsupportedEncryption extends Error {}

export class Decryptor {
  constructor(encryptDict, idFirst) {
    const filter = encryptDict.Filter;
    if (filter !== 'Standard') {
      throw new UnsupportedEncryption(
        `This PDF uses the "${filter}" security handler, which this tool cannot read.`
      );
    }
    const v = encryptDict.V ?? 0;
    const r = encryptDict.R ?? 2;
    if (r >= 5) {
      throw new UnsupportedEncryption(
        'This PDF uses AES-256 encryption. Re-save it without protection first — ' +
          'in Preview, choose File › Print › Save as PDF — then upload that copy.'
      );
    }
    this.revision = r;
    this.version = v;
    const lengthBits = encryptDict.Length ?? 40;
    this.keyLength = Math.floor(lengthBits / 8) || 5;
    this.method = 'RC4';

    if (v >= 4) {
      const cfName = encryptDict.StmF ?? 'Identity';
      const cf = encryptDict.CF?.[cfName];
      if (cfName === 'Identity') {
        this.method = 'Identity';
      } else if (cf) {
        const cfm = cf.CFM;
        if (cfm === 'AESV2') {
          this.method = 'AES';
          this.keyLength = 16;
        } else if (cfm === 'V2') {
          this.method = 'RC4';
          if (cf.Length) this.keyLength = cf.Length > 40 ? Math.floor(cf.Length / 8) : cf.Length;
        } else if (cfm === 'None') {
          this.method = 'Identity';
        } else {
          throw new UnsupportedEncryption(`Unsupported crypt filter "${cfm}".`);
        }
      }
    }

    const o = encryptDict.O?.bytes ?? new Uint8Array(32);
    const p = encryptDict.P ?? -1;
    const pBytes = new Uint8Array(4);
    new DataView(pBytes.buffer).setInt32(0, p | 0, true);
    const id = idFirst ?? new Uint8Array(0);

    let input = concat(PAD, o.subarray(0, 32), pBytes, id);
    if (r >= 4 && encryptDict.EncryptMetadata === false) {
      input = concat(input, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    }
    let key = md5(input).subarray(0, r === 2 ? 5 : this.keyLength);
    if (r >= 3) {
      for (let i = 0; i < 50; i++) key = md5(key.subarray(0, this.keyLength)).subarray(0, this.keyLength);
    }
    this.key = key;
  }

  objectKey(num, gen) {
    const extra = new Uint8Array([
      num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff,
      gen & 0xff, (gen >> 8) & 0xff,
    ]);
    let input = concat(this.key, extra);
    if (this.method === 'AES') {
      input = concat(input, new Uint8Array([0x73, 0x41, 0x6c, 0x54]));
    }
    const n = Math.min(this.key.length + 5, 16);
    return md5(input).subarray(0, n);
  }

  async decrypt(bytes, num, gen) {
    if (this.method === 'Identity') return bytes;
    const key = this.objectKey(num, gen);
    if (this.method === 'RC4') return rc4(key, bytes);
    if (bytes.length <= 16) return new Uint8Array(0);
    const iv = bytes.subarray(0, 16);
    const body = bytes.subarray(16);
    const usable = body.length - (body.length % 16);
    if (usable === 0) return new Uint8Array(0);
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, [
      'decrypt',
    ]);
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv },
        cryptoKey,
        body.subarray(0, usable)
      );
      return new Uint8Array(plain);
    } catch {
      // Padding damaged; recover everything but the final block.
      if (usable <= 16) return new Uint8Array(0);
      const plain = await crypto.subtle
        .decrypt({ name: 'AES-CBC', iv }, cryptoKey, body.subarray(0, usable - 16))
        .catch(() => null);
      return plain ? new Uint8Array(plain) : new Uint8Array(0);
    }
  }
}
