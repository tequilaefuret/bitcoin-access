import { Buffer } from 'buffer';
import { address as bitcoinAddress, networks, opcodes, Psbt } from 'bitcoinjs-lib';

export const assertLedgerInteger = (value, label, maximum = 0x7fffffff) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be between 0 and ${maximum}.`);
  }
};

export function ledgerAccountPath(account) {
  assertLedgerInteger(account, 'Ledger account', 100);
  return `84'/0'/${account}'`;
}

export function buildLedgerDescriptor({ fingerprint, extendedPublicKey, account }) {
  const accountPath = ledgerAccountPath(account);
  if (!/^[0-9a-f]{8}$/i.test(fingerprint || '')) throw new Error('Ledger returned an invalid master fingerprint.');
  if (!/^xpub[1-9A-HJ-NP-Za-km-z]+$/.test(extendedPublicKey || '')) {
    throw new Error('Ledger returned an invalid mainnet extended public key.');
  }
  return `wpkh([${fingerprint.toLowerCase()}/${accountPath}]${extendedPublicKey}/<0;1>/*)`;
}

const compactRecoveryId = (value) => {
  if (Number.isInteger(value) && value >= 0 && value <= 3) return value;
  const ranges = [27, 31, 35, 39];
  const range = ranges.find((start) => value >= start && value <= start + 3);
  if (range == null) throw new Error('Ledger returned an invalid message recovery identifier.');
  return value - range;
};

export function encodeLedgerMessageSignature({ v, r, s }) {
  const recoveryId = compactRecoveryId(v);
  const normalizeScalar = (value, label) => {
    const normalized = typeof value === 'string' ? value.replace(/^0x/, '') : '';
    if (!/^[0-9a-f]{64}$/i.test(normalized)) {
      throw new Error(`Ledger returned an invalid message signature ${label} value.`);
    }
    return Buffer.from(normalized, 'hex');
  };

  // BIP-137 headers 39-42 identify compressed Native SegWit addresses.
  return Buffer.concat([
    Buffer.from([39 + recoveryId]),
    normalizeScalar(r, 'R'),
    normalizeScalar(s, 'S'),
  ]).toString('base64');
}

export function validateLedgerSigningRequest({
  address,
  message,
  unsignedPsbt,
  descriptorInfo,
  account,
  branch,
  index,
}) {
  assertLedgerInteger(account, 'Ledger account', 100);
  assertLedgerInteger(index, 'Address index');
  if (![0, 1].includes(branch)) throw new Error('The Ledger address chain must be receive or change.');
  if (descriptorInfo?.addressType !== 'p2wpkh' || descriptorInfo?.address !== address) {
    throw new Error('Direct Ledger signing is limited to the verified Native SegWit address.');
  }

  let psbt;
  try {
    psbt = Psbt.fromBase64(unsignedPsbt, { network: networks.bitcoin });
  } catch {
    throw new Error('The authentication PSBT is invalid. Generate it again.');
  }

  if (psbt.inputCount !== 1 || psbt.txInputs.length !== 1 || psbt.txOutputs.length !== 1) {
    throw new Error('Ledger refused an unexpected PSBT structure.');
  }
  const input = psbt.data.inputs[0];
  const output = psbt.txOutputs[0];
  const expectedScript = bitcoinAddress.toOutputScript(address, networks.bitcoin);
  if (
    !input?.witnessUtxo
    || Number(input.witnessUtxo.value) !== 0
    || !Buffer.from(input.witnessUtxo.script).equals(expectedScript)
    || Number(output.value) !== 0
    || !Buffer.from(output.script).equals(Buffer.from([opcodes.OP_RETURN]))
  ) {
    throw new Error('Ledger refused a PSBT that could move funds or target another script.');
  }

  const messageEntry = psbt.data.globalMap.unknownKeyVals?.find(
    ({ key }) => Buffer.from(key).equals(Buffer.from([0x09])),
  );
  if (!messageEntry || Buffer.from(messageEntry.value).toString('utf8') !== message) {
    throw new Error('The PSBT does not contain the exact server authentication challenge.');
  }

  const expectedPath = `m/${ledgerAccountPath(account)}/${branch}/${index}`;
  const derivation = input.bip32Derivation?.find(({ path }) => path === expectedPath);
  if (!derivation || input.partialSig?.length || input.finalScriptWitness || input.finalScriptSig) {
    throw new Error('The PSBT key path or signature state does not match the verified Ledger account.');
  }

  return { psbt, expectedPubkey: Buffer.from(derivation.pubkey) };
}
