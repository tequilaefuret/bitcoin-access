import assert from 'node:assert/strict';
import {
  enrichSocialMessages,
  loadMessageTopicIds,
} from '../supabase/functions/_shared/social-messages.mjs';

const requestedProfiles = [];
const supabase = {
  from(table) {
    assert.equal(table, 'user_profiles');
    return {
      select(columns) {
        assert.equal(columns, 'bitcoin_address, display_name, avatar_url');
        return {
          async in(column, addresses) {
            assert.equal(column, 'bitcoin_address');
            requestedProfiles.push(...addresses);
            return {
              data: [
                { bitcoin_address: 'author-a', display_name: 'Alice', avatar_url: 'https://media.example/alice' },
                { bitcoin_address: 'author-b', display_name: 'Bob', avatar_url: 'https://media.example/bob' },
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
assert.equal(message.avatar_url, 'https://media.example/alice');
assert.equal(message.reposted_message.display_name, 'Bob');
assert.equal(message.reposted_message.avatar_url, 'https://media.example/bob');
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

const repostWrapperSupabase = {
  from(table) {
    if (table === 'user_profiles') {
      return queryResult([{ bitcoin_address: 'reader-address', display_name: 'Reader' }]);
    }
    if (table === 'message_useful_votes') return queryResult([]);
    if (table === 'messages') {
      return queryResult([{ repost_of: 'original-1' }]);
    }
    throw new Error(`Unexpected table: ${table}`);
  },
};
const [ownRepostWrapper] = await enrichSocialMessages(repostWrapperSupabase, [{
  id: 'repost-wrapper-1',
  bitcoin_address: 'reader-address',
  repost_of: 'original-1',
}], {
  readerAddress: 'reader-address',
  originalById,
});
assert.equal(ownRepostWrapper.user_has_reposted, false);

const thenableQuery = (data) => {
  const builder = {
    select() { return builder; },
    in() { return builder; },
    eq() { return builder; },
    then(resolve, reject) {
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
};
const topicSupabase = {
  from(table) {
    if (table === 'opinion_message_topic_scores') {
      return thenableQuery([{ message_id: 'parent-1', topic_id: 'topic-1' }]);
    }
    if (table === 'opinion_topic_messages') return thenableQuery([]);
    throw new Error(`Unexpected topic table: ${table}`);
  },
};
const topicIdsByMessage = await loadMessageTopicIds(topicSupabase, [{
  id: 'comment-1',
  parent_id: 'parent-1',
}]);
assert.deepEqual([...topicIdsByMessage.get('comment-1')], ['topic-1']);

console.log('Social message enrichment contracts valid.');
