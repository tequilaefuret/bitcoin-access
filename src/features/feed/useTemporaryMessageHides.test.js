import { act, renderHook } from '@testing-library/react';
import { useTemporaryMessageHides } from './useTemporaryMessageHides';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const setup = () => {
  const callbacks = {
    temporarilyHideMessage: jest.fn(),
    removeMessage: jest.fn(),
    restoreMessage: jest.fn(),
    persistHide: jest.fn().mockResolvedValue({ success: true }),
    onError: jest.fn(),
  };
  const rendered = renderHook(() => useTemporaryMessageHides({
    ...callbacks,
    duration: 5000,
  }));
  return { ...rendered, callbacks };
};

test('keeps feedback pending long enough to undo it', () => {
  const { result, callbacks } = setup();
  const message = { id: 'message-1' };

  act(() => result.current.hideTemporarily(message, 3));
  expect(callbacks.temporarilyHideMessage).toHaveBeenCalledWith(message.id);

  act(() => result.current.undoHide(message.id));
  act(() => jest.advanceTimersByTime(5000));

  expect(callbacks.restoreMessage).toHaveBeenCalledWith(message, 3);
  expect(callbacks.persistHide).not.toHaveBeenCalled();
  expect(callbacks.removeMessage).not.toHaveBeenCalled();
});

test('persists and removes the placeholder after the undo window', async () => {
  const { result, callbacks } = setup();

  act(() => result.current.hideTemporarily({ id: 'message-2' }, 0));
  await act(async () => {
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
  });

  expect(callbacks.removeMessage).toHaveBeenCalledWith('message-2');
  expect(callbacks.persistHide).toHaveBeenCalledWith('message-2');
});
