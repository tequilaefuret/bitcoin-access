import { useCallback, useEffect, useRef } from 'react';

export const TEMPORARY_HIDE_DURATION_MS = 5000;

export const useTemporaryMessageHides = ({
  temporarilyHideMessage,
  removeMessage,
  restoreMessage,
  persistHide,
  onError,
  duration = TEMPORARY_HIDE_DURATION_MS,
}) => {
  const pendingRef = useRef(new Map());
  const callbacksRef = useRef({ removeMessage, restoreMessage, persistHide, onError });
  callbacksRef.current = { removeMessage, restoreMessage, persistHide, onError };

  const commitHide = useCallback(async (messageId) => {
    const pending = pendingRef.current.get(messageId);
    if (!pending) return;

    pendingRef.current.delete(messageId);
    callbacksRef.current.removeMessage(messageId);
    try {
      await callbacksRef.current.persistHide?.(messageId);
    } catch (error) {
      callbacksRef.current.restoreMessage(pending.message, pending.index);
      callbacksRef.current.onError?.(
        error.message || 'Your recommendation could not be updated.'
      );
    }
  }, []);

  const hideTemporarily = useCallback((message, index = 0) => {
    if (!message?.id || pendingRef.current.has(message.id)) return;

    temporarilyHideMessage(message.id);
    const timer = setTimeout(() => commitHide(message.id), duration);
    pendingRef.current.set(message.id, { message, index, timer });
  }, [commitHide, duration, temporarilyHideMessage]);

  const undoHide = useCallback((messageId) => {
    const pending = pendingRef.current.get(messageId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    pendingRef.current.delete(messageId);
    callbacksRef.current.restoreMessage(pending.message, pending.index);
    return true;
  }, []);

  useEffect(() => () => {
    for (const [messageId, pending] of pendingRef.current.entries()) {
      clearTimeout(pending.timer);
      Promise.resolve(callbacksRef.current.persistHide?.(messageId)).catch(() => {});
    }
    pendingRef.current.clear();
  }, []);

  return { hideTemporarily, undoHide };
};
