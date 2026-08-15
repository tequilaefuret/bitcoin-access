import {
  classicFeedReducer,
  createFeedCollection,
  mergeUniqueMessages,
  normalizeFeedPage,
  normalizePublishedMessage,
} from './classicFeedState';

const first = { id: 'first', content: 'First' };
const second = { id: 'second', content: 'Second' };

test('normalizes legacy arrays and cursor pages behind one contract', () => {
  expect(normalizeFeedPage([first])).toEqual({
    messages: [first],
    hasMore: false,
    nextCursor: null,
  });
  expect(normalizeFeedPage({
    messages: [first],
    hasMore: true,
    nextCursor: 'next-page',
  })).toEqual({
    messages: [first],
    hasMore: true,
    nextCursor: 'next-page',
  });
});

test('deduplicates messages and gives prepended local data precedence', () => {
  expect(mergeUniqueMessages(
    [{ ...first, content: 'Remote value' }],
    [{ ...first, content: 'Local value' }, second],
    true
  )).toEqual([
    { ...first, content: 'Local value' },
    second,
  ]);
});

test('appends cursor pages while retaining server pagination progress', () => {
  const initial = classicFeedReducer(createFeedCollection(), {
    type: 'replace-page',
    sortMode: 'for_you',
    page: { messages: [first], hasMore: true, nextCursor: 'cursor-1' },
  });
  const appended = classicFeedReducer(initial, {
    type: 'append-page',
    sortMode: 'for_you',
    page: { messages: [first, second], hasMore: false, nextCursor: null },
  });

  expect(appended.for_you.messages).toEqual([first, second]);
  expect(appended.for_you.loadedCount).toBe(3);
  expect(appended.for_you.hasMore).toBe(false);
});

test('updates and removes one post consistently from every cached feed', () => {
  let feeds = createFeedCollection();
  for (const sortMode of ['for_you', 'recent']) {
    feeds = classicFeedReducer(feeds, {
      type: 'replace-page',
      sortMode,
      page: { messages: [first], hasMore: false, nextCursor: null },
    });
  }

  feeds = classicFeedReducer(feeds, {
    type: 'update-message',
    messageId: first.id,
    updater: (message) => ({ ...message, useful_count: 3 }),
  });
  expect(feeds.for_you.messages[0].useful_count).toBe(3);
  expect(feeds.recent.messages[0].useful_count).toBe(3);

  feeds = classicFeedReducer(feeds, { type: 'remove-message', messageId: first.id });
  expect(feeds.for_you.messages).toEqual([]);
  expect(feeds.recent.messages).toEqual([]);
});

test('normalizes a freshly published database row for local rendering', () => {
  expect(normalizePublishedMessage({ id: 'new', content: 'New' }, 'reader')).toEqual({
    id: 'new',
    content: 'New',
    bitcoin_address: 'reader',
    useful_count: 0,
    comments_count: 0,
    reposts_count: 0,
    user_has_marked_useful: false,
    user_has_reposted: false,
  });
});

test('prepends a local post only to an initialized Latest cache', () => {
  const untouched = classicFeedReducer(createFeedCollection(), {
    type: 'prepend-latest',
    message: second,
    force: false,
  });
  expect(untouched.recent.loaded).toBe(false);

  const initialized = classicFeedReducer(untouched, {
    type: 'prepend-latest',
    message: second,
    force: true,
  });
  expect(initialized.recent.messages).toEqual([second]);
  expect(initialized.recent.loaded).toBe(true);
});
