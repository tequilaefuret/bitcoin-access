import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import { URDecoder } from '@ngraveio/bc-ur';
import bs58check from 'bs58check';
import '@keystonehq/bc-ur-registry/dist/patchCBOR';
import { Bytes } from '@keystonehq/bc-ur-registry/dist/Bytes';
import { decodeToDataItem } from '@keystonehq/bc-ur-registry/dist/lib';

const MAX_JADE_ACCOUNT = 100;

const assertBufferLength = (value, length, label) => {
  const bytes = value ? Buffer.from(value) : Buffer.alloc(0);
  if (bytes.length !== length) throw new Error(`${label} has an invalid length.`);
  return bytes;
};

const decodeJadeAccount = (cbor) => {
  let accountData;
  try {
    // patchCBOR is imported above before this low-level decoder. Without that
    // registration, valid Jade tags 404/303/304 are silently discarded.
    accountData = decodeToDataItem(cbor).getData();
  } catch {
    throw new Error('The Jade account QR is malformed. Export the xpub again from Jade.');
  }

  const fingerprintNumber = accountData?.[1];
  if (!Number.isSafeInteger(fingerprintNumber) || fingerprintNumber < 0 || fingerprintNumber > 0xffffffff) {
    throw new Error('The wallet fingerprint is invalid.');
  }
  const fingerprint = Buffer.alloc(4);
  fingerprint.writeUInt32BE(fingerprintNumber, 0);
  const outputItems = accountData?.[2];
  if (!Array.isArray(outputItems) || outputItems.length !== 1) {
    throw new Error('Export one Native SegWit singlesig Jade account.');
  }

  const outputTags = [];
  let taggedItem = outputItems[0];
  let hdKey = null;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!taggedItem || typeof taggedItem.getData !== 'function') break;
    const tag = taggedItem.getTag?.();
    if (tag !== undefined) outputTags.push(tag);
    const data = taggedItem.getData();
    if (data && typeof data.getData === 'function') taggedItem = data;
    else {
      hdKey = data;
      break;
    }
  }
  const scriptTags = outputTags.filter((tag) => tag !== 303);
  if (scriptTags.length !== 1 || scriptTags[0] !== 404) {
    throw new Error('Only a Native SegWit singlesig Jade xpub is supported.');
  }
  if (!outputTags.includes(303) || !hdKey || typeof hdKey !== 'object') {
    throw new Error('The Jade QR must contain a public extended key.');
  }
  if (hdKey[1] === true || hdKey[2] === true) {
    throw new Error('Private keys are forbidden. Export the public xpub from Jade.');
  }
  const publicKey = assertBufferLength(hdKey[3], 33, 'The Jade public key');
  const chainCode = assertBufferLength(hdKey[4], 32, 'The Jade chain code');
  if (![2, 3].includes(publicKey[0])) throw new Error('The Jade public key is not compressed.');

  const useInfoItem = hdKey[5];
  const useInfo = useInfoItem?.getData?.();
  if (
    useInfoItem
    && (useInfoItem.getTag?.() !== 305 || !useInfo || (useInfo[1] ?? 0) !== 0 || (useInfo[2] ?? 0) !== 0)
  ) {
    throw new Error('Only a Bitcoin mainnet Jade account is supported.');
  }

  const originItem = hdKey[6];
  const origin = originItem?.getData?.();
  const components = origin?.[1];
  if (
    originItem?.getTag?.() !== 304
    || !Array.isArray(components)
    || components.length !== 6
    || components[0] !== 84
    || components[1] !== true
    || components[2] !== 0
    || components[3] !== true
    || !Number.isSafeInteger(components[4])
    || components[4] < 0
    || components[4] > MAX_JADE_ACCOUNT
    || components[5] !== true
    || (origin[3] !== undefined && origin[3] !== 3)
  ) {
    throw new Error("Export a Native SegWit singlesig xpub at m/84'/0'/account'.");
  }

  if (origin[2] !== fingerprintNumber) {
    throw new Error('The Jade account fingerprints do not match. Export the xpub again.');
  }

  const accountIndex = components[4];
  const parentFingerprint = Buffer.alloc(4);
  const parentFingerprintNumber = hdKey[8] ?? 0;
  if (!Number.isSafeInteger(parentFingerprintNumber) || parentFingerprintNumber < 0 || parentFingerprintNumber > 0xffffffff) {
    throw new Error('The Jade parent fingerprint is invalid.');
  }
  parentFingerprint.writeUInt32BE(parentFingerprintNumber, 0);
  const childIndex = Buffer.alloc(4);
  childIndex.writeUInt32BE(0x80000000 + accountIndex, 0);
  const xpub = bs58check.encode(Buffer.concat([
    Buffer.from('0488b21e', 'hex'),
    Buffer.from([3]),
    parentFingerprint,
    childIndex,
    chainCode,
    publicKey,
  ]));
  try {
    HDKey.fromExtendedKey(xpub).deriveChild(0).deriveChild(0);
  } catch {
    throw new Error('The Jade extended public key is invalid.');
  }
  const fingerprintHex = fingerprint.toString('hex');
  return {
    account: accountIndex,
    fingerprint: fingerprintHex,
    accountPath: `m/84'/0'/${accountIndex}'`,
    descriptor: `wpkh([${fingerprintHex}/84'/0'/${accountIndex}']${xpub}/<0;1>/*)`,
    // Retained for diagnostics after both the wpkh tag and BIP84 origin have
    // been validated independently.
    scriptTags,
  };
};

export function createJadeMessageUrEncoder(payload, maxFragmentLength = 90) {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : '', 'utf8');
  if (!bytes.length) throw new Error('The Jade signing request is empty.');
  if (bytes.length > 4096) throw new Error('The Jade signing request is too large.');
  if (!Number.isSafeInteger(maxFragmentLength) || maxFragmentLength < 30 || maxFragmentLength > 300) {
    throw new Error('The Jade QR fragment size is invalid.');
  }
  return new Bytes(bytes).toUREncoder(maxFragmentLength);
}

export function createJadeAccountUrDecoder() {
  const decoder = new URDecoder();
  let receivedParts = 0;
  const receivedPartValues = new Set();

  const progressDetails = () => {
    const sourceFrames = decoder.expectedPartCount();
    return {
      progress: Math.min(100, Math.round(decoder.estimatedPercentComplete() * 100)),
      sourceFrames,
      // Jade shows the pure source frames plus one fountain-code recovery
      // frame for every three source frames (firmware BCUR_NUM_FRAGMENTS).
      maximumPhotoFrames: sourceFrames ? Math.floor((4 * sourceFrames) / 3) : 0,
      recommendedPhotoFrames: sourceFrames || 0,
    };
  };

  return {
    receivePart(part) {
      const normalizedPart = (part || '').trim().toLowerCase();
      if (normalizedPart.length > 5000) throw new Error('The Jade QR fragment is too large.');
      if (!normalizedPart.startsWith('ur:crypto-account/')) {
        throw new Error('Scan the animated crypto-account xpub displayed by Jade.');
      }
      if (receivedPartValues.has(normalizedPart)) {
        return { complete: false, duplicate: true, ...progressDetails() };
      }
      receivedPartValues.add(normalizedPart);
      receivedParts += 1;
      if (receivedParts > 2048) throw new Error('Too many Jade QR fragments were received. Restart the scan.');

      decoder.receivePart(normalizedPart);
      if (decoder.isError()) throw new Error(decoder.resultError() || 'Unable to decode the Jade xpub sequence.');

      const details = progressDetails();
      if (!decoder.isComplete()) return { complete: false, ...details };

      const ur = decoder.resultUR();
      if (ur.type !== 'crypto-account') throw new Error('The scanned BC-UR is not a Jade account.');
      if (ur.cbor.length > 2048) throw new Error('The Jade account payload is too large.');
      return { complete: true, progress: 100, ...details, ...decodeJadeAccount(ur.cbor) };
    },
  };
}
