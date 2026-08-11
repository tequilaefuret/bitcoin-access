import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1';
import { crypto as bitcoinCrypto } from 'bitcoinjs-lib';
import {
  buildJadePath,
  buildJadePathArray,
  buildJadeQrPayload,
  normalizeJadeMessageSignature,
  validateJadeAddress,
} from './jadeValidation';

test('builds matching Jade BIP84 paths for QR and USB', () => {
  expect(buildJadePath({ account: 2, branch: 1, index: 7 })).toBe('m/84h/0h/2h/1/7');
  expect(buildJadePathArray({ account: 2, branch: 1, index: 7 })).toEqual([
    0x80000054,
    0x80000000,
    0x80000002,
    1,
    7,
  ]);
  expect(() => buildJadePath({ account: 101 })).toThrow('between 0 and 100');
  expect(() => buildJadePath({ branch: 2 })).toThrow('Address chain');
});

test('accepts only mainnet Native SegWit addresses', () => {
  expect(validateJadeAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'))
    .toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
  expect(() => validateJadeAddress('1BoatSLRHtKNngkdXEeobR76b53LETtpyT'))
    .toThrow('Native SegWit');
  expect(() => validateJadeAddress('not-an-address')).toThrow('invalid Bitcoin mainnet');
});

test('normalizes compact Jade signatures for Native SegWit verification', () => {
  const compact = Buffer.concat([Buffer.from([32]), Buffer.alloc(64, 0x11)]).toString('base64');
  const normalized = Buffer.from(normalizeJadeMessageSignature(compact), 'base64');
  expect(normalized).toHaveLength(65);
  expect(normalized[0]).toBe(40);
  expect(normalized.subarray(1)).toEqual(Buffer.alloc(64, 0x11));

  const alreadySegwit = Buffer.concat([Buffer.from([42]), Buffer.alloc(64, 0x22)]).toString('base64');
  expect(Buffer.from(normalizeJadeMessageSignature(alreadySegwit), 'base64')[0]).toBe(42);
  expect(() => normalizeJadeMessageSignature('not base64')).toThrow('invalid message signature');
});

test('preserves the recoverable key in an official Jade firmware signature vector', () => {
  const seed = Buffer.from(
    'f1d56befd46eddfc31cda129dc76cd4a2b41d2cf86f10a5ccf0787617afa3869'
    + '967aab0224742ccc002056747ea09b68598ddf79c027c37a7c3ec923004593da',
    'hex',
  );
  const expectedPublicKey = HDKey.fromMasterSeed(Uint8Array.from(seed)).derive("m/84'/0'/0/0").publicKey;
  const firmwareSignature = 'IMfZgjj9GtcZ8Ryh/WILwkwGDIgCxal85kZ/o7cIGa8JMb1g5yj3pMS3NEEHVCkEV5G6qIG5TGvWZmYgAk/oXoU=';
  const normalized = Buffer.from(normalizeJadeMessageSignature(firmwareSignature), 'base64');
  const message = Buffer.from('test hardened indicators');
  const messageHash = bitcoinCrypto.hash256(Buffer.concat([
    Buffer.from('\x18Bitcoin Signed Message:\n', 'binary'),
    Buffer.from([message.length]),
    message,
  ]));
  const recovered = secp256k1.Signature
    .fromCompact(normalized.subarray(1).toString('hex'))
    .addRecoveryBit(normalized[0] - 39)
    .recoverPublicKey(messageHash.toString('hex'))
    .toRawBytes(true);

  expect(Buffer.from(recovered)).toEqual(Buffer.from(expectedPublicKey));
});

test('builds the Specter signmessage payload understood by Jade QR mode', () => {
  expect(buildJadeQrPayload({
    path: 'm/84h/0h/0h/0/0',
    message: 'Bitcoin Access\nNonce: abc',
  })).toBe('signmessage m/84h/0h/0h/0/0 ascii:Bitcoin Access\nNonce: abc');
  expect(() => buildJadeQrPayload({ path: 'm/44h/0h/0h/0/0', message: 'x' })).toThrow('path is invalid');
});
