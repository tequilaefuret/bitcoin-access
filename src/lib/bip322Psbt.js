import { Buffer } from 'buffer';
import {
  address as bitcoinAddress,
  crypto as bitcoinCrypto,
  networks,
  opcodes,
  payments,
  Psbt,
  Transaction,
} from 'bitcoinjs-lib';

const P2WPKH_PREFIX = '0014';
const P2WSH_PREFIX = '0020';
const P2PKH_PREFIX = '76a914';
const P2PKH_SUFFIX = '88ac';
const P2SH_PREFIX = 'a914';
const P2SH_SUFFIX = '87';
const GENERIC_SIGNED_MESSAGE_KEY = Buffer.from([0x09]);

const normalizeHex = (value) => (value || '').trim().toLowerCase().replace(/^0x/, '');

const isHex = (value) => Boolean(value) && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);

const buildToSpend = (message, scriptPubKey) => {
  const tagHash = bitcoinCrypto.sha256(Buffer.from('BIP0322-signed-message'));
  const messageHash = bitcoinCrypto.sha256(Buffer.concat([
    tagHash,
    tagHash,
    Buffer.from(message),
  ]));
  const transaction = new Transaction();
  transaction.version = 0;
  transaction.locktime = 0;
  transaction.addInput(
    Buffer.alloc(32),
    0xffffffff,
    0,
    Buffer.concat([Buffer.from([opcodes.OP_0, 0x20]), messageHash]),
  );
  transaction.addOutput(scriptPubKey, 0);
  return transaction;
};

const buildToSign = (toSpend, scriptPubKey, addressType) => {
  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.setVersion(0);
  psbt.setLocktime(0);
  const input = {
    hash: toSpend.getId(),
    index: 0,
    sequence: 0,
  };

  if (addressType === 'p2pkh') {
    input.nonWitnessUtxo = toSpend.toBuffer();
  } else {
    input.witnessUtxo = { script: scriptPubKey, value: 0 };
  }

  psbt.addInput(input);
  psbt.addOutput({ script: Buffer.from([opcodes.OP_RETURN]), value: 0 });
  return psbt;
};

export function getPsbtAddressType(address) {
  const outputScript = bitcoinAddress.toOutputScript(address.trim(), networks.bitcoin);
  const outputHex = outputScript.toString('hex');

  if (
    outputHex.startsWith(P2PKH_PREFIX)
    && outputHex.endsWith(P2PKH_SUFFIX)
    && outputScript.length === 25
  ) return 'p2pkh';
  if (
    outputHex.startsWith(P2SH_PREFIX)
    && outputHex.endsWith(P2SH_SUFFIX)
    && outputScript.length === 23
  ) return 'p2sh';
  if (outputHex.startsWith(P2WPKH_PREFIX) && outputScript.length === 22) return 'p2wpkh';
  if (outputHex.startsWith(P2WSH_PREFIX) && outputScript.length === 34) return 'p2wsh';

  return 'unsupported';
}

export function buildBip322Psbt({
  address,
  message,
  redeemScriptHex = '',
  witnessScriptHex = '',
  bip32Derivations = [],
}) {
  const normalizedAddress = (address || '').trim();
  const normalizedRedeemScript = normalizeHex(redeemScriptHex);
  const normalizedWitnessScript = normalizeHex(witnessScriptHex);

  if (!normalizedAddress || !message) {
    throw new Error('Address and challenge are required.');
  }

  let scriptPubKey;
  try {
    scriptPubKey = bitcoinAddress.toOutputScript(normalizedAddress, networks.bitcoin);
  } catch {
    throw new Error('Enter a valid Bitcoin mainnet address.');
  }

  const addressType = getPsbtAddressType(normalizedAddress);
  if (addressType === 'unsupported') {
    throw new Error('This address type is not supported by the PSBT proof. Use message signature instead.');
  }

  const toSpend = buildToSpend(message, scriptPubKey);
  const psbt = buildToSign(toSpend, scriptPubKey, addressType);
  psbt.addUnknownKeyValToGlobal({
    key: GENERIC_SIGNED_MESSAGE_KEY,
    value: Buffer.from(message, 'utf8'),
  });
  let multisig = null;
  let resolvedAddressType = addressType;

  if (bip32Derivations.length > 0) {
    psbt.updateInput(0, { bip32Derivation: bip32Derivations });
  }

  if (addressType === 'p2sh') {
    if (!isHex(normalizedRedeemScript)) {
      throw new Error('A Nested SegWit address requires the public redeem script from its descriptor.');
    }

    const redeemScript = Buffer.from(normalizedRedeemScript, 'hex');
    if (redeemScript.length !== 22 || !redeemScript.toString('hex').startsWith(P2WPKH_PREFIX)) {
      throw new Error('Only standard sh(wpkh(...)) Nested SegWit addresses are supported.');
    }

    const derivedAddress = payments.p2sh({
      redeem: { output: redeemScript, network: networks.bitcoin },
      network: networks.bitcoin,
    }).address;
    if (derivedAddress !== normalizedAddress) {
      throw new Error('The redeem script does not match the Bitcoin address.');
    }

    psbt.updateInput(0, { redeemScript });
    resolvedAddressType = 'p2sh-p2wpkh';
  } else if (addressType === 'p2wsh') {
    if (!isHex(normalizedWitnessScript)) {
      throw new Error('Paste the hexadecimal multisig witness script exported by your coordinator.');
    }

    const witnessScript = Buffer.from(normalizedWitnessScript, 'hex');
    let policy;

    try {
      policy = payments.p2ms({ output: witnessScript, network: networks.bitcoin });
    } catch {
      throw new Error('The multisig witness script is invalid or unsupported.');
    }

    const derivedAddress = payments.p2wsh({
      redeem: { output: witnessScript, network: networks.bitcoin },
      network: networks.bitcoin,
    }).address;

    if (derivedAddress !== normalizedAddress) {
      throw new Error('The multisig script does not match the Bitcoin address.');
    }

    if (!policy.m || !policy.n || !policy.pubkeys?.length) {
      throw new Error('Only standard m-of-n Native SegWit multisig policies are supported.');
    }

    psbt.updateInput(0, { witnessScript });
    multisig = { requiredSignatures: policy.m, totalSigners: policy.n };
  }

  return {
    base64: psbt.toBase64(),
    addressType: resolvedAddressType,
    toSpendTxId: toSpend.getId(),
    multisig,
  };
}
