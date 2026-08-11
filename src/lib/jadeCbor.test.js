import { appendJadeCborBytes, decodeFirstJadeCbor, encodeJadeCbor, IncompleteCborError } from './jadeCbor';

test('round-trips Jade RPC CBOR values and reports consumed bytes', () => {
  const message = {
    id: 'web1',
    method: 'sign_message',
    params: { path: [0x80000054, 0x80000000, 0], message: 'Hello Jade', enabled: true },
  };
  const first = encodeJadeCbor(message);
  const second = encodeJadeCbor({ log: new Uint8Array([73, 32, 79, 75]) });
  const joined = appendJadeCborBytes(first, second);
  const decoded = decodeFirstJadeCbor(joined);

  expect(decoded.value).toEqual(message);
  expect(decoded.bytesRead).toBe(first.length);
  expect(decodeFirstJadeCbor(joined.slice(decoded.bytesRead)).value.log).toEqual(new Uint8Array([73, 32, 79, 75]));
});

test('waits for a complete CBOR item instead of accepting truncated serial data', () => {
  const encoded = encodeJadeCbor({ id: 'web1', result: 'signature' });
  expect(() => decodeFirstJadeCbor(encoded.slice(0, -1))).toThrow(IncompleteCborError);
});

