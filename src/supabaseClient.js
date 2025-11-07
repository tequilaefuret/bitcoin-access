// src/supabaseClient.js - VERSION SÉCURISÉE AVEC JWT + CORRECTION VERIFY
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
    console.log('📍 Adresse:', address);
    console.log('🌐 Réseau:', network);
    console.log('✍️ Message:', message?.substring(0, 50) + '...');
    
    // 🆕 VALIDATION DES PARAMÈTRES
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
    console.log('📊 [getUserData] Récupération pour:', address);
    
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
  try {
    console.log('🎮 [saveGameScore] Score:', score);
    
    const jwt = getJWT();
    if (!jwt) {
      // Non bloquant si pas de JWT
      console.warn('⚠️ Pas de JWT, score non enregistré');
      return { success: false };
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'save_score',
        jwt,
        address,
        score
      }
    });

    if (error) {
      console.error('❌ Erreur save_score:', error);
      return { success: false };
    }

    console.log('✅ Score enregistré');
    return data || { success: true };
    
  } catch (error) {
    console.error('❌ [saveGameScore] Erreur:', error);
    return { success: false };
  }
}

/**
 * Récupérer l'historique
 * @param {string} address - Adresse Bitcoin
 * @param {number} limit - Nombre max (défaut: 20)
 * @returns {Promise<array>} Liste des transactions
 */
export async function getTransactionHistory(address, limit = 20) {
  try {
    console.log('📜 [getTransactionHistory] Récupération...');
    
    const jwt = getJWT();
    if (!jwt) {
      throw new Error('Non authentifié');
    }
    
    const { data, error } = await supabase.functions.invoke('user-operations', {
      body: { 
        operation: 'get_history',
        jwt,
        address,
        limit
      }
    });

    if (error) {
      console.error('❌ Erreur get_history:', error);
      return [];
    }

    console.log(`✅ ${data?.transactions?.length || 0} transactions`);
    return data?.transactions || [];
    
  } catch (error) {
    console.error('❌ [getTransactionHistory] Erreur:', error);
    return [];
  }
}

/**
 * Récupérer les statistiques
 * @param {string} address - Adresse Bitcoin
 * @returns {Promise<object|null>} Stats ou null
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

// Export functions pour nettoyage
export { clearJWT, getJWT };