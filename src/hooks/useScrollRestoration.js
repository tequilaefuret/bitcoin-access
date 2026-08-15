import { useCallback, useEffect, useRef } from 'react';

export const useScrollRestoration = () => {
  const positionsRef = useRef(new Map());
  const animationFrameRef = useRef(null);

  const captureScroll = useCallback((key) => {
    if (!key || typeof window === 'undefined') return;
    positionsRef.current.set(key, Math.max(0, Number(window.scrollY) || 0));
  }, []);

  const restoreScroll = useCallback((key) => {
    if (!key || typeof window === 'undefined') return;
    const top = positionsRef.current.get(key);
    if (!Number.isFinite(top)) return;

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = window.requestAnimationFrame(() => {
      window.scrollTo({ top, left: 0, behavior: 'auto' });
      animationFrameRef.current = null;
    });
  }, []);

  const scrollToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return { captureScroll, restoreScroll, scrollToTop };
};
