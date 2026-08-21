// ========================================
// EDGE FUNCTION : user-operations
// Gère toutes les opérations utilisateur AVEC vérification JWT
// ========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.78.0';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.750.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.750.0';
import {
  assertAllowedOrigin,
  corsHeaders as buildCorsHeaders,
  jsonResponse,
  verifyAccessToken,
} from '../_shared/auth.ts';
import { safeErrorForLog } from '../_shared/logging.mjs';
import { OperationError } from '../_shared/operation-error.mjs';
import {
  attachFeedPageContext,
  extractFeedPageSnapshot,
  FEED_BATCH_SIZE,
} from '../_shared/feed-pagination.mjs';
import {
  enrichSocialMessages,
  loadDisplayNames as loadSharedDisplayNames,
  SOCIAL_MESSAGE_SELECT,
} from '../_shared/social-messages.mjs';
import {
  getMessages,
  recordForYouFeedback,
  recordForYouImpressions,
} from './feed-service.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID') ?? '';
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID') ?? '';
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '';
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME') ?? '';
const R2_PUBLIC_BASE_URL = (Deno.env.get('R2_PUBLIC_BASE_URL') ?? '').replace(/\/$/, '');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// === CONSTANTES ===
const MESSAGE_COST_PER_CHAR = 1; // 1 satoshi = 1 shell
const GAME_COST = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PROFILE_MEDIA_BYTES = 5 * 1024 * 1024;
const POST_MEDIA_TYPES = new Set(['image/jpeg', 'image/webp']);
const MAX_POST_MEDIA_ITEMS = 3;
const MAX_POST_MEDIA_BYTES = 600 * 1024;
const MAX_POST_MEDIA_EDGE = 1600;

const r2 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

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
  return loadSharedDisplayNames(supabase, addresses);
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

async function setEditorialTopicPreference(
  readerAddress: string,
  messageId: string,
  preference: string,
) {
  const { data, error } = await supabase.rpc(
    'set_editorial_topic_preference_from_message',
    {
      p_reader_address: readerAddress,
      p_message_id: messageId,
      p_preference: preference,
    },
  );

  if (error) {
    if (error.message?.includes('Publication introuvable')) {
      throw new OperationError('Publication introuvable', 404);
    }
    if (error.message?.includes('Sujet indisponible')) {
      throw new OperationError('Aucun sujet fiable n’a été détecté pour cette publication', 409);
    }
    throw error;
  }

  return {
    success: true,
    message_id: messageId,
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

function normalizeProfileWebsite(value: string = ''): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const withProtocol = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new OperationError('Le lien du profil est invalide');
  }
  if (parsed.protocol !== 'https:') throw new OperationError('Le lien du profil doit utiliser HTTPS');
  return parsed.toString();
}

async function profileMediaPrefix(address: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `profiles/${hash.slice(0, 32)}`;
}

async function postMediaPrefix(address: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `posts/${hash.slice(0, 32)}`;
}

async function deletePostMediaObjects(objectKeys: string[]) {
  if (!r2 || !R2_BUCKET_NAME) return;
  await Promise.all(objectKeys.map((objectKey) => (
    r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey })).catch(() => null)
  )));
}

async function createPostMediaUploads(
  address: string,
  requestedFiles: Array<{ contentType?: string; fileSize?: number }>,
) {
  if (!r2 || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
    throw new OperationError('Le stockage des photos n’est pas encore configuré', 503);
  }
  if (!Array.isArray(requestedFiles) || requestedFiles.length < 1 || requestedFiles.length > MAX_POST_MEDIA_ITEMS) {
    throw new OperationError('Une publication accepte entre une et trois photos');
  }

  const normalized = requestedFiles.map((file) => ({
    contentType: typeof file?.contentType === 'string' ? file.contentType : '',
    fileSize: Number(file?.fileSize),
  }));
  for (const file of normalized) {
    if (!POST_MEDIA_TYPES.has(file.contentType)) {
      throw new OperationError('Les photos doivent être optimisées en WebP ou JPEG');
    }
    if (!Number.isFinite(file.fileSize) || file.fileSize <= 0 || file.fileSize > MAX_POST_MEDIA_BYTES) {
      throw new OperationError('Chaque photo optimisée doit peser moins de 600 Ko');
    }
  }

  const prefix = await postMediaPrefix(address);
  const batchId = crypto.randomUUID();
  const uploads = await Promise.all(normalized.map(async (file, index) => {
    const extension = file.contentType === 'image/webp' ? 'webp' : 'jpg';
    const objectKey = `${prefix}/${batchId}/${index}.${extension}`;
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
        ContentType: file.contentType,
      }),
      { expiresIn: 300 },
    );
    return { upload_url: uploadUrl, object_key: objectKey };
  }));

  return { success: true, uploads, expires_in: 300 };
}

async function discardPostMediaUploads(address: string, objectKeys: unknown) {
  const keys = Array.isArray(objectKeys)
    ? [...new Set(objectKeys.filter((key): key is string => typeof key === 'string'))]
    : [];
  const prefix = `${await postMediaPrefix(address)}/`;
  const ownedKeys = keys
    .filter((key) => key.startsWith(prefix))
    .slice(0, MAX_POST_MEDIA_ITEMS);
  const unusedChecks = await Promise.all(ownedKeys.map(async (key) => {
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .contains('media', [{ object_key: key }])
      .limit(1);
    if (error) throw error;
    return (data || []).length === 0 ? key : null;
  }));
  const unusedKeys = unusedChecks.filter((key): key is string => Boolean(key));
  await deletePostMediaObjects(unusedKeys);
  return { success: true, discarded: unusedKeys.length };
}

async function validatePostMediaUploads(address: string, objectKeys: unknown) {
  const keys = Array.isArray(objectKeys)
    ? objectKeys.filter((key): key is string => typeof key === 'string')
    : [];
  if (keys.length === 0) return [];
  if (keys.length > MAX_POST_MEDIA_ITEMS || new Set(keys).size !== keys.length) {
    throw new OperationError('Les photos de la publication sont invalides');
  }

  const prefix = `${await postMediaPrefix(address)}/`;
  const ownedKeyPattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[0-9a-f-]{36}/[0-2]\\.(webp|jpg)$`,
    'i',
  );
  if (keys.some((key) => !ownedKeyPattern.test(key))) {
    throw new OperationError('Une photo n’appartient pas à cette publication', 403);
  }

  try {
    return await Promise.all(keys.map(async (objectKey) => {
      const uploaded = await r2!.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey }));
      const bytesCount = Number(uploaded.ContentLength) || 0;
      const contentType = uploaded.ContentType || '';
      if (bytesCount <= 0 || bytesCount > MAX_POST_MEDIA_BYTES || !POST_MEDIA_TYPES.has(contentType)) {
        throw new OperationError('Une photo envoyée ne respecte pas la limite de 600 Ko');
      }

      const object = await r2!.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey }));
      const bytes = new Uint8Array(await object.Body!.transformToByteArray());
      const { width, height } = readImageDimensions(bytes, contentType);
      if (
        width < 1 || height < 1
        || width > MAX_POST_MEDIA_EDGE || height > MAX_POST_MEDIA_EDGE
        || !Number.isSafeInteger(width * height)
      ) {
        throw new OperationError('Une photo dépasse la résolution maximale de 1 600 px');
      }

      return {
        url: `${R2_PUBLIC_BASE_URL}/${objectKey}`,
        object_key: objectKey,
        width,
        height,
        bytes: bytesCount,
        content_type: contentType,
      };
    }));
  } catch (error) {
    await deletePostMediaObjects(keys);
    if (error instanceof OperationError) throw error;
    throw new OperationError('Une photo envoyée est introuvable ou invalide');
  }
}

async function createProfileMediaUpload(
  address: string,
  mediaKind: string,
  contentType: string,
  fileSize: number,
) {
  if (!r2 || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
    throw new OperationError('Le stockage des images de profil n’est pas encore configuré', 503);
  }
  if (!['avatar', 'cover'].includes(mediaKind)) throw new OperationError('Type de média invalide');
  if (!PROFILE_MEDIA_TYPES.has(contentType)) throw new OperationError('Format accepté : JPG, PNG ou WebP');
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_PROFILE_MEDIA_BYTES) {
    throw new OperationError('L’image doit peser moins de 5 Mo');
  }

  const objectKey = `${await profileMediaPrefix(address)}/${mediaKind}/${crypto.randomUUID()}`;
  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: objectKey,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );

  return { success: true, upload_url: uploadUrl, object_key: objectKey, expires_in: 300 };
}

async function confirmProfileMediaUpload(address: string, mediaKind: string, objectKey: string) {
  if (!r2 || !R2_BUCKET_NAME || !R2_PUBLIC_BASE_URL) {
    throw new OperationError('Le stockage des images de profil n’est pas encore configuré', 503);
  }
  const expectedPrefix = `${await profileMediaPrefix(address)}/${mediaKind}/`;
  if (!['avatar', 'cover'].includes(mediaKind) || !objectKey.startsWith(expectedPrefix)) {
    throw new OperationError('Média de profil invalide');
  }

  const uploaded = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey }));
  const size = Number(uploaded.ContentLength) || 0;
  const contentType = uploaded.ContentType || '';
  if (size <= 0 || size > MAX_PROFILE_MEDIA_BYTES || !PROFILE_MEDIA_TYPES.has(contentType)) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey })).catch(() => null);
    throw new OperationError('Le fichier envoyé ne respecte pas les limites du profil');
  }

  const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey }));
  const bytes = new Uint8Array(await object.Body!.transformToByteArray());
  const { width, height } = readImageDimensions(bytes, contentType);
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || width < 1 || height < 1 || width > 8192 || height > 8192 || pixels > 67108864) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey })).catch(() => null);
    throw new OperationError('Les dimensions de cette image sont trop grandes');
  }

  const publicUrl = `${R2_PUBLIC_BASE_URL}/${objectKey}`;
  const { data, error } = await supabase.rpc('set_profile_media_lock', {
    p_bitcoin_address: address,
    p_media_kind: mediaKind,
    p_pixels: pixels,
    p_public_url: publicUrl,
    p_object_key: objectKey,
  });
  if (error) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: objectKey })).catch(() => null);
    if (error.message?.includes('INSUFFICIENT_SHELLS')) throw new OperationError('INSUFFICIENT_SHELLS', 402);
    throw error;
  }
  const locked = data?.[0];
  if (locked?.old_object_key && locked.old_object_key !== objectKey) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: locked.old_object_key })).catch(() => null);
  }
  return {
    success: true,
    public_url: publicUrl,
    width,
    height,
    pixels,
    lock_delta: Number(locked?.lock_delta) || 0,
    user: {
      shells_balance: Number(locked?.new_balance) || 0,
      shells_spent_total: Number(locked?.shells_spent_total) || 0,
    },
  };
}

function readImageDimensions(bytes: Uint8Array, contentType: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isPng = bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (contentType === 'image/png' && isPng) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  const isJpeg = bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (contentType === 'image/jpeg' && isJpeg) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }
  const isWebp = bytes.length >= 30
    && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF'
    && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP';
  if (contentType === 'image/webp' && isWebp) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      const height = 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
      return { width, height };
    }
  }
  throw new OperationError('Impossible de lire les dimensions de cette image');
}

async function removeProfileMedia(address: string, mediaKind: string) {
  if (!['avatar', 'cover'].includes(mediaKind)) throw new OperationError('Type de média invalide');
  const { data, error } = await supabase.rpc('set_profile_media_lock', {
    p_bitcoin_address: address,
    p_media_kind: mediaKind,
    p_pixels: 0,
    p_public_url: null,
    p_object_key: null,
  });
  if (error) throw error;
  const unlocked = data?.[0];
  if (r2 && R2_BUCKET_NAME && unlocked?.old_object_key) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: unlocked.old_object_key })).catch(() => null);
  }
  return {
    success: true,
    public_url: null,
    pixels: 0,
    lock_delta: Number(unlocked?.lock_delta) || 0,
    user: {
      shells_balance: Number(unlocked?.new_balance) || 0,
      shells_spent_total: Number(unlocked?.shells_spent_total) || 0,
    },
  };
}

async function upsertProfile(
  address: string,
  displayName: string,
  bio: string = '',
  location: string = '',
  websiteUrl: string = '',
) {
  const cleanedDisplayName = displayName.trim();
  const cleanedBio = bio.trim();
  const cleanedLocation = location.trim();
  const cleanedWebsiteUrl = normalizeProfileWebsite(websiteUrl);

  if (cleanedDisplayName.length < 3 || cleanedDisplayName.length > 50) {
    throw new OperationError('Le pseudo doit contenir entre 3 et 50 caractères');
  }
  if (cleanedBio.length > 300) throw new OperationError('La bio ne doit pas dépasser 300 caractères');
  if (cleanedLocation.length > 80) throw new OperationError('La localisation ne doit pas dépasser 80 caractères');

  const now = new Date().toISOString();

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
          location: cleanedLocation || null,
          website_url: cleanedWebsiteUrl,
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
        location: cleanedLocation || null,
        website_url: cleanedWebsiteUrl,
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
  parentId?: string,
  mediaObjectKeys: unknown = [],
) {
  console.log('📝 [PUBLISH_MESSAGE] Nouveau message');

  try {
    if (parentId) await assertEditorialInteractionAllowed(address, parentId);
    if (parentId && Array.isArray(mediaObjectKeys) && mediaObjectKeys.length > 0) {
      throw new OperationError('Les photos sont réservées aux publications');
    }
    const media = await validatePostMediaUploads(address, mediaObjectKeys);

    const { data, error } = await supabase.rpc('publish_message_with_media_cost_idempotent', {
      p_request_id: requestId,
      p_bitcoin_address: address,
      p_content: content || '',
      p_parent_id: parentId || null,
      p_media: media,
    });
    if (error) {
      const expectedMessages = [
        'INSUFFICIENT_SHELLS',
        'Solde insuffisant',
        'Utilisateur introuvable',
        'Publication parente introuvable',
        'Le message ne peut pas être vide',
        'La publication ne peut pas être vide',
        'Le message ne peut pas dépasser 1000 caractères',
        'Les photos sont réservées aux publications',
        'Médias de publication invalides',
        'Identifiant de requête déjà utilisé avec des paramètres différents',
      ];
      const expected = expectedMessages.find((message) => error.message?.includes(message));
      if (expected) {
        await deletePostMediaObjects(media.map((item) => item.object_key));
        const status = expected.includes('INSUFFICIENT_SHELLS')
          ? 402
          : expected.includes('introuvable')
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

async function getOpinionTopics(address: string, requestId: string) {
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

      return { ...publicPost, topic_feedback_available: true };
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

  const opinionMessageIds = formattedTopics.flatMap((topic: any) =>
    topic.posts.map((post: any) => post.id)
  );
  const { data: chargedRows, error: chargeError } = await supabase.rpc('charge_message_batch_idempotent', {
    p_request_id: requestId,
    p_bitcoin_address: address,
    p_message_ids: opinionMessageIds,
    p_request_context: { view: 'opinion_topics' },
    p_messages_snapshot: formattedTopics,
  });
  if (chargeError) {
    if (chargeError.message?.includes('INSUFFICIENT_SHELLS')) throw new OperationError('INSUFFICIENT_SHELLS', 402);
    throw chargeError;
  }
  const charged = chargedRows?.[0];
  const paidTopics = Array.isArray(charged?.messages_snapshot)
    ? charged.messages_snapshot
    : formattedTopics;

  await recordMessageExposures(paidTopics.flatMap((topic: any) =>
    (topic.posts || []).map((post: any) => post.id)
  ));

  return {
    success: true,
    topics: paidTopics,
    new_balance: Number(charged?.new_balance) || 0,
    cost: Number(charged?.cost) || 0,
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
      .select(SOCIAL_MESSAGE_SELECT)
      .eq('bitcoin_address', address)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const enrichedMessages = await enrichSocialMessages(supabase, messages || [], {
      includeTopicFeedback: true,
    });

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

async function getProfileMessages(
  viewerAddress: string,
  targetAddress: string,
  category: string,
  limit: number,
  offset: number,
  requestId: string,
) {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 25, 25));
  const boundedOffset = Math.max(0, Number(offset) || 0);
  let rawMessages: any[] = [];

  if (category === 'useful') {
    const { data: votes, error: votesError } = await supabase
      .from('message_useful_votes')
      .select('message_id, created_at')
      .eq('bitcoin_address', targetAddress)
      .order('created_at', { ascending: false })
      .range(boundedOffset, boundedOffset + boundedLimit - 1);
    if (votesError) throw votesError;
    const ids = (votes || []).map((vote: any) => vote.message_id);
    if (ids.length) {
      const { data, error } = await supabase.from('messages').select(SOCIAL_MESSAGE_SELECT)
        .in('id', ids).is('deleted_at', null);
      if (error) throw error;
      const byId = new Map((data || []).map((message: any) => [message.id, message]));
      rawMessages = ids.map((id: string) => byId.get(id)).filter(Boolean);
    }
  } else {
    let query = supabase.from('messages').select(SOCIAL_MESSAGE_SELECT)
      .eq('bitcoin_address', targetAddress).is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (category === 'posts') query = query.is('parent_id', null).is('repost_of', null);
    else if (category === 'replies') query = query.not('parent_id', 'is', null);
    else if (category === 'reposts') query = query.not('repost_of', 'is', null);
    else throw new OperationError('Catégorie de profil invalide');
    const { data, error } = await query.range(boundedOffset, boundedOffset + boundedLimit - 1);
    if (error) throw error;
    rawMessages = data || [];
  }

  const enriched = await enrichSocialMessages(supabase, rawMessages, {
    includeTopicFeedback: true,
    readerAddress: viewerAddress,
  });
  const parentIds = [...new Set(enriched.map((message: any) => message.parent_id).filter(Boolean))];
  let parents: any[] = [];
  if (parentIds.length) {
    const { data, error } = await supabase.from('messages').select(SOCIAL_MESSAGE_SELECT)
      .in('id', parentIds).is('deleted_at', null);
    if (error) throw error;
    parents = await enrichSocialMessages(supabase, data || [], {
      includeTopicFeedback: true,
      readerAddress: viewerAddress,
    });
  }
  const parentsById = new Map(parents.map((message: any) => [message.id, message]));
  const snapshot = enriched.map((message: any) => ({
    ...message,
    ...(message.parent_id && parentsById.has(message.parent_id)
      ? { parent_message: parentsById.get(message.parent_id) }
      : {}),
  }));
  const billableIds = [
    ...snapshot.map((message: any) => message.id),
    ...parents.map((message: any) => message.id),
  ];
  const { data: chargedRows, error: chargeError } = await supabase.rpc('charge_message_batch_idempotent', {
    p_request_id: requestId,
    p_bitcoin_address: viewerAddress,
    p_message_ids: billableIds,
    p_request_context: {
      target_address: targetAddress,
      category,
      limit: boundedLimit,
      offset: boundedOffset,
    },
    p_messages_snapshot: snapshot,
  });
  if (chargeError) {
    if (chargeError.message?.includes('INSUFFICIENT_SHELLS')) throw new OperationError('INSUFFICIENT_SHELLS', 402);
    throw chargeError;
  }
  const charged = chargedRows?.[0];
  return {
    success: true,
    messages: Array.isArray(charged?.messages_snapshot) ? charged.messages_snapshot : snapshot,
    count: snapshot.length,
    new_balance: Number(charged?.new_balance) || 0,
    cost: Number(charged?.cost) || 0,
  };
}

async function getMessageThread(viewerAddress: string, messageId: string, requestId: string) {
  const { data: selected, error: selectedError } = await supabase.from('messages')
    .select(SOCIAL_MESSAGE_SELECT).eq('id', messageId).is('deleted_at', null).maybeSingle();
  if (selectedError) throw selectedError;
  if (!selected) throw new OperationError('Publication introuvable', 404);

  let root = selected;
  let depth = 0;
  while (root.parent_id && depth < 20) {
    const { data: parent, error } = await supabase.from('messages')
      .select(SOCIAL_MESSAGE_SELECT).eq('id', root.parent_id).is('deleted_at', null).maybeSingle();
    if (error) throw error;
    if (!parent) break;
    root = parent;
    depth += 1;
  }

  const { data: replies, error: repliesError } = await supabase.from('messages')
    .select(SOCIAL_MESSAGE_SELECT).eq('parent_id', root.id).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(50);
  if (repliesError) throw repliesError;
  const rawThread = [root, ...(replies || [])];
  if (!rawThread.some((message: any) => message.id === selected.id)) rawThread.push(selected);
  const snapshot = await enrichSocialMessages(supabase, rawThread, {
    includeTopicFeedback: true,
    readerAddress: viewerAddress,
  });
  const { data: chargedRows, error: chargeError } = await supabase.rpc('charge_message_batch_idempotent', {
    p_request_id: requestId,
    p_bitcoin_address: viewerAddress,
    p_message_ids: snapshot.map((message: any) => message.id),
    p_request_context: { message_id: messageId, view: 'thread' },
    p_messages_snapshot: snapshot,
  });
  if (chargeError) {
    if (chargeError.message?.includes('INSUFFICIENT_SHELLS')) throw new OperationError('INSUFFICIENT_SHELLS', 402);
    throw chargeError;
  }
  const charged = chargedRows?.[0];
  const paid = Array.isArray(charged?.messages_snapshot) ? charged.messages_snapshot : snapshot;
  return {
    success: true,
    root: paid.find((message: any) => message.id === root.id) || paid[0],
    comments: paid.filter((message: any) => message.id !== root.id),
    focus_id: messageId,
    new_balance: Number(charged?.new_balance) || 0,
    cost: Number(charged?.cost) || 0,
  };
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
async function getHistory(address: string, limit: number = 20, offset: number = 0) {
  console.log('🧾 [GET_HISTORY] Récupération | Limit:', limit, '| Offset:', offset);

  try {
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const boundedOffset = Math.max(0, Math.min(Number(offset) || 0, 5000));
    const sourceLimit = boundedOffset + boundedLimit + 1;

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
        .limit(sourceLimit),
      supabase
        .from('message_likes')
        .select('id, message_id, created_at')
        .eq('bitcoin_address', address)
        .order('created_at', { ascending: false })
        .limit(sourceLimit),
      supabase
        .from('message_dislikes')
        .select('id, message_id, created_at')
        .eq('bitcoin_address', address)
        .order('created_at', { ascending: false })
        .limit(sourceLimit),
      supabase
        .from('transactions')
        .select('id, amount, type, game_score, created_at')
        .eq('bitcoin_address', address)
        .in('type', [
          'game',
          'canvas',
          'read_messages',
          'social_useful',
          'profile_media_lock',
          'profile_avatar_lock',
          'profile_avatar_unlock',
          'profile_cover_lock',
          'profile_cover_unlock',
        ])
        .order('created_at', { ascending: false })
        .limit(sourceLimit)
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
        event_key: isComment ? 'comment' : isQuote ? 'quote' : isRepost ? 'repost' : 'message',
        action_count: 1,
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
        amount: -1,
        created_at: like.created_at,
        title: 'Like',
        event_key: 'like',
        action_count: 1,
        description: target
          ? `On ${targetType}: ${summarizeContent(target.content)}`
          : 'On a deleted post',
        detail: '1 shell'
      });
    });

    (dislikes || []).forEach((dislike: any) => {
      const target = targetMessagesById.get(dislike.message_id);
      const targetType = target?.parent_id ? 'comment' : 'post';

      history.push({
        id: `dislike:${dislike.id}`,
        type: 'dislike',
        amount: -1,
        created_at: dislike.created_at,
        title: 'Dislike',
        event_key: 'dislike',
        action_count: 1,
        description: target
          ? `On ${targetType}: ${summarizeContent(target.content)}`
          : 'On a deleted post',
        detail: '1 shell'
      });
    });

    (actions || []).forEach((action: any) => {
      const signedAmount = Number(action.amount || 0);
      const amount = toShellAmount(signedAmount);
      if (!Number.isFinite(signedAmount) || amount === 0) return;

      const actionType = action.type === 'game'
        ? 'game'
        : action.type === 'canvas'
          ? 'canvas'
          : action.type === 'social_useful'
            ? 'useful'
            : action.type.startsWith('profile_')
              ? action.type
              : 'read_messages';

      const labels: Record<string, { title: string; description: string; detail: string }> = {
        game: {
          title: 'Mini-game',
          description: action.game_score !== null && action.game_score !== undefined
            ? `Session score: ${action.game_score} points`
            : 'Game session',
          detail: `${Math.round(amount)} shells spent`
        },
        canvas: {
          title: 'Canvas',
          description: `${Math.round(amount)} pixels placed`,
          detail: `${Math.round(amount)} shells spent`
        },
        read_messages: {
          title: 'Feed reading',
          description: `${Math.round(amount)} messages loaded`,
          detail: `${Math.round(amount)} shells spent`
        },
        useful: {
          title: 'Useful',
          description: 'Marked a post or comment as useful',
          detail: `${Math.round(amount)} shells spent`
        },
        profile_media_lock: {
          title: 'Profile media',
          description: signedAmount > 0 ? 'Profile media removed' : 'Profile media added',
          detail: `${Math.round(amount)} shells ${signedAmount > 0 ? 'unlocked' : 'locked'}`
        },
        profile_avatar_lock: {
          title: 'Profile photo',
          description: 'Profile photo added',
          detail: `${Math.round(amount)} shells locked`
        },
        profile_avatar_unlock: {
          title: 'Profile photo',
          description: 'Profile photo removed',
          detail: `${Math.round(amount)} shells unlocked`
        },
        profile_cover_lock: {
          title: 'Cover photo',
          description: 'Cover photo added',
          detail: `${Math.round(amount)} shells locked`
        },
        profile_cover_unlock: {
          title: 'Cover photo',
          description: 'Cover photo removed',
          detail: `${Math.round(amount)} shells unlocked`
        }
      };

      const label = labels[actionType];

      history.push({
        id: `${actionType}:${action.id}`,
        type: actionType,
        amount: actionType.startsWith('profile_') ? signedAmount : -amount,
        created_at: action.created_at,
        title: label.title,
        description: label.description,
        detail: label.detail,
        event_key: actionType,
        action_count: actionType === 'read_messages' || actionType === 'canvas'
          ? Math.round(amount)
          : 1,
      });
    });

    const allHistory = history.sort((left, right) => {
        const leftTime = new Date(left.created_at).getTime() || 0;
        const rightTime = new Date(right.created_at).getTime() || 0;
        return rightTime - leftTime;
      });
    const sortedHistory = allHistory.slice(boundedOffset, boundedOffset + boundedLimit);
    const hasMore = allHistory.length > boundedOffset + sortedHistory.length;

    console.log(`✅ [GET_HISTORY] ${sortedHistory.length} événements récupérés`);

    return {
      success: true,
      history: sortedHistory,
      count: sortedHistory.length,
      has_more: hasMore,
      next_offset: boundedOffset + sortedHistory.length,
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
    const costPerPixel = 1;
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
      location,
      websiteUrl,
      mediaKind,
      contentType,
      fileSize,
      objectKey,
      objectKeys,
      files,
      mediaObjectKeys,
      messageId,
      quoteContent,
      topicId,
      stance,
      sortMode,
      cursor,
      requestId,
      targetAddress,
      category,
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
        result = await getHistory(address, limit || 20, offset || 0);
        break;
      
      case 'publish_message':
        if (typeof content !== 'string') throw new Error('Paramètre "content" invalide');
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
          throw new OperationError('Paramètre "requestId" invalide');
        }
        if (content.length > 1000) throw new Error('Message trop long (max 1000 caractères)');
        result = await publishMessage(address, content, requestId, parentId, mediaObjectKeys);
        break;
      
      case 'get_messages':
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
          throw new OperationError('Paramètre "requestId" invalide');
        }
        console.log('📨 [GET_MESSAGES] Demande de chargement:', limit || 20, 'messages');
        
        // ÉTAPE 1 : Charger les messages d'abord pour connaître le nombre exact
        const messagesResult = await getMessages(
          supabase,
          limit || 20,
          offset || 0,
          address,
          body.parentId,
          sortMode || 'recent',
          cursor,
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
              ...(typeof cursor === 'string' ? { cursor } : {}),
            },
            p_messages_snapshot: attachFeedPageContext(messagesResult.messages, {
              has_more: Boolean(messagesResult.has_more),
              next_cursor: messagesResult.next_cursor || null,
            }),
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
        const paidSnapshot = extractFeedPageSnapshot(
          charged.messages_snapshot,
          messagesResult.messages,
          {
            has_more: Boolean(messagesResult.has_more),
            next_cursor: messagesResult.next_cursor || null,
          },
        );
        const paidPageContext = paidSnapshot.context;
        const paidMessages = paidSnapshot.messages;

        await recordMessageExposures(
          paidMessages.map((message: any) => message.id)
        );

        if (sortMode === 'for_you' && !body.parentId) {
          const paidAlgorithmVersion = paidMessages.find(
            (message: any) => typeof message.recommendation_algorithm_version === 'string'
          )?.recommendation_algorithm_version || messagesResult.algorithm_version;

          if (typeof paidAlgorithmVersion === 'string') {
            await recordForYouImpressions(
              supabase,
              address,
              requestId,
              paidMessages.map((message: any) => message.id),
              paidAlgorithmVersion
            );
          } else if (paidMessages.length > 0) {
            console.error('❌ [FOR_YOU_IMPRESSIONS] Version de classement absente');
          }
        }

        console.log(`✅ [GET_MESSAGES] ${Math.round(totalCost)} shells déduits`);
        
        // Retourner les 20 messages et le résultat de leur débit unique.
        result = {
          ...messagesResult,
          messages: paidMessages,
          count: paidMessages.length,
          algorithm_version: paidMessages.find(
            (message: any) => typeof message.recommendation_algorithm_version === 'string'
          )?.recommendation_algorithm_version || messagesResult.algorithm_version || null,
          has_more: Boolean(paidPageContext.has_more),
          next_cursor: paidPageContext.next_cursor || null,
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
        result = await recordForYouFeedback(supabase, address, messageId);
        break;

      case 'set_editorial_author_preference':
        if (!targetAddress) throw new OperationError('Paramètre "targetAddress" manquant');
        if (!['none', 'reduce', 'mute', 'block'].includes(preference)) {
          throw new OperationError('Choix éditorial invalide');
        }
        result = await setEditorialAuthorPreference(address, targetAddress, preference);
        break;

      case 'set_editorial_topic_preference':
        if (!messageId) throw new OperationError('Paramètre "messageId" manquant');
        if (!['none', 'reduce'].includes(preference)) {
          throw new OperationError('Choix éditorial invalide');
        }
        result = await setEditorialTopicPreference(address, messageId, preference);
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
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) throw new OperationError('Paramètre "requestId" invalide');
        result = await getOpinionTopics(address, requestId);
        break;

      case 'set_private_topic_stance':
        if (!topicId) throw new Error('Paramètre "topicId" manquant');
        if (!stance) throw new Error('Paramètre "stance" manquant');
        result = await setPrivateTopicStance(address, topicId, stance);
        break;

      case 'get_user_messages':
        result = await getUserMessages(address, limit || 20, offset || 0);
        break;

      case 'get_profile_messages':
        if (!targetAddress) throw new OperationError('Paramètre "targetAddress" manquant');
        if (!['posts', 'replies', 'reposts', 'useful'].includes(category)) throw new OperationError('Catégorie de profil invalide');
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) throw new OperationError('Paramètre "requestId" invalide');
        result = await getProfileMessages(address, targetAddress, category, limit, offset, requestId);
        break;

      case 'get_message_thread':
        if (!messageId) throw new OperationError('Paramètre "messageId" manquant');
        if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) throw new OperationError('Paramètre "requestId" invalide');
        result = await getMessageThread(address, messageId, requestId);
        break;
      
      case 'get_stats':
        result = await getStats(address);
        break;

      case 'upsert_profile':
        if (!displayName) throw new Error('Paramètre "displayName" manquant');
        result = await upsertProfile(
          address,
          displayName,
          bio || '',
          location || '',
          websiteUrl || '',
        );
        break;

      case 'create_profile_media_upload':
        result = await createProfileMediaUpload(address, mediaKind, contentType, Number(fileSize));
        break;

      case 'confirm_profile_media_upload':
        result = await confirmProfileMediaUpload(address, mediaKind, objectKey);
        break;

      case 'remove_profile_media':
        result = await removeProfileMedia(address, mediaKind);
        break;

      case 'create_post_media_uploads':
        result = await createPostMediaUploads(address, files);
        break;

      case 'discard_post_media_uploads':
        result = await discardPostMediaUploads(address, objectKeys);
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
    const insufficientShells = /INSUFFICIENT_SHELLS|solde insuffisant/i.test(error?.message || '');
    const status = insufficientShells
      ? 402
      : error?.message === 'Origin not allowed'
      ? 403
      : error instanceof OperationError
        ? error.status
        : 500;
    const publicMessage = insufficientShells
      ? 'INSUFFICIENT_SHELLS'
      : status === 500
      ? 'Une erreur interne est survenue. Veuillez réessayer.'
      : error?.message || 'Requête invalide';

    return jsonResponse(req, { success: false, error: publicMessage }, status);
  }
});
