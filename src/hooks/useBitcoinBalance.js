// src/hooks/useBitcoinBalance.js - VERSION SÉCURISÉE FINALE (Edge Functions uniquement)
import { useState, useCallback } from 'react';
import { 
  verifyAndRegister,
  syncUserBalance,
  deductGameCost,
  saveGameScore,
  getTransactionHistory,
  getUserStats
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
   * 🔍 Récupérer le solde BTC confirmé via Mempool.space
   * (Fonction helper locale - ne touche pas à la DB)
   */
  const fetchConfirmedBalance = async (bitcoinAddress) => {
    try {
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
          return { confirmed: 0, unconfirmed: 0, total: 0 };
        }
        throw new Error('API_ERROR');
      }
      
      const data = await response.json();
      const confirmedBalance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
      const unconfirmedBalance = (data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum) / 100000000;
      
      return {
        confirmed: confirmedBalance,
        unconfirmed: unconfirmedBalance,
        total: confirmedBalance + unconfirmedBalance
      };
    } catch (error) {
      console.error('Erreur fetchConfirmedBalance:', error);
      throw error;
    }
  };

  /**
   * 🔐 Vérifier solde Bitcoin + Signature (si fournie)
   * CETTE FONCTION UTILISE L'EDGE FUNCTION verify-and-register
   */
  const checkBitcoinBalance = useCallback(async (bitcoinAddress, signatureData = null) => {
    console.log('🔍 checkBitcoinBalance appelé avec:', { 
      bitcoinAddress, 
      hasSignature: !!signatureData 
    });
    
    try {
      setLoading(true);
      setError('');
      
      // 1️⃣ Vérifier solde BTC réel via Mempool.space
      const balances = await fetchConfirmedBalance(bitcoinAddress);
      const balanceBTC = balances.confirmed;
      const unconfirmedBTC = balances.unconfirmed;
      
      setBtcBalance(balanceBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      console.log('💰 Soldes détectés:', {
        confirmed: balanceBTC,
        unconfirmed: unconfirmedBTC,
        total: balances.total
      });
      
      const minimumBTC = 0.00001;
      
      // 2️⃣ Vérifier solde minimum
      if (balanceBTC < minimumBTC) {
        if (unconfirmedBTC > 0) {
          setError(
            `Solde en attente de confirmation\n\n` +
            `Solde confirmé : ${balanceBTC.toFixed(8)} BTC\n` +
            `En attente : ${unconfirmedBTC.toFixed(8)} BTC\n` +
            `Minimum requis : ${minimumBTC} BTC\n\n` +
            `Veuillez attendre au moins 1 confirmation blockchain (~10 min).\n` +
            `Total une fois confirmé : ${balances.total.toFixed(8)} BTC`
          );
        } else {
          setError(
            `Solde insuffisant\n\n` +
            `Minimum requis : ${minimumBTC} BTC\n` +
            `Votre solde confirmé : ${balanceBTC.toFixed(8)} BTC`
          );
        }
        setVerificationStatus('insufficient');
        return false;
      }
      
      // 3️⃣ Si signature fournie → Créer/Sync compte via Edge Function
      if (signatureData) {
        console.log('🔐 Signature fournie, appel verify-and-register...');
        
        try {
          const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK || 'mainnet';
          
          const result = await verifyAndRegister({
            address: bitcoinAddress,
            message: signatureData.message,
            signature: signatureData.signature,
            network: networkConfig === 'testnet4' ? 'testnet4' : 'bitcoin'
          });
          
          if (!result.valid) {
            throw new Error('Signature cryptographique invalide');
          }
          
          console.log('✅ Signature vérifiée et compte créé/synced !');
          
          // Mise à jour des états avec données de l'Edge Function
          setWbtcAvailable(result.user.wbtc_balance);
          setWbtcSpentTotal(result.user.wbtc_spent_total || 0);
          setBtcBalance(result.user.btc_balance);
          setVerificationStatus('success');
          
          // Message utilisateur
          const isNew = result.user.created_at === result.user.last_sync;
          let message = '';
          
          if (isNew) {
            message = 
              `✅ Compte wBTC créé avec succès !\n\n` +
              `Solde BTC confirmé : ${result.user.btc_balance.toFixed(8)} BTC\n` +
              `Solde wBTC : ${result.user.wbtc_balance.toFixed(8)} wBTC\n` +
              `Parties disponibles : ${Math.floor(result.user.wbtc_balance / 0.000001)}\n\n` +
              `Coût par partie : 0.000001 wBTC\n` +
              `Signature cryptographique vérifiée ✅`;
          } else {
            message = 
              `✅ Connexion réussie !\n\n` +
              `Solde BTC : ${result.user.btc_balance.toFixed(8)} BTC\n` +
              `Solde wBTC : ${result.user.wbtc_balance.toFixed(8)} wBTC\n` +
              `Parties disponibles : ${Math.floor(result.user.wbtc_balance / 0.000001)}`;
          }
          
          if (unconfirmedBTC > 0) {
            message += `\n\nEn attente : ${unconfirmedBTC.toFixed(8)} BTC`;
          }
          
          alert(message);
          return true;
          
        } catch (err) {
          console.error('❌ Erreur vérification signature:', err);
          setError('Échec de la vérification cryptographique : ' + err.message);
          setVerificationStatus('error');
          return false;
        }
      }
      
      // 4️⃣ Pas de signature → Simple vérification solde (reconnexion)
      console.log('ℹ️ Pas de signature, simple vérification solde');
      setVerificationStatus('success');
      return true;
      
    } catch (err) {
      if (err.message === 'API_ERROR') {
        setError('Erreur de connexion blockchain. Vérifiez votre connexion.');
      } else {
        setError('Erreur lors de la vérification : ' + err.message);
      }
      setVerificationStatus('error');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 🎮 Démarrer une partie (déduire wBTC)
   * CETTE FONCTION UTILISE L'EDGE FUNCTION user-operations (operation: 'deduct')
   */
  const startGame = useCallback(async () => {
    setError('');
    const gameCost = 0.000001;
    
    try {
      setLoading(true);
      
      console.log('🎮 Démarrage partie - déduction de', gameCost, 'wBTC');
      
      const result = await deductGameCost(address, gameCost);
      
      if (!result.success) {
        throw new Error(result.error || 'Déduction échouée');
      }
      
      // Mise à jour des états
      setWbtcAvailable(result.user.wbtc_balance);
      setWbtcSpentTotal(result.user.wbtc_spent_total);
      setBtcBalance(result.user.btc_balance);
      
      console.log('✅ Partie démarrée. Nouveau solde:', result.user.wbtc_balance);
      setError('');
      return true;
      
    } catch (err) {
      console.error('❌ Erreur démarrage partie:', err);
      
      if (err.message.includes('insuffisant') || err.message.includes('Insufficient')) {
        setError(
          `Solde wBTC insuffisant\n\n` +
          `Requis : ${gameCost.toFixed(6)} wBTC\n` +
          `Actuel : ${wbtcAvailable.toFixed(8)} wBTC\n\n` +
          `Rechargez votre compte Bitcoin pour continuer.`
        );
      } else {
        setError('Erreur : ' + err.message);
      }
      
      return false;
      
    } finally {
      setLoading(false);
    }
  }, [address, wbtcAvailable]);

  /**
   * 🔄 Synchronisation manuelle BTC → wBTC
   * CETTE FONCTION UTILISE L'EDGE FUNCTION user-operations (operation: 'sync')
   */
  const manualSync = useCallback(async () => {
    if (!address) return;
    
    try {
      setLoading(true);
      setError('');
      
      console.log('🔄 Synchronisation manuelle pour:', address);
      
      // 1️⃣ Vérifier solde BTC réel
      const balances = await fetchConfirmedBalance(address);
      const confirmedBTC = balances.confirmed;
      const unconfirmedBTC = balances.unconfirmed;
      
      console.log('💰 Soldes détectés:', balances);
      
      // 2️⃣ Appeler Edge Function pour sync
      const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK || 'mainnet';
      const result = await syncUserBalance(
        address, 
        networkConfig === 'testnet4' ? 'testnet4' : 'bitcoin'
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Synchronisation échouée');
      }
      
      // 3️⃣ Mise à jour des états
      setWbtcAvailable(result.user.wbtc_balance);
      setWbtcSpentTotal(result.user.wbtc_spent_total);
      setBtcBalance(confirmedBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      // 4️⃣ Message utilisateur
      let message = 
        `✅ Synchronisation réussie !\n\n` +
        `BTC confirmé : ${confirmedBTC.toFixed(8)} BTC\n` +
        `wBTC disponible : ${result.user.wbtc_balance.toFixed(8)} wBTC\n` +
        `Total dépensé : ${result.user.wbtc_spent_total.toFixed(8)} wBTC\n` +
        `Parties restantes : ${Math.floor(result.user.wbtc_balance / 0.000001)}`;
      
      if (result.delta !== 0) {
        const syncType = result.delta > 0 ? 'Rechargement' : 'Retrait';
        message += `\n\n${syncType} : ${Math.abs(result.delta).toFixed(8)} BTC`;
      }
      
      if (unconfirmedBTC > 0) {
        message += `\n\nEn attente : ${unconfirmedBTC.toFixed(8)} BTC`;
      }
      
      alert(message);
      
    } catch (err) {
      console.error('❌ Erreur synchronisation:', err);
      setError('Erreur synchronisation : ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 📜 Charger l'historique des transactions
   * CETTE FONCTION UTILISE L'EDGE FUNCTION user-operations (operation: 'get_history')
   */
  const loadHistory = useCallback(async () => {
    if (!address) return [];
    
    try {
      setLoading(true);
      console.log('📜 Chargement historique pour:', address);
      
      const history = await getTransactionHistory(address, 20);
      console.log(`✅ ${history.length} transactions récupérées`);
      
      return history;
    } catch (err) {
      console.error('❌ Erreur chargement historique:', err);
      setError('Erreur chargement historique : ' + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 📊 Charger les statistiques utilisateur
   * CETTE FONCTION UTILISE L'EDGE FUNCTION user-operations (operation: 'get_stats')
   */
  const loadStats = useCallback(async () => {
    if (!address) return null;
    
    try {
      setLoading(true);
      console.log('📊 Chargement stats pour:', address);
      
      const stats = await getUserStats(address);
      console.log('✅ Stats récupérées:', stats);
      
      return stats;
    } catch (err) {
      console.error('❌ Erreur chargement stats:', err);
      setError('Erreur chargement stats : ' + err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address]);

  /**
   * 💾 Sauvegarder le score d'une partie
   * CETTE FONCTION UTILISE L'EDGE FUNCTION user-operations (operation: 'save_score')
   */
  const saveGameScoreCallback = useCallback(async (score) => {
    try {
      console.log('💾 Sauvegarde score:', score);
      await saveGameScore(address, score);
      console.log('✅ Score sauvegardé');
    } catch (err) {
      console.error('❌ Erreur sauvegarde score:', err);
      // Non bloquant
    }
  }, [address]);

  return {
    address,
    btcBalance,
    btcUnconfirmed,
    wbtcAvailable,
    wbtcSpentTotal,
    loading,
    error,
    verificationStatus,
    setAddress,
    setError,
    checkBitcoinBalance,
    startGame,
    manualSync,
    loadHistory,
    loadStats,
    saveGameScore: saveGameScoreCallback,
  };
};