import { useCallback, useState } from 'react';

export const usePendingActivity = () => {
  const [pendingCount, setPendingCount] = useState(0);

  const beginActivity = useCallback(() => {
    setPendingCount((current) => current + 1);
  }, []);

  const endActivity = useCallback(() => {
    setPendingCount((current) => Math.max(0, current - 1));
  }, []);

  return {
    loading: pendingCount > 0,
    pendingCount,
    beginActivity,
    endActivity,
  };
};
