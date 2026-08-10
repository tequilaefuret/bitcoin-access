import { Buffer } from 'buffer';
import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { normalizeBitcoinAddress } from './bitcoinAddress';

const MAX_ADDRESS_INDEX = 0x7fffffff;
const P2WPKH_SCRIPT_PREFIX = '0014';

export const assertTrezorInteger = (value, label, maximum = MAX_ADDRESS_INDEX) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 0 and ${maximum}.`);
  }
};

export function buildTrezorPath({ account = 0, branch = 0, index = 0 } = {}) {
  assertTrezorInteger(account, 'Trezor account', 100);
  assertTrezorInteger(branch, 'Address chain', 1);
  assertTrezorInteger(index, 'Address index');
  return `m/84'/0'/${account}'/${branch}/${index}`;
}

export function validateTrezorAddress(value) {
  const address = normalizeBitcoinAddress(value);
  if (!address) throw new Error('Trezor did not return a Bitcoin address.');

  let script;
  try {
    script = bitcoinAddress.toOutputScript(address, networks.bitcoin);
  } catch {
    throw new Error('Trezor returned an invalid Bitcoin mainnet address.');
  }

  if (script.length !== 22 || !script.toString('hex').startsWith(P2WPKH_SCRIPT_PREFIX)) {
    throw new Error('Direct Trezor sign-in currently supports Native SegWit addresses only.');
  }

  return address;
}

export function validateTrezorMessageSignature({ expectedAddress, responseAddress, signature }) {
  const expected = validateTrezorAddress(expectedAddress);
  const returned = validateTrezorAddress(responseAddress);
  if (returned !== expected) {
    throw new Error('Security check failed: Trezor signed for a different address.');
  }

  const normalizedSignature = typeof signature === 'string' ? signature.trim() : '';
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedSignature)) {
    throw new Error('Trezor returned an invalid message signature.');
  }

  let decoded;
  try {
    decoded = Buffer.from(normalizedSignature, 'base64');
  } catch {
    throw new Error('Trezor returned an invalid message signature.');
  }

  if (decoded.length !== 65 || decoded.toString('base64') !== normalizedSignature) {
    throw new Error('Trezor returned an unexpected message signature format.');
  }

  return normalizedSignature;
}
