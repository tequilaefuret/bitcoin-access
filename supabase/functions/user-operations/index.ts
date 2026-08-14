// ========================================
// EDGE FUNCTION : user-operations
// Gère toutes les opérations utilisateur AVEC vérification JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  assertAllowedOrigin,
  corsHeaders as buildCorsHeaders,
  jsonResponse,
  verifyAccessToken,
} from '../_shared/auth.ts';
import { safeErrorForLog } from '../_shared/logging.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// === CONSTANTES ===
const MESSAGE_COST_PER_CHAR = 0.00000001; // 1 satoshi par caractère
const GAME_COST = 0.000001;
const FEED_BATCH_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class OperationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'OperationError';
    this.status = status;
  }
}

// === VÉRIFICATION JWT ===
async function verifyJWT(token: string): Promise<{ valid: boolean; address?: string }> {
  return verifyAccessToken(token, supabase);
}

// === RÉCUPÉRATION BALANCE BITCOIN ===
async function fetchBitcoinBalance(address: string): Promise<number> {
  let apiUrl: string;
  apiUrl = `https://mempool.space/api/address/${address}`;

  const response = await fetch(apiUrl);
  
  if (!response.ok) {
    if (response.status === 404) {
      return 0;
    }
    throw new Error('Erreur API Mempool.space');
  }

  const data = await response.json();
  const confirmedSats = data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
  const pendingDeltaSats = data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum;
  // Incoming unconfirmed funds are not credited. A pending outgoing transaction
  // reduces the cached backing early, but this check only runs during sync.
  const conservativeSats = Math.max(0, confirmedSats + Math.min(0, pendingDeltaSats));
  return conservativeSats / 100000000;
}

// ========================================
// PROFILS UTILISATEUR
// ========================================
async function loadDisplayNames(addresses: string[]) {
  const uniqueAddresses = [...new Set(addresses.filter(Boolean))];

  if (uniqueAddresses.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('bitcoin_address, display_name')
    .in('bitcoin_address', uniqueAddresses);

  if (error) throw error;

  return new Map<string, string>(
    (data || []).map((row: any) => [row.bitcoin_address, row.display_name])
  );
}

type EditorialPolicy = {
  hiddenAuthors: Set<string>;
  reducedAuthors: Set<string>;
  blockedAuthors: Set<string>;
};

async function loadEditorialPolicy(readerAddress: string): Promise<EditorialPolicy> {
  const [outboundResult, inboundBlocksResult] = await Promise.all([
    supabase
      .from('editorial_author_preferences')
      .select('target_address, preference')
      .eq('reader_address', readerAddress),
    supabase
      .from('editorial_author_preferences')
      .select('reader_address')
      .eq('target_address', readerAddress)
      .eq('preference', 'block'),
  ]);

  if (outboundResult.error) throw outboundResult.error;
  if (inboundBlocksResult.error) throw inboundBlocksResult.error;

  const hiddenAuthors = new Set<string>();
  const reducedAuthors = new Set<string>();
  const blockedAuthors = new Set<string>();

  for (const row of outboundResult.data || []) {
    if (row.preference === 'reduce') reducedAuthors.add(row.target_address);
    if (row.preference === 'mute' || row.preference === 'block') {
      hiddenAuthors.add(row.target_address);
    }
    if (row.preference === 'block') blockedAuthors.add(row.target_address);
  }

  for (const row of inboundBlocksResult.data || []) {
    hiddenAuthors.add(row.reader_address);
    blockedAuthors.add(row.reader_address);
  }

  return { hiddenAuthors, reducedAuthors, blockedAuthors };
}

async function loadEditorialRiskScores(messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, number>();

  const { data, error } = await supabase
    .from('editorial_message_risk')
    .select('message_id, risk_score')
    .in('message_id', messageIds);

  if (error) throw error;
  return new Map<string, number>(
    (data || []).map((row: any) => [row.message_id, Number(row.risk_score) || 0])
  );
}

async function assertEditorialInteractionAllowed(actorAddress: string, messageId: string) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, bitcoin_address, repost_of')
    .eq('id', messageId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!message) throw new OperationError('Publication introuvable', 404);

  let targetAddress = message.bitcoin_address;
  if (message.repost_of) {
    const { data: original, error: originalError } = await supabase
      .from('messages')
      .select('bitcoin_address')
      .eq('id', message.repost_of)
      .is('deleted_at', null)
      .maybeSingle();
    if (originalError) throw originalError;
    if (original?.bitcoin_address) targetAddress = original.bitcoin_address;
  }

  if (!targetAddress || targetAddress === actorAddress) return;

  const [outbound, inbound] = await Promise.all([
    supabase
      .from('editorial_author_preferences')
      .select('preference')
      .eq('reader_address', actorAddress)
      .eq('target_address', targetAddress)
      .eq('preference', 'block')
      .maybeSingle(),
    supabase
      .from('editorial_author_preferences')
      .select('preference')
      .eq('reader_address', targetAddress)
      .eq('target_address', actorAddress)
      .eq('preference', 'block')
      .maybeSingle(),
  ]);

  if (outbound.error) throw outbound.error;
  if (inbound.error) throw inbound.error;
  if (outbound.data || inbound.data) {
    throw new OperationError('Interaction impossible entre ces comptes', 403);
  }
}

async function setEditorialAuthorPreference(
  readerAddress: string,
  targetAddress: string,
  preference: string,
) {
  const { data, error } = await supabase.rpc('set_editorial_author_preference', {
    p_reader_address: readerAddress,
    p_target_address: targetAddress,
    p_preference: preference,
  });

  if (error) {
    if (error.message?.includes('Compte introuvable')) {
      throw new OperationError('Compte introuvable', 404);
    }
    throw error;
  }

  return {
    success: true,
    target_address: targetAddress,
    preference: data?.[0]?.preference || preference,
    active: Boolean(data?.[0]?.active),
  };
}

async function listEditorialAuthorPreferences(readerAddress: string) {
  const { data, error } = await supabase
    .from('editorial_author_preferences')
    .select('target_address, preference, updated_at')
    .eq('reader_address', readerAddress)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const displayNames = await loadDisplayNames(
    (data || []).map((row: any) => row.target_address)
  );

  return (data || []).map((row: any) => ({
    target_address: row.target_address,
    preference: row.preference,
    display_name: displayNames.get(row.target_address) || '',
    updated_at: row.updated_at,
  }));
}

async function recordEditorialReport(
  reporterAddress: string,
  targetKind: string,
  messageId?: string,
  profileAddress?: string,
) {
  const { data, error } = await supabase.rpc('record_editorial_report', {
    p_reporter_address: reporterAddress,
    p_target_kind: targetKind,
    p_message_id: messageId || null,
    p_profile_address: profileAddress || null,
  });

  if (error) {
    if (error.message?.includes('introuvable')) {
      throw new OperationError(error.message.includes('Profil') ? 'Profil introuvable' : 'Publication introuvable', 404);
    }
    throw error;
  }

  const report = data?.[0];
  return {
    success: true,
    created: Boolean(report?.created),
    report_count: Number(report?.report_count) || 0,
  };
}

async function upsertProfile(address: string, displayName: string, bio: string = '') {
  const cleanedDisplayName = displayName.trim();
  const cleanedBio = bio.trim();

  if (cleanedDisplayName.length < 3 || cleanedDisplayName.length > 50) {
    throw new OperationError('Le pseudo doit contenir entre 3 et 50 caractères');
  }

  const now = new Date().toISOString();

  const { data: duplicateProfile, error: duplicateError } = await supabase
    .from('user_profiles')
    .select('bitcoin_address')
    .ilike('display_name', cleanedDisplayName)
    .neq('bitcoin_address', address)
    .maybeSingle();

  if (duplicateError) throw duplicateError;
  if (duplicateProfile) {
    throw new OperationError('Ce pseudo est déjà pris', 409);
  }

  const { data: existingProfile, error: fetchError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('bitcoin_address', address)
    .maybeSingle();

  if (fetchError) throw fetchError;

  try {
    if (existingProfile) {
      const { data: updatedProfile, error: updateError } = await supabase
        .from('user_profiles')
        .update({
          display_name: cleanedDisplayName,
          bio: cleanedBio,
          updated_at: now
        })
        .eq('bitcoin_address', address)
        .select()
        .single();

      if (updateError) throw updateError;

      return {
        success: true,
        profile: updatedProfile
      };
    }

    const { data: createdProfile, error: insertError } = await supabase
      .from('user_profiles')
      .insert({
        bitcoin_address: address,
        display_name: cleanedDisplayName,
        bio: cleanedBio,
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return {
      success: true,
      profile: createdProfile
    };
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new OperationError('Ce pseudo est déjà pris', 409);
    }
    throw error;
  }
}

// ========================================
// OPÉRATION 1 : SYNC BALANCE
// ========================================
async function syncBalance(address: string, network: string) {
  console.log('🔄 [SYNC] Démarrage');
  
  try {
    // Timestamp the observation before the HTTP request. If two explorer calls
    // overlap, the database can reject the older response even if it arrives last.
    const observedAt = new Date().toISOString();
    const newBtcBalance = await fetchBitcoinBalance(address);
    console.log('💰 Solde BTC détecté:', newBtcBalance);

    const { data, error } = await supabase.rpc('reconcile_bitcoin_balance_v2', {
      p_bitcoin_address: address,
      p_btc_balance: newBtcBalance,
      p_observed_at: observedAt,
    });
    if (error) throw error;
    const updatedUser = data?.[0];
    if (!updatedUser) throw new Error('Utilisateur non trouvé');
    const delta = Number(updatedUser.balance_delta) || 0;

    console.log('📊 Delta BTC:', delta);

    console.log('✅ [SYNC] Terminé');
    
    return {
      success: true,
      user: updatedUser,
      delta: delta
    };
    
  } catch (error: any) {
    console.error('❌ [SYNC] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

// ========================================
// OPÉRATION 2 : PUBLISH_MESSAGE
// ========================================
async function publishMessage(
  address: string,
  content: string,
  requestId: string,
  parentId?: string
) {
  console.log('📝 [PUBLISH_MESSAGE] Nouveau message');

  try {
    if (parentId) await assertEditorialInteractionAllowed(address, parentId);

    const { data, error } = await supabase.rpc('publish_message_with_cost_idempotent', {
      p_request_id: requestId,
      p_bitcoin_address: address,
      p_content: content,
      p_parent_id: parentId || null,
    });
    if (error) {
      const expectedMessages = [
        'Solde insuffisant',
        'Utilisateur introuvable',
        'Publication parente introuvable',
        'Le message ne peut pas être vide',
        'Le message ne peut pas dépasser 1000 caractères',
        'Identifiant de requête déjà utilisé avec des paramètres différents',
      ];
      const expected = expectedMessages.find((message) => error.message?.includes(message));
      if (expected) {
        const status = expected.includes('introuvable')
          ? 404
          : expected.includes('déjà utilisé')
            ? 409
            : 400;
        throw new OperationError(expected, status);
      }
      throw error;
    }

    const charged = data?.[0];
    if (!charged?.created_message) throw new Error('Le message n’a pas pu être publié');
    const updatedUser = {
      bitcoin_address: address,
      btc_balance: Number(charged.btc_balance) || 0,
      shells_balance: Number(charged.new_balance) || 0,
      shells_spent_total: Number(charged.shells_spent_total) || 0,
    };

    console.log('✅ [PUBLISH_MESSAGE] Message publié');
    
    return {
      success: true,
      message: charged.created_message,
      user: updatedUser
    };
    
  } catch (error: any) {
    console.error('❌ [PUBLISH_MESSAGE] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

async function repostMessage(address: string, messageId: string, quoteContent?: string | null) {
  await assertEditorialInteractionAllowed(address, messageId);

  const { data, error } = await supabase.rpc('toggle_or_create_message_repost', {
    p_bitcoin_address: address,
    p_target_message_id: messageId,
    p_quote_content: quoteContent || null,
  });

  if (error) {
    const expectedMessages = [
      'Publication introuvable',
      'Publication originale introuvable',
      'Vous ne pouvez pas reposter votre propre publication',
      'La citation ne peut pas dépasser 1000 caractères',
      'Solde insuffisant',
    ];
    const expected = expectedMessages.find((message) => error.message?.includes(message));
    if (expected) throw new OperationError(expected, expected.includes('introuvable') ? 404 : 400);
    throw error;
  }

  const result = data?.[0];
  if (!result) throw new Error('Le repost n’a pas pu être enregistré');
  return {
    success: true,
    active: Boolean(result.active),
    reposts_count: Number(result.repost_count) || 0,
    new_balance: Number(result.new_balance) || 0,
    shells_spent_total: Number(result.shells_spent_total) || 0,
    message: result.created_message || null,
  };
}

// ========================================
// OPÉRATION 3 : GET_MESSAGES
// ========================================
async function getMessages(
  limit: number = 20,
  offset: number = 0,
  userAddress?: string,
  parentId?: string,
  sortMode: string = 'recent'
) {
  console.log('📨 [GET_MESSAGES] Params reçus:', {
    limit,
    offset,
    userAddress: userAddress?.slice(0, 8),
    parentId,
    sortMode
  });

  try {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || FEED_BATCH_SIZE, FEED_BATCH_SIZE));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    const safeSortMode = !parentId && ['followed', 'for_you'].includes(sortMode)
      ? sortMode
      : 'recent';
    let followedAddresses: string[] = [];
    let rankedMessageIds: string[] = [];
    let rankScoreByMessageId = new Map<string, number>();
    const editorialPolicy = userAddress
      ? await loadEditorialPolicy(userAddress)
      : { hiddenAuthors: new Set<string>(), reducedAuthors: new Set<string>(), blockedAuthors: new Set<string>() };

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
        return { success: true, messages: [], count: 0 };
      }
    }

    if (safeSortMode === 'for_you' && userAddress) {
      const { data: ranked, error: rankingError } = await supabase.rpc('rank_for_you_feed', {
        p_bitcoin_address: userAddress,
        p_limit: boundedLimit,
      });
      if (rankingError) throw rankingError;
      rankedMessageIds = (ranked || []).map((row: any) => row.message_id).filter(Boolean);
      rankScoreByMessageId = new Map(
        (ranked || []).map((row: any) => [row.message_id, Number(row.rank_score) || 0])
      );
      if (rankedMessageIds.length === 0) {
        return { success: true, messages: [], count: 0 };
      }
    }

    let query = supabase
      .from('messages')
      .select(`
        *,
        comments:messages!parent_id(count),
        reposts:messages!repost_of(count)
      `)
      .is('deleted_at', null);

    query = parentId
      ? query.eq('parent_id', parentId)
      : query.is('parent_id', null);

    if (safeSortMode === 'followed') query = query.in('bitcoin_address', followedAddresses);
    if (safeSortMode === 'for_you') query = query.in('id', rankedMessageIds);
    if (editorialPolicy.hiddenAuthors.size > 0) {
      const hiddenList = [...editorialPolicy.hiddenAuthors].map((value) => `"${value}"`).join(',');
      query = query.not('bitcoin_address', 'in', `(${hiddenList})`);
    }

    let messagesResult;
    if (safeSortMode === 'for_you') {
      messagesResult = await query;
    } else {
      messagesResult = await query
        .order('created_at', { ascending: false })
        .range(boundedOffset, boundedOffset + boundedLimit - 1);
    }

    const { data: messages, error } = messagesResult;

    if (error) throw error;

    const riskScoreByMessageId = safeSortMode === 'for_you'
      ? await loadEditorialRiskScores((messages || []).map((message: any) => message.id))
      : new Map<string, number>();
    const sortedMessageList = safeSortMode === 'for_you'
      ? [...(messages || [])].sort((left: any, right: any) => {
          const adjustedScore = (message: any) => {
            const authorMultiplier = editorialPolicy.reducedAuthors.has(message.bitcoin_address) ? 0.45 : 1;
            const riskMultiplier = 1 - Math.min(0.9, riskScoreByMessageId.get(message.id) || 0) * 0.60;
            return (rankScoreByMessageId.get(message.id) || 0) * authorMultiplier * riskMultiplier;
          };
          return adjustedScore(right) - adjustedScore(left);
        })
      : messages || [];
    const originalIds = [...new Set(sortedMessageList.map((message: any) => message.repost_of).filter(Boolean))];
    let originalById = new Map<string, any>();
    if (originalIds.length > 0) {
      const { data: originals, error: originalsError } = await supabase
        .from('messages')
        .select('id, bitcoin_address, content, created_at, useful_count')
        .in('id', originalIds)
        .is('deleted_at', null);
      if (originalsError) throw originalsError;
      originalById = new Map((originals || []).map((original: any) => [original.id, original]));
    }
    // A hidden or blocked author must not reappear indirectly through somebody
    // else's repost.
    const messageList = sortedMessageList.filter((message: any) => {
      const originalAuthor = originalById.get(message.repost_of)?.bitcoin_address;
      return !originalAuthor || !editorialPolicy.hiddenAuthors.has(originalAuthor);
    });
    const messageIds = messageList.map((message: any) => message.id);
    const repostTargetIds = messageList.map((message: any) => message.repost_of || message.id);
    const profileMap = await loadDisplayNames(messageList.flatMap((message: any) => [
      message.bitcoin_address,
      originalById.get(message.repost_of)?.bitcoin_address,
    ]));

    let usefulMessageIds = new Set<string>();
    let repostedTargetIds = new Set<string>();
    if (userAddress && messageIds.length > 0) {
      const [usefulVotesResult, repostsResult] = await Promise.all([
        supabase
          .from('message_useful_votes')
          .select('message_id')
          .eq('bitcoin_address', userAddress)
          .in('message_id', messageIds),
        supabase
          .from('messages')
          .select('repost_of')
          .eq('bitcoin_address', userAddress)
          .eq('repost_kind', 'simple')
          .is('deleted_at', null)
          .in('repost_of', repostTargetIds),
      ]);

      if (usefulVotesResult.error) throw usefulVotesResult.error;
      if (repostsResult.error) throw repostsResult.error;
      usefulMessageIds = new Set((usefulVotesResult.data || []).map((vote: any) => vote.message_id));
      repostedTargetIds = new Set((repostsResult.data || []).map((repost: any) => repost.repost_of));
    }

    const formatted = messageList.map((message: any) => ({
      ...message,
      display_name: profileMap.get(message.bitcoin_address) || null,
      reposted_message: originalById.has(message.repost_of) ? {
        ...originalById.get(message.repost_of),
        display_name: profileMap.get(originalById.get(message.repost_of).bitcoin_address) || null,
      } : null,
      useful_count: Number(message.useful_count) || 0,
      comments_count: message.comments?.[0]?.count || 0,
      reposts_count: message.reposts?.[0]?.count || 0,
      user_has_marked_useful: usefulMessageIds.has(message.id),
      user_has_reposted: repostedTargetIds.has(message.repost_of || message.id)
    }));

    console.log(`✅ [GET_MESSAGES] ${formatted.length} ${parentId ? 'commentaires' : 'messages'}`);

    return {
      success: true,
      messages: formatted,
      count: formatted.length
    };
  } catch (error: any) {
    console.error('❌ [GET_MESSAGES] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

async function toggleMessageUseful(address: string, messageId: string) {
  await assertEditorialInteractionAllowed(address, messageId);

  const { data, error } = await supabase.rpc('toggle_message_useful_with_cost', {
    p_message_id: messageId,
    p_bitcoin_address: address
  });

  if (error) throw error;

  const result = data?.[0];
  if (!result) throw new Error('Le vote Useful n’a pas pu être enregistré');

  return {
    success: true,
    active: Boolean(result.active),
    useful_count: Number(result.useful_count) || 0,
    new_balance: Number(result.new_balance) || 0,
    shells_spent_total: Number(result.shells_spent_total) || 0,
    cost: Number(result.cost) || 0
  };
}

async function recordForYouFeedback(address: string, messageId: string) {
  const { error } = await supabase.rpc('record_for_you_feedback', {
    p_bitcoin_address: address,
    p_message_id: messageId,
    p_feedback_kind: 'not_interested'
  });

  if (error) {
    if (error.message?.includes('Publication introuvable')) {
      throw new OperationError('Publication introuvable', 404);
    }
    throw error;
  }

  return { success: true, message_id: messageId, feedback: 'not_interested' };
}

async function recordForYouImpressions(address: string, requestId: string, messageIds: string[]) {
  if (messageIds.length === 0) return;

  const { error } = await supabase.rpc('record_for_you_impressions', {
    p_bitcoin_address: address,
    p_request_id: requestId,
    p_message_ids: messageIds,
  });

  // Impression analytics must never hide content after the paid read succeeds.
  if (error) console.error('❌ [FOR_YOU_IMPRESSIONS] Comptage impossible:', safeErrorForLog(error));
}

function shuffleItems<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

async function recordMessageExposures(messageIds: string[]) {
  const uniqueMessageIds = [...new Set(messageIds.filter(Boolean))];
  if (uniqueMessageIds.length === 0) return;

  const { error } = await supabase.rpc('record_opinion_message_exposures', {
    p_message_ids: uniqueMessageIds
  });

  // A metrics failure must not hide content after a reader has paid for it.
  if (error) {
    console.error('❌ [EXPOSURES] Comptage impossible:', safeErrorForLog(error));
  }
}

function compareOpinionCandidates(left: any, right: any) {
  const qualityDelta = (Number(right.internal_quality_score) || 0)
    - (Number(left.internal_quality_score) || 0);
  if (qualityDelta !== 0) return qualityDelta;

  const usefulDelta = (Number(right.useful_count) || 0)
    - (Number(left.useful_count) || 0);
  if (usefulDelta !== 0) return usefulDelta;

  const relevanceDelta = (Number(right.internal_relevance_score) || 0)
    - (Number(left.internal_relevance_score) || 0);
  if (relevanceDelta !== 0) return relevanceDelta;

  return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
}

function compareOpinionTopics(left: any, right: any) {
  const lifecycleRank: Record<string, number> = {
    hot: 0,
    emerging: 1,
    declining: 2
  };
  const statusDelta = (lifecycleRank[left.trend_status] ?? 3)
    - (lifecycleRank[right.trend_status] ?? 3);
  if (statusDelta !== 0) return statusDelta;

  const leftWindow = Number(left.trend_window_minutes) || Number.MAX_SAFE_INTEGER;
  const rightWindow = Number(right.trend_window_minutes) || Number.MAX_SAFE_INTEGER;
  if (leftWindow !== rightWindow) return leftWindow - rightWindow;

  const scoreDelta = (Number(right.internal_trend_score) || 0)
    - (Number(left.internal_trend_score) || 0);
  if (scoreDelta !== 0) return scoreDelta;

  const accelerationDelta = (Number(right.internal_acceleration_ratio) || 0)
    - (Number(left.internal_acceleration_ratio) || 0);
  if (accelerationDelta !== 0) return accelerationDelta;

  return (Number(left.sort_rank) || 0) - (Number(right.sort_rank) || 0);
}

async function getOpinionTopics(address: string) {
  const { error: refreshError } = await supabase.rpc(
    'refresh_active_opinion_cycle_quality'
  );
  if (refreshError) throw refreshError;

  const { data: topics, error: topicsError } = await supabase
    .from('opinion_topics')
    .select('id, slug, category, title, question, sort_rank')
    .eq('status', 'active')
    .order('sort_rank', { ascending: true })
    .order('created_at', { ascending: false });

  if (topicsError) throw topicsError;

  const topicList = topics || [];
  if (topicList.length === 0) {
    return { success: true, topics: [] };
  }

  const allTopicIds = topicList.map((topic: any) => topic.id);
  const { data: trends, error: trendsError } = await supabase
    .from('opinion_topic_trends')
    .select(`
      topic_id,
      lifecycle_status,
      dominant_window_minutes,
      trend_score,
      acceleration_ratio,
      calculated_at
    `)
    .in('topic_id', allTopicIds);

  if (trendsError) throw trendsError;

  const trendByTopic = new Map(
    (trends || []).map((trend: any) => [trend.topic_id, trend])
  );
  const rankedTopicList = topicList
    .map((topic: any) => {
      const trend: any = trendByTopic.get(topic.id);
      return {
        ...topic,
        trend_status: trend?.lifecycle_status || 'emerging',
        trend_window_minutes: trend?.dominant_window_minutes || null,
        internal_trend_score: Number(trend?.trend_score) || 0,
        internal_acceleration_ratio: Number(trend?.acceleration_ratio) || 1
      };
    })
    .filter((topic: any) => topic.trend_status !== 'archived')
    .sort(compareOpinionTopics);

  if (rankedTopicList.length === 0) {
    return { success: true, topics: [] };
  }

  const topicIds = rankedTopicList.map((topic: any) => topic.id);
  const { data: cycles, error: cyclesError } = await supabase
    .from('opinion_topic_cycles')
    .select('id, topic_id, starts_at')
    .eq('status', 'open')
    .in('topic_id', topicIds);

  if (cyclesError) throw cyclesError;

  const cycleList = cycles || [];
  const cycleIds = cycleList.map((cycle: any) => cycle.id);
  const [scoresResult, qualityResult, stancesResult] = await Promise.all([
    supabase
      .from('opinion_message_topic_scores')
      .select('topic_id, message_id, relevance_score, is_primary, classified_at')
      .eq('accepted', true)
      .in('topic_id', topicIds),
    cycleIds.length > 0
      ? supabase
        .from('opinion_cycle_message_quality')
        .select('cycle_id, message_id, quality_score, calculated_at')
        .in('cycle_id', cycleIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('private_topic_stances')
      .select('topic_id, stance')
      .eq('bitcoin_address', address)
      .in('topic_id', topicIds)
  ]);

  if (scoresResult.error) throw scoresResult.error;
  if (qualityResult.error) throw qualityResult.error;
  if (stancesResult.error) throw stancesResult.error;

  const cycleByTopic = new Map(
    cycleList.map((cycle: any) => [cycle.topic_id, cycle])
  );
  const qualityByCycleAndMessage = new Map(
    (qualityResult.data || []).map((quality: any) => [
      `${quality.cycle_id}:${quality.message_id}`,
      quality
    ])
  );
  const mappings = (scoresResult.data || [])
    .map((score: any) => {
      const cycle: any = cycleByTopic.get(score.topic_id);
      if (!cycle) return null;

      const quality: any = qualityByCycleAndMessage.get(
        `${cycle.id}:${score.message_id}`
      );
      if (!quality) return null;

      return {
        topic_id: score.topic_id,
        message_id: score.message_id,
        relevance_score: Number(score.relevance_score) || 0,
        quality_score: Number(quality.quality_score) || 0
      };
    })
    .filter(Boolean);
  const messageIds = [...new Set(mappings.map((mapping: any) => mapping.message_id))];
  const stanceByTopic = new Map(
    (stancesResult.data || []).map((stance: any) => [stance.topic_id, stance.stance])
  );

  let messageList: Array<any> = [];
  let usefulMessageIds = new Set<string>();

  if (messageIds.length > 0) {
    const [messagesResult, usefulVotesResult] = await Promise.all([
      supabase
        .from('messages')
        .select(`
          *,
          comments:messages!parent_id(count),
          reposts:messages!repost_of(count)
        `)
        .in('id', messageIds)
        .is('deleted_at', null),
      supabase
        .from('message_useful_votes')
        .select('message_id')
        .eq('bitcoin_address', address)
        .in('message_id', messageIds)
    ]);

    if (messagesResult.error) throw messagesResult.error;
    if (usefulVotesResult.error) throw usefulVotesResult.error;

    messageList = messagesResult.data || [];
    usefulMessageIds = new Set(
      (usefulVotesResult.data || []).map((vote: any) => vote.message_id)
    );
  }

  const profileMap = await loadDisplayNames(
    messageList.map((message: any) => message.bitcoin_address)
  );
  const messageById = new Map(messageList.map((message: any) => [message.id, message]));
  const topicTarget = 8;

  const formattedTopics = rankedTopicList.map((topic: any) => {
    const candidates = mappings
      .filter((mapping: any) => mapping.topic_id === topic.id)
      .map((mapping: any) => {
        const message = messageById.get(mapping.message_id);
        if (!message) return null;

        return {
          ...message,
          display_name: profileMap.get(message.bitcoin_address) || null,
          useful_count: Number(message.useful_count) || 0,
          comments_count: message.comments?.[0]?.count || 0,
          reposts_count: message.reposts?.[0]?.count || 0,
          user_has_marked_useful: usefulMessageIds.has(message.id),
          internal_quality_score: Number(mapping.quality_score) || 0,
          internal_relevance_score: Number(mapping.relevance_score) || 0
        };
      })
      .filter(Boolean);

    const selected = candidates
      .sort(compareOpinionCandidates)
      .slice(0, topicTarget);

    const publicPosts = shuffleItems(selected.slice(0, topicTarget)).map((candidate: any) => {
      const {
        internal_quality_score: _quality,
        internal_relevance_score: _relevance,
        comments: _comments,
        reposts: _reposts,
        ...publicPost
      } = candidate;

      return publicPost;
    });

    return {
      id: topic.id,
      slug: topic.slug,
      category: topic.category,
      title: topic.title,
      question: topic.question,
      trend_status: topic.trend_status,
      trend_window_minutes: topic.trend_window_minutes,
      posts: publicPosts,
      private_stance: stanceByTopic.get(topic.id) || 'undecided'
    };
  });

  await recordMessageExposures(
    formattedTopics.flatMap((topic: any) =>
      topic.posts.map((post: any) => post.id)
    )
  );

  return {
    success: true,
    topics: formattedTopics
  };
}

async function setPrivateTopicStance(address: string, topicId: string, stance: string) {
  const allowedStances = new Set(['for', 'against', 'undecided', 'learning']);
  if (!allowedStances.has(stance)) throw new Error('Position privée invalide');

  const { data: topic, error: topicError } = await supabase
    .from('opinion_topics')
    .select('id')
    .eq('id', topicId)
    .eq('status', 'active')
    .maybeSingle();

  if (topicError) throw topicError;
  if (!topic) throw new Error('Sujet introuvable');

  const now = new Date().toISOString();
  const { error: stanceError } = await supabase
    .from('private_topic_stances')
    .upsert({
      topic_id: topicId,
      bitcoin_address: address,
      stance,
      updated_at: now
    }, {
      onConflict: 'topic_id,bitcoin_address'
    });

  if (stanceError) throw stanceError;

  return {
    success: true,
    topic_id: topicId,
    stance
  };
}

// ========================================
// OPÉRATION 4 : GET_USER_MESSAGES (historique utilisateur)
// ========================================
async function getUserMessages(address: string, limit: number = 20, offset: number = 0) {
  console.log('📜 [GET_USER_MESSAGES] Récupération | Limit:', limit, '| Offset:', offset);
  
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select(`
        *,
        comments:messages!parent_id(count),
        reposts:messages!repost_of(count)
      `)
      .eq('bitcoin_address', address)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const originalIds = [...new Set((messages || []).map((msg: any) => msg.repost_of).filter(Boolean))];
    let originalById = new Map<string, any>();
    if (originalIds.length > 0) {
      const { data: originals, error: originalsError } = await supabase
        .from('messages')
        .select('id, bitcoin_address, content, created_at, useful_count')
        .in('id', originalIds)
        .is('deleted_at', null);
      if (originalsError) throw originalsError;
      originalById = new Map((originals || []).map((original: any) => [original.id, original]));
    }

    const profileMap = await loadDisplayNames((messages || []).flatMap((msg: any) => [
      msg.bitcoin_address,
      originalById.get(msg.repost_of)?.bitcoin_address,
    ]));

    const enrichedMessages = (messages || []).map((msg: any) => ({
      ...msg,
      display_name: profileMap.get(msg.bitcoin_address) || null,
      reposted_message: originalById.has(msg.repost_of) ? {
        ...originalById.get(msg.repost_of),
        display_name: profileMap.get(originalById.get(msg.repost_of).bitcoin_address) || null,
      } : null,
      comments_count: msg.comments?.[0]?.count || 0,
      reposts_count: msg.reposts?.[0]?.count || 0
    }));

    console.log(`✅ [GET_USER_MESSAGES] ${messages?.length || 0} messages récupérés`);

    return {
      success: true,
      messages: enrichedMessages,
      count: messages?.length || 0
    };
    
  } catch (error: any) {
    console.error('❌ [GET_USER_MESSAGES] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

// ========================================
// OPÉRATION 5 : GET_STATS
// ========================================
async function getStats(address: string) {
  console.log('📊 [GET_STATS] Récupération');
  
  try {
    const { data: balance, error: balanceError } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', address)
      .single();

    if (balanceError) throw balanceError;

    // Compter messages publiés
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('cost_shells')
      .eq('bitcoin_address', address);

    if (messagesError) throw messagesError;

    const totalMessages = messages?.length || 0;
    const totalCost = messages?.reduce((sum: number, msg: any) => sum + parseFloat(msg.cost_shells), 0) || 0;
    const avgCost = totalMessages > 0 ? totalCost / totalMessages : 0;

    console.log('✅ [GET_STATS] Terminé');
    
    return {
      success: true,
      stats: {
        btc_balance: balance.btc_balance,
        shells_available: balance.shells_balance,
        shells_spent_total: balance.shells_spent_total || 0,
        total_messages: totalMessages,
        total_cost_messages: totalCost,
        average_cost_per_message: avgCost,
        characters_remaining: Math.floor(balance.shells_balance / MESSAGE_COST_PER_CHAR)
      }
    };
    
  } catch (error: any) {
    console.error('❌ [GET_STATS] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

function summarizeContent(content: string | null | undefined, maxLength: number = 70) {
  const cleaned = (content || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'No content';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function toShellAmount(value: number | string | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

// ========================================
// OPÉRATION 6 : GET_HISTORY
// ========================================
async function getHistory(address: string, limit: number = 20) {
  console.log('🧾 [GET_HISTORY] Récupération | Limit:', limit);

  try {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 50));

    const [
      { data: messages, error: messagesError },
      { data: likes, error: likesError },
      { data: dislikes, error: dislikesError },
      { data: actions, error: actionsError }
    ] = await Promise.all([
      supabase
        .from('messages')
        .select('id, content, char_count, cost_shells, created_at, parent_id, repost_of, repost_kind')
        .eq('bitcoin_address', address)
        .order('created_at', { ascending: false })
        .limit(boundedLimit),
      supabase
        .from('message_likes')
        .select('id, message_id, created_at')
        .eq('bitcoin_address', address)
        .order('created_at', { ascending: false })
        .limit(boundedLimit),
      supabase
        .from('message_dislikes')
        .select('id, message_id, created_at')
        .eq('bitcoin_address', address)
        .order('created_at', { ascending: false })
        .limit(boundedLimit),
      supabase
        .from('transactions')
        .select('id, amount, type, game_score, created_at')
        .eq('bitcoin_address', address)
        .in('type', ['game', 'canvas', 'read_messages', 'social_useful'])
        .order('created_at', { ascending: false })
        .limit(boundedLimit)
    ]);

    if (messagesError) throw messagesError;
    if (likesError) throw likesError;
    if (dislikesError) throw dislikesError;
    if (actionsError) throw actionsError;

    const history: Array<any> = [];

    (messages || []).forEach((message: any) => {
      const amount = toShellAmount(message.cost_shells);
      if (amount === 0) return;

      const isComment = Boolean(message.parent_id);
      const isRepost = Boolean(message.repost_of);
      const isQuote = message.repost_kind === 'quote';

      history.push({
        id: `message:${message.id}`,
        type: isComment ? 'comment' : isRepost ? 'repost' : 'message',
        amount: -amount,
        created_at: message.created_at,
        title: isComment ? 'Comment' : isQuote ? 'Quoted repost' : isRepost ? 'Repost' : 'Message',
        description: isRepost && !isQuote
          ? 'Reposted a publication'
          : summarizeContent(message.content),
        detail: `${message.char_count || 0} characters`
      });
    });

    const targetIds = [
      ...(likes || []).map((item: any) => item.message_id),
      ...(dislikes || []).map((item: any) => item.message_id)
    ].filter(Boolean);

    let targetMessagesById = new Map<string, any>();
    if (targetIds.length > 0) {
      const { data: targetMessages, error: targetMessagesError } = await supabase
        .from('messages')
        .select('id, content, parent_id')
        .in('id', targetIds);

      if (targetMessagesError) throw targetMessagesError;

      targetMessagesById = new Map((targetMessages || []).map((message: any) => [message.id, message]));
    }

    (likes || []).forEach((like: any) => {
      const target = targetMessagesById.get(like.message_id);
      const targetType = target?.parent_id ? 'comment' : 'post';

      history.push({
        id: `like:${like.id}`,
        type: 'like',
        amount: -0.00000001,
        created_at: like.created_at,
        title: 'Like',
        description: target
          ? `On ${targetType}: ${summarizeContent(target.content)}`
          : 'On a deleted post',
        detail: '1 satoshi'
      });
    });

    (dislikes || []).forEach((dislike: any) => {
      const target = targetMessagesById.get(dislike.message_id);
      const targetType = target?.parent_id ? 'comment' : 'post';

      history.push({
        id: `dislike:${dislike.id}`,
        type: 'dislike',
        amount: -0.00000001,
        created_at: dislike.created_at,
        title: 'Dislike',
        description: target
          ? `On ${targetType}: ${summarizeContent(target.content)}`
          : 'On a deleted post',
        detail: '1 satoshi'
      });
    });

    (actions || []).forEach((action: any) => {
      const amount = toShellAmount(action.amount);
      if (amount === 0) return;

      const actionType = action.type === 'game'
        ? 'game'
        : action.type === 'canvas'
          ? 'canvas'
          : action.type === 'social_useful'
            ? 'useful'
            : 'read_messages';

      const labels: Record<string, { title: string; description: string; detail: string }> = {
        game: {
          title: 'Mini-game',
          description: action.game_score !== null && action.game_score !== undefined
            ? `Session score: ${action.game_score} points`
            : 'Game session',
          detail: `${amount.toFixed(8)} shells spent`
        },
        canvas: {
          title: 'Canvas',
          description: `${Math.round(amount / 0.00000001)} pixels placed`,
          detail: `${amount.toFixed(8)} shells spent`
        },
        read_messages: {
          title: 'Feed reading',
          description: `${Math.round(amount / 0.00000001)} messages loaded`,
          detail: `${amount.toFixed(8)} shells spent`
        },
        useful: {
          title: 'Useful',
          description: 'Marked a post or comment as useful',
          detail: `${amount.toFixed(8)} shells spent`
        }
      };

      const label = labels[actionType];

      history.push({
        id: `${actionType}:${action.id}`,
        type: actionType,
        amount: -amount,
        created_at: action.created_at,
        title: label.title,
        description: label.description,
        detail: label.detail
      });
    });

    const sortedHistory = history
      .sort((left, right) => {
        const leftTime = new Date(left.created_at).getTime() || 0;
        const rightTime = new Date(right.created_at).getTime() || 0;
        return rightTime - leftTime;
      })
      .slice(0, boundedLimit);

    console.log(`✅ [GET_HISTORY] ${sortedHistory.length} événements récupérés`);

    return {
      success: true,
      history: sortedHistory,
      count: sortedHistory.length
    };

  } catch (error: any) {
    console.error('❌ [GET_HISTORY] Erreur:', safeErrorForLog(error));
    throw error;
  }
}


// ========================================
// OPÉRATION 7 : DEDUCT (Déduire shells)
// ========================================
async function deductShells(address: string) {
  const amount = GAME_COST;
  console.log('💳 [DEDUCT] Déduction de', amount, 'shells');

  try {
    const { data, error } = await supabase.rpc('charge_game', {
      p_bitcoin_address: address,
    });
    if (error) {
      if (error.message?.includes('Solde insuffisant')) {
        throw new OperationError('Solde insuffisant');
      }
      if (error.message?.includes('Utilisateur introuvable')) {
        throw new OperationError('Utilisateur introuvable', 404);
      }
      throw error;
    }

    const updatedUser = data?.[0];
    if (!updatedUser) throw new Error('La partie n’a pas pu être débitée');

    console.log('✅ [DEDUCT] Terminé');
    
    return {
      success: true,
      user: updatedUser
    };
    
  } catch (error: any) {
    console.error('❌ [DEDUCT] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

// ========================================
// OPÉRATION 9 : PLACE_PIXELS (Canvas)
// ========================================
async function placePixels(address: string, pixels: Array<{ x: number; y: number; color: string }>) {
  console.log(`🎨 [PLACE_PIXELS] Placement de ${pixels.length} pixels`);
  
  try {
    // Validation des pixels
    if (!pixels || !Array.isArray(pixels) || pixels.length === 0) {
      throw new Error('Aucun pixel fourni');
    }

    if (pixels.length > 1000) {
      throw new Error('Maximum 1000 pixels par validation');
    }

    // Valider chaque pixel
    const validColors = [
      '#FFFFFF', '#E4E4E4', '#888888', '#222222',
      '#FFA7D1', '#E50000', '#E59500', '#A06A42',
      '#E5D900', '#94E044', '#02BE01', '#00D3DD',
      '#0083C7', '#0000EA', '#CF6EE4', '#820080'
    ];

    for (const pixel of pixels) {
      if (
        typeof pixel.x !== 'number' || pixel.x < 0 || pixel.x >= 100 ||
        typeof pixel.y !== 'number' || pixel.y < 0 || pixel.y >= 100 ||
        !validColors.includes(pixel.color)
      ) {
        throw new Error('Pixel invalide détecté');
      }
    }

    // Calcul du coût total
    const costPerPixel = 0.00000001;
    const totalCost = pixels.length * costPerPixel;

    console.log(`💰 Coût total: ${totalCost} shells`);

    // Vérifier le solde
    const { data: user, error: userError } = await supabase
      .from('user_balances')
      .select('shells_balance, shells_spent_total, last_sync')
      .eq('bitcoin_address', address)
      .single();

    if (userError || !user) {
      throw new Error('Utilisateur non trouvé');
    }

    if (user.shells_balance < totalCost) {
      throw new Error(`Solde insuffisant. Requis: ${totalCost} shells, Disponible: ${user.shells_balance} shells`);
    }

    // Récupérer les pixels existants pour détecter les conflits
    const { data: existingPixels, error: fetchError } = await supabase
      .from('canvas_pixels')
      .select('x, y, bitcoin_address, created_at')
      .in('x', pixels.map(p => p.x))
      .in('y', pixels.map(p => p.y));

    if (fetchError) {
      throw new Error('Erreur vérification conflits');
    }

    // Créer un map des pixels existants
    const existingMap = new Map(
      (existingPixels || []).map((p: any) => [`${p.x},${p.y}`, p])
    );

    // Séparer pixels valides et conflits
    const validPixels = [];
    const conflicts = [];
    const now = new Date().toISOString();

    for (const pixel of pixels) {
      const key = `${pixel.x},${pixel.y}`;
      const existing = existingMap.get(key);
      
      if (existing && existing.bitcoin_address !== address) {
        // Conflit : pixel appartient à quelqu'un d'autre
        conflicts.push(pixel);
      } else {
        // Pixel valide : soit nouveau, soit appartient déjà à l'utilisateur
        validPixels.push(pixel);
      }
    }

    if (validPixels.length === 0) {
      throw new Error(`Tous les pixels sont en conflit avec d'autres utilisateurs (${conflicts.length} conflits)`);
    }

    // Calculer le coût réel (seulement les pixels valides)
    const actualCost = validPixels.length * costPerPixel;

    // Débiter le solde
    const { data: updatedUser, error: updateError } = await supabase
      .from('user_balances')
      .update({
        shells_balance: user.shells_balance - actualCost,
        shells_spent_total: (user.shells_spent_total || 0) + actualCost,
        last_sync: now
      })
      .eq('bitcoin_address', address)
      .eq('last_sync', user.last_sync)
      .select()
      .single();

    if (updateError) {
      throw new Error('Erreur débit solde');
    }

    if (!updatedUser) {
      throw new Error('Conflit de synchronisation. Réessayez.');
    }

    // Insérer/Mettre à jour les pixels valides (UPSERT)
    const pixelsToUpsert = validPixels.map((p: any) => ({
      x: p.x,
      y: p.y,
      color: p.color,
      bitcoin_address: address,
      created_at: existingMap.has(`${p.x},${p.y}`) ? existingMap.get(`${p.x},${p.y}`).created_at : now,
      updated_at: now
    }));

    const { error: upsertError } = await supabase
      .from('canvas_pixels')
      .upsert(pixelsToUpsert, { onConflict: 'x,y' });

    if (upsertError) {
      console.error('❌ Erreur insertion pixels:', safeErrorForLog(upsertError));
      // Rollback: rembourser l'utilisateur
      await supabase
        .from('user_balances')
        .update({
          shells_balance: user.shells_balance,
          shells_spent_total: user.shells_spent_total,
          last_sync: user.last_sync
        })
        .eq('bitcoin_address', address);

      throw new Error('Erreur placement pixels');
    }

    // Enregistrer la transaction
    await supabase.from('transactions').insert({
      bitcoin_address: address,
      amount: -actualCost,
      type: 'canvas',
      created_at: now
    });

    console.log(`✅ [PLACE_PIXELS] ${validPixels.length} pixels placés, ${conflicts.length} conflits rejetés`);

    return {
      success: true,
      user: updatedUser,
      pixelsPlaced: validPixels.length,
      conflicts: conflicts.length
    };
    
  } catch (error: any) {
    console.error('❌ [PLACE_PIXELS] Erreur:', safeErrorForLog(error));
    throw error;
  }
}

// ========================================
// HANDLER PRINCIPAL
// ========================================
serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    assertAllowedOrigin(req);
    if (req.method !== 'POST') {
      return jsonResponse(req, { success: false, error: 'Méthode non autorisée' }, 405);
    }

    const body = await req.json();
    const {
      operation,
      jwt,
      address,
      network,
      content,
      limit,
      offset,
      pixels,
      parentId,
      displayName,
      bio,
      messageId,
      quoteContent,
      topicId,
      stance,
      sortMode,
      requestId,
      targetAddress,
      preference,
      targetKind,
      profileAddress,
    } = body;

    console.log('🔧 [HANDLER] Opération:', operation);
    console.log('🔍 [DEBUG] JWT reçu:', jwt ? 'OUI' : 'NON');

    // ========================================
    // VALIDATION JWT OBLIGATOIRE (plus d'exception)
    // ========================================
    if (!jwt) {
      throw new Error('JWT manquant - Connexion requise');
    }

    const jwtVerification = await verifyJWT(jwt);
    
    if (!jwtVerification.valid) {
      return new Response(
        JSON.stringify({ success: false, error: 'JWT invalide ou expiré' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (jwtVerification.address !== address) {
      return new Response(
        JSON.stringify({ success: false, error: 'Adresse non autorisée' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Router selon l'opération
    let result;
    
    switch (operation) {
      case 'sync':
        if (!network) throw new Error('Paramètre "network" manquant');
        result = await syncBalance(address, network);
        break;

      case 'deduct':
        // The price of a game is a server-side rule. Never trust a client amount:
        // a negative value used to turn this debit endpoint into a balance credit.
        result = await deductShells(address);
        break;

      case 'get_history':
        result = await getHistory(address, limit || 20);
        break;
      
      case 'publish_message':
        if (!content) throw new Error('Paramètre "content" manquant');
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
          throw new OperationError('Paramètre "requestId" invalide');
        }
        if (content.length > 1000) throw new Error('Message trop long (max 1000 caractères)');
        result = await publishMessage(address, content, requestId, parentId);
        break;
      
      case 'get_messages':
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
          throw new OperationError('Paramètre "requestId" invalide');
        }
        console.log('📨 [GET_MESSAGES] Demande de chargement:', limit || 20, 'messages');
        
        // ÉTAPE 1 : Charger les messages d'abord pour connaître le nombre exact
        const messagesResult = await getMessages(
          limit || 20,
          offset || 0,
          address,
          body.parentId,
          sortMode || 'recent'
        );
        
        if (!messagesResult.success) {
          throw new Error('Erreur chargement messages');
        }
        
        // One fast local transaction charges the complete page (maximum 20).
        // An empty page is also recorded (at zero cost), so a delayed duplicate
        // cannot later turn into a different, chargeable request.
        const { data: chargedRows, error: chargeError } = await supabase.rpc(
          'charge_message_batch_idempotent',
          {
            p_request_id: requestId,
            p_bitcoin_address: address,
            p_message_ids: messagesResult.messages.map((message: any) => message.id),
            p_request_context: {
              limit: Math.max(1, Math.min(Number(limit) || FEED_BATCH_SIZE, FEED_BATCH_SIZE)),
              offset: Math.max(0, Number(offset) || 0),
              parent_id: body.parentId || null,
              sort_mode: !body.parentId && ['followed', 'for_you'].includes(sortMode)
                ? sortMode
                : 'recent',
            },
            p_messages_snapshot: messagesResult.messages,
          },
        );
        if (chargeError) {
          if (chargeError.message?.includes('Solde insuffisant')) {
            throw new OperationError('Solde insuffisant pour charger les messages');
          }
          if (chargeError.message?.includes('Utilisateur introuvable')) {
            throw new OperationError('Utilisateur introuvable', 404);
          }
          if (chargeError.message?.includes('déjà utilisé')) {
            throw new OperationError(
              'Cette demande de lecture a déjà été traitée avec un autre contenu',
              409
            );
          }
          throw chargeError;
        }
        const charged = chargedRows?.[0];
        if (!charged) throw new Error('Le lot de messages n’a pas pu être débité');
        const totalCost = Number(charged.cost) || 0;
        const paidMessages = Array.isArray(charged.messages_snapshot)
          ? charged.messages_snapshot
          : messagesResult.messages;

        await recordMessageExposures(
          paidMessages.map((message: any) => message.id)
        );

        if (sortMode === 'for_you' && !body.parentId) {
          await recordForYouImpressions(
            address,
            requestId,
            paidMessages.map((message: any) => message.id)
          );
        }

        console.log(`✅ [GET_MESSAGES] ${totalCost.toFixed(8)} shells déduits`);
        
        // Retourner les 20 messages et le résultat de leur débit unique.
        result = {
          ...messagesResult,
          messages: paidMessages,
          count: paidMessages.length,
          new_balance: Number(charged.new_balance) || 0,
          cost: totalCost
        };
        break;

      case 'toggle_message_useful':
        if (!messageId) throw new Error('Paramètre "messageId" manquant');
        result = await toggleMessageUseful(address, messageId);
        break;

      case 'for_you_not_interested':
        if (!messageId) throw new OperationError('Paramètre "messageId" manquant');
        result = await recordForYouFeedback(address, messageId);
        break;

      case 'set_editorial_author_preference':
        if (!targetAddress) throw new OperationError('Paramètre "targetAddress" manquant');
        if (!['none', 'reduce', 'mute', 'block'].includes(preference)) {
          throw new OperationError('Choix éditorial invalide');
        }
        result = await setEditorialAuthorPreference(address, targetAddress, preference);
        break;

      case 'list_editorial_author_preferences':
        result = await listEditorialAuthorPreferences(address);
        break;

      case 'report_editorial_target':
        if (!['message', 'profile'].includes(targetKind)) {
          throw new OperationError('Type de signalement invalide');
        }
        if (targetKind === 'message' && !messageId) {
          throw new OperationError('Paramètre "messageId" manquant');
        }
        if (targetKind === 'profile' && !profileAddress) {
          throw new OperationError('Paramètre "profileAddress" manquant');
        }
        result = await recordEditorialReport(
          address,
          targetKind,
          messageId,
          profileAddress,
        );
        break;

      case 'repost_message':
        if (!messageId) throw new OperationError('Paramètre "messageId" manquant');
        result = await repostMessage(address, messageId, quoteContent);
        break;

      case 'get_opinion_topics':
        result = await getOpinionTopics(address);
        break;

      case 'set_private_topic_stance':
        if (!topicId) throw new Error('Paramètre "topicId" manquant');
        if (!stance) throw new Error('Paramètre "stance" manquant');
        result = await setPrivateTopicStance(address, topicId, stance);
        break;

      case 'get_user_messages':
        result = await getUserMessages(address, limit || 20, offset || 0);
        break;
      
      case 'get_stats':
        result = await getStats(address);
        break;

      case 'upsert_profile':
        if (!displayName) throw new Error('Paramètre "displayName" manquant');
        result = await upsertProfile(address, displayName, bio || '');
        break;

      case 'place_pixels':
        result = await placePixels(address, pixels);
        break;
      
      default:
        throw new Error(`Opération inconnue: ${operation}`);
    }

    return jsonResponse(req, result, 200);

  } catch (error: any) {
    console.error('❌ [HANDLER] Erreur:', safeErrorForLog(error));
    const status = error?.message === 'Origin not allowed'
      ? 403
      : error instanceof OperationError
        ? error.status
        : 500;
    const publicMessage = status === 500
      ? 'Une erreur interne est survenue. Veuillez réessayer.'
      : error?.message || 'Requête invalide';

    return jsonResponse(req, { success: false, error: publicMessage }, status);
  }
});
