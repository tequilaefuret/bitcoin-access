export const FEED_PAGE_SIZE = 20;
export const CLASSIC_SORTS = ['for_you', 'recent', 'followed'];

export const createEmptyFeed = () => ({
  messages: [],
  hasMore: true,
  nextCursor: null,
  loadedCount: 0,
  loaded: false,
});

export const createFeedCollection = () => Object.fromEntries(
  CLASSIC_SORTS.map((sortMode) => [sortMode, createEmptyFeed()])
);

export const normalizeFeedPage = (loadedPage) => {
  if (Array.isArray(loadedPage)) {
    return {
      messages: loadedPage,
      hasMore: loadedPage.length === FEED_PAGE_SIZE,
      nextCursor: null,
    };
  }

  const messages = Array.isArray(loadedPage?.messages) ? loadedPage.messages : [];
  return {
    messages,
    hasMore: typeof loadedPage?.hasMore === 'boolean'
      ? loadedPage.hasMore
      : messages.length === FEED_PAGE_SIZE,
    nextCursor: loadedPage?.nextCursor || null,
  };
};

export const mergeUniqueMessages = (currentMessages, incomingMessages, prepend = false) => {
  const merged = prepend
    ? [...incomingMessages, ...currentMessages]
    : [...currentMessages, ...incomingMessages];
  const seen = new Set();

  return merged.filter((message) => {
    if (!message?.id || seen.has(message.id) || message.deleted_at) return false;
    seen.add(message.id);
    return true;
  });
};

export const normalizePublishedMessage = (message, authorAddress) => message?.id ? {
  ...message,
  bitcoin_address: message.bitcoin_address || authorAddress,
  useful_count: Number(message.useful_count) || 0,
  comments_count: Number(message.comments_count) || 0,
  reposts_count: Number(message.reposts_count) || 0,
  user_has_marked_useful: false,
  user_has_reposted: false,
} : null;

const mapFeeds = (feeds, mapMessage) => Object.fromEntries(
  Object.entries(feeds).map(([sortMode, feed]) => [sortMode, {
    ...feed,
    messages: feed.messages.map(mapMessage),
  }])
);

const filterFeeds = (feeds, predicate) => Object.fromEntries(
  Object.entries(feeds).map(([sortMode, feed]) => [sortMode, {
    ...feed,
    messages: feed.messages.filter(predicate),
  }])
);

export const classicFeedReducer = (feeds, action) => {
  switch (action.type) {
    case 'reset':
      return createFeedCollection();

    case 'replace-page': {
      const page = action.page;
      return {
        ...feeds,
        [action.sortMode]: {
          messages: mergeUniqueMessages([], page.messages),
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          loadedCount: page.messages.length,
          loaded: true,
        },
      };
    }

    case 'append-page': {
      const currentFeed = feeds[action.sortMode] || createEmptyFeed();
      const messages = mergeUniqueMessages(currentFeed.messages, action.page.messages);
      const addedCount = messages.length - currentFeed.messages.length;
      return {
        ...feeds,
        [action.sortMode]: {
          ...currentFeed,
          messages,
          hasMore: action.page.hasMore && addedCount > 0,
          nextCursor: action.page.nextCursor,
          loadedCount: currentFeed.loadedCount + action.page.messages.length,
          loaded: true,
        },
      };
    }

    case 'update-message':
      return mapFeeds(feeds, (message) => (
        message.id === action.messageId ? action.updater(message) : message
      ));

    case 'remove-message':
      return filterFeeds(feeds, (message) => message.id !== action.messageId);

    case 'filter-messages':
      return filterFeeds(feeds, action.predicate);

    case 'prepend-latest': {
      const latest = feeds.recent || createEmptyFeed();
      if (!latest.loaded && !action.force) return feeds;
      return {
        ...feeds,
        recent: {
          ...latest,
          messages: mergeUniqueMessages(latest.messages, [action.message], true),
          loaded: true,
        },
      };
    }

    case 'remove-for-you':
      return {
        ...feeds,
        for_you: {
          ...feeds.for_you,
          messages: feeds.for_you.messages.filter((message) => message.id !== action.messageId),
        },
      };

    case 'restore-for-you':
      return {
        ...feeds,
        for_you: {
          ...feeds.for_you,
          messages: mergeUniqueMessages(feeds.for_you.messages, [action.message], true),
        },
      };

    default:
      return feeds;
  }
};
