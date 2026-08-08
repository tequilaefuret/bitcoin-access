import { Buffer } from 'buffer';

const PSBT_MAGIC = Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]);

const hasPsbtMagic = (buffer) => buffer.subarray(0, PSBT_MAGIC.length).equals(PSBT_MAGIC);

export function psbtBase64ToBlob(base64) {
  const bytes = Buffer.from((base64 || '').trim(), 'base64');
  return new Blob([bytes], { type: 'application/octet-stream' });
}

export async function psbtFileToBase64(file) {
  if (!file) return '';
  const buffer = Buffer.from(new Uint8Array(await file.arrayBuffer()));

  if (hasPsbtMagic(buffer)) return buffer.toString('base64');

  const text = buffer.toString('utf8').trim();
  if (hasPsbtMagic(Buffer.from(text, 'base64'))) return text;

  throw new Error('This file is not a valid PSBT.');
}
