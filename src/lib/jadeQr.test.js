import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import { URDecoder } from '@ngraveio/bc-ur';
import {
  Bytes,
  CryptoAccount,
  CryptoCoinInfo,
  CryptoCoinInfoNetwork,
  CryptoCoinInfoType,
  CryptoHDKey,
  CryptoKeypath,
  CryptoOutput,
  PathComponent,
  ScriptExpressions,
} from '@keystonehq/bc-ur-registry';
import { createJadeAccountUrDecoder, createJadeMessageUrEncoder } from './jadeQr';

const buildAccount = ({ purpose = 84, network, privateKey = false, scriptExpression = ScriptExpressions.WITNESS_PUBLIC_KEY_HASH } = {}) => {
  const fingerprint = Buffer.from('d34db33f', 'hex');
  const accountNode = HDKey.fromMasterSeed(Uint8Array.from(Buffer.alloc(32, 7))).derive("m/84'/0'/2'");
  const origin = new CryptoKeypath([
    new PathComponent({ index: purpose, hardened: true }),
    new PathComponent({ index: 0, hardened: true }),
    new PathComponent({ index: 2, hardened: true }),
  ], fingerprint, 3);
  const key = new CryptoHDKey({
    isMaster: false,
    isPrivateKey: privateKey,
    key: Buffer.from(accountNode.publicKey),
    chainCode: Buffer.from(accountNode.chainCode),
    useInfo: network === undefined
      ? undefined
      : new CryptoCoinInfo(CryptoCoinInfoType.bitcoin, network),
    origin,
    parentFingerprint: Buffer.alloc(4),
  });
  return new CryptoAccount(fingerprint, [
    new CryptoOutput([scriptExpression], key),
  ]);
};

const decodeAllParts = (encoder, decoder) => {
  for (let index = 0; index < 200; index += 1) {
    const result = decoder.receivePart(encoder.nextPart());
    if (result.complete) return result;
  }
  throw new Error('Test decoder did not complete.');
};

test('imports the animated Native SegWit crypto-account exported by Jade', () => {
  const result = decodeAllParts(buildAccount().toUREncoder(60), createJadeAccountUrDecoder());
  expect(result.account).toBe(2);
  expect(result.accountPath).toBe("m/84'/0'/2'");
  expect(result.fingerprint).toBe('d34db33f');
  expect(result.descriptor).toMatch(/^wpkh\(\[d34db33f\/84'\/0'\/2'\]xpub.+\/<0;1>\/\*\)$/);
});

test('rejects incompatible or private Jade account exports', () => {
  expect(() => decodeAllParts(buildAccount({ purpose: 49 }).toUREncoder(80), createJadeAccountUrDecoder()))
    .toThrow('Native SegWit');
  expect(() => decodeAllParts(buildAccount({ network: CryptoCoinInfoNetwork.testnet }).toUREncoder(80), createJadeAccountUrDecoder()))
    .toThrow('mainnet');
  expect(() => decodeAllParts(buildAccount({ privateKey: true }).toUREncoder(80), createJadeAccountUrDecoder()))
    .toThrow('Private keys');
});

test('accepts only the older Jade BIP84 metadata mismatch as a compatibility case', () => {
  const result = decodeAllParts(buildAccount({ scriptExpression: ScriptExpressions.PUBLIC_KEY_HASH }).toUREncoder(80), createJadeAccountUrDecoder());
  expect(result.legacyScriptMetadata).toBe(true);
  expect(result.accountPath).toBe("m/84'/0'/2'");

  expect(() => decodeAllParts(buildAccount({ purpose: 49, scriptExpression: ScriptExpressions.PUBLIC_KEY_HASH }).toUREncoder(80), createJadeAccountUrDecoder()))
    .toThrow('Native SegWit');
});

test('encodes a Jade message request as animated UR bytes', () => {
  const payload = `signmessage m/84h/0h/0h/0/0 ascii:${'login challenge '.repeat(30)}`;
  const encoder = createJadeMessageUrEncoder(payload, 50);
  const decoder = new URDecoder();
  for (let index = 0; index < 200 && !decoder.isComplete(); index += 1) {
    decoder.receivePart(encoder.nextPart());
  }
  expect(decoder.isComplete()).toBe(true);
  const ur = decoder.resultUR();
  expect(ur.type).toBe('bytes');
  expect(Bytes.fromCBOR(ur.cbor).getData().toString('utf8')).toBe(payload);
});
