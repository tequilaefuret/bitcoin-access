const MAX_CBOR_DEPTH = 32;
const MAX_CBOR_BYTES = 1024 * 1024;

export class IncompleteCborError extends Error {}

const concatBytes = (parts) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
};

const encodeLength = (major, value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('CBOR integer is outside the supported range.');
  const prefix = major << 5;
  if (value < 24) return Uint8Array.of(prefix | value);
  if (value <= 0xff) return Uint8Array.of(prefix | 24, value);
  if (value <= 0xffff) return Uint8Array.of(prefix | 25, value >> 8, value & 0xff);
  if (value <= 0xffffffff) {
    return Uint8Array.of(prefix | 26, value >>> 24, value >>> 16, value >>> 8, value);
  }
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  return Uint8Array.of(
    prefix | 27,
    high >>> 24, high >>> 16, high >>> 8, high,
    low >>> 24, low >>> 16, low >>> 8, low,
  );
};

const encodeItem = (value, depth) => {
  if (depth > MAX_CBOR_DEPTH) throw new Error('CBOR value is nested too deeply.');
  if (value === null) return Uint8Array.of(0xf6);
  if (value === false) return Uint8Array.of(0xf4);
  if (value === true) return Uint8Array.of(0xf5);
  if (Number.isSafeInteger(value)) {
    return value >= 0 ? encodeLength(0, value) : encodeLength(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concatBytes([encodeLength(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) {
    return concatBytes([encodeLength(2, value.length), value]);
  }
  if (Array.isArray(value)) {
    return concatBytes([encodeLength(4, value.length), ...value.map((item) => encodeItem(item, depth + 1))]);
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value);
    const parts = [encodeLength(5, keys.length)];
    keys.forEach((key) => parts.push(encodeItem(key, depth + 1), encodeItem(value[key], depth + 1)));
    return concatBytes(parts);
  }
  throw new Error('Unsupported value in Jade CBOR request.');
};

export const encodeJadeCbor = (value) => {
  const encoded = encodeItem(value, 0);
  if (encoded.length > MAX_CBOR_BYTES) throw new Error('Jade CBOR request is too large.');
  return encoded;
};

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  require(length) {
    if (this.offset + length > this.bytes.length) throw new IncompleteCborError('Incomplete CBOR value.');
  }

  byte() {
    this.require(1);
    return this.bytes[this.offset++];
  }

  uint(length) {
    this.require(length);
    let value = 0;
    for (let index = 0; index < length; index += 1) value = (value * 256) + this.bytes[this.offset++];
    if (!Number.isSafeInteger(value)) throw new Error('CBOR integer exceeds the safe JavaScript range.');
    return value;
  }

  length(additional) {
    if (additional < 24) return additional;
    if (additional === 24) return this.uint(1);
    if (additional === 25) return this.uint(2);
    if (additional === 26) return this.uint(4);
    if (additional === 27) return this.uint(8);
    if (additional === 31) return -1;
    throw new Error('Unsupported CBOR length encoding.');
  }

  chunk(length) {
    this.require(length);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  item(depth = 0) {
    if (depth > MAX_CBOR_DEPTH) throw new Error('CBOR value is nested too deeply.');
    const first = this.byte();
    if (first === 0xff) return Reader.BREAK;
    const major = first >> 5;
    const additional = first & 31;
    const length = this.length(additional);

    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2 || major === 3) {
      if (length < 0) throw new Error('Indefinite strings are not supported in Jade replies.');
      const chunk = this.chunk(length);
      if (major === 2) return chunk;
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(chunk);
      } catch {
        throw new Error('Jade returned invalid UTF-8 text.');
      }
    }
    if (major === 4) {
      const values = [];
      if (length < 0) {
        while (true) {
          const value = this.item(depth + 1);
          if (value === Reader.BREAK) break;
          values.push(value);
        }
      } else {
        for (let index = 0; index < length; index += 1) values.push(this.item(depth + 1));
      }
      return values;
    }
    if (major === 5) {
      const value = {};
      const readPair = () => {
        const key = this.item(depth + 1);
        if (key === Reader.BREAK) return false;
        if (typeof key !== 'string') throw new Error('Jade CBOR map keys must be text.');
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Jade returned an unsafe CBOR map key.');
        if (Object.prototype.hasOwnProperty.call(value, key)) throw new Error('Jade returned a duplicate CBOR map key.');
        const item = this.item(depth + 1);
        if (item === Reader.BREAK) throw new Error('Jade returned an incomplete CBOR map.');
        value[key] = item;
        return true;
      };
      if (length < 0) while (readPair()) {} // eslint-disable-line no-empty
      else for (let index = 0; index < length; index += 1) readPair();
      return value;
    }
    if (major === 6) return this.item(depth + 1);
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      if (additional === 23) return undefined;
      if (additional === 26) {
        this.offset -= 4;
        this.require(4);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
        this.offset += 4;
        return view.getFloat32(0, false);
      }
      if (additional === 27) {
        this.offset -= 8;
        this.require(8);
        const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8);
        this.offset += 8;
        return view.getFloat64(0, false);
      }
      throw new Error('Unsupported CBOR simple value.');
    }
    throw new Error('Unsupported CBOR value.');
  }
}
Reader.BREAK = Symbol('CBOR break');

export function decodeFirstJadeCbor(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes.length > MAX_CBOR_BYTES) throw new Error('Jade CBOR reply is too large.');
  const reader = new Reader(bytes);
  const value = reader.item();
  if (value === Reader.BREAK) throw new Error('Unexpected CBOR break marker.');
  return { value, bytesRead: reader.offset };
}

export const appendJadeCborBytes = (left, right) => concatBytes([
  left instanceof Uint8Array ? left : new Uint8Array(left || []),
  right instanceof Uint8Array ? right : new Uint8Array(right || []),
]);
