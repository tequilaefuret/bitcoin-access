const MAINNET_CAIP_PREFIX = 'bip122:000000000019d6689c085ae165831e93:';

export function normalizeBitcoinAddress(value) {
  if (typeof value !== 'string') return '';

  let address = value.trim();
  if (address.toLowerCase().startsWith(MAINNET_CAIP_PREFIX)) {
    address = address.slice(MAINNET_CAIP_PREFIX.length);
  } else if (/^bip122:/i.test(address)) {
    address = address.split(':').pop() || '';
  }

  if (/^bitcoin:/i.test(address)) {
    address = address.slice('bitcoin:'.length).split('?')[0];
  }

  address = address.trim();
  return /^bc1/i.test(address) ? address.toLowerCase() : address;
}
