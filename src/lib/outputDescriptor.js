import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import bs58check from 'bs58check';
import { networks, payments } from 'bitcoinjs-lib';

const INPUT_CHARSET = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ";
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHECKSUM_GENERATORS = [
  0xf5dee51989n,
  0xa9fdca3312n,
  0x1bab10e32dn,
  0x3706b1677an,
  0x644d626ffdn,
];
const toBigInt = (1n).constructor;
const XPUB_VERSION = 0x0488b21e;
const PUBLIC_VERSIONS = new Set([
  XPUB_VERSION,
  0x049d7cb2, // ypub
  0x04b24746, // zpub
  0x0295b43f, // Ypub
  0x02aa7ed3, // Zpub
]);
const PRIVATE_VERSIONS = new Set([
  0x0488ade4,
  0x049d7878,
  0x04b2430c,
  0x0295b005,
  0x02aa7a99,
]);

const isSupportedDescriptor = (value) => /^(?:pkh|wpkh|wsh)\(/.test(value) || /^sh\(wpkh\(/.test(value);

const descriptorPolymod = (symbols) => {
  let checksum = 1n;
  for (const symbol of symbols) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x7ffffffffn) << 5n) ^ toBigInt(symbol);
    for (let index = 0; index < CHECKSUM_GENERATORS.length; index += 1) {
      if ((top >> toBigInt(index)) & 1n) checksum ^= CHECKSUM_GENERATORS[index];
    }
  }
  return checksum;
};

const expandDescriptor = (descriptor) => {
  const groups = [];
  const symbols = [];

  for (const character of descriptor) {
    const position = INPUT_CHARSET.indexOf(character);
    if (position === -1) throw new Error('The descriptor contains unsupported characters.');
    symbols.push(position & 31);
    groups.push(position >> 5);
    if (groups.length === 3) {
      symbols.push(groups[0] * 9 + groups[1] * 3 + groups[2]);
      groups.length = 0;
    }
  }

  if (groups.length === 1) symbols.push(groups[0]);
  if (groups.length === 2) symbols.push(groups[0] * 3 + groups[1]);
  return symbols;
};

export function descriptorChecksum(descriptor) {
  const symbols = [...expandDescriptor(descriptor), 0, 0, 0, 0, 0, 0, 0, 0];
  const checksum = descriptorPolymod(symbols) ^ 1n;
  return Array.from({ length: 8 }, (_, index) => (
    CHECKSUM_CHARSET[Number((checksum >> toBigInt(5 * (7 - index))) & 31n)]
  )).join('');
}

const findDescriptorString = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isSupportedDescriptor(trimmed)) return trimmed;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const descriptor = findDescriptorString(item);
      if (descriptor) return descriptor;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const preferredKeys = ['descriptor', 'desc', 'receive', 'external', 'wallet_descriptor'];
    for (const key of preferredKeys) {
      const descriptor = findDescriptorString(value[key]);
      if (descriptor) return descriptor;
    }
    for (const child of Object.values(value)) {
      const descriptor = findDescriptorString(child);
      if (descriptor) return descriptor;
    }
  }
  return null;
};

export function extractOutputDescriptor(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error('Paste or import a public output descriptor.');

  try {
    const fromJson = findDescriptorString(JSON.parse(text));
    if (fromJson) return fromJson;
  } catch {
    // Plain-text wallet exports are handled below.
  }

  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^['"]|['"],?$/g, ''))
    .filter(isSupportedDescriptor);
  if (candidates.length > 0) return candidates[0];
  if (isSupportedDescriptor(text)) return text;
  throw new Error('No supported pkh, wpkh, sh(wpkh) or wsh descriptor was found in this file.');
}

const splitDescriptorChecksum = (value) => {
  const separator = value.lastIndexOf('#');
  if (separator === -1) return { body: value, checksum: null };

  const body = value.slice(0, separator);
  const checksum = value.slice(separator + 1);
  if (checksum.length !== 8 || ![...checksum].every((character) => CHECKSUM_CHARSET.includes(character))) {
    throw new Error('The descriptor checksum is malformed.');
  }
  if (descriptorChecksum(body) !== checksum) {
    throw new Error('The descriptor checksum is invalid. Export the wallet policy again.');
  }
  return { body, checksum };
};

const normalizeExtendedPublicKey = (extendedKey) => {
  let decoded;
  try {
    decoded = Buffer.from(bs58check.decode(extendedKey));
  } catch {
    throw new Error('An extended public key in the descriptor is invalid.');
  }
  if (decoded.length !== 78) throw new Error('An extended public key has an invalid length.');

  const version = decoded.readUInt32BE(0);
  if (PRIVATE_VERSIONS.has(version)) {
    throw new Error('Private descriptors are forbidden. Export public keys only.');
  }
  if (!PUBLIC_VERSIONS.has(version)) {
    throw new Error('Only mainnet xpub, ypub and zpub public keys are supported.');
  }

  decoded.writeUInt32BE(XPUB_VERSION, 0);
  return bs58check.encode(decoded);
};

const normalizeOriginPath = (path) => path
  .split('/')
  .filter(Boolean)
  .map((segment) => segment.replace(/h$/, "'"));

const parseOrigin = (keyExpression) => {
  if (!keyExpression.startsWith('[')) return { expression: keyExpression, fingerprint: null, path: [] };
  const close = keyExpression.indexOf(']');
  if (close === -1) throw new Error('A key origin in the descriptor is incomplete.');

  const origin = keyExpression.slice(1, close);
  const [fingerprint, ...path] = origin.split('/');
  if (!/^[0-9a-fA-F]{8}$/.test(fingerprint)) {
    throw new Error('A descriptor key fingerprint is invalid.');
  }
  if (path.some((segment) => !/^\d+(?:h|')?$/.test(segment))) {
    throw new Error('A descriptor key origin path is invalid.');
  }

  return {
    expression: keyExpression.slice(close + 1),
    fingerprint: fingerprint.toLowerCase(),
    path: normalizeOriginPath(path.join('/')),
  };
};

const resolvePathSegment = (segment, branch, index) => {
  if (segment === '*') return index;
  const tuple = segment.match(/^<([0-9;]+)>$/);
  if (tuple) {
    const choices = tuple[1].split(';').map(Number);
    const selected = choices[branch];
    if (!Number.isSafeInteger(selected)) {
      throw new Error('This descriptor does not provide the selected receive/change branch.');
    }
    return selected;
  }
  if (!/^\d+$/.test(segment)) {
    throw new Error('Hardened or unsupported derivation after an xpub is not allowed.');
  }
  return Number(segment);
};

const deriveDescriptorKey = (keyExpression, branch, index) => {
  const origin = parseOrigin(keyExpression.trim());
  const compressedPublicKey = origin.expression.match(/^(02|03)[0-9a-fA-F]{64}$/);
  if (compressedPublicKey) {
    const pubkey = Buffer.from(origin.expression, 'hex');
    return {
      pubkey,
      bip32Derivation: origin.fingerprint
        ? {
          masterFingerprint: Buffer.from(origin.fingerprint, 'hex'),
          pubkey,
          path: `m${origin.path.length ? `/${origin.path.join('/')}` : ''}`,
        }
        : null,
    };
  }

  const slash = origin.expression.indexOf('/');
  const extendedKey = slash === -1 ? origin.expression : origin.expression.slice(0, slash);
  const pathText = slash === -1 ? '' : origin.expression.slice(slash + 1);
  const normalizedKey = normalizeExtendedPublicKey(extendedKey);
  const derivedSegments = pathText
    ? pathText.split('/').map((segment) => resolvePathSegment(segment, branch, index))
    : [];

  let node = HDKey.fromExtendedKey(normalizedKey);
  derivedSegments.forEach((childIndex) => {
    if (!Number.isSafeInteger(childIndex) || childIndex < 0 || childIndex >= 0x80000000) {
      throw new Error('A descriptor derivation index is outside the public range.');
    }
    node = node.deriveChild(childIndex);
  });
  if (!node.publicKey) throw new Error('Unable to derive a public key from the descriptor.');

  const pubkey = Buffer.from(node.publicKey);
  const fullPath = [...origin.path, ...derivedSegments.map(String)];
  return {
    pubkey,
    bip32Derivation: origin.fingerprint
      ? {
        masterFingerprint: Buffer.from(origin.fingerprint, 'hex'),
        pubkey,
        path: `m${fullPath.length ? `/${fullPath.join('/')}` : ''}`,
      }
      : null,
  };
};

const assertDerivationOptions = (branch, index) => {
  if (![0, 1].includes(branch)) throw new Error('Select either the receive or change branch.');
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
    throw new Error('The address index must be between 0 and 2147483647.');
  }
};

export function deriveOutputDescriptor(value, { branch = 0, index = 0 } = {}) {
  assertDerivationOptions(branch, index);
  const importedDescriptor = extractOutputDescriptor(value);
  const { body, checksum } = splitDescriptorChecksum(importedDescriptor);

  const singleKey = body.match(/^(pkh|wpkh)\((.+)\)$/);
  if (singleKey) {
    const derived = deriveDescriptorKey(singleKey[2], branch, index);
    const payment = singleKey[1] === 'pkh'
      ? payments.p2pkh({ pubkey: derived.pubkey, network: networks.bitcoin })
      : payments.p2wpkh({ pubkey: derived.pubkey, network: networks.bitcoin });
    if (!payment.address) throw new Error('Unable to derive the Bitcoin address.');
    return {
      descriptor: importedDescriptor,
      checksumVerified: Boolean(checksum),
      address: payment.address,
      addressType: singleKey[1] === 'pkh' ? 'p2pkh' : 'p2wpkh',
      redeemScriptHex: '',
      witnessScriptHex: '',
      policy: { type: 'single-signature', requiredSignatures: 1, totalSigners: 1 },
      bip32Derivations: derived.bip32Derivation ? [derived.bip32Derivation] : [],
      branch,
      index,
    };
  }

  const nestedSingleKey = body.match(/^sh\(wpkh\((.+)\)\)$/);
  if (nestedSingleKey) {
    const derived = deriveDescriptorKey(nestedSingleKey[1], branch, index);
    const redeem = payments.p2wpkh({ pubkey: derived.pubkey, network: networks.bitcoin });
    const payment = payments.p2sh({ redeem, network: networks.bitcoin });
    if (!payment.address || !redeem.output) throw new Error('Unable to derive the Nested SegWit address.');
    return {
      descriptor: importedDescriptor,
      checksumVerified: Boolean(checksum),
      address: payment.address,
      addressType: 'p2sh-p2wpkh',
      redeemScriptHex: redeem.output.toString('hex'),
      witnessScriptHex: '',
      policy: { type: 'single-signature', requiredSignatures: 1, totalSigners: 1 },
      bip32Derivations: derived.bip32Derivation ? [derived.bip32Derivation] : [],
      branch,
      index,
    };
  }

  const multisig = body.match(/^wsh\((sortedmulti|multi)\((.+)\)\)$/);
  if (!multisig) {
    throw new Error('Supported descriptors are pkh, wpkh, sh(wpkh), wsh(multi) and wsh(sortedmulti).');
  }

  const [thresholdText, ...keyExpressions] = multisig[2].split(',').map((part) => part.trim());
  const threshold = Number(thresholdText);
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > keyExpressions.length) {
    throw new Error('The multisig threshold in the descriptor is invalid.');
  }
  if (keyExpressions.length < 2 || keyExpressions.length > 15) {
    throw new Error('Multisig descriptors must contain between 2 and 15 public keys.');
  }

  const derivedKeys = keyExpressions.map((expression) => deriveDescriptorKey(expression, branch, index));
  const orderedKeys = multisig[1] === 'sortedmulti'
    ? [...derivedKeys].sort((left, right) => Buffer.compare(left.pubkey, right.pubkey))
    : derivedKeys;
  const policy = payments.p2ms({
    m: threshold,
    pubkeys: orderedKeys.map((key) => key.pubkey),
    network: networks.bitcoin,
  });
  const payment = payments.p2wsh({ redeem: policy, network: networks.bitcoin });
  if (!payment.address || !policy.output) throw new Error('Unable to derive the multisig policy.');

  return {
    descriptor: importedDescriptor,
    checksumVerified: Boolean(checksum),
    address: payment.address,
    addressType: 'p2wsh',
    redeemScriptHex: '',
    witnessScriptHex: policy.output.toString('hex'),
    policy: {
      type: multisig[1],
      requiredSignatures: threshold,
      totalSigners: keyExpressions.length,
    },
    bip32Derivations: orderedKeys
      .map((key) => key.bip32Derivation)
      .filter(Boolean),
    branch,
    index,
  };
}
