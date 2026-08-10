import { HDKey } from '@scure/bip32';
import { deriveOutputDescriptor } from './outputDescriptor';
import { buildBip322Psbt } from './bip322Psbt';
import {
  buildLedgerDescriptor,
  ledgerAccountPath,
  validateLedgerSigningRequest,
} from './ledgerUsbValidation';

const seed = Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1));
const master = HDKey.fromMasterSeed(seed);
const fingerprint = master.fingerprint.toString(16).padStart(8, '0');
const account = master.derive("m/84'/0'/0'");

test('builds the standard Native SegWit Ledger descriptor', () => {
  expect(ledgerAccountPath(0)).toBe("84'/0'/0'");
  expect(buildLedgerDescriptor({
    fingerprint,
    extendedPublicKey: account.publicExtendedKey,
    account: 0,
  })).toBe(`wpkh([${fingerprint}/84'/0'/0']${account.publicExtendedKey}/<0;1>/*)`);
});

test('accepts only the zero-value BIP-322 PSBT for the verified Ledger path', () => {
  const descriptor = buildLedgerDescriptor({
    fingerprint,
    extendedPublicKey: account.publicExtendedKey,
    account: 0,
  });
  const descriptorInfo = deriveOutputDescriptor(descriptor, { branch: 0, index: 7 });
  const message = 'Bitcoin Access authentication challenge';
  const unsignedPsbt = buildBip322Psbt({
    address: descriptorInfo.address,
    message,
    bip32Derivations: descriptorInfo.bip32Derivations,
  }).base64;

  expect(validateLedgerSigningRequest({
    address: descriptorInfo.address,
    message,
    unsignedPsbt,
    descriptorInfo,
    account: 0,
    branch: 0,
    index: 7,
  }).expectedPubkey.toString('hex')).toBe(descriptorInfo.bip32Derivations[0].pubkey.toString('hex'));

  expect(() => validateLedgerSigningRequest({
    address: descriptorInfo.address,
    message: `${message} altered`,
    unsignedPsbt,
    descriptorInfo,
    account: 0,
    branch: 0,
    index: 7,
  })).toThrow('exact server authentication challenge');
});
