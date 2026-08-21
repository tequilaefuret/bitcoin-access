import { friendlyShellError, INSUFFICIENT_SHELLS_MESSAGE } from './shells';

describe('shell error copy', () => {
  test('turns technical insufficient-balance errors into the product explanation', () => {
    expect(friendlyShellError('INSUFFICIENT_SHELLS')).toBe(INSUFFICIENT_SHELLS_MESSAGE);
    expect(friendlyShellError(new Error('Insufficient balance to load messages.')))
      .toBe(INSUFFICIENT_SHELLS_MESSAGE);
  });

  test('preserves unrelated errors', () => {
    expect(friendlyShellError('Network unavailable')).toBe('Network unavailable');
  });
});
