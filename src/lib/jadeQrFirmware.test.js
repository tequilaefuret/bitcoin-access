import { Buffer } from 'buffer';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { createJadeAccountUrDecoder } from './jadeQr';

test('imports the exact nested-tag CBOR layout emitted by Jade firmware', () => {
  // Kept in a separate test module that does not import the registry entry
  // point. This catches a missing semantic-tag registration in jadeQr itself.
  // Jade bcur.c writes: account map -> tag 404 (wpkh) -> tag 303
  // (crypto-hdkey) -> HD key map.
  const jadeFirmwareCbor = Buffer.from(
    'a2011ad34db33f0281d90194d9012fa4035821039d7f8577be01454569c82b482652fd4b946308702774e4009ff0439e925dcffd0458208fa12bf7ed26928b719be000ca93774d596caafd28d693bb0d3abccfd709796706d90130a301861854f500f502f5021ad34db33f03030800',
    'hex',
  );
  const encoder = new UREncoder(new UR(jadeFirmwareCbor, 'crypto-account'), 45);
  const decoder = createJadeAccountUrDecoder();
  let result;

  for (let index = 0; index < 200 && !result?.complete; index += 1) {
    result = decoder.receivePart(encoder.nextPart());
  }

  expect(result?.complete).toBe(true);
  expect(result.fingerprint).toBe('d34db33f');
  expect(result.accountPath).toBe("m/84'/0'/2'");
  expect(result.scriptTags).toEqual([404]);
  expect(result.descriptor).toMatch(/^wpkh\(\[d34db33f\/84'\/0'\/2'\]xpub/);
});
