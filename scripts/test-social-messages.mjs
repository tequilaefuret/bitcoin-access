import assert from 'node:assert/strict';
import { enrichSocialMessages } from '../supabase/functions/_shared/social-messages.mjs';

const requestedProfiles = [];
const supabase = {
  from(table) {
    assert.equal(table, 'user_profiles');
    return {
      select(columns) {
        assert.equal(columns, 'bitcoin_address, display_name');
        return {
          async in(column, addresses) {
            assert.equal(column, 'bitcoin_address');
            requestedProfiles.push(...addresses);
            return {
              data: [
                { bitcoin_address: 'author-a', display_name: 'Alice' },
                { bitcoin_address: 'author-b', display_name: 'Bob' },
              ],
              error: null,
            };
          },
        };
      },
    };
  },
};

const originalById = new Map([[
  'original-1',
  {
    id: 'original-1',
    bitcoin_address: 'author-b',
    content: 'Original post',
    useful_count: 7,
  },
]]);
const [message] = await enrichSocialMessages(supabase, [{
  id: 'message-1',
  bitcoin_address: 'author-a',
  repost_of: 'original-1',
  useful_count: '3',
  comments: [{ count: 2 }],
  reposts: [{ count: 4 }],
}], {
  originalById,
  recommendationAlgorithmVersion: 'for-you-v3',
});

assert.deepEqual(requestedProfiles.sort(), ['author-a', 'author-b']);
assert.equal(message.display_name, 'Alice');
assert.equal(message.reposted_message.display_name, 'Bob');
assert.equal(message.useful_count, 3);
assert.equal(message.comments_count, 2);
assert.equal(message.reposts_count, 4);
assert.equal(message.user_has_marked_useful, false);
assert.equal(message.user_has_reposted, false);
assert.equal(message.recommendation_algorithm_version, 'for-you-v3');

const queryResult = (data) => {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    is() { return builder; },
    async in() { return { data, error: null }; },
  };
  return builder;
};
const viewerSupabase = {
  from(table) {
    if (table === 'user_profiles') {
      return queryResult([{ bitcoin_address: 'author-a', display_name: 'Alice' }]);
    }
    if (table === 'message_useful_votes') {
      return queryResult([{ message_id: 'message-1' }]);
    }
    if (table === 'messages') {
      return queryResult([{ repost_of: 'message-1' }]);
    }
    throw new Error(`Unexpected table: ${table}`);
  },
};
const [viewerMessage] = await enrichSocialMessages(viewerSupabase, [{
  id: 'message-1',
  bitcoin_address: 'author-a',
}], {
  readerAddress: 'reader-address',
  originalById: new Map(),
});
assert.equal(viewerMessage.user_has_marked_useful, true);
assert.equal(viewerMessage.user_has_reposted, true);

console.log('Social message enrichment contracts valid.');
