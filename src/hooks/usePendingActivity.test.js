import { act, renderHook } from '@testing-library/react';
import { usePendingActivity } from './usePendingActivity';

test('stays loading until every concurrent activity has finished', () => {
  const { result } = renderHook(() => usePendingActivity());

  act(() => {
    result.current.beginActivity();
    result.current.beginActivity();
  });
  expect(result.current.pendingCount).toBe(2);
  expect(result.current.loading).toBe(true);

  act(() => result.current.endActivity());
  expect(result.current.pendingCount).toBe(1);
  expect(result.current.loading).toBe(true);

  act(() => {
    result.current.endActivity();
    result.current.endActivity();
  });
  expect(result.current.pendingCount).toBe(0);
  expect(result.current.loading).toBe(false);
});
