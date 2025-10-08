// src/hooks/useBitcoinBalance.js - VERSION SÉCURISÉE (Mempool.space API + Signature)
import { useState, useCallback } from 'react';
import { 
  getUserBalance, 
  deductGameCost, 
  updateGameScore, 
  getTransactionHistory, 
  getUserStats,
  syncBeforeCriticalAction,
  verifyBitcoinSignature
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
        total: confirmedBalance + unconfirmedBalance,
        txCount: data.chain_stats.tx_count,
        mempoolTxCount: data.mempool_stats.tx_count
      };
    } catch (error) {
      console.error('Erreur fetchConfirmedBalance:', error);
      throw error;
    }
  };

  const checkBitcoinBalance = useCallback(async (bitcoinAddress, signatureData = null) => {
    console.log('checkBitcoinBalance appelé avec:', { bitcoinAddress, hasSignature: !!signatureData });
    
    try {
      setLoading(true);
      setError('');
      
      let signatureVerified = false;
      
      if (signatureData) {
        console.log('Vérification de la signature cryptographique...');
        
        try {
          const networkConfig = process.env.REACT_APP_BITCOIN_NETWORK || 'mainnet';
          
          const verificationResult = await verifyBitcoinSignature({
            address: bitcoinAddress,
            message: signatureData.message,
            signature: signatureData.signature,
            network: networkConfig
          });
          
          if (!verificationResult.valid) {
            throw new Error('Signature cryptographique invalide. La preuve de propriété a échoué.');
          }
          
          console.log('Signature vérifiée avec succès !');
          signatureVerified = true;
          
        } catch (err) {
          console.error('Erreur vérification signature:', err);
          setError('Échec de la vérification cryptographique : ' + err.message);
          setVerificationStatus('error');
          return false;
        }
      }
      
      const balances = await fetchConfirmedBalance(bitcoinAddress);
      const balanceBTC = balances.confirmed;
      const unconfirmedBTC = balances.unconfirmed;
      
      setBtcBalance(balanceBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      console.log('Soldes détectés:', {
        confirmed: balanceBTC,
        unconfirmed: unconfirmedBTC,
        total: balances.total
      });
      
      const minimumBTC = 0.00001;
      
      if (balanceBTC < minimumBTC) {
        if (unconfirmedBTC > 0) {
          setError(
            `Solde en attente de confirmation\n\n` +
            `Solde confirmé : ${balanceBTC.toFixed(8)} BTC\n` +
            `En attente : ${unconfirmedBTC.toFixed(8)} BTC\n` +
            `Minimum requis : ${minimumBTC} BTC\n\n` +
            `Veuillez attendre au moins 1 confirmation blockchain (environ 10 minutes).\n` +
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
      
      try {
        const userBalance = await getUserBalance(
          bitcoinAddress, 
          balanceBTC,
          signatureData ? {
            message: signatureData.message,
            signature: signatureData.signature,
            timestamp: signatureData.timestamp,
            verified: signatureVerified
          } : null
        );
        
        setWbtcAvailable(userBalance.wbtc_available);
        setWbtcSpentTotal(userBalance.wbtc_spent_total);
        setVerificationStatus('success');
        
        let message = '';
        
        if (userBalance.isNew) {
          message = 
            `Compte wBTC créé avec succès !\n\n` +
            `Solde BTC confirmé : ${balanceBTC.toFixed(8)} BTC\n` +
            `Solde wBTC : ${userBalance.wbtc_available.toFixed(8)} wBTC\n` +
            `Parties disponibles : ${Math.floor(userBalance.wbtc_available / 0.000001)}\n\n` +
            `Coût par partie : 0.000001 wBTC`;
          
          if (signatureVerified) {
            message += `\n\nSignature cryptographique vérifiée`;
          }
          
          if (unconfirmedBTC > 0) {
            message += `\n\nEn attente de confirmation : ${unconfirmedBTC.toFixed(8)} BTC`;
          }
          
          alert(message);
          
        } else if (userBalance.synced) {
          const syncType = userBalance.syncDelta > 0 ? 'Rechargement' : 'Retrait';
          
          message = 
            `Synchronisation effectuée !\n\n` +
            `${syncType} détecté : ${Math.abs(userBalance.syncDelta).toFixed(8)} BTC\n` +
            `Nouveau solde wBTC : ${userBalance.wbtc_available.toFixed(8)} wBTC\n` +
            `Parties disponibles : ${Math.floor(userBalance.wbtc_available / 0.000001)}`;
          
          if (unconfirmedBTC > 0) {
            message += `\n\nEn attente : ${unconfirmedBTC.toFixed(8)} BTC`;
          }
          
          alert(message);
        }
        
        return true;
        
      } catch (err) {
        console.error('Erreur synchronisation wBTC:', err);
        setError('Erreur lors de la synchronisation avec la base de données : ' + err.message);
        setVerificationStatus('error');
        return false;
      }
      
    } catch (err) {
      if (err.message === 'API_ERROR') {
        setError('Erreur de connexion à la blockchain. Vérifiez votre connexion internet.');
      } else {
        setError('Erreur lors de la vérification de l\'adresse: ' + err.message);
      }
      setVerificationStatus('error');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const startGame = useCallback(async () => {
    setError('');
    const gameCost = 0.000001;
    
    try {
      setLoading(true);
      
      const updated = await deductGameCost(address, gameCost);
      
      setWbtcAvailable(updated.wbtc_available);
      setWbtcSpentTotal(updated.wbtc_spent_total);
      setBtcBalance(updated.btc_balance);
      
      setError('');
      return true;
      
    } catch (err) {
      console.error('Erreur lors du paiement:', err);
      
      if (err.message.includes('insuffisant')) {
        setError(
          `Solde wBTC insuffisant\n\n` +
          `Requis : ${gameCost.toFixed(4)} wBTC\n` +
          `Actuel : ${wbtcAvailable.toFixed(8)} wBTC\n\n` +
          `Rechargez votre compte Bitcoin pour continuer.`
        );
      } else if (err.message.includes('Conflit')) {
        setError('Action trop rapide. Veuillez réessayer dans quelques secondes.');
      } else if (err.message.includes('attendre')) {
        setError('Trop de requêtes. Veuillez patienter 1 minute.');
      } else {
        setError('Erreur : ' + err.message);
      }
      
      return false;
      
    } finally {
      setLoading(false);
    }
  }, [address, wbtcAvailable]);

  const manualSync = useCallback(async () => {
    if (!address) return;
    
    try {
      setLoading(true);
      setError('');
      
      const balances = await fetchConfirmedBalance(address);
      const confirmedBTC = balances.confirmed;
      const unconfirmedBTC = balances.unconfirmed;
      
      console.log('Synchronisation manuelle:', balances);
      
      const synced = await syncBeforeCriticalAction(address);
      setWbtcAvailable(synced.wbtc_available);
      setWbtcSpentTotal(synced.wbtc_spent_total);
      setBtcBalance(confirmedBTC);
      setBtcUnconfirmed(unconfirmedBTC);
      
      let message = 
        `Synchronisation réussie !\n\n` +
        `BTC confirmé : ${confirmedBTC.toFixed(8)} BTC\n` +
        `wBTC disponible : ${synced.wbtc_available.toFixed(8)} wBTC\n` +
        `Total dépensé : ${synced.wbtc_spent_total.toFixed(8)} wBTC\n` +
        `Parties restantes : ${Math.floor(synced.wbtc_available / 0.000001)}`;
      
      if (unconfirmedBTC > 0) {
        message += `\n\nEn attente : ${unconfirmedBTC.toFixed(8)} BTC (non confirmé)`;
      }
      
      alert(message);
      
    } catch (err) {
      if (err.message === 'API_RATE_LIMIT') {
        setError('Trop de requêtes. Veuillez attendre 1 minute.');
      } else {
        setError('Erreur lors de la synchronisation : ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [address]);

  const loadHistory = useCallback(async () => {
    if (!address) return [];
    
    try {
      setLoading(true);
      const history = await getTransactionHistory(address, 20);
      return history;
    } catch (err) {
      setError('Erreur lors du chargement de l\'historique : ' + err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [address]);

  const loadStats = useCallback(async () => {
    if (!address) return null;
    
    try {
      setLoading(true);
      const userStats = await getUserStats(address);
      return userStats;
    } catch (err) {
      setError('Erreur lors du chargement des statistiques : ' + err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [address]);

  const saveGameScore = useCallback(async (score) => {
    try {
      await updateGameScore(address, score);
    } catch (err) {
      console.error('Erreur lors de la sauvegarde du score:', err);
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
    saveGameScore,
  };
};