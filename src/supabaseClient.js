// src/supabaseClient.js - VERSION SÉCURISÉE (Mempool.space API + Signature)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const environment = process.env.REACT_APP_ENVIRONMENT || 'development';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('⚠️ Variables Supabase manquantes dans .env.local');
  console.error('URL:', supabaseUrl);
  console.error('Key:', supabaseAnonKey ? 'Présente' : 'Absente');
}

// 🔍 Log de debug pour vérifier l'environnement
console.log(`🌍 Environnement actuel : ${environment}`);
console.log(`🔗 Supabase URL : ${supabaseUrl?.substring(0, 30)}...`);
console.log('🔑 Clé chargée :', supabaseAnonKey ? 'OUI ✅' : 'NON ❌');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * 🔒 SÉCURISÉ : Vérification en temps réel du solde BTC CONFIRMÉ uniquement
 * Utilise Mempool.space API (gratuite, sans limite, open source)
 * @param {string} bitcoinAddress - Adresse Bitcoin
 * @returns {number} Solde BTC confirmé (au moins 1 confirmation)
 */
async function fetchRealTimeBtcBalanceConfirmed(bitcoinAddress) {
  try {
    // 🌐 API Mempool.space - Retourne explicitement confirmé vs mempool
    const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK;
    let apiUrl;
    
    if (networkConfig === 'testnet4') {
      apiUrl = `https://mempool.space/testnet4/api/address/${bitcoinAddress}`;
    } else if (networkConfig === 'testnet' || networkConfig === 'testnet3') {
      apiUrl = `https://mempool.space/testnet/api/address/${bitcoinAddress}`;
    } else {
      apiUrl = `https://mempool.space/api/address/${bitcoinAddress}`;
    }
  
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        // Adresse valide mais sans transactions = solde 0
        return 0;
      }
      throw new Error('API_ERROR');
    }
    
    const data = await response.json();
    
    // ✅ chain_stats = transactions confirmées (dans la blockchain)
    // ❌ mempool_stats = transactions non confirmées (en attente)
    const confirmedBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
    
    console.log('🔒 Solde BTC confirmé:', confirmedBalance);
    
    return confirmedBalance;
    
  } catch (error) {
    console.error('❌ Erreur fetchRealTimeBtcBalanceConfirmed:', error);
    throw error;
  }
}

/**
 * ✅ Vérifie une signature Bitcoin via Edge Function Supabase
 * @param {object} params - { address, message, signature, network }
 * @returns {Promise<object>} { valid: boolean, error?: string }
 */
export async function verifyBitcoinSignature({ address, message, signature, network }) {
  try {
    console.log('🔐 Appel Edge Function pour vérification signature...');
    console.log('📍 Adresse:', address);
    console.log('📝 Message:', message);
    console.log('🌐 Réseau:', network);
    
    // Appeler l'Edge Function Supabase
    const { data, error } = await supabase.functions.invoke('verify-bitcoin-signature', {
      body: {
        address,
        message,
        signature,
        network
      }
    });

    // Gérer les erreurs de l'Edge Function
    if (error) {
      console.error('❌ Erreur Edge Function:', error);
      return {
        valid: false,
        error: error.message || 'Erreur lors de la vérification de la signature'
      };
    }

    console.log('📥 Réponse Edge Function:', data);

    // Retourner le résultat de la vérification
    return {
      valid: data.valid === true,
      error: data.error || null,
      verified_at: data.valid ? new Date().toISOString() : null
    };

  } catch (error) {
    console.error('❌ Erreur verifyBitcoinSignature:', error);
    return {
      valid: false,
      error: error.message || 'Erreur technique lors de la vérification'
    };
  }
}

/**
 * ✅ MODIFIÉ : Récupère ou crée le compte wBTC d'un utilisateur
 * Accepte maintenant les données de signature en paramètre optionnel
 * 
 * @param {string} bitcoinAddress - Adresse Bitcoin
 * @param {number} currentBtcBalance - Solde BTC CONFIRMÉ actuel
 * @param {object|null} signatureProof - Données de signature { message, signature, timestamp, verified }
 * @returns {object} État du compte wBTC
 */
export async function getUserBalance(bitcoinAddress, currentBtcBalance, signatureProof = null) {
  try {
    // Tenter de récupérer l'utilisateur existant
    const { data: existingUser, error: fetchError } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', bitcoinAddress)
      .single();

    // Gérer l'erreur 406 (Not Acceptable) - traiter comme "non trouvé"
    if (fetchError && fetchError.code !== 'PGRST116' && fetchError.code !== 'PGRST406') {
      throw fetchError;
    }

    // Si l'utilisateur existe
    if (existingUser) {
      const btcChanged = existingUser.btc_balance !== currentBtcBalance;
      
      // Préparer les données de mise à jour
      const updateData = {
        last_sync: new Date().toISOString()
      };

      // Si le solde BTC a changé, mettre à jour wBTC
      if (btcChanged) {
        const delta = currentBtcBalance - existingUser.btc_balance;
        const newWbtcAvailable = Math.max(0, existingUser.wbtc_balance + delta);
        const wbtcSpentTotal = existingUser.wbtc_spent_total || 0;

        updateData.btc_balance = currentBtcBalance;
        updateData.wbtc_balance = newWbtcAvailable;
        updateData.wbtc_spent_total = wbtcSpentTotal;
      }

      // ✅ Si une signature est fournie, la stocker/mettre à jour
      if (signatureProof) {
        updateData.signature_proof = {
          message: signatureProof.message,
          signature: signatureProof.signature,
          timestamp: signatureProof.timestamp,
          verified: signatureProof.verified,
          verified_at: new Date().toISOString()
        };
        console.log('🔐 Mise à jour signature_proof en base');
      }

      const { data: updated, error: updateError } = await supabase
        .from('user_balances')
        .update(updateData)
        .eq('bitcoin_address', bitcoinAddress)
        .select()
        .single();

      if (updateError) throw updateError;

      // Enregistrer la transaction de sync si le solde a changé
      if (btcChanged) {
        const delta = currentBtcBalance - existingUser.btc_balance;
        await supabase.from('transactions').insert({
          bitcoin_address: bitcoinAddress,
          amount: delta,
          type: 'sync'
        });
      }

      return { 
        wbtc_available: updated.wbtc_balance,
        wbtc_spent_total: updated.wbtc_spent_total,
        btc_balance: updated.btc_balance,
        isNew: false, 
        synced: btcChanged,
        syncDelta: btcChanged ? currentBtcBalance - existingUser.btc_balance : 0
      };
    }

    // Nouvel utilisateur - préparer les données d'insertion
    const insertData = {
      bitcoin_address: bitcoinAddress,
      btc_balance: currentBtcBalance,
      wbtc_balance: currentBtcBalance,
      wbtc_spent_total: 0,
      last_sync: new Date().toISOString()
    };

    // ✅ Si une signature est fournie, l'inclure dès la création
    if (signatureProof) {
      insertData.signature_proof = {
        message: signatureProof.message,
        signature: signatureProof.signature,
        timestamp: signatureProof.timestamp,
        verified: signatureProof.verified,
        verified_at: new Date().toISOString()
      };
      console.log('🔐 Création compte avec signature_proof');
    }

    const { data: newUser, error: insertError } = await supabase
      .from('user_balances')
      .insert(insertData)
      .select()
      .single();

    // Gérer l'erreur 409 (duplicate key) - l'utilisateur existe déjà
    if (insertError && insertError.code === '23505') {
      // Race condition: l'utilisateur a été créé entre-temps
      // Réessayer de le récupérer
      const { data: retryUser, error: retryError } = await supabase
        .from('user_balances')
        .select('*')
        .eq('bitcoin_address', bitcoinAddress)
        .single();

      if (retryError) throw retryError;

      // Synchroniser avec le solde actuel si différent
      if (retryUser.btc_balance !== currentBtcBalance) {
        const delta = currentBtcBalance - retryUser.btc_balance;
        const newWbtcAvailable = Math.max(0, retryUser.wbtc_balance + delta);

        const updateData = {
          btc_balance: currentBtcBalance,
          wbtc_balance: newWbtcAvailable,
          last_sync: new Date().toISOString()
        };

        // Ajouter la signature si fournie
        if (signatureProof) {
          updateData.signature_proof = {
            message: signatureProof.message,
            signature: signatureProof.signature,
            timestamp: signatureProof.timestamp,
            verified: signatureProof.verified,
            verified_at: new Date().toISOString()
          };
        }

        const { data: updated, error: updateError } = await supabase
          .from('user_balances')
          .update(updateData)
          .eq('bitcoin_address', bitcoinAddress)
          .select()
          .single();

        if (updateError) throw updateError;

        await supabase.from('transactions').insert({
          bitcoin_address: bitcoinAddress,
          amount: delta,
          type: 'sync'
        });

        return {
          wbtc_available: updated.wbtc_balance,
          wbtc_spent_total: updated.wbtc_spent_total || 0,
          btc_balance: updated.btc_balance,
          isNew: false,
          synced: true,
          syncDelta: delta
        };
      }

      return {
        wbtc_available: retryUser.wbtc_balance,
        wbtc_spent_total: retryUser.wbtc_spent_total || 0,
        btc_balance: retryUser.btc_balance,
        isNew: false,
        synced: false
      };
    }

    // Autre erreur d'insertion
    if (insertError) throw insertError;

    return { 
      wbtc_available: newUser.wbtc_balance,
      wbtc_spent_total: newUser.wbtc_spent_total,
      btc_balance: newUser.btc_balance,
      isNew: true 
    };

  } catch (error) {
    console.error('❌ Erreur getUserBalance:', error);
    throw error;
  }
}

/**
 * 🔒 PROTECTION NIVEAU 1 : Synchronisation AVANT une action critique
 * Vérifie le solde BTC CONFIRMÉ en temps réel et synchronise
 */
export async function syncBeforeCriticalAction(bitcoinAddress) {
  try {
    console.log('🔒 Synchronisation sécurisée pour:', bitcoinAddress);
    
    // 1. Vérifier le solde BTC CONFIRMÉ en temps réel (Mempool.space)
    const realTimeBtc = await fetchRealTimeBtcBalanceConfirmed(bitcoinAddress);
    
    console.log('💰 BTC confirmé détecté:', realTimeBtc);
    
    // 2. Synchroniser avec Supabase (sans signature car c'est une sync de routine)
    const balance = await getUserBalance(bitcoinAddress, realTimeBtc, null);
    
    return balance;
    
  } catch (error) {
    if (error.message === 'API_ERROR') {
      throw new Error('Impossible de vérifier votre solde. Vérifiez votre connexion.');
    }
    throw error;
  }
}

/**
 * 🔒 Débite le compte wBTC pour une partie de jeu (AVEC PROTECTION)
 */
export async function deductGameCost(bitcoinAddress, gameCost = 0.0001) {
  try {
    console.log('💳 Tentative de débit:', gameCost, 'wBTC');
    
    // 🔒 PROTECTION : Synchroniser AVANT de débiter (vérifie BTC confirmés)
    const syncedBalance = await syncBeforeCriticalAction(bitcoinAddress);
    
    console.log('✅ Solde après sync:', syncedBalance.wbtc_available);
    
    if (syncedBalance.wbtc_available < gameCost) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const { data: currentUser, error: fetchError } = await supabase
      .from('user_balances')
      .select('wbtc_balance, wbtc_spent_total, last_sync')
      .eq('bitcoin_address', bitcoinAddress)
      .single();

    if (fetchError) throw fetchError;

    // 🎯 OPTION B : Calcul des nouveaux soldes
    const newWbtcAvailable = currentUser.wbtc_balance - gameCost;
    const newWbtcSpentTotal = (currentUser.wbtc_spent_total || 0) + gameCost;

    // 🔒 Mise à jour atomique avec protection race condition
    const { data: updated, error: updateError } = await supabase
      .from('user_balances')
      .update({ 
        wbtc_balance: newWbtcAvailable,
        wbtc_spent_total: newWbtcSpentTotal,
        last_sync: new Date().toISOString()
      })
      .eq('bitcoin_address', bitcoinAddress)
      .eq('last_sync', currentUser.last_sync) // ⭐ Lock optimiste
      .select();

    if (updateError) throw updateError;

    if (!updated || updated.length === 0) {
      throw new Error('RACE_CONDITION');
    }

    // Enregistrer la transaction
    await supabase.from('transactions').insert({
      bitcoin_address: bitcoinAddress,
      amount: -gameCost,
      type: 'game',
      game_score: null
    });

    console.log('✅ Débit réussi. Nouveau solde:', newWbtcAvailable);

    return {
      wbtc_available: updated[0].wbtc_balance,
      wbtc_spent_total: updated[0].wbtc_spent_total,
      btc_balance: updated[0].btc_balance
    };

  } catch (error) {
    console.error('❌ Erreur deductGameCost:', error);
    
    if (error.message === 'INSUFFICIENT_BALANCE') {
      throw new Error('Solde wBTC insuffisant pour jouer.');
    }
    if (error.message === 'RACE_CONDITION') {
      throw new Error('Conflit de synchronisation détecté. Veuillez réessayer.');
    }
    
    throw error;
  }
}

/**
 * Met à jour le score d'une partie dans l'historique
 */
export async function updateGameScore(bitcoinAddress, score) {
  try {
    const { data: lastGame, error: fetchError } = await supabase
      .from('transactions')
      .select('*')
      .eq('bitcoin_address', bitcoinAddress)
      .eq('type', 'game')
      .is('game_score', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !lastGame) {
      console.warn('⚠️ Aucune partie en attente de score trouvée');
      return;
    }

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ game_score: score })
      .eq('id', lastGame.id);

    if (updateError) throw updateError;

  } catch (error) {
    console.error('❌ Erreur updateGameScore:', error);
  }
}

/**
 * Récupère l'historique des transactions
 */
export async function getTransactionHistory(bitcoinAddress, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('bitcoin_address', bitcoinAddress)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];

  } catch (error) {
    console.error('❌ Erreur getTransactionHistory:', error);
    throw error;
  }
}

/**
 * 🔒 Récupère les statistiques de l'utilisateur
 */
export async function getUserStats(bitcoinAddress) {
  try {
    const { data: balance, error: balanceError } = await supabase
      .from('user_balances')
      .select('*')
      .eq('bitcoin_address', bitcoinAddress)
      .single();

    if (balanceError) throw balanceError;

    const { data: games, error: gamesError } = await supabase
      .from('transactions')
      .select('game_score')
      .eq('bitcoin_address', bitcoinAddress)
      .eq('type', 'game')
      .not('game_score', 'is', null);

    if (gamesError) throw gamesError;

    const totalGames = games.length;
    const bestScore = games.length > 0 
      ? Math.max(...games.map(g => g.game_score)) 
      : 0;
    const avgScore = games.length > 0
      ? games.reduce((sum, g) => sum + g.game_score, 0) / games.length
      : 0;

    return {
      btc_balance: balance.btc_balance,
      wbtc_available: balance.wbtc_balance,
      wbtc_spent_total: balance.wbtc_spent_total || 0,
      total_games: totalGames,
      best_score: bestScore,
      average_score: Math.round(avgScore),
      games_remaining: Math.floor(balance.wbtc_balance / 0.0001)
    };

  } catch (error) {
    console.error('❌ Erreur getUserStats:', error);
    throw error;
  }
}