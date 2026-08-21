export const SOCIAL_MESSAGE_SELECT = `
  id, bitcoin_address, content, char_count, cost_shells, created_at, parent_id,
  repost_of, repost_kind, useful_count, content_origin,
  comments:messages!parent_id(count),
  reposts:messages!repost_of(count)
`;

export const PUBLIC_MESSAGE_SELECT = `
  id, bitcoin_address, content, created_at, parent_id, repost_of, repost_kind, useful_count,
  comments:messages!parent_id(count),
  reposts:messages!repost_of(count)
`;

export async function loadDisplayNames(supabase, addresses) {
  const uniqueAddresses = [...new Set(addresses.filter(Boolean))];
  if (uniqueAddresses.length === 0) return new Map();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('bitcoin_address, display_name')
    .in('bitcoin_address', uniqueAddresses);
  if (error) throw error;

  return new Map(
    (data || []).map((row) => [row.bitcoin_address, row.display_name]),
  );
}

async function loadProfileSummaries(supabase, addresses) {
  const uniqueAddresses = [...new Set(addresses.filter(Boolean))];
  if (uniqueAddresses.length === 0) return new Map();

  const { data, error } = await supabase
    .from('user_profiles')
    .select('bitcoin_address, display_name, avatar_url')
    .in('bitcoin_address', uniqueAddresses);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.bitcoin_address, profile]));
}

export async function loadRepostOriginals(supabase, messages) {
  const originalIds = [...new Set(
    (messages || []).map((message) => message.repost_of).filter(Boolean),
  )];
  if (originalIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('messages')
    .select('id, bitcoin_address, content, created_at, useful_count')
    .in('id', originalIds)
    .is('deleted_at', null);
  if (error) throw error;

  return new Map((data || []).map((message) => [message.id, message]));
}

export async function loadMessageTopicIds(supabase, messages) {
  const sourceIds = [...new Set((messages || []).flatMap((message) => [
    message.id,
    message.parent_id,
    message.repost_of,
  ]).filter(Boolean))];
  if (sourceIds.length === 0) return new Map();

  const [scoresResult, mappingsResult] = await Promise.all([
    supabase
      .from('opinion_message_topic_scores')
      .select('message_id, topic_id')
      .in('message_id', sourceIds)
      .eq('accepted', true),
    supabase
      .from('opinion_topic_messages')
      .select('message_id, topic_id')
      .in('message_id', sourceIds),
  ]);
  if (scoresResult.error) throw scoresResult.error;
  if (mappingsResult.error) throw mappingsResult.error;

  const topicsBySource = new Map();
  for (const row of [...(scoresResult.data || []), ...(mappingsResult.data || [])]) {
    if (!topicsBySource.has(row.message_id)) topicsBySource.set(row.message_id, new Set());
    topicsBySource.get(row.message_id).add(row.topic_id);
  }

  return new Map((messages || []).map((message) => {
    const topicIds = new Set();
    for (const sourceId of [message.id, message.parent_id, message.repost_of].filter(Boolean)) {
      for (const topicId of topicsBySource.get(sourceId) || []) topicIds.add(topicId);
    }
    return [message.id, topicIds];
  }));
}

export async function enrichSocialMessages(supabase, messages, options = {}) {
  const messageList = messages || [];
  const originalById = options.originalById
    || await loadRepostOriginals(supabase, messageList);
  const profileMap = await loadProfileSummaries(
    supabase,
    messageList.flatMap((message) => [
      message.bitcoin_address,
      originalById.get(message.repost_of)?.bitcoin_address,
    ]),
  );
  const messageIds = messageList.map((message) => message.id);
  let usefulMessageIds = new Set();
  let repostedTargetIds = new Set();
  const topicIdsByMessage = options.topicIdsByMessage
    || (options.includeTopicFeedback
      ? await loadMessageTopicIds(supabase, messageList)
      : null);

  if (options.readerAddress && messageIds.length > 0) {
    const [usefulVotesResult, repostsResult] = await Promise.all([
      supabase
        .from('message_useful_votes')
        .select('message_id')
        .eq('bitcoin_address', options.readerAddress)
        .in('message_id', messageIds),
      supabase
        .from('messages')
        .select('repost_of')
        .eq('bitcoin_address', options.readerAddress)
        .eq('repost_kind', 'simple')
        .is('deleted_at', null)
        .in('repost_of', messageIds),
    ]);
    if (usefulVotesResult.error) throw usefulVotesResult.error;
    if (repostsResult.error) throw repostsResult.error;
    usefulMessageIds = new Set(
      (usefulVotesResult.data || []).map((vote) => vote.message_id),
    );
    repostedTargetIds = new Set(
      (repostsResult.data || []).map((repost) => repost.repost_of),
    );
  }

  return messageList.map((message) => {
    const original = originalById.get(message.repost_of);
    const authorProfile = profileMap.get(message.bitcoin_address);
    const originalProfile = original ? profileMap.get(original.bitcoin_address) : null;
    return {
      ...message,
      display_name: authorProfile?.display_name || null,
      avatar_url: authorProfile?.avatar_url || null,
      reposted_message: original ? {
        ...original,
        display_name: originalProfile?.display_name || null,
        avatar_url: originalProfile?.avatar_url || null,
      } : null,
      useful_count: Number(message.useful_count) || 0,
      comments_count: message.comments?.[0]?.count || 0,
      reposts_count: message.reposts?.[0]?.count || 0,
      user_has_marked_useful: usefulMessageIds.has(message.id),
      user_has_reposted: repostedTargetIds.has(message.id),
      ...(topicIdsByMessage
        ? { topic_feedback_available: (topicIdsByMessage.get(message.id)?.size || 0) > 0 }
        : {}),
      ...(options.recommendationAlgorithmVersion
        ? { recommendation_algorithm_version: options.recommendationAlgorithmVersion }
        : {}),
    };
  });
}
