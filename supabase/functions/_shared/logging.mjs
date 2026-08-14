const BECH32_ADDRESS_PATTERN = /\b(?:bc1|tb1|bcrt1)[02-9ac-hj-np-z]{8,87}\b/gi;
const BASE58_ADDRESS_PATTERN = /\b[123mn][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;

export function sanitizeLogText(value, fallback = 'Unknown error') {
  let text = fallback;

  if (typeof value === 'string') {
    text = value;
  } else if (value instanceof Error) {
    text = value.message || fallback;
  } else if (value && typeof value === 'object') {
    text = typeof value.message === 'string' ? value.message : fallback;
  }

  return text
    .replace(BECH32_ADDRESS_PATTERN, '[bitcoin-address-redacted]')
    .replace(BASE58_ADDRESS_PATTERN, '[bitcoin-address-redacted]');
}

export function safeErrorForLog(error, fallback = 'Unknown error') {
  return sanitizeLogText(error, fallback);
}
