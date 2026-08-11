import { Buffer } from 'buffer';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { normalizeBitcoinAddress } from './bitcoinAddress';

const MAX_ADDRESS_INDEX = 0x7fffffff;
const P2WPKH_SCRIPT_PREFIX = '0014';

export const assertJadeInteger = (value, label, maximum = MAX_ADDRESS_INDEX) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
};

export function buildJadePath({ account = 0, branch = 0, index = 0 } = {}) {
  assertJadeInteger(account, 'Jade account', 100);
  assertJadeInteger(branch, 'Address chain', 1);
  assertJadeInteger(index, 'Address index');
  return `m/84h/0h/${account}h/${branch}/${index}`;
}

export function buildJadePathArray(options = {}) {
  const { account = 0, branch = 0, index = 0 } = options;
  assertJadeInteger(account, 'Jade account', 100);
  assertJadeInteger(branch, 'Address chain', 1);
  assertJadeInteger(index, 'Address index');
  const hardened = 0x80000000;
  return [84 + hardened, hardened, account + hardened, branch, index];
}

export function validateJadeAddress(value) {
  const address = normalizeBitcoinAddress(value);
  if (!address) throw new Error('Jade did not return a Bitcoin address.');

  let script;
  try {
    script = bitcoinAddress.toOutputScript(address, networks.bitcoin);
  } catch {
    throw new Error('Jade returned an invalid Bitcoin mainnet address.');
  }

  if (script.length !== 22 || !script.toString('hex').startsWith(P2WPKH_SCRIPT_PREFIX)) {
    throw new Error('Jade sign-in currently supports Native SegWit addresses only.');
  }

  return address;
}

export function normalizeJadeMessageSignature(value) {
  const signature = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
    throw new Error('Jade returned an invalid message signature.');
  }

  const decoded = Buffer.from(signature, 'base64');
  if (decoded.length !== 65 || decoded.toString('base64') !== signature) {
    throw new Error('Jade returned an unexpected message signature format.');
  }

  const header = decoded[0];
  let recoveryId;
  if (header >= 27 && header <= 34) recoveryId = (header - 27) & 3;
  else if (header >= 35 && header <= 38) recoveryId = header - 35;
  else if (header >= 39 && header <= 42) recoveryId = header - 39;
  else if (header >= 0 && header <= 3) recoveryId = header;
  else throw new Error('Jade returned an unsupported signature recovery identifier.');

  // Jade emits a compact recoverable signature. Mark it explicitly as a
  // Native SegWit BIP-137 signature because this integration only accepts
  // addresses derived from m/84'/0'/... paths.
  const normalized = Buffer.from(decoded);
  normalized[0] = 39 + recoveryId;
  return normalized.toString('base64');
}

export function buildJadeQrPayload({ path, message }) {
  if (typeof path !== 'string' || !/^m\/84h\/0h\/\d+h\/[01]\/\d+$/.test(path)) {
    throw new Error('The Jade QR derivation path is invalid.');
  }
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('The Jade authentication message is missing.');
  }
  if (new TextEncoder().encode(message).length > 2800 || message.includes('\0')) {
    throw new Error('The Jade authentication message is too large or invalid.');
  }
  return `signmessage ${path} ascii:${message}`;
}
