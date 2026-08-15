import { safeErrorForLog } from '../_shared/logging.mjs';
import { OperationError } from '../_shared/operation-error.mjs';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_BATCH_SIZE,
} from '../_shared/feed-pagination.mjs';
import {
  enrichSocialMessages,
  loadMessageTopicIds,
  loadRepostOriginals,
  SOCIAL_MESSAGE_SELECT,
} from '../_shared/social-messages.mjs';

type EditorialPolicy = {
  hiddenAuthors: Set<string>;
  reducedAuthors: Set<string>;
  reducedTopics: Set<string>;
};

async function loadEditorialPolicy(supabase: any, readerAddress: string): Promise<EditorialPolicy> {
  const [outboundResult, inboundBlocksResult, topicPreferencesResult] = await Promise.all([
    supabase
      .from('editorial_author_preferences')
      .select('target_address, preference')
      .eq('reader_address', readerAddress),
    supabase
      .from('editorial_author_preferences')
      .select('reader_address')
      .eq('target_address', readerAddress)
      .eq('preference', 'block'),
    supabase
      .from('editorial_topic_preferences')
      .select('topic_id')
      .eq('reader_address', readerAddress)
      .eq('preference', 'reduce'),
  ]);
  if (outboundResult.error) throw outboundResult.error;
  if (inboundBlocksResult.error) throw inboundBlocksResult.error;
  if (topicPreferencesResult.error) throw topicPreferencesResult.error;

  const hiddenAuthors = new Set<string>();
  const reducedAuthors = new Set<string>();
  for (const row of outboundResult.data || []) {
    if (row.preference === 'reduce') reducedAuthors.add(row.target_address);
    if (row.preference === 'mute' || row.preference === 'block') {
      hiddenAuthors.add(row.target_address);
    }
  }
  for (const row of inboundBlocksResult.data || []) {
    hiddenAuthors.add(row.reader_address);
  }

  return {
    hiddenAuthors,
    reducedAuthors,
    reducedTopics: new Set(
      (topicPreferencesResult.data || []).map((row: any) => row.topic_id).filter(Boolean),
    ),
  };
}

async function loadEditorialRiskScores(supabase: any, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, number>();
  const { data, error } = await supabase
    .from('editorial_message_risk')
    .select('message_id, risk_score')
    .in('message_id', messageIds);
  if (error) throw error;

  return new Map<string, number>(
    (data || []).map((row: any) => [row.message_id, Number(row.risk_score) || 0]),
  );
}

export async function getMessages(
  supabase: any,
  limit = FEED_BATCH_SIZE,
  offset = 0,
  userAddress?: string,
  parentId?: string,
  sortMode = 'recent',
  cursor?: string,
) {
  console.log('📨 [GET_MESSAGES] Params reçus:', {
    limit,
    offset,
    userAddress: userAddress?.slice(0, 8),
    parentId,
    sortMode,
    hasCursor: Boolean(cursor),
  });

  try {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || FEED_BATCH_SIZE, FEED_BATCH_SIZE));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    const safeSortMode = !parentId && ['followed', 'for_you'].includes(sortMode)
      ? sortMode
      : 'recent';
    const chronologicalCursor = !parentId && safeSortMode !== 'for_you'
      ? decodeFeedCursor(cursor)
      : null;
    let followedAddresses: string[] = [];
    let rankedMessageIds: string[] = [];
    let rankScoreByMessageId = new Map<string, number>();
    let forYouAlgorithmVersion: string | null = null;
    const editorialPolicy = userAddress
      ? await loadEditorialPolicy(supabase, userAddress)
      : {
          hiddenAuthors: new Set<string>(),
          reducedAuthors: new Set<string>(),
          reducedTopics: new Set<string>(),
        };

    if (safeSortMode === 'followed' && userAddress) {
      const { data: followed, error: followedError } = await supabase
        .from('follows')
        .select('following_address')
        .eq('follower_address', userAddress);
      if (followedError) throw followedError;
      followedAddresses = (followed || [])
        .map((row: any) => row.following_address)
        .filter((followedAddress: string) => !editorialPolicy.hiddenAuthors.has(followedAddress));
      if (followedAddresses.length === 0) {
        return {
          success: true,
          messages: [],
          count: 0,
          algorithm_version: null,
          has_more: false,
          next_cursor: null,
        };
      }
    }

    if (safeSortMode === 'for_you' && userAddress) {
      const { data: ranked, error: rankingError } = await supabase.rpc('rank_for_you_feed_versioned', {
        p_bitcoin_address: userAddress,
        p_limit: boundedLimit,
      });
      if (rankingError) throw rankingError;
      forYouAlgorithmVersion = typeof ranked?.[0]?.algorithm_version === 'string'
        ? ranked[0].algorithm_version
        : null;
      rankedMessageIds = (ranked || []).map((row: any) => row.message_id).filter(Boolean);
      rankScoreByMessageId = new Map(
        (ranked || []).map((row: any) => [row.message_id, Number(row.rank_score) || 0]),
      );
      if (rankedMessageIds.length === 0) {
        return {
          success: true,
          messages: [],
          count: 0,
          algorithm_version: forYouAlgorithmVersion,
          has_more: false,
          next_cursor: null,
        };
      }
    }

    let query = supabase
      .from('messages')
      .select(SOCIAL_MESSAGE_SELECT)
      .is('deleted_at', null);
    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);

    if (safeSortMode === 'followed') query = query.in('bitcoin_address', followedAddresses);
    if (safeSortMode === 'for_you') query = query.in('id', rankedMessageIds);
    if (editorialPolicy.hiddenAuthors.size > 0) {
      const hiddenList = [...editorialPolicy.hiddenAuthors]
        .map((value) => `"${value}"`)
        .join(',');
      query = query.not('bitcoin_address', 'in', `(${hiddenList})`);
    }

    let messagesResult;
    if (safeSortMode === 'for_you') {
      messagesResult = await query;
    } else if (!parentId) {
      if (chronologicalCursor) {
        query = query.or(
          `created_at.lt.${chronologicalCursor.createdAt},and(created_at.eq.${chronologicalCursor.createdAt},id.lt.${chronologicalCursor.messageId})`,
        );
      }
      messagesResult = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(
          chronologicalCursor ? 0 : boundedOffset,
          (chronologicalCursor ? 0 : boundedOffset) + boundedLimit,
        );
    } else {
      messagesResult = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(boundedOffset, boundedOffset + boundedLimit - 1);
    }

    const { data: queriedMessages, error } = messagesResult;
    if (error) throw error;

    const chronologicalHasMore = !parentId
      && safeSortMode !== 'for_you'
      && (queriedMessages || []).length > boundedLimit;
    const messages = !parentId && safeSortMode !== 'for_you'
      ? (queriedMessages || []).slice(0, boundedLimit)
      : queriedMessages || [];
    const chronologicalBoundary = chronologicalHasMore && messages.length > 0
      ? messages[messages.length - 1]
      : null;
    const nextCursor = safeSortMode === 'for_you'
      ? (rankedMessageIds.length === boundedLimit ? 'for-you-served-history' : null)
      : chronologicalBoundary
        ? encodeFeedCursor({
            createdAt: chronologicalBoundary.created_at,
            messageId: chronologicalBoundary.id,
          })
        : null;
    const pageHasMore = safeSortMode === 'for_you'
      ? rankedMessageIds.length === boundedLimit
      : chronologicalHasMore;

    const riskScoreByMessageId = safeSortMode === 'for_you'
      ? await loadEditorialRiskScores(supabase, messages.map((message: any) => message.id))
      : new Map<string, number>();
    const topicIdsByMessage = await loadMessageTopicIds(supabase, messages);
    const sortedMessageList = safeSortMode === 'for_you'
      ? [...messages].sort((left: any, right: any) => {
          const adjustedScore = (message: any) => {
            const authorMultiplier = editorialPolicy.reducedAuthors.has(message.bitcoin_address) ? 0.45 : 1;
            const topicMultiplier = [...(topicIdsByMessage.get(message.id) || [])].some(
              (topicId) => editorialPolicy.reducedTopics.has(topicId),
            ) ? 0.35 : 1;
            const riskMultiplier = 1 - Math.min(0.9, riskScoreByMessageId.get(message.id) || 0) * 0.60;
            return (rankScoreByMessageId.get(message.id) || 0)
              * authorMultiplier
              * topicMultiplier
              * riskMultiplier;
          };
          return adjustedScore(right) - adjustedScore(left);
        })
      : messages;
    const originalById = await loadRepostOriginals(supabase, sortedMessageList);
    const messageList = sortedMessageList.filter((message: any) => {
      const originalAuthor = originalById.get(message.repost_of)?.bitcoin_address;
      return !originalAuthor || !editorialPolicy.hiddenAuthors.has(originalAuthor);
    });
    const formatted = await enrichSocialMessages(supabase, messageList, {
      readerAddress: userAddress,
      originalById,
      topicIdsByMessage,
      recommendationAlgorithmVersion: safeSortMode === 'for_you'
        ? forYouAlgorithmVersion
        : null,
    });
    console.log(`✅ [GET_MESSAGES] ${formatted.length} ${parentId ? 'commentaires' : 'messages'}`);
    return {
      success: true,
      messages: formatted,
      count: formatted.length,
      algorithm_version: forYouAlgorithmVersion,
      has_more: pageHasMore,
      next_cursor: nextCursor,
    };
  } catch (error: any) {
    console.error('❌ [GET_MESSAGES] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

export async function recordForYouFeedback(
  supabase: any,
  address: string,
  messageId: string,
) {
  const { error } = await supabase.rpc('record_for_you_feedback', {
    p_bitcoin_address: address,
    p_message_id: messageId,
    p_feedback_kind: 'not_interested',
  });
  if (error) {
    if (error.message?.includes('Publication introuvable')) {
      throw new OperationError('Publication introuvable', 404);
    }
    throw error;
  }

  return { success: true, message_id: messageId, feedback: 'not_interested' };
}

export async function recordForYouImpressions(
  supabase: any,
  address: string,
  requestId: string,
  messageIds: string[],
  algorithmVersion: string,
) {
  if (messageIds.length === 0) return;
  const { error } = await supabase.rpc('record_for_you_impressions', {
    p_bitcoin_address: address,
    p_request_id: requestId,
    p_message_ids: messageIds,
    p_algorithm_version: algorithmVersion,
  });
  if (error) {
    console.error('❌ [FOR_YOU_IMPRESSIONS] Comptage impossible:', safeErrorForLog(error));
  }
}
