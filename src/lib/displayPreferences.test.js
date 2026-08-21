import {
  canShowBitcoinBalance,
  canShowShellBalance,
  formatBitcoinAddress,
  formatShellAmount,
} from './displayPreferences';

describe('display preferences', () => {
  const address = 'bc1qabcdefghijklmnopqrstuvwxyz1234567890';

  test('formats Bitcoin addresses in all supported privacy modes', () => {
    expect(formatBitcoinAddress(address, 'full')).toBe(address);
    expect(formatBitcoinAddress(address, 'shortened')).toBe('bc1qabcd...567890');
    expect(formatBitcoinAddress(address, 'masked')).toBe('bc1q••••••••••7890');
  });

  test('applies the balance visibility choices independently', () => {
    expect(canShowBitcoinBalance('hide_bitcoin')).toBe(false);
    expect(canShowShellBalance('hide_bitcoin')).toBe(true);
    expect(canShowBitcoinBalance('hide_shells')).toBe(true);
    expect(canShowShellBalance('hide_shells')).toBe(false);
    expect(canShowBitcoinBalance('hide_all')).toBe(false);
    expect(canShowShellBalance('hide_all')).toBe(false);
  });

  test('uses the requested compact shell notation', () => {
    expect(formatShellAmount(1_003_000)).toBe('1.003M');
    expect(formatShellAmount(10_300, { besideBar: true })).toBe('10.3k');
    expect(formatShellAmount(10_300)).toBe('10,300');
  });
});
