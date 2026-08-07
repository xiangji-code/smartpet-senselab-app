const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i] ?? 0;
    const b2 = bytes[i + 1] ?? 0;
    const b3 = bytes[i + 2] ?? 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    out += BASE64_ALPHABET[(triplet >> 18) & 63];
    out += BASE64_ALPHABET[(triplet >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triplet >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triplet & 63] : '=';
  }
  return out;
}

export function base64ToBytes(value: string | null | undefined): Uint8Array {
  if (!value) return new Uint8Array();
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_ALPHABET.indexOf(clean[i]);
    const c2 = BASE64_ALPHABET.indexOf(clean[i + 1]);
    const c3 = clean[i + 2] === '=' ? -1 : BASE64_ALPHABET.indexOf(clean[i + 2]);
    const c4 = clean[i + 3] === '=' ? -1 : BASE64_ALPHABET.indexOf(clean[i + 3]);
    if (c1 < 0 || c2 < 0) continue;

    const triplet = (c1 << 18) | (c2 << 12) | ((c3 > -1 ? c3 : 0) << 6) | (c4 > -1 ? c4 : 0);
    bytes.push((triplet >> 16) & 255);
    if (c3 > -1) bytes.push((triplet >> 8) & 255);
    if (c4 > -1) bytes.push(triplet & 255);
  }

  return new Uint8Array(bytes);
}

export function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

export function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

export function writeU16le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >> 8) & 255;
}

