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

export async function enrichSocialMessages(supabase, messages, options = {}) {
  const messageList = messages || [];
  const originalById = options.originalById
    || await loadRepostOriginals(supabase, messageList);
  const profileMap = await loadDisplayNames(
    supabase,
    messageList.flatMap((message) => [
      message.bitcoin_address,
      originalById.get(message.repost_of)?.bitcoin_address,
    ]),
  );
  const messageIds = messageList.map((message) => message.id);
  const repostTargetIds = messageList.map((message) => message.repost_of || message.id);
  let usefulMessageIds = new Set();
  let repostedTargetIds = new Set();

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
        .in('repost_of', repostTargetIds),
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
    return {
      ...message,
      display_name: profileMap.get(message.bitcoin_address) || null,
      reposted_message: original ? {
        ...original,
        display_name: profileMap.get(original.bitcoin_address) || null,
      } : null,
      useful_count: Number(message.useful_count) || 0,
      comments_count: message.comments?.[0]?.count || 0,
      reposts_count: message.reposts?.[0]?.count || 0,
      user_has_marked_useful: usefulMessageIds.has(message.id),
      user_has_reposted: repostedTargetIds.has(message.repost_of || message.id),
      ...(options.recommendationAlgorithmVersion
        ? { recommendation_algorithm_version: options.recommendationAlgorithmVersion }
        : {}),
    };
  });
}
