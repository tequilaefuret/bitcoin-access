import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import { networks, payments } from 'bitcoinjs-lib';
import {
  deriveOutputDescriptor,
  descriptorChecksum,
  extractOutputDescriptor,
} from './outputDescriptor';

const accountFromSeed = (seedByte) => {
  const root = HDKey.fromMasterSeed(Uint8Array.from({ length: 32 }, () => seedByte));
  const account = root.derive("m/84'/0'/0'");
  return {
    root,
    account,
    fingerprint: root.fingerprint.toString(16).padStart(8, '0'),
  };
};

test('implements the BIP-380 descriptor checksum vectors', () => {
  expect(descriptorChecksum('raw(deadbeef)')).toBe('89f8spxm');
});

test('extracts a descriptor from a JSON wallet export', () => {
  expect(extractOutputDescriptor(JSON.stringify({
    wallet: { receive: 'wpkh(02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5)' },
  }))).toMatch(/^wpkh/);
});

test('derives a checksummed Native SegWit descriptor at the selected index', () => {
  const { account, fingerprint } = accountFromSeed(1);
  const body = `wpkh([${fingerprint}/84'/0'/0']${account.publicExtendedKey}/0/*)`;
  const descriptor = `${body}#${descriptorChecksum(body)}`;
  const result = deriveOutputDescriptor(descriptor, { branch: 0, index: 7 });
  const child = account.deriveChild(0).deriveChild(7);
  const expected = payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: networks.bitcoin,
  });

  expect(result.address).toBe(expected.address);
  expect(result.checksumVerified).toBe(true);
  expect(result.bip32Derivations[0].path).toBe("m/84'/0'/0'/0/7");
});

test('derives a Legacy pkh descriptor', () => {
  const { account, fingerprint } = accountFromSeed(5);
  const descriptor = `pkh([${fingerprint}/44'/0'/0']${account.publicExtendedKey}/0/*)`;
  const result = deriveOutputDescriptor(descriptor, { branch: 0, index: 3 });
  const child = account.deriveChild(0).deriveChild(3);
  const expected = payments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: networks.bitcoin,
  });

  expect(result.address).toBe(expected.address);
  expect(result.addressType).toBe('p2pkh');
  expect(result.redeemScriptHex).toBe('');
});

test('derives a Nested SegWit sh(wpkh) descriptor and redeem script', () => {
  const { account, fingerprint } = accountFromSeed(6);
  const descriptor = `sh(wpkh([${fingerprint}/49'/0'/0']${account.publicExtendedKey}/0/*))`;
  const result = deriveOutputDescriptor(descriptor, { branch: 0, index: 2 });
  const child = account.deriveChild(0).deriveChild(2);
  const redeem = payments.p2wpkh({
    pubkey: Buffer.from(child.publicKey),
    network: networks.bitcoin,
  });
  const expected = payments.p2sh({ redeem, network: networks.bitcoin });

  expect(result.address).toBe(expected.address);
  expect(result.addressType).toBe('p2sh-p2wpkh');
  expect(result.redeemScriptHex).toBe(redeem.output.toString('hex'));
});

test('derives the address and witness script for a sorted multisig descriptor', () => {
  const first = accountFromSeed(2);
  const second = accountFromSeed(3);
  const descriptor = [
    'wsh(sortedmulti(2',
    `[${first.fingerprint}/48'/0'/0'/2']${first.account.publicExtendedKey}/<0;1>/*`,
    `[${second.fingerprint}/48'/0'/0'/2']${second.account.publicExtendedKey}/<0;1>/*))`,
  ].join(',');
  const result = deriveOutputDescriptor(descriptor, { branch: 1, index: 4 });

  expect(result.address).toMatch(/^bc1q/);
  expect(result.addressType).toBe('p2wsh');
  expect(result.policy).toEqual({
    type: 'sortedmulti',
    requiredSignatures: 2,
    totalSigners: 2,
  });
  expect(result.witnessScriptHex).toMatch(/^[0-9a-f]+$/);
  expect(result.bip32Derivations).toHaveLength(2);
});

test('rejects descriptors containing private extended keys', () => {
  const { account } = accountFromSeed(4);
  expect(() => deriveOutputDescriptor(`wpkh(${account.privateExtendedKey}/0/*)`)).toThrow(
    'Private descriptors are forbidden',
  );
});
