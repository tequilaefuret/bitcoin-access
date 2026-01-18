// src/supabaseClient.js - VERSION SÉCURISÉE AVEC JWT + RÉSEAU SOCIAL + HISTORIQUE
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const environment = process.env.REACT_APP_ENVIRONMENT || 'development';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Variables Supabase manquantes');
}

console.log(`🌍 Environnement : ${environment}`);
console.log(`🔗 Supabase URL : ${supabaseUrl?.substring(0, 30)}...`);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ========================================
// 🔐 GESTION JWT
// ========================================

/**
 * Stocker le JWT dans localStorage
 */
function storeJWT(jwt) {
  localStorage.setItem('btc_auth_token', jwt);
  console.log('✅ JWT stocké');
}

/**
 * Récupérer le JWT depuis localStorage
 */
function getJWT() {
  return localStorage.getItem('btc_auth_token');
}

/**
 * Supprimer le JWT
 */
function clearJWT() {
  localStorage.removeItem('btc_auth_token');
  localStorage.removeItem('bitcoin_address');
  console.log('🗑️ JWT supprimé');
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
export async function verifyAndRegister({ address, message, signature, network }) {
  try {
    console.log('🔐 [VERIFY-AND-REGISTER] Démarrage...');
    console.log('📍 Adresse:', truncateAddress(address));
    console.log('🌐 Réseau:', network);
    console.log('✍️ Message:', message?.substring(0, 50) + '...');
    
    // Validation des paramètres
    if (!address || !message || !signature || !network) {
      console.error('❌ [VERIFY-AND-REGISTER] Paramètres manquants', {
        address: !!address,
        message: !!message, 
        signature: !!signature,
        network: !!network
      });
      throw new Error('Paramètres manquants pour la vérification');
    }
    
    // Extraction signature si format objet Xverse
    let signatureString = signature;
    if (typeof signature === 'object' && signature.signature) {
      signatureString = signature.signature;
      console.log('📝 Signature extraite de l\'objet');
    }
    
    console.log('🚀 Appel Edge Function...');
    const { data, error } = await supabase.functions.invoke('verify-and-register', {
      body: { 
        address, 
        message, 
        signature: signatureString, 
        network 
      }
    });

    if (error) {
      console.error('❌ Erreur Edge Function:', error);
      throw new Error(error.message || 'Erreur de vérification');
    }

    if (!data || !data.valid) {
      console.error('❌ Vérification échouée:', data);
      throw new Error(data?.error || 'Vérification échouée');
    }

    console.log('✅ Signature vérifiée !');
    console.log('🔑 JWT reçu');
    
    // Stocker JWT et adresse
    storeJWT(data.jwt);
    localStorage.setItem('bitcoin_address', address);

    return data; // { valid: true, jwt, user }
    
  } catch (error) {
    console.error('❌ [verifyAndRegister] Erreur:', error);
    throw error;
  }
}

/**
 * Récupérer données utilisateur (reconnexion)
 * @param {string} address - Adresse Bitcoin
 * @returns {Promise<object|null>} Données utilisateur ou null
 */
export async function getUserData(address) {
  try {
    console.log('📊 [getUserData] Récupération pour:', truncateAddress(address));
    
    const { data, error } = await supabase.functions.invoke('get-user-data', {
      body: { address }
    });

    if (error) {
      console.error('❌ Erreur get-user-data:', error);
      return null;
    }

    if (!data || !data.exists) {
      console.log('ℹ️ Utilisateur non trouvé');
      return null;
    }

    console.log('✅ Données récupérées');
    return data.user;
    
  } catch (error) {
    console.error('❌ [getUserData] Erreur:', error);
    return null;
  }
}

/**
 * Synchroniser solde BTC → wBTC
 * @param {string} address - Adresse Bitcoin
 * @param {string} network - 'testnet4' ou 'bitcoin'
 * @returns {Promise<object>} { success: true, user, delta }
 */
export async function syncUserBalance(address, network) {
  try {
    console.log('🔄 [syncUserBalance] Synchronisation...');
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié. Reconnectez-vous.');
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'sync',
        jwt,
        address,
        network
      }
    });

    if (error) {
      console.error('❌ Erreur sync:', error);
      throw new Error(error.message || 'Erreur synchronisation');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Synchronisation échouée');
    }

    console.log('✅ Synchronisation réussie. Delta:', data.delta);
    return data;
    
  } catch (error) {
    console.error('❌ [syncUserBalance] Erreur:', error);
    throw error;
  }
}

/**
 * Déduire wBTC pour jouer
 * @param {string} address - Adresse Bitcoin
 * @param {number} amount - Montant (défaut: 0.000001)
 * @returns {Promise<object>} { success: true, user }
 */
export async function deductGameCost(address, amount = 0.000001) {
  try {
    console.log('💳 [deductGameCost] Déduction de', amount, 'wBTC');
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié. Reconnectez-vous.');
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'deduct',
        jwt,
        address,
        amount
      }
    });

    if (error) {
      console.error('❌ Erreur deduct:', error);
      throw new Error(error.message || 'Erreur déduction');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Déduction échouée');
    }

    console.log('✅ Déduction réussie');
    return data;
    
  } catch (error) {
    console.error('❌ [deductGameCost] Erreur:', error);
    throw error;
  }
}

/**
 * Enregistrer le score
 * @param {string} address - Adresse Bitcoin
 * @param {number} score - Score obtenu
 * @returns {Promise<object>} { success: true }
 */
export async function saveGameScore(address, score) {
}

// ========================================
// 📝 RÉSEAU SOCIAL - MESSAGES
// ========================================

/**
 * Publier un message ou un commentaire sur le réseau social
 * @param {string} address - Adresse Bitcoin de l'auteur
 * @param {string} content - Contenu du message (max 1000 caractères)
 * @param {string|null} parentId - ID du message parent (pour commentaires)
 * @returns {Promise<object>} { success: true, message: {...}, user: {...} }
 */
export async function publishMessage(address, content, parentId = null) {
  try {
    const logType = parentId ? '💬 [publishComment]' : '📝 [publishMessage]';
    console.log(`${logType} Publication...`);
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié. Reconnectez-vous.');
    }
    
    // Validation
    if (!content || content.trim().length === 0) {
      throw new Error('Le message ne peut pas être vide');
    }
    
    if (content.length > 1000) {
      throw new Error('Message trop long (max 1000 caractères)');
    }
    
    const body = { 
      operation: 'publish_message',
      jwt,
      address,
      content: content.trim()
    };
    
    // Ajouter parentId si c'est un commentaire
    if (parentId) {
      body.parentId = parentId;
      console.log('💬 Commentaire du message:', parentId.slice(0, 8));
    }
    
    console.log('🔍 [DEBUG] Body envoyé:', body);

    const { data, error } = await supabase.functions.invoke('user-operations', {
      body
    });

    if (error) {
      console.error('❌ Erreur publication:', error);
      throw new Error(error.message || 'Erreur publication');
    }

    if (!data || !data.success) {
      throw new Error(data?.error || 'Publication échouée');
    }

    console.log(`✅ ${parentId ? 'Commentaire' : 'Message'} publié`);
    return data;
    
  } catch (error) {
    console.error('❌ [publishMessage] Erreur:', error);
    throw error;
  }
}

/**
 * Récupérer les messages du réseau social (tous les messages) ou les commentaires d'un message
 * @param {number} limit - Nombre de messages (défaut: 20)
 * @param {number} offset - Offset pour pagination (défaut: 0)
 * @param {string|null} userAddress - Adresse Bitcoin de l'utilisateur (pour likes/dislikes)
 * @param {string|null} parentId - ID du message parent (pour charger les commentaires)
 * @returns {Promise<array>} Liste des messages avec compteurs sociaux
 */
export async function getMessages(limit = 20, offset = 0, userAddress = null, parentId = null) {
  try {
    const logType = parentId ? '💬 [getComments]' : '📨 [getMessages]';
    console.log(`${logType} Récupération...`, { userAddress: userAddress?.slice(0, 8), limit, offset, parentId: parentId?.slice(0, 8) });
    
    // JWT obligatoire pour utilisateur authentifié
    if (!userAddress) {
      console.warn('⚠️ Pas d\'adresse utilisateur - accès refusé');
      return { messages: [], new_balance: null, cost: 0 };
    }

    const jwt = getJWT();
    if (!jwt) {
      console.error('❌ JWT manquant - utilisateur non authentifié');
      throw new Error('Authentification requise');
    }
    
    const body = { 
      operation: 'get_messages',
      limit,
      offset,
      address: userAddress,
      jwt
    };
    
    // Ajouter parentId si on charge des commentaires
    if (parentId) {
      body.parentId = parentId;
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body
    });

    if (error) {
      console.error('❌ Erreur get_messages:', error);
      throw error;
    }

    const messages = data?.messages || [];
    const newBalance = data?.new_balance;
    const cost = data?.cost || 0;

    console.log(`✅ ${messages.length} ${parentId ? 'commentaires' : 'messages'} récupérés | Coût: ${cost.toFixed(8)} wBTC`);
    
    return { messages, new_balance: newBalance, cost };
    
  } catch (error) {
    console.error('❌ [getMessages] Erreur:', error);
    throw error;
  }
}

/**
 * Récupérer l'historique des messages de l'utilisateur
 * @param {string} address - Adresse Bitcoin
 * @param {number} limit - Nombre de messages (défaut: 20)
 * @param {number} offset - Offset pour pagination (défaut: 0)
 * @returns {Promise<array>} Liste des messages de l'utilisateur
 */
export async function getUserMessages(address, limit = 20, offset = 0) {
  try {
    console.log('📜 [getUserMessages] Récupération historique...');
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié');
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'get_user_messages',
        jwt,
        address,
        limit,
        offset
      }
    });

    if (error) {
      console.error('❌ Erreur get_user_messages:', error);
      return [];
    }

    console.log(`✅ ${data?.messages?.length || 0} messages historique`);
    return data?.messages || [];
    
  } catch (error) {
    console.error('❌ [getUserMessages] Erreur:', error);
    return [];
  }
}

/**
 * Récupérer les statistiques utilisateur (adapté pour réseau social)
 * @param {string} address - Adresse Bitcoin
 * @returns {Promise<object|null>} Statistiques
 */
export async function getUserStats(address) {
  try {
    console.log('📊 [getUserStats] Récupération...');
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié');
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'get_stats',
        jwt,
        address
      }
    });

    if (error) {
      console.error('❌ Erreur get_stats:', error);
      return null;
    }

    console.log('✅ Stats récupérées');
    return data?.stats || null;
    
  } catch (error) {
    console.error('❌ [getUserStats] Erreur:', error);
    return null;
  }
}

// ============================================
// CANVAS - Récupérer tous les pixels
// ============================================
export async function getCanvasPixels() {
  try {
    const { data, error } = await supabase
      .from('canvas_pixels')
      .select('x, y, color, bitcoin_address, updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ Erreur getCanvasPixels:', err);
    throw err;
  }
}

// ============================================
// CANVAS - Placer des pixels (avec validation)
// ============================================
export async function placeCanvasPixels(address, pixels) {
  try {
    const jwt = getJWT();
    if (!jwt) throw new Error('Non authentifié');

    console.log(`🎨 Envoi de ${pixels.length} pixel(s) pour validation...`);

    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'place_pixels',
        jwt,
        address, 
        pixels
      },
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Placement pixels échoué');

    console.log(`✅ ${data.pixelsPlaced} pixel(s) placé(s)${data.conflicts > 0 ? `, ${data.conflicts} conflit(s) rejeté(s)` : ''}`);

    return data;
  } catch (err) {
    console.error('❌ Erreur placeCanvasPixels:', err);
    return { success: false, error: err.message };
  }
}

// ============================================
// CANVAS - Compter les pixels d'un utilisateur
// ============================================
export async function getUserPixelCount(address) {
  try {
    const { count, error } = await supabase
      .from('canvas_pixels')
      .select('*', { count: 'exact', head: true })
      .eq('bitcoin_address', address);

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('❌ Erreur getUserPixelCount:', err);
    throw err;
  }
}

// Export functions pour nettoyage
export { clearJWT, getJWT };