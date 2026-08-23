// src/supabaseClient.js - VERSION SÉCURISÉE AVEC JWT + RÉSEAU SOCIAL + HISTORIQUE
import { createClient } from '@supabase/supabase-js';
import { friendlyShellError } from './lib/shells';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
const authApiBaseUrl = (
  process.env.REACT_APP_AUTH_API_URL
  || '/api/auth'
).replace(/\/$/, '');
let accessToken = null;
let sessionRefreshPromise = null;

if (typeof window !== 'undefined') {
  localStorage.removeItem('btc_auth_token');
  localStorage.removeItem('bitcoin_address');
  localStorage.removeItem('walletConnected');
}

// ========================================
// 🔐 GESTION JWT
// ========================================

function storeJWT(jwt) {
  accessToken = jwt || null;
  localStorage.removeItem('btc_auth_token');
  localStorage.removeItem('bitcoin_address');
  localStorage.removeItem('walletConnected');
}

function getJWT() {
  return accessToken;
}

function clearJWT() {
  accessToken = null;
  localStorage.removeItem('btc_auth_token');
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function accessTokenNeedsRefresh(token) {
  const payload = decodeJwtPayload(token || '');
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now() + 60_000;
}

async function authApiRequest(functionName, body) {
  const response = await fetch(`${authApiBaseUrl}/${functionName}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Authentication service unavailable');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function edgeFunctionErrorMessage(error, fallback) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === 'string' && payload.error.trim()) return friendlyShellError(payload.error);
    } catch {
      // Fall through to the SDK message when the response is not JSON.
    }
  }
  return friendlyShellError(error?.message, fallback);
}

export async function restoreSession() {
  if (sessionRefreshPromise) return sessionRefreshPromise;

  const refresh = async () => {
    try {
      return await authApiRequest('auth-session', { action: 'refresh' });
    } catch (error) {
      if (error.status !== 409) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return authApiRequest('auth-session', { action: 'refresh' });
    }
  };

  sessionRefreshPromise = refresh()
    .then((data) => {
      if (!data.authenticated || !data.accessToken || !data.address) return null;
      storeJWT(data.accessToken);
      return { address: data.address };
    })
    .catch((error) => {
      clearJWT();
      if (error.status === 401) return null;
      throw error;
    })
    .finally(() => {
      sessionRefreshPromise = null;
    });

  return sessionRefreshPromise;
}

export async function logoutSession() {
  try {
    await authApiRequest('auth-session', { action: 'logout' });
  } catch (error) {
    if (error.status !== 401) throw error;
  } finally {
    clearJWT();
  }
}

export async function loginWithPassword(identifier, password) {
  const data = await authApiRequest('password-auth', {
    action: 'login',
    identifier,
    password,
  });
  if (!data.authenticated || !data.accessToken || !data.address) {
    throw new Error(data.error || 'Unable to sign in');
  }

  storeJWT(data.accessToken);
  return { address: data.address };
}

export async function configurePassword(password, { reset = false } = {}) {
  const jwt = await getAuthenticatedJWT();
  const data = await authApiRequest('password-auth', {
    action: reset ? 'reset' : 'set',
    password,
    accessToken: jwt,
  });
  if (!data.configured) throw new Error(data.error || 'Unable to save the password');
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  const jwt = await getAuthenticatedJWT();
  const data = await authApiRequest('password-auth', {
    action: 'change',
    currentPassword,
    password: newPassword,
    accessToken: jwt,
  });
  if (!data.changed) throw new Error(data.error || 'Unable to update the password');
  return data;
}

export async function skipPasswordSetup() {
  const jwt = await getAuthenticatedJWT();
  const data = await authApiRequest('password-auth', {
    action: 'skip',
    accessToken: jwt,
  });
  if (!data.skipped) throw new Error(data.error || 'Unable to continue without a password');
  return data;
}

export async function getAuthenticatedJWT() {
  if (accessToken && !accessTokenNeedsRefresh(accessToken)) return accessToken;
  const session = await restoreSession();
  if (!session || !accessToken) throw new Error('You are not authenticated. Please sign in again.');
  return accessToken;
}

export async function requestAuthChallenge({
  address,
  network = 'mainnet',
  personaId = null,
  methodId = null,
  walletName = null,
  purpose = 'login',
}) {
  return authApiRequest('auth-challenge', {
    address,
    network,
    personaId,
    methodId,
    walletName,
    purpose,
  });
}

// ========================================
// 🔧 UTILITAIRES
// ========================================

/**
 * Tronquer une adresse Bitcoin pour l'affichage
 * @param {string} address - Adresse Bitcoin complète
 * @returns {string} Adresse tronquée (ex: bc1q...xyz7)
 */
export function truncateAddress(address) {
  if (!address || address.length < 15) return address;
  return address.slice(0, 8) + '...' + address.slice(-6);
}

// ========================================
// 🔐 FONCTIONS EDGE (Architecture Sécurisée)
// ========================================

/**
 * Vérifier signature + Créer/Sync compte + Recevoir JWT
 * @param {object} params - { address, message, signature, network }
 * @returns {Promise<object>} { valid: true, jwt, user }
 */
export async function verifyAndRegister({
  address,
  message,
  signature,
  network,
  personaId = null,
  methodId = null,
  authRequest = null,
  proofFormat = null
}) {
  if (!address || !message || !signature || !network) {
    throw new Error('Verification parameters are missing');
  }
    
    // Extraction signature si format objet Xverse
  const signatureString = typeof signature === 'object' && signature.signature
    ? signature.signature
    : signature;
  const data = await authApiRequest('verify-and-register', {
        address, 
        message, 
        signature: signatureString, 
        network,
        personaId,
        methodId,
        authRequest,
        proofFormat,
    });

  if (!data?.valid) throw new Error(data?.error || 'Verification failed');
  storeJWT(data.jwt);
  return data;
}

/**
 * Récupérer données utilisateur (reconnexion)
 * @param {string} address - Adresse Bitcoin
 * @returns {Promise<object|null>} Données utilisateur ou null
 */
export async function getUserData(address, { throwOnError = false } = {}) {
  try {
    const jwt = await getAuthenticatedJWT();
    const { data, error } = await supabase.functions.invoke('get-user-data', {
      body: { address, jwt }
    });

    if (error) {
      if (throwOnError) {
        throw new Error(error.message || 'Unable to load user profile');
      }
      return null;
    }

    if (!data || !data.exists) {
      return null;
    }

    const user = data.user || {};
    const normalizedProfile = user.profile || null;
    const profileDisplayName =
      normalizedProfile?.display_name ||
      user.display_name ||
      user.profile_display_name ||
      null;

    return {
      ...user,
      profile: normalizedProfile,
      display_name: profileDisplayName,
      profile_display_name: profileDisplayName,
      has_profile: Boolean(user.has_profile || profileDisplayName)
    };
    
  } catch (error) {
    if (throwOnError) throw error;
    return null;
  }
}

function createRequestId() {
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : null;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('This browser cannot secure this request. Please update it.');
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export async function getPublicProfile(address) {
  const { data, error } = await supabase.functions.invoke('get-public-profile', {
    body: { address },
  });
  if (error) throw new Error(error.message || 'Unable to load profile');
  if (!data?.exists) return null;

  return {
    bitcoin_address: address,
    profile: data.profile,
    display_name: data.profile?.display_name || null,
    has_profile: Boolean(data.profile),
    ownership_verified: Boolean(data.profile?.ownership_verified),
    followers_count: Number(data.profile?.followers_count) || 0,
    following_count: Number(data.profile?.following_count) || 0,
    profile_counts: data.profile?.profile_counts || { posts: 0, replies: 0, reposts: 0, useful: 0 },
    created_at: data.profile?.created_at || null,
  };
}

export async function getPublicProfileConnections(address, relation, limit = 50, offset = 0) {
  const { data, error } = await supabase.functions.invoke('get-public-profile', {
    body: { address, action: 'connections', relation, limit, offset },
  });
  if (error) throw new Error(error.message || 'Unable to load profile connections');
  return {
    accounts: Array.isArray(data?.accounts) ? data.accounts : [],
    total: Number(data?.total) || 0,
  };
}

async function invokeEdgeFunction(functionName, body, fallbackMessage) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(await edgeFunctionErrorMessage(error, fallbackMessage));
  if (data?.success === false) throw new Error(data.error || fallbackMessage);
  return data;
}

async function invokeUserOperation(address, operation, payload = {}, fallbackMessage = 'Operation failed') {
  if (!address) throw new Error('Authentication required');
  const jwt = await getAuthenticatedJWT();
  return invokeEdgeFunction('user-operations', {
    operation,
    jwt,
    address,
    ...payload,
  }, fallbackMessage);
}

/**
 * Créer ou mettre à jour le pseudo du profil utilisateur
 * @param {string} address - Adresse Bitcoin
 * @param {string} displayName - Pseudo unique (3 à 50 caractères)
 * @param {string} bio - Bio optionnelle
 * @returns {Promise<object>} Profil sauvegardé
 */
export async function upsertUserProfile(address, displayName, details = {}) {
  const normalizedDetails = typeof details === 'string' ? { bio: details } : (details || {});
  const data = await invokeUserOperation(address, 'upsert_profile', {
    displayName: typeof displayName === 'string' ? displayName.trim() : '',
    bio: typeof normalizedDetails.bio === 'string' ? normalizedDetails.bio.trim() : '',
    location: typeof normalizedDetails.location === 'string' ? normalizedDetails.location.trim() : '',
    websiteUrl: typeof normalizedDetails.websiteUrl === 'string' ? normalizedDetails.websiteUrl.trim() : '',
  }, 'Could not save profile');
  return data.profile || data;
}

export async function uploadProfileMedia(address, file, mediaKind) {
  if (!(file instanceof File)) throw new Error('Choose an image first');
  const prepared = await invokeUserOperation(address, 'create_profile_media_upload', {
    mediaKind,
    contentType: file.type,
    fileSize: file.size,
  }, 'Could not prepare image upload');

  const uploadResponse = await fetch(prepared.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Image upload failed (${uploadResponse.status})`);
  }

  const confirmed = await invokeUserOperation(address, 'confirm_profile_media_upload', {
    mediaKind,
    objectKey: prepared.object_key,
  }, 'Could not confirm image upload');
  return confirmed;
}

export async function removeProfileMedia(address, mediaKind) {
  return invokeUserOperation(address, 'remove_profile_media', { mediaKind }, 'Could not remove image');
}

/**
 * Synchroniser solde BTC → shells
 * @param {string} address - Adresse Bitcoin
 * @param {string} network - 'mainnet' ou 'bitcoin'
 * @returns {Promise<object>} { success: true, user, delta }
 */
export async function syncUserBalance(address, network) {
  return invokeUserOperation(address, 'sync', { network }, 'Could not sync balance');
}

/**
 * Déduire shells pour jouer
 * @param {string} address - Adresse Bitcoin
 * Le prix fixe d'une partie est de 100 shells.
 * @returns {Promise<object>} { success: true, user }
 */
export async function deductGameCost(address) {
  return invokeUserOperation(address, 'deduct', {}, 'Balance deduction failed');
}

// ========================================
// 📝 RÉSEAU SOCIAL - MESSAGES
// ========================================

/**
 * Publier un message ou un commentaire sur le réseau social
 * @param {string} address - Adresse Bitcoin de l'auteur
 * @param {string} content - Contenu du message (max 1000 caractères)
 * @param {string|null} parentId - ID du message parent (pour commentaires)
 * @param {File[]} mediaFiles - Une à trois photos déjà optimisées
 * @returns {Promise<object>} { success: true, message: {...}, user: {...} }
 */
async function uploadPostMedia(address, files) {
  const mediaFiles = Array.from(files || []);
  if (mediaFiles.length === 0) return [];
  if (mediaFiles.length > 3 || mediaFiles.some((file) => !(file instanceof File))) {
    throw new Error('Choose between one and three optimized photos.');
  }

  const prepared = await invokeUserOperation(address, 'create_post_media_uploads', {
    files: mediaFiles.map((file) => ({
      contentType: file.type,
      fileSize: file.size,
    })),
  }, 'Could not prepare photo upload');
  const uploads = Array.isArray(prepared?.uploads) ? prepared.uploads : [];
  if (uploads.length !== mediaFiles.length) throw new Error('Photo upload preparation was incomplete.');

  try {
    await Promise.all(uploads.map(async (upload, index) => {
      const response = await fetch(upload.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': mediaFiles[index].type },
        body: mediaFiles[index],
      });
      if (!response.ok) throw new Error(`Photo ${index + 1} upload failed (${response.status}).`);
    }));
  } catch (error) {
    await invokeUserOperation(address, 'discard_post_media_uploads', {
      objectKeys: uploads.map((upload) => upload.object_key),
    }, 'Could not discard incomplete photo uploads').catch(() => null);
    throw error;
  }

  return uploads.map((upload) => upload.object_key);
}

export async function publishMessage(address, content, parentId = null, mediaFiles = []) {
  const cleanedContent = typeof content === 'string' ? content.trim() : '';
  const files = Array.from(mediaFiles || []);
  if (!cleanedContent && files.length === 0) throw new Error('Message cannot be empty');
  if (cleanedContent.length > 1000) throw new Error('Message is too long (maximum 1,000 characters)');

  const mediaObjectKeys = await uploadPostMedia(address, files);

  return invokeUserOperation(address, 'publish_message', {
      requestId: createRequestId(),
      content: cleanedContent,
      ...(parentId ? { parentId } : {}),
      ...(mediaObjectKeys.length > 0 ? { mediaObjectKeys } : {}),
  }, 'Publishing failed');
}

/**
 * Récupérer les messages du réseau social (tous les messages) ou les commentaires d'un message
 * @param {number} limit - Nombre de messages (défaut: 20)
 * @param {number} offset - Offset pour pagination (défaut: 0)
 * @param {string|null} userAddress - Adresse Bitcoin de l'utilisateur (pour ses interactions)
 * @param {string|null} parentId - ID du message parent (pour charger les commentaires)
 * @param {'for_you'|'recent'|'followed'} sortMode - Recommandations, fil global ou comptes suivis
 * @param {string|null} cursor - Curseur opaque retourné par la page précédente
 * @returns {Promise<object>} Page stable de messages avec son prochain curseur
 */
export async function getMessages(
  limit = 20,
  offset = 0,
  userAddress = null,
  parentId = null,
  sortMode = 'recent',
  cursor = null
) {
  const data = await invokeUserOperation(userAddress, 'get_messages', {
      requestId: createRequestId(),
      limit,
      offset,
      sortMode,
      ...(cursor ? { cursor } : {}),
      ...(parentId ? { parentId } : {}),
  }, 'Could not load messages');
  return {
    messages: data?.messages || [],
    hasMore: Boolean(data?.has_more),
    nextCursor: data?.next_cursor || null,
    algorithmVersion: data?.algorithm_version || null,
    new_balance: data?.new_balance,
    cost: data?.cost || 0,
  };
}

/**
 * Ajouter ou retirer le signal Useful d'une publication.
 * L'ajout verrouille 1 shell ; le retrait libère ce shell.
 */
export async function toggleMessageUseful(address, messageId) {
  return invokeUserOperation(address, 'toggle_message_useful', { messageId }, 'Could not update Useful');
}

export async function createMessageRepost(address, messageId, quoteContent = '', mediaFiles = []) {
  const cleanedQuote = typeof quoteContent === 'string' ? quoteContent.trim() : '';
  const files = Array.from(mediaFiles || []);
  const mediaObjectKeys = await uploadPostMedia(address, files);

  try {
    return await invokeUserOperation(address, 'repost_message', {
      messageId,
      quoteContent: cleanedQuote,
      ...(mediaObjectKeys.length > 0 ? { mediaObjectKeys } : {}),
    }, 'Could not repost');
  } catch (error) {
    if (mediaObjectKeys.length > 0) {
      await invokeUserOperation(address, 'discard_post_media_uploads', {
        objectKeys: mediaObjectKeys,
      }, 'Could not discard unused quote photos').catch(() => null);
    }
    throw error;
  }
}

/**
 * Retirer une publication des recommandations futures et enregistrer ce
 * signal négatif pour le classement personnalisé.
 */
export async function markForYouNotInterested(address, messageId) {
  return invokeUserOperation(
    address,
    'for_you_not_interested',
    { messageId },
    'Could not update your recommendations'
  );
}

export async function setEditorialAuthorPreference(address, targetAddress, preference) {
  if (!['none', 'reduce', 'mute', 'block'].includes(preference)) {
    throw new Error('Invalid editorial preference');
  }

  return invokeUserOperation(address, 'set_editorial_author_preference', {
    targetAddress,
    preference,
  }, 'Could not update this author preference');
}

export async function setEditorialTopicPreference(address, messageId, preference = 'reduce') {
  if (!['none', 'reduce'].includes(preference)) {
    throw new Error('Invalid editorial topic preference');
  }

  return invokeUserOperation(address, 'set_editorial_topic_preference', {
    messageId,
    preference,
  }, 'Could not update this topic preference');
}

export async function listEditorialAuthorPreferences(address) {
  const data = await invokeUserOperation(
    address,
    'list_editorial_author_preferences',
    {},
    'Could not load content controls'
  );
  return Array.isArray(data) ? data : [];
}

export async function reportEditorialMessage(address, messageId) {
  return invokeUserOperation(address, 'report_editorial_target', {
    targetKind: 'message',
    messageId,
  }, 'Could not report this post');
}

export async function reportEditorialProfile(address, profileAddress) {
  return invokeUserOperation(address, 'report_editorial_target', {
    targetKind: 'profile',
    profileAddress,
  }, 'Could not report this profile');
}

export async function listFollowingAddresses(address) {
  const jwt = await getAuthenticatedJWT();
  const data = await invokeEdgeFunction('social-follow', {
    jwt, address, action: 'list_following',
  }, 'Unable to load followed users');
  return Array.isArray(data?.following) ? data.following : [];
}

export async function setFollowingAddress(address, targetAddress, follow) {
  const jwt = await getAuthenticatedJWT();
  const data = await invokeEdgeFunction('social-follow', {
      jwt,
      address,
      targetAddress,
      action: follow ? 'follow' : 'unfollow',
  }, 'Unable to update follow');
  return {
    following: Array.isArray(data.following) ? data.following : [],
    shells_balance: Number(data.shells_balance) || 0,
    lock_delta: Number(data.lock_delta) || 0,
  };
}

/**
 * Charger les sujets Opinion et leur sélection de publications.
 * La répartition interne des perspectives n'est jamais renvoyée au navigateur.
 */
export async function getOpinionTopics(address) {
  return invokeUserOperation(address, 'get_opinion_topics', { requestId: createRequestId() }, 'Could not load Opinion mode');
}

/**
 * Sauvegarder la position privée du lecteur pour un sujet.
 */
export async function setPrivateTopicStance(address, topicId, stance) {
  return invokeUserOperation(address, 'set_private_topic_stance', { topicId, stance }, 'Could not save private stance');
}

/**
 * Récupérer l'historique des messages de l'utilisateur
 * @param {string} address - Adresse Bitcoin
 * @param {number} limit - Nombre de messages (défaut: 20)
 * @param {number} offset - Offset pour pagination (défaut: 0)
 * @returns {Promise<array>} Liste des messages de l'utilisateur
 */
export async function getUserMessages(address, limit = 20, offset = 0) {
  const data = await invokeUserOperation(address, 'get_user_messages', { limit, offset }, 'Could not load history');
  return data?.messages || [];
}

export async function getProfileMessages(address, targetAddress, category = 'posts', limit = 25, offset = 0) {
  const data = await invokeUserOperation(address, 'get_profile_messages', {
    requestId: createRequestId(),
    targetAddress,
    category,
    limit,
    offset,
  }, 'Unable to load profile posts');
  return {
    messages: Array.isArray(data?.messages) ? data.messages : [],
    new_balance: data?.new_balance,
    cost: Number(data?.cost) || 0,
  };
}

export async function getMessageThread(address, messageId, replySort = 'recent') {
  return invokeUserOperation(address, 'get_message_thread', {
    requestId: createRequestId(),
    messageId,
    replySort: replySort === 'useful' ? 'useful' : 'recent',
  }, 'Unable to load this conversation');
}

/**
 * Récupérer les statistiques utilisateur (adapté pour réseau social)
 * @param {string} address - Adresse Bitcoin
 * @returns {Promise<object|null>} Statistiques
 */
export async function getUserStats(address) {
  const data = await invokeUserOperation(address, 'get_stats', {}, 'Could not load statistics');
  return data?.stats || null;
}

/**
 * Récupérer l'historique des dépenses de l'utilisateur
 * @param {string} address - Adresse Bitcoin
 * @param {number} limit - Nombre d'éléments (défaut: 20)
 * @returns {Promise<array>} Liste des événements de dépense
 */
export async function getSpendingHistory(address, limit = 20, offset = 0) {
  const data = await invokeUserOperation(address, 'get_history', { limit, offset }, 'Could not load history');
  return {
    history: Array.isArray(data?.history) ? data.history : [],
    hasMore: Boolean(data?.has_more),
    nextOffset: Number(data?.next_offset) || 0,
  };
}

export async function deleteMessage(address, messageId) {
  const jwt = await getAuthenticatedJWT();
  return invokeEdgeFunction('social-delete', {
    jwt,
    bitcoinAddress: address,
    messageId,
  }, 'Delete failed');
}

// ============================================
// CANVAS - Récupérer tous les pixels
// ============================================
export async function getCanvasPixels() {
  const { data, error } = await supabase
    .from('canvas_pixels')
    .select('x, y, color, bitcoin_address, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ============================================
// CANVAS - Placer des pixels (avec validation)
// ============================================
export async function placeCanvasPixels(address, pixels) {
  return invokeUserOperation(address, 'place_pixels', { pixels }, 'Could not place pixels');
}

// ============================================
// CANVAS - Compter les pixels d'un utilisateur
// ============================================
export async function getUserPixelCount(address) {
  const { count, error } = await supabase
    .from('canvas_pixels')
    .select('*', { count: 'exact', head: true })
    .eq('bitcoin_address', address);
  if (error) throw error;
  return count || 0;
}

// Export functions pour nettoyage
export { clearJWT, getJWT };
