import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  classicFeedReducer,
  createEmptyFeed,
  createFeedCollection,
  FEED_PAGE_SIZE,
  normalizeFeedPage,
} from './classicFeedState';

const initialFeedError = '';

export const useClassicFeed = ({ address, defaultFeed, onLoadMessages }) => {
  const [classicSort, setClassicSort] = useState(defaultFeed);
  const [feedsBySort, dispatch] = useReducer(classicFeedReducer, undefined, createFeedCollection);
  const [isLoadingFeed, setIsLoadingFeed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState(initialFeedError);
  const feedRequestRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreRequestRef = useRef(0);
  const feedsRef = useRef(feedsBySort);
  const sortRef = useRef(classicSort);

  feedsRef.current = feedsBySort;
  sortRef.current = classicSort;

  const loadFeed = useCallback(async (sortMode) => {
    const requestNumber = ++feedRequestRef.current;
    setIsLoadingFeed(true);
    setFeedError(initialFeedError);

    try {
      const page = normalizeFeedPage(
        await onLoadMessages?.(FEED_PAGE_SIZE, 0, sortMode, null)
      );
      if (feedRequestRef.current !== requestNumber) return;
      dispatch({ type: 'replace-page', sortMode, page });
    } catch (error) {
      if (feedRequestRef.current === requestNumber) {
        setFeedError(error.message || 'The feed could not be loaded.');
      }
    } finally {
      if (feedRequestRef.current === requestNumber) setIsLoadingFeed(false);
    }
  }, [onLoadMessages]);

  useEffect(() => {
    feedRequestRef.current += 1;
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    dispatch({ type: 'reset' });
    setFeedError(initialFeedError);
    setIsLoadingMore(false);
    setClassicSort(defaultFeed);
    loadFeed(defaultFeed);

    return () => {
      feedRequestRef.current += 1;
      loadMoreRequestRef.current += 1;
      loadMoreInFlightRef.current = false;
    };
  }, [address, defaultFeed, loadFeed]);

  const changeSort = useCallback(async (sortMode) => {
    if (sortMode === sortRef.current) return;

    feedRequestRef.current += 1;
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    setIsLoadingMore(false);
    setIsLoadingFeed(false);
    setFeedError(initialFeedError);
    setClassicSort(sortMode);

    if (!feedsRef.current[sortMode]?.loaded) await loadFeed(sortMode);
  }, [loadFeed]);

  const loadMore = useCallback(async () => {
    const requestedSort = sortRef.current;
    const requestedFeed = feedsRef.current[requestedSort] || createEmptyFeed();
    if (loadMoreInFlightRef.current || !requestedFeed.hasMore) return;

    const requestGeneration = feedRequestRef.current;
    const requestNumber = ++loadMoreRequestRef.current;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setFeedError(initialFeedError);

    try {
      const page = normalizeFeedPage(await onLoadMessages?.(
        FEED_PAGE_SIZE,
        requestedFeed.loadedCount,
        requestedSort,
        requestedFeed.nextCursor
      ));
      if (feedRequestRef.current !== requestGeneration) return;
      dispatch({ type: 'append-page', sortMode: requestedSort, page });
    } catch (error) {
      if (feedRequestRef.current === requestGeneration) {
        setFeedError(error.message || 'The next page could not be loaded.');
      }
    } finally {
      if (loadMoreRequestRef.current === requestNumber) {
        loadMoreInFlightRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [onLoadMessages]);

  const updateMessage = useCallback((messageId, updater) => {
    dispatch({ type: 'update-message', messageId, updater });
  }, []);

  const removeMessage = useCallback((messageId) => {
    dispatch({ type: 'remove-message', messageId });
  }, []);

  const filterMessages = useCallback((predicate) => {
    dispatch({ type: 'filter-messages', predicate });
  }, []);

  const prependLatest = useCallback((message, force = false) => {
    if (!message) return;
    dispatch({ type: 'prepend-latest', message, force });
  }, []);

  const removeForYouMessage = useCallback((messageId) => {
    dispatch({ type: 'remove-for-you', messageId });
  }, []);

  const restoreForYouMessage = useCallback((message) => {
    if (!message) return;
    dispatch({ type: 'restore-for-you', message });
  }, []);

  const clearFeedError = useCallback(() => setFeedError(initialFeedError), []);

  const activeFeed = feedsBySort[classicSort] || createEmptyFeed();

  return {
    classicSort,
    messages: activeFeed.messages,
    hasMore: activeFeed.hasMore,
    isLoadingFeed,
    isLoadingMore,
    feedError,
    clearFeedError,
    changeSort,
    loadMore,
    updateMessage,
    removeMessage,
    filterMessages,
    prependLatest,
    removeForYouMessage,
    restoreForYouMessage,
  };
};
