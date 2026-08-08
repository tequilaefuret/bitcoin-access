import { Buffer } from 'buffer';
import { URDecoder } from '@ngraveio/bc-ur';
import { CryptoPSBT } from '@keystonehq/bc-ur-registry/dist/CryptoPSBT';

const PSBT_MAGIC = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]);

const assertPsbt = (psbt) => {
  if (psbt.length < PSBT_MAGIC.length || !psbt.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC)) {
    throw new Error('The BC-UR payload is not a valid PSBT.');
  }
};

export function createPsbtUrEncoder(psbtBase64, maxFragmentLength = 180) {
  const psbt = Buffer.from((psbtBase64 || '').trim(), 'base64');
  assertPsbt(psbt);
  return new CryptoPSBT(psbt).toUREncoder(maxFragmentLength);
}

export function createPsbtUrDecoder() {
  const decoder = new URDecoder();

  return {
    receivePart(part) {
      const normalizedPart = (part || '').trim().toLowerCase();
      if (!normalizedPart.startsWith('ur:crypto-psbt/')) {
        throw new Error('Scan a crypto-psbt BC-UR code.');
      }

      decoder.receivePart(normalizedPart);
      if (decoder.isError()) throw new Error(decoder.resultError() || 'Unable to decode the BC-UR sequence.');

      const progress = Math.min(100, Math.round(decoder.estimatedPercentComplete() * 100));
      if (!decoder.isComplete()) return { complete: false, progress };

      const ur = decoder.resultUR();
      if (ur.type !== 'crypto-psbt') throw new Error('The scanned BC-UR does not contain a PSBT.');
      const result = CryptoPSBT.fromCBOR(ur.cbor);
      const psbt = Buffer.from(result.getPSBT());
      assertPsbt(psbt);
      return { complete: true, progress: 100, psbtBase64: psbt.toString('base64') };
    },
  };
}
