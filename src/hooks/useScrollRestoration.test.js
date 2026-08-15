import { act, renderHook } from '@testing-library/react';
import { useScrollRestoration } from './useScrollRestoration';

test('restores the captured reading position on the next animation frame', () => {
  const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 1280 });
  window.scrollTo = jest.fn();
  window.requestAnimationFrame = jest.fn((callback) => {
    callback();
    return 7;
  });
  window.cancelAnimationFrame = jest.fn();

  const { result } = renderHook(() => useScrollRestoration());
  act(() => result.current.captureScroll('social-feed'));
  act(() => result.current.restoreScroll('social-feed'));

  expect(window.scrollTo).toHaveBeenCalledWith({
    top: 1280,
    left: 0,
    behavior: 'auto',
  });

  act(() => result.current.scrollToTop());
  expect(window.scrollTo).toHaveBeenLastCalledWith({
    top: 0,
    left: 0,
    behavior: 'auto',
  });

  if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY);
});
