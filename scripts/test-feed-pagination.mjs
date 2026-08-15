import assert from 'node:assert/strict';
import { OperationError } from '../supabase/functions/_shared/operation-error.mjs';
import {
  attachFeedPageContext,
  decodeFeedCursor,
  encodeFeedCursor,
  extractFeedPageSnapshot,
} from '../supabase/functions/_shared/feed-pagination.mjs';

const cursor = {
  createdAt: '2026-08-15T12:34:56.000Z',
  messageId: '123e4567-e89b-42d3-a456-426614174000',
};
assert.deepEqual(decodeFeedCursor(encodeFeedCursor(cursor)), cursor);
assert.equal(decodeFeedCursor(), null);

for (const invalidCursor of ['not-a-cursor', 'x'.repeat(257)]) {
  assert.throws(
    () => decodeFeedCursor(invalidCursor),
    (error) => error instanceof OperationError && error.status === 400,
  );
}

const originalMessages = [{ id: 'first', content: 'hello' }, { id: 'second' }];
const storedPage = { has_more: true, next_cursor: 'stored-cursor' };
const snapshot = attachFeedPageContext(originalMessages, storedPage);
assert.equal(snapshot[0].__danaus_feed_page.next_cursor, 'stored-cursor');
assert.equal(originalMessages[0].__danaus_feed_page, undefined);

const extracted = extractFeedPageSnapshot(
  snapshot,
  [{ id: 'fallback' }],
  { has_more: false, next_cursor: null },
);
assert.deepEqual(extracted.context, storedPage);
assert.deepEqual(extracted.messages, originalMessages);
assert.equal(extracted.messages[0].__danaus_feed_page, undefined);

const fallback = extractFeedPageSnapshot(
  null,
  originalMessages,
  { has_more: false, next_cursor: null },
);
assert.deepEqual(fallback.messages, originalMessages);
assert.deepEqual(fallback.context, { has_more: false, next_cursor: null });

console.log('Feed pagination contracts valid.');
