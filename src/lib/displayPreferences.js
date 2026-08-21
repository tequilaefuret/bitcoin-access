export function formatBitcoinAddress(address, mode = 'shortened') {
  if (!address) return '';
  if (mode === 'masked') return '••••••••••••';
  if (mode === 'full' || address.length < 15) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function canShowBitcoinBalance(balanceDisplay = 'show_all') {
  return !['hide_all', 'hide_bitcoin'].includes(balanceDisplay);
}

export function canShowShellBalance(balanceDisplay = 'show_all') {
  return !['hide_all', 'hide_shells'].includes(balanceDisplay);
}

export function formatShellAmount(value, { besideBar = false } = {}) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0';
  const absolute = Math.abs(amount);
  if (absolute >= 1_000_000) return `${(amount / 1_000_000).toFixed(3)}M`;
  if (besideBar && absolute > 9_999) return `${(amount / 1_000).toFixed(1)}k`;
  return Math.round(amount).toLocaleString('en-US');
}
