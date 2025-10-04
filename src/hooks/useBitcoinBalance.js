// src/hooks/useBitcoinBalance.js - VERSION SÉCURISÉE (Mempool.space API)
import { useState } from 'react';
import { 
  getUserBalance, 
  deductGameCost, 
  updateGameScore, 
  getTransactionHistory, 
  getUserStats,
  syncBeforeCriticalAction 
} from '../supabaseClient';

export const useBitcoinBalance = () => {
  const [address, setAddress] = useState('');
  const [btcBalance, setBtcBalance] = useState(0);
  const [btcUnconfirmed, setBtcUnconfirmed] = useState(0);
  const [wbtcAvailable, setWbtcAvailable] = useState(0);
  const [wbtcSpentTotal, setWbtcSpentTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');

  /**
   * 🔒 SÉCURISÉ : Utiliser Mempool.space pour obtenir le solde confirmé
   * @param {string} btcAddress - Adresse Bitcoin
   * @returns {object} { confirmed, unconfirmed, total }
   */
  const fetchConfirmedBalance = async (btcAddress) => {
    try {
      // 🌐 API Mempool.space - Gratuite et sans limite
      const response = await fetch(
        `https://mempool.space/api/address/${btcAddress}`
      );
      
      if (!response.ok) {
        if (response.status === 404) {
          // Adresse valide mais sans transactions = solde 0
          return { confirmed: 0, unconfirmed: 0, total: 0 };
        }
        throw new Error('API_ERROR');
      }
      
      const data = await response.json();
      
      // ✅ Mempool.space retourne explicitement les soldes séparés
      const confirmedBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
      const unconfirmedBalance = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum) / 100000000;
      
      return {
        confirmed: confirmedBalance,
        unconfirmed: unconfirmedBalance,
        total: confirmedBalance + unconfirmedBalance,
        // Infos supplémentaires utiles
        txCount: data.chain_stats.tx_count,
        mempoolTxCount: data.mempool_stats.tx_count
      };
      
    } catch (error) {
      console.error('❌ Erreur fetchConfirmedBalance:', error);
      throw error;
    }
  };

  /**
   * Vérifier le solde Bitcoin et créer/synchroniser le compte wBTC
   * @param {string} btcAddress - Adresse Bitcoin
   * @returns {boolean} Succès de la vérification
   */
  const checkBitcoinBalance = async (btcAddress) => {
    try {
      setLoading(true);
      setError('');
      
      // 🔒 1. Vérifier le solde BTC CONFIRMÉ sur la blockchain
      const balances = await fetchConfirmedBalance(btcAddress);
      
      const balanceBTC = balances.confirmed; // ⭐ Uniquement confirmé
      const unconfirmedBTC = balances.unconfirmed;
      
      setBtcBalance(balanceBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      console.log('📊 Soldes détectés:', {
        confirmed: balanceBTC,
        unconfirmed: unconfirmedBTC,
        total: balances.total
      });
      
      // 2. Vérifier le minimum requis (CONFIRMÉ uniquement)
      const minimumBTC = 0.001;
      
      if (balanceBTC < minimumBTC) {
        // Message adapté selon s'il y a des fonds non confirmés
        if (unconfirmedBTC > 0) {
          setError(
            `⏳ Solde en attente de confirmation\n\n` +
            `✅ Solde confirmé : ${balanceBTC.toFixed(8)} BTC\n` +
            `⏳ En attente : ${unconfirmedBTC.toFixed(8)} BTC\n` +
            `📍 Minimum requis : ${minimumBTC} BTC\n\n` +
            `Veuillez attendre au moins 1 confirmation blockchain (≈10 minutes).\n` +
            `Total une fois confirmé : ${balances.total.toFixed(8)} BTC`
          );
        } else {
          setError(
            `❌ Solde insuffisant\n\n` +
            `Minimum requis : ${minimumBTC} BTC\n` +
            `Votre solde confirmé : ${balanceBTC.toFixed(8)} BTC`
          );
        }
        setVerificationStatus('insufficient');
        return false;
      }
      
      // 3. Créer ou synchroniser le compte wBTC (avec solde CONFIRMÉ)
      try {
        const userBalance = await getUserBalance(btcAddress, balanceBTC);
        setWbtcAvailable(userBalance.wbtc_available);
        setWbtcSpentTotal(userBalance.wbtc_spent_total);
        
        setVerificationStatus('success');
        
        // Messages informatifs
        let message = '';
        
        if (userBalance.isNew) {
          message = 
            `🎉 Compte wBTC créé avec succès !\n\n` +
            `✅ Solde BTC confirmé : ${balanceBTC.toFixed(8)} BTC\n` +
            `💎 Solde wBTC : ${userBalance.wbtc_available.toFixed(8)} wBTC\n` +
            `🎮 Parties disponibles : ${Math.floor(userBalance.wbtc_available / 0.0001)}\n\n` +
            `💰 Coût par partie : 0.0001 wBTC`;
          
          if (unconfirmedBTC > 0) {
            message += `\n\n⏳ En attente de confirmation : ${unconfirmedBTC.toFixed(8)} BTC`;
          }
          
          alert(message);
          
        } else if (userBalance.synced) {
          const syncType = userBalance.syncDelta > 0 ? 'Rechargement' : 'Retrait';
          const syncIcon = userBalance.syncDelta > 0 ? '➕' : '➖';
          
          message = 
            `🔄 Synchronisation effectuée !\n\n` +
            `${syncIcon} ${syncType} détecté : ${Math.abs(userBalance.syncDelta).toFixed(8)} BTC\n` +
            `💎 Nouveau solde wBTC : ${userBalance.wbtc_available.toFixed(8)} wBTC\n` +
            `🎮 Parties disponibles : ${Math.floor(userBalance.wbtc_available / 0.0001)}`;
          
          if (unconfirmedBTC > 0) {
            message += `\n\n⏳ En attente : ${unconfirmedBTC.toFixed(8)} BTC`;
          }
          
          alert(message);
        }
        
        return true;
        
      } catch (err) {
        console.error('❌ Erreur synchronisation wBTC:', err);
        setError('Erreur lors de la synchronisation avec la base de données : ' + err.message);
        setVerificationStatus('error');
        return false;
      }
      
    } catch (err) {
      if (err.message === 'API_ERROR') {
        setError('❌ Erreur de connexion à la blockchain. Vérifiez votre connexion internet.');
      } else {
        setError('❌ Erreur lors de la vérification de l\'adresse: ' + err.message);
      }
      setVerificationStatus('error');
      return false;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Démarrer une partie (débiter wBTC)
   * @returns {boolean} Succès du paiement
   */
  const startGame = async () => {
    setError('');
    const gameCost = 0.0001;
    
    try {
      setLoading(true);
      
      // 🔒 PROTECTION NIVEAU 1 : Synchroniser + Vérifier + Débiter
      const updated = await deductGameCost(address, gameCost);
      
      // Mettre à jour l'interface
      setWbtcAvailable(updated.wbtc_available);
      setWbtcSpentTotal(updated.wbtc_spent_total);
      setBtcBalance(updated.btc_balance);
      
      setError('');
      return true;
      
    } catch (err) {
      console.error('❌ Erreur lors du paiement:', err);
      
      // Messages d'erreur personnalisés
      if (err.message.includes('insuffisant')) {
        setError(
          `❌ Solde wBTC insuffisant\n\n` +
          `Requis : ${gameCost.toFixed(4)} wBTC\n` +
          `Actuel : ${wbtcAvailable.toFixed(8)} wBTC\n\n` +
          `Rechargez votre compte Bitcoin pour continuer.`
        );
      } else if (err.message.includes('Conflit')) {
        setError('⚠️ Action trop rapide. Veuillez réessayer dans quelques secondes.');
      } else if (err.message.includes('attendre')) {
        setError('⏱️ Trop de requêtes. Veuillez patienter 1 minute.');
      } else {
        setError('❌ Erreur : ' + err.message);
      }
      
      return false;
      
    } finally {
      setLoading(false);
    }
  };

  /**
   * Synchroniser manuellement
   */
  const manualSync = async () => {
    if (!address) return;
    
    try {
      setLoading(true);
      setError('');
      
      // 🔒 Récupérer le solde confirmé depuis Mempool.space
      const balances = await fetchConfirmedBalance(address);
      const confirmedBTC = balances.confirmed;
      const unconfirmedBTC = balances.unconfirmed;
      
      console.log('🔄 Synchronisation manuelle:', balances);
      
      // Synchroniser avec Supabase en utilisant le solde confirmé
      const synced = await syncBeforeCriticalAction(address);
      setWbtcAvailable(synced.wbtc_available);
      setWbtcSpentTotal(synced.wbtc_spent_total);
      setBtcBalance(confirmedBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      let message = 
        `✅ Synchronisation réussie !\n\n` +
        `✅ BTC confirmé : ${confirmedBTC.toFixed(8)} BTC\n` +
        `💎 wBTC disponible : ${synced.wbtc_available.toFixed(8)} wBTC\n` +
        `📊 Total dépensé : ${synced.wbtc_spent_total.toFixed(8)} wBTC\n` +
        `🎮 Parties restantes : ${Math.floor(synced.wbtc_available / 0.0001)}`;
      
      if (unconfirmedBTC > 0) {
        message += `\n\n⏳ En attente : ${unconfirmedBTC.toFixed(8)} BTC (non confirmé)`;
      }
      
      alert(message);
      
    } catch (err) {
      if (err.message === 'API_RATE_LIMIT') {
        setError('⏱️ Trop de requêtes. Veuillez attendre 1 minute.');
      } else {
        setError('❌ Erreur lors de la synchronisation : ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Charger l'historique
   */
  const loadHistory = async () => {
    if (!address) return [];
    
    try {
      setLoading(true);
      const history = await getTransactionHistory(address, 20);
      return history;
    } catch (err) {
      setError('❌ Erreur lors du chargement de l\'historique : ' + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  /**
   * Charger les statistiques
   */
  const loadStats = async () => {
    if (!address) return null;
    
    try {
      setLoading(true);
      const userStats = await getUserStats(address);
      return userStats;
    } catch (err) {
      setError('❌ Erreur lors du chargement des statistiques : ' + err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Mettre à jour le score d'une partie
   */
  const saveGameScore = async (score) => {
    try {
      await updateGameScore(address, score);
    } catch (err) {
      console.error('❌ Erreur lors de la sauvegarde du score:', err);
    }
  };

  return {
    // États
    address,
    btcBalance, // Solde CONFIRMÉ uniquement
    btcUnconfirmed, // Solde en attente (mempool)
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    verificationStatus,
    
    // Setters
    setAddress,
    setError,
    
    // Actions
    checkBitcoinBalance,
    startGame,
    manualSync,
    loadHistory,
    loadStats,
    saveGameScore,
  };
};