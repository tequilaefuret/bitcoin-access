import { Buffer } from 'buffer';
import { createPsbtUrDecoder, createPsbtUrEncoder } from './bcUrPsbt';

const psbtBase64 = Buffer.from([
  0x70, 0x73, 0x62, 0x74, 0xff,
  ...Array.from({ length: 600 }, (_, index) => index % 251),
]).toString('base64');

test('round-trips a PSBT through animated crypto-psbt BC-UR fragments', () => {
  const encoder = createPsbtUrEncoder(psbtBase64, 100);
  const decoder = createPsbtUrDecoder();
  let result = { complete: false };

  for (let index = 0; index < encoder.fragmentsLength * 3 && !result.complete; index += 1) {
    result = decoder.receivePart(encoder.nextPart());
  }

  expect(result.complete).toBe(true);
  expect(result.psbtBase64).toBe(psbtBase64);
});

test('rejects another UR registry type', () => {
  const decoder = createPsbtUrDecoder();
  expect(() => decoder.receivePart('ur:bytes/hdcxfdwfen')).toThrow('crypto-psbt');
});
